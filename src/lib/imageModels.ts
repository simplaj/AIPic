import type { ApiProfile } from '../types'

export const DEFAULT_IMAGES_MODEL = 'gpt-image-2.6-sunburst'
/** Images API 生成 SVG 时必填的 svg.model（负责编写 SVG 的文本模型） */
export const DEFAULT_SVG_MODEL = 'gpt-6.1-sol'
export const DEFAULT_FAL_MODEL = 'openai/gpt-image-2.6/sunburst'

export function getImageGenerationModel(profile: ApiProfile) {
  return profile.provider === 'openai' && profile.apiMode === 'responses'
    ? profile.imageGenerationModel?.trim() ?? ''
    : profile.model
}

/** 从 `gpt-image-2.6-flare`、`openai/gpt-image-2.5/sunburst` 等 ID 中解析主次版本号，无法识别时返回 null */
export function parseGptImageVersion(model: string) {
  const match = model.trim().toLowerCase().match(/gpt-image-(\d+)(?:\.(\d+))?/)
  return match ? { major: Number(match[1]), minor: Number(match[2] ?? 0) } : null
}

function isGptImageModelAtLeast(model: string, major: number, minor: number) {
  const version = parseGptImageVersion(model)
  if (!version) return false
  return version.major > major || (version.major === major && version.minor >= minor)
}

/** xhigh / max 画质和 markup 标注编辑 */
export function isGptImage25PlusModel(model: string) {
  return isGptImageModelAtLeast(model, 2, 5)
}

/** complexity、SVG 和 GIF 输出；2.5 会拒绝这些参数 */
export function isGptImage26PlusModel(model: string) {
  return isGptImageModelAtLeast(model, 2, 6)
}

/** xhigh / max 画质；fal.ai 的 2.6 端点画质只到 high */
export function supportsExtendedQuality(profile: ApiProfile) {
  const model = getImageGenerationModel(profile)
  if (profile.provider === 'fal' && isGptImage26PlusModel(model)) return false
  return isGptImage25PlusModel(model)
}

/** complexity、SVG 和 GIF：OpenAI Images / Responses（含 Codex CLI）、fal.ai 2.6 和自定义服务商都可以发送 */
export function supportsGptImage26Params(profile: ApiProfile) {
  return isGptImage26PlusModel(getImageGenerationModel(profile))
}

export function isVectorOrAnimatedFormat(format: string | undefined) {
  return format === 'svg' || format === 'gif'
}
