// ===== 设置 =====

export type ApiMode = 'images' | 'responses'
export const REASONING_EFFORT_VALUES = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ReasoningEffort = typeof REASONING_EFFORT_VALUES[number]
export type AppMode = 'gallery' | 'agent'
export type ReferenceImageEditAction = 'ask' | 'replace-reference' | 'add-mask'
export type BuiltInApiProvider = 'openai' | 'fal'
export type ApiProvider = BuiltInApiProvider | string
export type CustomProviderTemplate = 'http-image'
export const DEFAULT_STREAM_PARTIAL_IMAGES = 3
export const DEFAULT_AGENT_MAX_TOOL_ROUNDS = 15

export type CustomProviderRequestMethod = 'GET' | 'POST'
export type CustomProviderContentType = 'json' | 'multipart'
export type CustomProviderFileSource = 'inputImages' | 'mask'

export interface CustomProviderFileMapping {
  field: string
  source: CustomProviderFileSource
  array?: boolean
}

export interface CustomProviderResultMapping {
  imageUrlPaths?: string[]
  b64JsonPaths?: string[]
}

export interface CustomProviderSubmitMapping {
  path: string
  method?: CustomProviderRequestMethod
  contentType?: CustomProviderContentType
  query?: Record<string, string>
  body?: Record<string, unknown>
  files?: CustomProviderFileMapping[]
  taskIdPath?: string
  result?: CustomProviderResultMapping
}

export interface CustomProviderPollMapping {
  path: string
  method?: CustomProviderRequestMethod
  query?: Record<string, string>
  intervalSeconds?: number
  statusPath: string
  successValues: string[]
  failureValues: string[]
  errorPath?: string
  result: CustomProviderResultMapping
}

export interface CustomProviderDefinition {
  id: string
  name: string
  template?: CustomProviderTemplate
  submit: CustomProviderSubmitMapping
  editSubmit?: CustomProviderSubmitMapping
  poll?: CustomProviderPollMapping
}

export interface ApiProfile {
  id: string
  name: string
  provider: ApiProvider
  baseUrl: string
  apiKey: string
  model: string
  /** Responses API 下实际调用图像工具的模型；留空则不发送，由接口决定 */
  imageGenerationModel?: string
  /** 生成 SVG 时负责编写 SVG 的文本模型，留空使用默认值 */
  svgModel?: string
  /** Responses API 文本模型的推理强度，留空表示不发送 */
  reasoningEffort?: ReasoningEffort
  timeout: number
  apiMode: ApiMode
  codexCli: boolean
  apiProxy: boolean
  responseFormatB64Json?: boolean
  streamImages?: boolean
  streamPartialImages?: number
  providerDrafts?: Partial<Record<ApiProvider, Partial<Pick<ApiProfile, 'baseUrl' | 'model' | 'imageGenerationModel' | 'svgModel' | 'reasoningEffort' | 'apiMode' | 'codexCli' | 'apiProxy' | 'responseFormatB64Json' | 'streamImages' | 'streamPartialImages'>>>>
}

export interface AppSettings {
  /** 旧版单配置字段：保留用于导入/查询参数兼容，实际请求以 active profile 为准 */
  baseUrl: string
  apiKey: string
  model: string
  timeout: number
  apiMode: ApiMode
  codexCli: boolean
  apiProxy: boolean
  streamImages?: boolean
  streamPartialImages?: number
  customProviders: CustomProviderDefinition[]
  providerOrder?: string[]
  clearInputAfterSubmit: boolean
  persistInputOnRestart: boolean
  reuseTaskApiProfileTemporarily: boolean
  alwaysShowRetryButton: boolean
  enterSubmit: boolean
  referenceImageEditAction: ReferenceImageEditAction
  agentScrollToBottomAfterSubmit: boolean
  agentMaxToolRounds: number
  agentWebSearch: boolean
  profiles: ApiProfile[]
  activeProfileId: string
}

// ===== 任务参数 =====

export const OUTPUT_FORMATS = ['png', 'jpeg', 'webp', 'svg', 'gif'] as const
export const IMAGE_QUALITIES = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export const IMAGE_COMPLEXITIES = ['auto', 'low', 'medium', 'high'] as const
export const GIF_FRAME_COUNT_RANGE = { min: 2, max: 16 }
export const GIF_FRAME_DURATION_RANGE = { min: 20, max: 2000 }

export interface TaskParams {
  size: string
  quality: typeof IMAGE_QUALITIES[number]
  /** auto 表示不发送，由模型使用默认复杂度 */
  complexity: typeof IMAGE_COMPLEXITIES[number]
  output_format: typeof OUTPUT_FORMATS[number]
  output_compression: number | null
  moderation: 'auto' | 'low'
  background?: 'auto' | 'transparent' | 'opaque'
  n: number
  /** 仅 GIF 输出 */
  frame_count: number
  frame_duration_ms: number
}

export const DEFAULT_PARAMS: TaskParams = {
  size: 'auto',
  quality: 'auto',
  complexity: 'auto',
  output_format: 'png',
  output_compression: null,
  moderation: 'auto',
  n: 1,
  frame_count: 9,
  frame_duration_ms: 200,
}

// ===== 输入图片（UI 层面） =====

export interface InputImage {
  /** IndexedDB image store 的 id（SHA-256 hash） */
  id: string
  /** data URL，用于预览 */
  dataUrl: string
  /** 前端输入队列元信息，不参与模型请求 */
  meta?: {
    source?: 'built-in-film-scene' | 'custom-film-scene' | 'graduate-background'
    sceneId?: string
    label?: string
  }
}

export interface MaskDraft {
  targetImageId: string
  maskDataUrl: string
  updatedAt: number
}

// ===== 任务记录 =====

export type TaskStatus = 'running' | 'done' | 'error'

export interface TaskRecord {
  id: string
  prompt: string
  params: TaskParams
  /** 生成时使用的 Provider 类型 */
  apiProvider?: ApiProvider
  /** 生成时使用的 API 配置 ID */
  apiProfileId?: string
  /** 生成时使用的 Provider 名称 */
  apiProfileName?: string
  /** 生成时使用的 API 模式 */
  apiMode?: ApiMode
  /** 生成时使用的模型 ID */
  apiModel?: string
  /** fal.ai 队列请求 ID，用于连接断开后的结果恢复 */
  falRequestId?: string
  /** fal.ai 队列 endpoint，用于连接断开后的状态和结果查询 */
  falEndpoint?: string
  /** fal.ai 任务连接断开后是否等待自动恢复 */
  falRecoverable?: boolean
  /** 自定义异步服务商任务 ID，用于重启后继续查询结果 */
  customTaskId?: string
  /** 自定义异步任务是否等待自动恢复 */
  customRecoverable?: boolean
  /** 本地 flyreq 后端任务 ID，刷新页面后只继续查询，不重新生图 */
  backendTaskId?: string
  /** 与本地后端断开时，等待恢复查询现有任务 */
  backendRecoverable?: boolean
  /** 后端返回的部分成功提示 */
  backendWarning?: string
  /** API 返回的实际生效参数，用于标记与请求值不一致的情况 */
  actualParams?: Partial<TaskParams>
  /** 输出图片对应的实际生效参数，key 为 outputImages 中的图片 id */
  actualParamsByImage?: Record<string, Partial<TaskParams>>
  /** 输出图片对应的 API 改写提示词，key 为 outputImages 中的图片 id */
  revisedPromptByImage?: Record<string, string>
  /** 输入图片的 image store id 列表 */
  inputImageIds: string[]
  maskTargetImageId?: string | null
  maskImageId?: string | null
  /** 输出图片的 image store id 列表 */
  outputImages: string[]
  /** 流式生成的中间步骤图片 id 列表，仅失败时保留供排查/下载 */
  streamPartialImageIds?: string[]
  /** API 返回的原始图片 HTTP URL（非 base64 时记录） */
  rawImageUrls?: string[]
  /** 发生解析错误时的原始响应 JSON */
  rawResponsePayload?: string
  status: TaskStatus
  error: string | null
  createdAt: number
  finishedAt: number | null
  /** 总耗时毫秒 */
  elapsed: number | null
  /** 是否收藏 */
  isFavorite?: boolean
  /** 来源模式：画廊 / Agent */
  sourceMode?: AppMode
  /** Agent 对话 ID */
  agentConversationId?: string
  /** Agent 轮次 ID */
  agentRoundId?: string
  /** Agent 消息 ID */
  agentMessageId?: string
  /** Agent 图像工具调用 ID */
  agentToolCallId?: string
  /** Agent 批量图像工具调用 ID */
  agentBatchCallId?: string
  /** Agent 图像工具实际动作 */
  agentToolAction?: 'generate' | 'edit' | 'auto' | string
}

// ===== Agent 模式 =====

export type AgentMessageRole = 'user' | 'assistant'
export type AgentRoundStatus = 'running' | 'done' | 'error'

export interface AgentMessage {
  id: string
  role: AgentMessageRole
  content: string
  roundId: string
  inputImageIds?: string[]
  maskTargetImageId?: string | null
  maskImageId?: string | null
  outputTaskIds?: string[]
  createdAt: number
}

export interface AgentRound {
  id: string
  index: number
  parentRoundId?: string | null
  userMessageId: string
  assistantMessageId?: string
  prompt: string
  inputImageIds: string[]
  maskTargetImageId?: string | null
  maskImageId?: string | null
  outputTaskIds: string[]
  responseId?: string
  responseOutput?: ResponsesOutputItem[]
  status: AgentRoundStatus
  error: string | null
  createdAt: number
  finishedAt: number | null
}

export interface AgentConversation {
  id: string
  title: string
  activeRoundId?: string | null
  createdAt: number
  updatedAt: number
  rounds: AgentRound[]
  messages: AgentMessage[]
}

// ===== IndexedDB 存储的图片 =====

export interface StoredImage {
  id: string
  dataUrl: string
  /** 图片首次存储时间（ms） */
  createdAt?: number
  /** 图片来源：用户上传 / API 生成 / 遮罩 */
  source?: 'upload' | 'generated' | 'mask'
  /** 原图宽度 */
  width?: number
  /** 原图高度 */
  height?: number
}

export interface StoredImageThumbnail {
  id: string
  /** 列表缩略图，用于避免卡片页解码完整 4K 原图 */
  thumbnailDataUrl: string
  /** 原图宽度 */
  width?: number
  /** 原图高度 */
  height?: number
  /** 缩略图生成参数版本 */
  thumbnailVersion?: number
}

// ===== API 请求体 =====

export interface ImageGenerationRequest {
  model: string
  prompt: string
  size: string
  quality: string
  output_format: string
  moderation: string
  output_compression?: number
  n?: number
}

// ===== API 响应 =====

export interface ImageResponseItem {
  b64_json?: string
  url?: string
  revised_prompt?: string
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
}

export interface ImageApiResponse {
  data: ImageResponseItem[]
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
  n?: number
}

export interface ResponsesOutputItem {
  id?: string
  type?: string
  status?: string
  action?: string | Record<string, unknown>
  /** function_call: unique call id for sending back function_call_output */
  call_id?: string
  /** function_call: function name */
  name?: string
  /** function_call: JSON-encoded arguments string */
  arguments?: string
  /** function_call_output: JSON/text output string */
  output?: string
  annotations?: Array<{
    type?: string
    start_index?: number
    end_index?: number
    url?: string
    title?: string
  }>
  content?: Array<{
    type?: string
    text?: string
    annotations?: Array<{
      type?: string
      start_index?: number
      end_index?: number
      url?: string
      title?: string
    }>
  }>
  result?: string | {
    b64_json?: string
    base64?: string
    image?: string
    data?: string
  }
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
  revised_prompt?: string
}

export interface ResponsesApiResponse {
  id?: string
  output?: ResponsesOutputItem[]
  tools?: Array<{
    type?: string
    size?: string
    quality?: string
    output_format?: string
    output_compression?: number
    moderation?: string
    n?: number
  }>
}

export interface FalImageFile {
  url?: string
  content_type?: string
  file_name?: string
  width?: number
  height?: number
  b64_json?: string
  base64?: string
  data?: string
}

export interface FalApiResponse {
  images?: FalImageFile[]
  image?: FalImageFile | string
  url?: string
  seed?: number
}

// ===== 导出数据 =====

/** ZIP manifest.json 格式 */
export interface ExportData {
  version: number
  exportedAt: string
  settings?: AppSettings
  tasks?: TaskRecord[]
  agentConversations?: AgentConversation[]
  /** imageId → 图片信息 */
  imageFiles?: Record<string, {
    path: string
    createdAt?: number
    source?: 'upload' | 'generated' | 'mask'
    width?: number
    height?: number
  }>
  /** imageId → 缩略图信息 */
  thumbnailFiles?: Record<string, {
    path: string
    width?: number
    height?: number
    thumbnailVersion?: number
  }>
}
