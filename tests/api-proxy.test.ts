import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequest } from '../functions/api-proxy/[[path]]'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function makeRequest(path = 'images/generations', options: { body?: BodyInit, signal?: AbortSignal, stream?: string, timeout?: string } = {}) {
  const headers = new Headers({
    authorization: 'Bearer test-key',
    'x-aipic-upstream': 'https://upstream.example/v1',
    'x-aipic-proxy-stream': options.stream ?? '1',
  })
  if (options.timeout) headers.set('x-aipic-timeout-seconds', options.timeout)
  if (!(options.body instanceof FormData)) headers.set('content-type', 'application/json')
  return new Request(`https://aipic.example/api-proxy/${path}`, {
    method: 'POST', headers, body: options.body ?? '{}', signal: options.signal,
  })
}

function handle(request = makeRequest()) {
  return onRequest({ request, env: {} } as Parameters<typeof onRequest>[0]) as Promise<Response>
}

function defer<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function readFrame(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const result = await reader.read()
  expect(result.done).toBe(false)
  return JSON.parse(decoder.decode(result.value))
}

async function readFrames(response: Response) {
  return (await response.text()).trim().split('\n').map(line => JSON.parse(line))
}

function textFrom(frames: Array<{ type: string, text?: string }>) {
  return frames.filter(frame => frame.type === 'chunk').map(frame => frame.text).join('')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('long image request proxy transport', () => {
  it.each([
    { env: {}, upstream: null, expected: 'https://2api.dev/v1/models' },
    { env: { API_PROXY_URL: 'https://deployment.example/v1' }, upstream: null, expected: 'https://deployment.example/v1/models' },
    { env: { API_PROXY_URL: 'https://deployment.example/v1' }, upstream: 'https://saved.example/v1', expected: 'https://saved.example/v1/models' },
  ])('uses the configured upstream without changing saved provider routing: $expected', async ({ env, upstream, expected }) => {
    const fetchMock = vi.fn(async () => Response.json({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const request = new Request('https://aipic.example/api-proxy/models', {
      headers: upstream ? { 'x-aipic-upstream': upstream } : {},
    })
    const response = await onRequest({ request, env } as Parameters<typeof onRequest>[0])
    expect(response.status).toBe(200)
    const [url] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.href).toBe(expected)
  })

  it('returns a heartbeat before upstream responds and continues during silence', async () => {
    vi.useFakeTimers()
    const upstream = defer<Response>()
    const fetchMock = vi.fn(() => upstream.promise)
    vi.stubGlobal('fetch', fetchMock)
    const response = await handle()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/x-aipic-stream; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store, no-transform')
    expect(response.headers.get('x-accel-buffering')).toBe('no')
    const reader = response.body!.getReader()
    expect(await readFrame(reader)).toEqual({ type: 'heartbeat' })
    const heartbeat = readFrame(reader)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await heartbeat).toEqual({ type: 'heartbeat' })
    upstream.resolve(Response.json({ data: [{ b64_json: '4K-image' }] }))
    expect((await readFrame(reader)).status).toBe(200)
    expect(await readFrame(reader)).toEqual({ type: 'chunk', text: '{"data":[{"b64_json":"4K-image"}]}' })
    expect(await readFrame(reader)).toEqual({ type: 'end' })
    expect(await reader.read()).toEqual({ done: true, value: undefined })
    expect(vi.getTimerCount()).toBe(0)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.href).toBe('https://upstream.example/v1/images/generations')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-key')
    for (const name of ['x-aipic-proxy-stream', 'x-aipic-timeout-seconds', 'x-aipic-upstream']) {
      expect(new Headers(init.headers).has(name)).toBe(false)
    }
  })

  it.each(['images/generations', 'images/edits', 'responses'])('frames JSON for %s', async path => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ b64_json: 'test' }] })))
    const frames = await readFrames(await handle(makeRequest(path)))
    expect(frames[0]).toEqual({ type: 'heartbeat' })
    expect(frames[1]).toMatchObject({ type: 'response', status: 200 })
    expect(JSON.parse(textFrom(frames))).toEqual({ data: [{ b64_json: 'test' }] })
    expect(frames.at(-1)).toEqual({ type: 'end' })
  })

  it('preserves SSE chunks and split UTF-8 while heartbeating between chunks', async () => {
    vi.useFakeTimers()
    let source!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start(controller) { source = controller } })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } })))
    const response = await handle(makeRequest('responses'))
    const reader = response.body!.getReader()
    await readFrame(reader)
    expect((await readFrame(reader)).headers['content-type']).toBe('text/event-stream')
    const expected = 'data: {"image":"图片"}\n\n'
    const bytes = encoder.encode(expected)
    source.enqueue(bytes.slice(0, 18))
    const first = await readFrame(reader)
    const heartbeat = readFrame(reader)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await heartbeat).toEqual({ type: 'heartbeat' })
    source.enqueue(bytes.slice(18))
    source.close()
    const second = await readFrame(reader)
    expect(first.text + second.text).toBe(expected)
    expect(await readFrame(reader)).toEqual({ type: 'end' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves multipart boundaries and request body', async () => {
    const form = new FormData()
    form.append('model', 'gpt-image-2')
    form.append('image', new Blob(['image-bytes'], { type: 'image/png' }), 'reference.png')
    let received!: FormData
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      received = await new Response(init.body, { headers: init.headers }).formData()
      return Response.json({ data: [] })
    }))
    await readFrames(await handle(makeRequest('images/edits', { body: form })))
    expect(received.get('model')).toBe('gpt-image-2')
    expect(await (received.get('image') as File).text()).toBe('image-bytes')
  })

  it('preserves upstream 524 and wraps only a bounded non-JSON error body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`<html>${'x'.repeat(10_000)}</html>`, {
      status: 524, statusText: 'A Timeout Occurred', headers: { 'content-type': 'text/html' },
    })))
    const frames = await readFrames(await handle())
    expect(frames[1]).toEqual({
      type: 'response', status: 524, statusText: 'A Timeout Occurred',
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
    const error = JSON.parse(textFrom(frames)).error
    expect(error.status).toBe(524)
    expect(error.body.length).toBe(8000)
    expect(frames.at(-1)).toEqual({ type: 'end' })
  })

  it('preserves a JSON upstream error without wrapping it again', async () => {
    const error = { error: { message: 'quota exhausted', code: 'insufficient_quota' } }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(error, { status: 429 })))
    const frames = await readFrames(await handle())
    expect(frames[1].status).toBe(429)
    expect(JSON.parse(textFrom(frames))).toEqual(error)
  })

  it('preserves diagnostic and retry headers while removing decoded-body transport metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream busy', {
      status: 429,
      headers: {
        'content-type': 'text/plain', 'x-request-id': 'request-123', 'retry-after': '15', 'x-ratelimit-remaining': '0',
        'set-cookie': 'session=secret', 'set-cookie2': 'session=secret', 'authorization': 'Bearer secret',
        'content-length': '13', 'content-encoding': 'gzip', 'transfer-encoding': 'chunked', 'connection': 'keep-alive',
      },
    })))
    const frames = await readFrames(await handle())
    expect(frames[1].headers).toEqual({
      'content-type': 'application/json; charset=utf-8', 'x-request-id': 'request-123', 'retry-after': '15', 'x-ratelimit-remaining': '0',
    })
  })

  it('reports pre-header connection errors as status 502', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connection reset') }))
    const frames = await readFrames(await handle())
    expect(frames[1]).toMatchObject({ type: 'response', status: 502 })
    expect(JSON.parse(textFrom(frames)).error.detail).toBe('connection reset')
    expect(frames.at(-1)).toEqual({ type: 'end' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports body failure explicitly instead of silently ending incomplete JSON', async () => {
    vi.useFakeTimers()
    let source!: ReadableStreamDefaultController<Uint8Array>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start(controller) { source = controller } }), {
      headers: { 'content-type': 'application/json' },
    })))
    const response = await handle()
    const reader = response.body!.getReader()
    await readFrame(reader)
    await readFrame(reader)
    source.enqueue(encoder.encode('{"data":'))
    expect(await readFrame(reader)).toEqual({ type: 'chunk', text: '{"data":' })
    source.error(new Error('socket terminated'))
    expect(await readFrame(reader)).toMatchObject({ type: 'error', message: expect.stringContaining('socket terminated') })
    expect(await readFrame(reader)).toEqual({ type: 'end' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts upstream and clears timers when downstream cancels', async () => {
    vi.useFakeTimers()
    let signal!: AbortSignal
    const cancel = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      signal = init.signal
      return new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'application/json' } })
    }))
    const response = await handle()
    const reader = response.body!.getReader()
    await readFrame(reader)
    await readFrame(reader)
    await reader.cancel('user cancelled')
    expect(signal.aborted).toBe(true)
    expect(cancel).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts upstream on request cancellation before headers', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    let signal!: AbortSignal
    vi.stubGlobal('fetch', vi.fn((_url, init) => {
      signal = init.signal
      return new Promise<Response>(() => {})
    }))
    const response = await handle(makeRequest('images/generations', { signal: controller.signal }))
    const reader = response.body!.getReader()
    await readFrame(reader)
    controller.abort(new Error('client disconnected'))
    await expect(reader.read()).rejects.toThrow('client disconnected')
    expect(signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('enforces the deadline before upstream headers and emits status 504', async () => {
    vi.useFakeTimers()
    let signal!: AbortSignal
    vi.stubGlobal('fetch', vi.fn((_url, init) => {
      signal = init.signal
      return new Promise<Response>(() => {})
    }))
    const framesPromise = readFrames(await handle(makeRequest('images/generations', { timeout: '20' })))
    await vi.advanceTimersByTimeAsync(20_000)
    const frames = await framesPromise
    expect(signal.aborted).toBe(true)
    expect(frames.find(frame => frame.type === 'response').status).toBe(504)
    expect(JSON.parse(textFrom(frames)).error.message).toContain('超时')
    expect(frames.at(-1)).toEqual({ type: 'end' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the deadline active after headers and aborts stalled response bodies', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    let signal!: AbortSignal
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      signal = init.signal
      return new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'application/json' } })
    }))
    const framesPromise = readFrames(await handle(makeRequest('images/generations', { timeout: '20' })))
    await vi.advanceTimersByTimeAsync(20_000)
    const frames = await framesPromise
    expect(frames.find(frame => frame.type === 'response').status).toBe(200)
    expect(frames.at(-2)).toMatchObject({ type: 'error', message: expect.stringContaining('超时') })
    expect(frames.at(-1)).toEqual({ type: 'end' })
    expect(signal.aborted).toBe(true)
    expect(cancel).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not let deadline cleanup strand a writer under downstream backpressure', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: ['image'] })))
    const response = await handle(makeRequest('images/generations', { timeout: '1' }))
    await vi.advanceTimersByTimeAsync(1000)
    const frames = await readFrames(response)
    expect(frames.find(frame => frame.type === 'response').status).toBe(504)
    expect(frames.at(-1)).toEqual({ type: 'end' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('limits upstream reads when the client stops consuming a large response', async () => {
    let pulls = 0
    const cancel = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      pull(controller) {
        pulls += 1
        controller.enqueue(encoder.encode('x'.repeat(64 * 1024)))
      },
      cancel,
    }), { headers: { 'content-type': 'application/json' } })))
    const response = await handle()
    const reader = response.body!.getReader()
    await readFrame(reader)
    await readFrame(reader)
    await Promise.resolve()
    await Promise.resolve()
    expect(pulls).toBeLessThanOrEqual(3)
    await reader.cancel()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('does not start upstream work for an already aborted request', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    controller.abort(new Error('already cancelled'))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const response = await handle(makeRequest('images/generations', { signal: controller.signal }))
    await expect(response.text()).rejects.toThrow('already cancelled')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retains legacy non-JSON error status and wrapping without the stream header', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>upstream timeout</html>', {
      status: 524, headers: { 'content-type': 'text/html' },
    })))
    const response = await handle(makeRequest('images/generations', { stream: '0' }))
    expect(response.status).toBe(524)
    expect(await response.json()).toMatchObject({ error: { status: 524, body: '<html>upstream timeout</html>' } })
  })

  it.each(['not-a-number', '0', '-1'])('uses the 30-minute default for invalid timeout %s', async timeout => {
    vi.useFakeTimers()
    let signal!: AbortSignal
    vi.stubGlobal('fetch', vi.fn((_url, init) => {
      signal = init.signal
      return new Promise<Response>(() => {})
    }))
    const response = await handle(makeRequest('images/generations', { timeout }))
    await vi.advanceTimersByTimeAsync(1_799_000)
    expect(signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(signal.aborted).toBe(true)
    const frames = await readFrames(response)
    expect(frames.find(frame => frame.type === 'response').status).toBe(504)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('caps a supplied deadline at one hour', async () => {
    vi.useFakeTimers()
    let signal!: AbortSignal
    vi.stubGlobal('fetch', vi.fn((_url, init) => {
      signal = init.signal
      return new Promise<Response>(() => {})
    }))
    const response = await handle(makeRequest('images/generations', { timeout: '99999' }))
    await vi.advanceTimersByTimeAsync(3_599_000)
    expect(signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(signal.aborted).toBe(true)
    await readFrames(response)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    ['images/generations', '0'],
    ['chat/completions', '1'],
    ['models', '1'],
  ])('retains legacy status and content for %s with opt-in %s', async (path, stream) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [] }, { status: 201 })))
    const response = await handle(makeRequest(path, { stream }))
    expect(response.status).toBe(201)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.json()).toEqual({ data: [] })
  })
})
