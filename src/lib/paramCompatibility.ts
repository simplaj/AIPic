import { DEFAULT_PARAMS, type AppSettings, type TaskParams } from '../types'
import { getActiveApiProfile } from './apiProfiles'
import { isVectorOrAnimatedFormat, supportsExtendedQuality, supportsGptImage26Params } from './imageModels'
import { normalizeCodexCliImageSize, normalizeImageSize } from './size'

export const DEFAULT_FAL_IMAGE_SIZE = '1360x1024'
export const MAX_FAL_OUTPUT_IMAGES = 4
export const MAX_OPENAI_OUTPUT_IMAGES = 10

export function getOutputImageLimitForSettings(settings: AppSettings) {
  return getActiveApiProfile(settings).provider === 'fal' ? MAX_FAL_OUTPUT_IMAGES : MAX_OPENAI_OUTPUT_IMAGES
}

/** Preserve transparent backgrounds by selecting an output format that supports alpha. */
export function normalizeImageBackgroundParams(params: TaskParams): TaskParams {
  const background = params.background
  if (background === undefined) return params
  if (background !== 'auto' && background !== 'transparent' && background !== 'opaque') {
    return { ...params, background: undefined }
  }
  if (background === 'transparent' && params.output_format === 'jpeg') {
    return { ...params, output_format: 'png', output_compression: null }
  }
  return params
}

export function normalizeParamsForSettings(
  params: TaskParams,
  settings: AppSettings,
  options: { hasInputImages?: boolean; agent?: boolean } = {},
): TaskParams {
  const activeProfile = getActiveApiProfile(settings)
  const outputImageLimit = getOutputImageLimitForSettings(settings)
  const completeParams = completeTaskParams(params)
  const nextParams: TaskParams = {
    ...(activeProfile.provider === 'openai' ? normalizeImageBackgroundParams(completeParams) : completeParams),
    size: normalizeImageSize(completeParams.size) || DEFAULT_PARAMS.size,
    n: Math.min(outputImageLimit, Math.max(1, completeParams.n || DEFAULT_PARAMS.n)),
  }

  if ((nextParams.quality === 'xhigh' || nextParams.quality === 'max') && !supportsExtendedQuality(activeProfile)) {
    nextParams.quality = 'high'
  }

  const supports26Params = supportsGptImage26Params(activeProfile)
  if (!supports26Params) nextParams.complexity = DEFAULT_PARAMS.complexity
  // Agent 结果会继续进入对话编辑，只保留位图格式。
  if (isVectorOrAnimatedFormat(nextParams.output_format) && (!supports26Params || options.agent)) {
    nextParams.output_format = DEFAULT_PARAMS.output_format
  }
  // fal.ai 的 SVG 依赖未公开参数，暂不开放；GIF 仍可用。
  if (activeProfile.provider === 'fal' && nextParams.output_format === 'svg') {
    nextParams.output_format = DEFAULT_PARAMS.output_format
  }
  // SVG 只能文生图；带参考图时改回 PNG。
  if (nextParams.output_format === 'svg' && options.hasInputImages) {
    nextParams.output_format = DEFAULT_PARAMS.output_format
  }

  if (activeProfile.provider === 'openai' && activeProfile.codexCli) {
    nextParams.size = normalizeCodexCliImageSize(nextParams.size)
    nextParams.quality = DEFAULT_PARAMS.quality
  }

  if (activeProfile.provider === 'fal') {
    if (nextParams.background !== undefined) nextParams.background = undefined
    if (!options.hasInputImages && nextParams.size === 'auto') nextParams.size = DEFAULT_FAL_IMAGE_SIZE
    if (nextParams.quality === 'auto') nextParams.quality = 'high'
    nextParams.moderation = DEFAULT_PARAMS.moderation
    nextParams.output_compression = DEFAULT_PARAMS.output_compression
  }

  if (nextParams.output_format === 'png' || isVectorOrAnimatedFormat(nextParams.output_format)) {
    nextParams.output_compression = DEFAULT_PARAMS.output_compression
  }

  return nextParams
}

export function completeTaskParams(params: Partial<TaskParams> | TaskParams): TaskParams {
  return {
    ...DEFAULT_PARAMS,
    ...params,
    complexity: params.complexity ?? DEFAULT_PARAMS.complexity,
    frame_count: normalizeGifValue(params.frame_count, 2, 16, DEFAULT_PARAMS.frame_count),
    frame_duration_ms: normalizeGifValue(params.frame_duration_ms, 20, 2000, DEFAULT_PARAMS.frame_duration_ms),
  }
}

function normalizeGifValue(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback
}

export function getChangedParams(current: TaskParams, next: TaskParams): Partial<TaskParams> {
  const patch: Partial<TaskParams> = {}
  for (const key of Object.keys(next) as Array<keyof TaskParams>) {
    if (current[key] !== next[key]) {
      ;(patch as Record<keyof TaskParams, TaskParams[keyof TaskParams]>)[key] = next[key]
    }
  }
  return patch
}
