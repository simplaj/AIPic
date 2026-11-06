import type { ApiProfile, AppSettings, TaskParams } from '../types'
import { DEFAULT_SVG_MODEL } from './imageModels'

export const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  gif: 'image/gif',
}

/** GPT Image 2.6 的 complexity、SVG 和 GIF 字段；Images API 生成请求和 Responses 图像工具格式相同 */
export function applyGptImage26Params(target: Record<string, unknown>, params: TaskParams, profile: ApiProfile) {
  if (params.complexity !== 'auto') target.complexity = params.complexity
  if (params.output_format === 'svg') {
    target.svg = { model: profile.svgModel?.trim() || DEFAULT_SVG_MODEL }
  }
  if (params.output_format === 'gif') {
    target.frame_count = params.frame_count
    target.frame_duration_ms = params.frame_duration_ms
  }
}

export const MAX_MASK_EDIT_FILE_BYTES = 50 * 1024 * 1024
export const MAX_IMAGE_INPUT_PAYLOAD_BYTES = 512 * 1024 * 1024

export interface CallApiOptions {
  settings: AppSettings
  prompt: string
  params: TaskParams
  /** 输入图片的 data URL 列表 */
  inputImageDataUrls: string[]
  maskDataUrl?: string
  onFalRequestEnqueued?: (request: { requestId: string; endpoint: string }) => void
  onCustomTaskEnqueued?: (task: { taskId: string }) => void
  onBackendTaskEnqueued?: (task: { taskId: string }) => void | Promise<void>
  onPartialImage?: (partial: { image: string; partialImageIndex?: number; requestIndex?: number }) => void
}

export interface CallApiResult {
  /** base64 data URL 列表 */
  images: string[]
  /** API 返回的实际生效参数 */
  actualParams?: Partial<TaskParams>
  /** 每张图片对应的实际生效参数 */
  actualParamsList?: Array<Partial<TaskParams> | undefined>
  /** 每张图片对应的 API 改写提示词 */
  revisedPrompts?: Array<string | undefined>
  /** API 返回的原始图片 HTTP URL（非 base64 时记录） */
  rawImageUrls?: string[]
  /** 后端返回部分成功等需要保留的提示 */
  warning?: string
}

export class ApiResponseError extends Error {
  status: number
  statusText: string
  rawResponsePayload?: string

  constructor(message: string, response: Response, rawResponsePayload?: string) {
    super(message)
    this.name = 'ApiResponseError'
    this.status = response.status
    this.statusText = response.statusText
    this.rawResponsePayload = rawResponsePayload
  }
}

export function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

export function isDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:')
}

export function normalizeBase64Image(value: string, fallbackMime: string): string {
  return value.startsWith('data:') ? value : `data:${fallbackMime};base64,${value}`
}

function formatMiB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

export function getDataUrlEncodedByteSize(dataUrl: string): number {
  return dataUrl.length
}

export function getDataUrlDecodedByteSize(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(',')
  if (commaIndex < 0) return dataUrl.length

  const meta = dataUrl.slice(0, commaIndex)
  const payload = dataUrl.slice(commaIndex + 1)
  if (!/;base64/i.test(meta)) return decodeURIComponent(payload).length

  const normalized = payload.replace(/\s/g, '')
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding)
}

function assertMaxBytes(label: string, bytes: number, maxBytes: number) {
  if (bytes > maxBytes) {
    throw new Error(`${label}过大：${formatMiB(bytes)}，上限为 ${formatMiB(maxBytes)}`)
  }
}

export function assertImageInputPayloadSize(bytes: number) {
  assertMaxBytes('图像输入有效负载总大小', bytes, MAX_IMAGE_INPUT_PAYLOAD_BYTES)
}

export function assertMaskEditFileSize(label: string, bytes: number) {
  assertMaxBytes(label, bytes, MAX_MASK_EDIT_FILE_BYTES)
}

async function blobToDataUrl(blob: Blob, fallbackMime: string): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''

  for (let i = 0; i < bytes.length; i += 0x8000) {
    const chunk = bytes.subarray(i, i + 0x8000)
    binary += String.fromCharCode(...chunk)
  }

  return `data:${blob.type || fallbackMime};base64,${btoa(binary)}`
}

export const IMAGE_FETCH_CORS_HINT = ' 可点链接按钮复制结果链接，或尝试开启「返回 Base64 图片数据」避免此问题。'

async function probeNoCorsReachability(url: string, timeoutMs = 8000): Promise<'opaque' | 'reachable' | 'failed'> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    })
    return response.type === 'opaque' ? 'opaque' : 'reachable'
  } catch {
    return 'failed'
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function fetchImageUrlAsDataUrl(url: string, fallbackMime: string, signal?: AbortSignal): Promise<string> {
  if (isDataUrl(url)) return url

  let response: Response
  try {
    response = await fetch(url, {
      cache: 'no-store',
      signal,
    })
  } catch (err) {
    if (err instanceof TypeError) {
      const probe = await probeNoCorsReachability(url)
      if (probe === 'opaque') {
        throw new Error(`图片已生成，但因服务商未允许跨域，图片链接下载失败。${IMAGE_FETCH_CORS_HINT}`)
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error(`图片链接下载失败（网络不可用）。${IMAGE_FETCH_CORS_HINT}`)
      }
      throw new Error(`图片链接下载失败（可能因跨域限制、链接过期或网络异常）。${IMAGE_FETCH_CORS_HINT}`)
    }
    throw err
  }

  if (!response.ok) {
    throw new Error(`图片 URL 下载失败：HTTP ${response.status}`)
  }

  const blob = await response.blob()
  return blobToDataUrl(blob, fallbackMime)
}

const MODERATION_STAGE_LABELS: Record<string, string> = {
  input: '提示词或参考图',
  output: '生成结果',
}

const IMAGE_TOOL_DROPPED_ERROR = /Tool choice 'required' must be specified with 'tools' parameter\./i
export const IMAGE_TOOL_DROPPED_HINT = '提示：当前使用的 API 可能未正确转发图像生成工具，请尝试更换支持该工具的接口或模型。'

export function appendModerationDetails(message: string, details: unknown): string {
  if (!details || typeof details !== 'object') return message
  const record = details as Record<string, unknown>
  const stage = typeof record.moderation_stage === 'string' ? MODERATION_STAGE_LABELS[record.moderation_stage] : undefined
  const categories = Array.isArray(record.categories)
    ? record.categories.filter((item): item is string => typeof item === 'string' && Boolean(item))
    : []
  const parts = [
    stage ? `拦截来源：${stage}` : '',
    categories.length ? `类别：${categories.join('、')}` : '',
  ].filter(Boolean)
  return parts.length ? `${message}\n${parts.join('；')}` : message
}

export function maybeAppendImageToolDroppedHint(message: string): string {
  if (!IMAGE_TOOL_DROPPED_ERROR.test(message)) return message
  return `${message}\n${IMAGE_TOOL_DROPPED_HINT}`
}

function getMessageFromErrorJson(errJson: unknown): string | null {
  if (!errJson || typeof errJson !== 'object') return null
  const record = errJson as Record<string, unknown>
  const error = record.error
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const errorRecord = error as Record<string, unknown>
    const message = errorRecord.message
    if (typeof message === 'string' && message.trim()) {
      return appendModerationDetails(message, errorRecord.moderation_details)
    }
  }
  if (typeof record.detail === 'string' && record.detail.trim()) return record.detail
  if (Array.isArray(record.detail) && record.detail.length) {
    return record.detail.map((item: unknown) => typeof item === 'string' ? item : JSON.stringify(item)).join('\n')
  }
  if (typeof record.error === 'string' && record.error.trim()) return record.error
  if (typeof record.message === 'string' && record.message.trim()) return record.message
  return null
}

export async function getApiErrorMessage(response: Response): Promise<string> {
  let errorMsg = `HTTP ${response.status}`
  try {
    const errJson = await response.json()
    errorMsg = getMessageFromErrorJson(errJson) ?? errorMsg
  } catch {
    try {
      errorMsg = await response.text()
    } catch {
      /* ignore */
    }
  }
  return errorMsg
}

export async function createApiResponseError(response: Response): Promise<ApiResponseError> {
  let errorMsg = `HTTP ${response.status}`
  let rawResponsePayload: string | undefined
  try {
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    const bodyText = await response.text()
    if (bodyText) rawResponsePayload = bodyText
    if (bodyText && contentType.includes('application/json')) {
      try {
        const errJson = JSON.parse(bodyText)
        errorMsg = getMessageFromErrorJson(errJson) ?? errorMsg
      } catch {
        errorMsg = bodyText
      }
    } else if (bodyText.trim()) {
      errorMsg = bodyText
    }
  } catch {
    /* ignore */
  }

  if (response.status === 502 && errorMsg === `HTTP ${response.status}`) {
    errorMsg = '上游接口返回 502，可能是中转站余额/渠道/模型不可用，或大尺寸图片生成超时。'
  } else if (response.status === 524 && (errorMsg === `HTTP ${response.status}` || /上游接口返回\s*HTTP\s*524/i.test(errorMsg))) {
    errorMsg = '上游接口返回 524：上游源站生成超时。通常是图片任务超过 Cloudflare 等网关等待时间，可降低尺寸/质量/数量，开启流式传输，或稍后/更换渠道重试。'
  } else if (/upstream did not return image output/i.test(errorMsg)) {
    errorMsg = '上游没有返回图片结果。常见原因是当前模型或中转渠道不支持 Image API/流式图片输出，或 4K、精修、参考图任务过重。已将默认请求改为非流式；请刷新页面后先用 1 张、1K/2K、快速质量测试，必要时更换模型或渠道。'
  }

  return new ApiResponseError(errorMsg, response, rawResponsePayload)
}

export function pickActualParams(source: unknown): Partial<TaskParams> {
  if (!source || typeof source !== 'object') return {}
  const record = source as Record<string, unknown>
  const actualParams: Partial<TaskParams> = {}

  if (typeof record.size === 'string') actualParams.size = record.size
  if (record.quality === 'auto' || record.quality === 'low' || record.quality === 'medium' || record.quality === 'high') {
    actualParams.quality = record.quality
  }
  if (record.quality === 'xhigh' || record.quality === 'max') {
    actualParams.quality = record.quality
  }
  if (record.output_format === 'png' || record.output_format === 'jpeg' || record.output_format === 'webp' || record.output_format === 'svg' || record.output_format === 'gif') {
    actualParams.output_format = record.output_format
  }
  if (record.complexity === 'auto' || record.complexity === 'low' || record.complexity === 'medium' || record.complexity === 'high') {
    actualParams.complexity = record.complexity
  }
  if (typeof record.output_compression === 'number') actualParams.output_compression = record.output_compression
  if (record.moderation === 'auto' || record.moderation === 'low') actualParams.moderation = record.moderation
  if (typeof record.n === 'number') actualParams.n = record.n

  return actualParams
}

export function mergeActualParams(...sources: Array<Partial<TaskParams> | undefined>): Partial<TaskParams> | undefined {
  const merged = Object.assign({}, ...sources.filter((source) => source && Object.keys(source).length))
  return Object.keys(merged).length ? merged : undefined
}
