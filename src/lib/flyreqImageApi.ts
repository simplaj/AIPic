import type { ApiProfile, TaskParams } from '../types'
import { normalizeBaseUrl } from './devProxy'
import { imageDataUrlToPngBlob, maskDataUrlToPngBlob } from './canvasImage'
import {
  ApiResponseError,
  applyGptImage26Params,
  MIME_MAP,
  assertImageInputPayloadSize,
  assertMaskEditFileSize,
  createApiResponseError,
  getDataUrlDecodedByteSize,
  getDataUrlEncodedByteSize,
  type CallApiOptions,
  type CallApiResult,
} from './imageApiShared'
import { getImageRequestTimeoutSeconds } from './imageRequestTimeout'
import { readRuntimeEnv } from './runtimeEnv'
import { normalizeImageBackgroundParams } from './paramCompatibility'

const TASKS_URL = '/api/flyreq/tasks'
const POLL_INTERVAL_MS = 2_000
const STATUS_REQUEST_TIMEOUT_MS = 30_000
const MAX_CONSECUTIVE_POLL_ERRORS = 5

export function isFlyreqTaskBackendEnabled(): boolean {
  return readRuntimeEnv(import.meta.env.VITE_TASK_BACKEND) === 'flyreq'
}

/** The task is already submitted. Recovery must only query its existing ID. */
export class FlyreqTaskRecoveryError extends Error {
  rawImageUrls?: string[]

  constructor(message: string, rawImageUrls?: string[]) {
    super(message)
    this.name = 'FlyreqTaskRecoveryError'
    this.rawImageUrls = rawImageUrls
  }
}

export function isFlyreqTaskRecoverableError(error: unknown): error is FlyreqTaskRecoveryError {
  return error instanceof FlyreqTaskRecoveryError
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function parseImageInput(dataUrl: string): { data: string; mimeType: string } {
  const match = /^data:(image\/[^;,]+);base64,([\s\S]+)$/.exec(dataUrl)
  if (!match) throw new Error('输入图片必须是有效的 Base64 图片数据。')
  return { data: match[2], mimeType: match[1] }
}

/** 将已处理的图片文件编码为 JSON 请求使用的数据 URL，保留文件的 MIME 类型。 */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('图片编码失败'))
    reader.readAsDataURL(blob)
  })
}

function getOutputSize(size: string): 'auto' | '1K' | '2K' | '4K' {
  if (size === 'auto') return 'auto'
  const preset = size.toUpperCase()
  if (preset === '1K' || preset === '2K' || preset === '4K') return preset
  const dimensions = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(size)
  if (!dimensions) return 'auto'
  const width = Number(dimensions[1])
  const height = Number(dimensions[2])
  if (width * height > 2048 * 2048 || Math.max(width, height) >= 3840) return '4K'
  return width * height > 1024 * 1024 ? '2K' : '1K'
}

async function fetchTaskJson(url: string, init: RequestInit = {}, timeoutMs = STATUS_REQUEST_TIMEOUT_MS): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, cache: 'no-store', signal: controller.signal })
    if (!response.ok) throw await createApiResponseError(response)
    const text = await response.text()
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      throw new ApiResponseError('任务后端返回了无效的 JSON 数据。', response, text)
    }
    if (!isRecord(body)) throw new ApiResponseError('任务后端返回了无效的数据结构。', response, text)
    return body
  } finally {
    clearTimeout(timeout)
  }
}

function isTransientStatusError(error: unknown): boolean {
  if (error instanceof ApiResponseError) return error.status >= 500 || error.status === 408 || error.status === 429
  return error instanceof TypeError || (error instanceof Error && error.name === 'AbortError')
}

async function downloadTaskImage(url: string, fallbackMime: string, timeoutMs: number): Promise<string> {
  if (url.startsWith('data:image/')) return url
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal })
    if (!response.ok) throw await createApiResponseError(response)
    const blob = await response.blob()
    if (blob.size === 0 || (blob.type && !blob.type.startsWith('image/') && blob.type !== 'application/octet-stream')) {
      throw new Error('任务完成，但后端返回的文件不是有效图片。')
    }
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
    }
    const mime = blob.type.startsWith('image/') ? blob.type : fallbackMime
    return `data:${mime};base64,${btoa(binary)}`
  } finally {
    clearTimeout(timeout)
  }
}

function getResultImageUrls(result: Record<string, unknown>): string[] {
  if (!Array.isArray(result.images) || result.images.length === 0) {
    throw new Error('任务后端已结束生成，但没有返回可用图片。')
  }
  return result.images.map((image) => {
    if (typeof image !== 'string' || !image.trim()) throw new Error('任务后端返回的图片地址无效。')
    const url = image.startsWith('URL:') ? image.slice(4) : image
    if (!url.startsWith('/api/flyreq/images/') && !/^https?:\/\//i.test(url) && !url.startsWith('data:image/')) {
      throw new Error('任务后端返回了不支持的图片地址。')
    }
    return url
  })
}

export async function getFlyreqQueuedImageResult(
  taskId: string,
  params: TaskParams,
  timeoutSeconds = 1800,
): Promise<CallApiResult> {
  const deadline = Date.now() + timeoutSeconds * 1000
  let consecutiveErrors = 0
  while (Date.now() < deadline) {
    let task: Record<string, unknown>
    try {
      task = await fetchTaskJson(`${TASKS_URL}/${encodeURIComponent(taskId)}`)
      consecutiveErrors = 0
    } catch (error) {
      if (!isTransientStatusError(error)) throw error
      consecutiveErrors += 1
      if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
        throw new FlyreqTaskRecoveryError('暂时无法查询后端任务，正在重新连接。任务不会重复提交。')
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      continue
    }

    if (task.status === 'failed' || task.status === 'expired') {
      const detail = typeof task.error === 'string' && task.error.trim() ? task.error : undefined
      throw new Error(detail ?? (task.status === 'expired' ? '后端任务已过期，无法恢复结果。' : '后端图片生成失败。'))
    }
    if (task.status === 'completed') {
      if (!isRecord(task.result)) throw new Error('任务后端已完成，但没有返回图片结果。')
      const rawImageUrls = getResultImageUrls(task.result)
      let images: string[]
      try {
        images = await Promise.all(rawImageUrls.map((url) => downloadTaskImage(url, MIME_MAP[params.output_format], Math.min(timeoutSeconds * 1000, 120_000))))
      } catch (error) {
        if (isTransientStatusError(error)) {
          throw new FlyreqTaskRecoveryError('图片已生成，正在重新连接并下载结果。任务不会重复提交。', rawImageUrls)
        }
        throw error
      }
      return {
        images,
        rawImageUrls: rawImageUrls.filter((url) => !url.startsWith('data:')),
        warning: typeof task.warning === 'string' && task.warning.trim() ? task.warning : undefined,
      }
    }
    if (task.status !== 'processing' && task.status !== 'queued' && task.status !== '排队中') {
      throw new Error(`任务后端返回了未知状态：${String(task.status ?? '空')}`)
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new FlyreqTaskRecoveryError('后端仍在处理图片，将继续查询当前任务的结果。')
}

export async function callFlyreqImageApi(opts: CallApiOptions, profile: ApiProfile): Promise<CallApiResult> {
  const params = normalizeImageBackgroundParams(opts.params)
  const inputImageDataUrls = [...opts.inputImageDataUrls]
  let maskDataUrl = opts.maskDataUrl
  if (maskDataUrl) {
    if (inputImageDataUrls.length === 0) throw new Error('遮罩编辑需要输入图片。')
    // 保持原 Images API 的遮罩处理：仅将主图和遮罩转为 PNG，其余参考图保持原始字节。
    const [imageBlob, maskBlob] = await Promise.all([
      imageDataUrlToPngBlob(inputImageDataUrls[0]),
      maskDataUrlToPngBlob(maskDataUrl),
    ])
    assertMaskEditFileSize('遮罩主图文件', imageBlob.size)
    assertMaskEditFileSize('遮罩文件', maskBlob.size)
    const [imageDataUrl, maskPngDataUrl] = await Promise.all([
      blobToDataUrl(imageBlob),
      blobToDataUrl(maskBlob),
    ])
    inputImageDataUrls[0] = imageDataUrl
    maskDataUrl = maskPngDataUrl
    for (const image of inputImageDataUrls.slice(1)) assertMaskEditFileSize('输入图片', getDataUrlDecodedByteSize(image))
  }
  assertImageInputPayloadSize(inputImageDataUrls.reduce((size, image) => size + getDataUrlEncodedByteSize(image), 0) + (maskDataUrl ? getDataUrlEncodedByteSize(maskDataUrl) : 0))
  const timeoutSeconds = getImageRequestTimeoutSeconds(profile, params)
  const baseUrl = normalizeBaseUrl(profile.baseUrl)
  const gptImage26Params: Record<string, unknown> = {}
  applyGptImage26Params(gptImage26Params, params, profile)
  const body = {
    apiKey: profile.apiKey,
    baseUrl,
    protocol: 'openai',
    ...(/^https?:\/\/api\.x\.ai(?:\/|$)/i.test(baseUrl) ? { imageApiFlavor: 'xai-imagine' } : {}),
    mode: inputImageDataUrls.length > 0 ? 'image-to-image' : 'text-to-image',
    prompt: opts.prompt,
    model: profile.model,
    outputSize: getOutputSize(params.size),
    customSize: params.size === 'auto' ? '' : params.size,
    customSizeAlignMultiple: false,
    aspectRatio: 'auto',
    parallelCount: params.n,
    images: inputImageDataUrls.map(parseImageInput),
    ...(maskDataUrl ? { mask: parseImageInput(maskDataUrl) } : {}),
    streamImages: profile.streamImages === true,
    streamPartialImages: profile.streamPartialImages,
    gptImageQuality: params.quality,
    gptImageOutputFormat: params.output_format,
    gptImageBackground: params.background ?? 'auto',
    ...(typeof gptImage26Params.complexity === 'string' ? { gptImageComplexity: gptImage26Params.complexity } : {}),
    ...(typeof gptImage26Params.frame_count === 'number' ? { gptImageFrameCount: gptImage26Params.frame_count } : {}),
    ...(typeof gptImage26Params.frame_duration_ms === 'number' ? { gptImageFrameDurationMs: gptImage26Params.frame_duration_ms } : {}),
    ...(gptImage26Params.svg && typeof gptImage26Params.svg === 'object' ? { gptImageSvg: gptImage26Params.svg } : {}),
    ...(params.output_compression != null ? { gptImageOutputCompression: params.output_compression } : {}),
    gptImageModeration: params.moderation,
    ...(profile.responseFormatB64Json ? { responseFormat: 'b64_json' } : {}),
    timeoutSeconds,
  }
  // Submission is intentionally a single attempt: a lost response does not prove
  // that the upstream task was never started, so an automatic retry can charge twice.
  const submitted = await fetchTaskJson(TASKS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, Math.max(STATUS_REQUEST_TIMEOUT_MS, Math.min(timeoutSeconds * 1000, 120_000)))
  if (typeof submitted.taskId !== 'string' || !submitted.taskId.trim()) {
    throw new Error('后端没有返回任务 ID；为避免重复计费，未自动重新提交。')
  }
  await opts.onBackendTaskEnqueued?.({ taskId: submitted.taskId })
  return getFlyreqQueuedImageResult(submitted.taskId, params, timeoutSeconds)
}
