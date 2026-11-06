const UPSTREAM_BASE_URL = 'https://2api.dev/v1'
const UPSTREAM_HEADER = 'x-aipic-upstream'
const MAX_TEXT_BODY_CHARS = 8000
const STREAM_HEADER = 'x-aipic-proxy-stream'
const TIMEOUT_HEADER = 'x-aipic-timeout-seconds'
const STREAM_CONTENT_TYPE = 'application/x-aipic-stream; charset=utf-8'
const DEFAULT_TIMEOUT_SECONDS = 1800
const MAX_TIMEOUT_SECONDS = 3600
const HEARTBEAT_INTERVAL_MS = 15_000

interface Env {
  API_PROXY_URL?: string
  DEFAULT_API_URL?: string
}

const hopByHopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

function withCors(headers: Headers) {
  headers.set('access-control-allow-origin', '*')
  headers.set('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  headers.set('access-control-allow-headers', `*, ${UPSTREAM_HEADER}, ${STREAM_HEADER}, ${TIMEOUT_HEADER}`)
  headers.set('access-control-max-age', '86400')
  return headers
}

function normalizeBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim()
  if (!trimmed) return ''

  const input = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  try {
    const url = new URL(input)
    if (url.protocol !== 'https:') return ''

    const pathSegments = url.pathname.split('/').filter(Boolean)
    const v1Index = pathSegments.indexOf('v1')
    const normalizedSegments = v1Index >= 0
      ? pathSegments.slice(0, v1Index + 1)
      : pathSegments.length
        ? [...pathSegments, 'v1']
        : ['v1']
    return `${url.origin}/${normalizedSegments.join('/')}`
  } catch {
    return ''
  }
}

function getDefaultUpstreamBaseUrl(env: Env) {
  return normalizeBaseUrl(env.API_PROXY_URL ?? '') ||
    normalizeBaseUrl(env.DEFAULT_API_URL ?? '') ||
    UPSTREAM_BASE_URL
}

function getUpstreamBaseUrl(request: Request, env: Env) {
  return normalizeBaseUrl(request.headers.get(UPSTREAM_HEADER) ?? '') || getDefaultUpstreamBaseUrl(env)
}

function buildUpstreamUrl(request: Request, env: Env) {
  const url = new URL(request.url)
  const upstreamPath = url.pathname.replace(/^\/api-proxy\/?/, '')
  const upstreamUrl = new URL(`${getUpstreamBaseUrl(request, env).replace(/\/+$/, '')}/${upstreamPath}`)
  upstreamUrl.search = url.search
  return upstreamUrl
}

function copyRequestHeaders(request: Request) {
  const headers = new Headers(request.headers)
  headers.delete('origin')
  headers.delete('host')
  headers.delete(UPSTREAM_HEADER)
  headers.delete(STREAM_HEADER)
  headers.delete(TIMEOUT_HEADER)
  for (const header of hopByHopHeaders) headers.delete(header)
  return headers
}

/** 仅为显式启用的长耗时生图请求建立心跳传输，其他代理请求保持原有协议。 */
function shouldStreamProxy(request: Request) {
  const path = new URL(request.url).pathname.replace(/^\/api-proxy\/?/, '').replace(/\/+$/, '')
  return request.method === 'POST' && request.headers.get(STREAM_HEADER) === '1' &&
    ['images/generations', 'images/edits', 'responses'].includes(path)
}

/** 从内部请求头读取完整上游请求的时间预算，并限制最长占用时间。 */
function getTimeoutMs(request: Request) {
  const seconds = Number(request.headers.get(TIMEOUT_HEADER))
  return (Number.isFinite(seconds) && seconds > 0
    ? Math.min(seconds, MAX_TIMEOUT_SECONDS)
    : DEFAULT_TIMEOUT_SECONDS) * 1000
}

/**
 * 立即返回心跳流，在同一个请求内转发上游状态和正文，避免等待首张图片时连接长期无响应。
 * 正文按 UTF-8 分块传输，计时覆盖响应头及完整正文；取消和超时都会释放上游读取与定时器。
 */
function streamUpstreamResponse(request: Request, upstreamUrl: URL) {
  const encoder = new TextEncoder()
  const abortController = new AbortController()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let streamController: ReadableStreamDefaultController<Uint8Array>
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined
  const demandWaiters = new Set<() => void>()
  let finished = false
  let terminating = false
  let responseStarted = false

  function cleanup(removeSignal = true) {
    clearInterval(heartbeatTimer)
    clearTimeout(deadlineTimer)
    if (removeSignal) request.signal.removeEventListener('abort', abortFromRequest)
  }

  function resumeDemand() {
    for (const resolve of demandWaiters) resolve()
    demandWaiters.clear()
  }

  function stopUpstream(reason: unknown) {
    abortController.abort(reason)
    void reader?.cancel(reason).catch(() => {})
    resumeDemand()
  }

  function abortFromRequest() {
    if (finished) return
    finished = true
    cleanup()
    stopUpstream(request.signal.reason)
    streamController.error(request.signal.reason ?? new Error('请求已取消'))
  }

  /** 仅保留一个待写入分块，慢速客户端不会导致 4K 图片正文无限堆积。 */
  async function writeFrame(frame: object, terminal = false): Promise<boolean> {
    while (!finished && (!terminating || terminal) && (streamController.desiredSize ?? 0) <= 0) {
      await new Promise<void>(resolve => { demandWaiters.add(resolve) })
    }
    if (finished || (terminating && !terminal)) return false
    streamController.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`))
    return true
  }

  async function finishWithError(error: unknown, timedOut = false) {
    if (finished || terminating) return
    terminating = true
    cleanup(false)
    stopUpstream(error)
    const message = timedOut ? 'API 代理等待上游响应超时' : 'API 代理无法连接上游服务'
    if (!responseStarted) {
      await writeFrame({
        type: 'response', status: timedOut ? 504 : 502, statusText: timedOut ? 'Gateway Timeout' : 'Bad Gateway',
        headers: { 'content-type': 'application/json; charset=utf-8' },
      }, true)
      await writeFrame({ type: 'chunk', text: JSON.stringify({ error: {
        message,
        upstream: upstreamUrl.origin,
        detail: error instanceof Error ? error.message : String(error),
      } }) }, true)
    } else {
      await writeFrame({ type: 'error', message: timedOut
        ? message
        : `上游响应读取失败：${error instanceof Error ? error.message : String(error)}` }, true)
    }
    await writeFrame({ type: 'end' }, true)
    if (!finished) {
      finished = true
      cleanup()
      streamController.close()
    }
  }

  async function pump() {
    try {
      const response = await fetch(upstreamUrl, {
        method: request.method,
        headers: copyRequestHeaders(request),
        body: request.body,
        redirect: 'manual',
        signal: abortController.signal,
      })
      if (finished || terminating) {
        void response.body?.cancel().catch(() => {})
        return
      }
      reader = response.body?.getReader()
      const contentType = response.headers.get('content-type') ?? ''
      const wrapError = !response.ok && !contentType.toLowerCase().includes('application/json')
      const forwardedHeaders = new Headers()
      // 仅保留诊断和重试元数据，避免 JSON 封装绕过浏览器对 Cookie 等敏感响应头的屏蔽。
      for (const [name, value] of response.headers) {
        if (/^(content-type|retry-after|request-id|x-request-id|x-correlation-id|cf-ray)$/.test(name) ||
            /^(x-)?ratelimit(?:-|$)/.test(name)) {
          forwardedHeaders.set(name, value)
        }
      }
      if (wrapError) forwardedHeaders.set('content-type', 'application/json; charset=utf-8')
      responseStarted = await writeFrame({
        type: 'response', status: response.status, statusText: response.statusText,
        headers: Object.fromEntries(forwardedHeaders),
      })
      if (!responseStarted) return

      const decoder = new TextDecoder()
      let errorText = ''
      while (reader && !finished && !terminating) {
        const { done, value } = await reader.read()
        if (finished || terminating) return
        const text = done ? decoder.decode() : decoder.decode(value, { stream: true })
        if (wrapError) {
          errorText = (errorText + text).slice(0, MAX_TEXT_BODY_CHARS)
          if (errorText.length >= MAX_TEXT_BODY_CHARS) {
            await reader.cancel()
            break
          }
        } else if (text && !await writeFrame({ type: 'chunk', text })) {
          return
        }
        if (done) break
      }
      if (finished || terminating) return
      if (wrapError) {
        await writeFrame({ type: 'chunk', text: JSON.stringify({ error: {
          message: `上游接口返回 HTTP ${response.status}`,
          upstream: upstreamUrl.origin,
          status: response.status,
          body: errorText,
        } }) })
      }
      if (!await writeFrame({ type: 'end' })) return
      finished = true
      cleanup()
      streamController.close()
    } catch (error) {
      await finishWithError(error)
    }
  }

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller
      controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'heartbeat' })}\n`))
      if (request.signal.aborted) {
        abortFromRequest()
        return
      }
      request.signal.addEventListener('abort', abortFromRequest, { once: true })
      heartbeatTimer = setInterval(() => {
        if (!finished && !terminating && (controller.desiredSize ?? 0) > 0) {
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'heartbeat' })}\n`))
        }
      }, HEARTBEAT_INTERVAL_MS)
      deadlineTimer = setTimeout(() => {
        void finishWithError(new Error('上游请求超过完整响应时间预算'), true)
      }, getTimeoutMs(request))
      void pump()
    },
    pull() {
      resumeDemand()
    },
    cancel(reason) {
      if (finished) return
      finished = true
      cleanup()
      stopUpstream(reason)
    },
  })
  return new Response(body, { status: 200, headers: withCors(new Headers({
    'content-type': STREAM_CONTENT_TYPE,
    'cache-control': 'no-store, no-transform',
    'x-accel-buffering': 'no',
  })) })
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: withCors(new Headers()) })
  }

  const upstreamUrl = buildUpstreamUrl(request, env)
  if (shouldStreamProxy(request)) return streamUpstreamResponse(request, upstreamUrl)

  let upstreamResponse: Response
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers: copyRequestHeaders(request),
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual',
    })
  } catch (error) {
    const headers = withCors(new Headers({ 'content-type': 'application/json; charset=utf-8' }))
    return new Response(JSON.stringify({
      error: {
        message: 'API 代理无法连接上游服务',
        upstream: upstreamUrl.origin,
        detail: error instanceof Error ? error.message : String(error),
      },
    }), { status: 502, headers })
  }

  const responseHeaders = new Headers(upstreamResponse.headers)
  for (const header of hopByHopHeaders) responseHeaders.delete(header)

  const contentType = responseHeaders.get('content-type')?.toLowerCase() ?? ''
  if (!upstreamResponse.ok && !contentType.includes('application/json')) {
    const text = await upstreamResponse.text()
    const headers = withCors(new Headers({ 'content-type': 'application/json; charset=utf-8' }))
    return new Response(JSON.stringify({
      error: {
        message: `上游接口返回 HTTP ${upstreamResponse.status}`,
        upstream: upstreamUrl.origin,
        status: upstreamResponse.status,
        body: text.slice(0, MAX_TEXT_BODY_CHARS),
      },
    }), {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers,
    })
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: withCors(responseHeaders),
  })
}
