import { getActiveApiProfile } from '../lib/apiProfiles'
import { supportsGptImage26Params } from '../lib/imageModels'
import { getOutputImageLimitForSettings } from '../lib/paramCompatibility'
import { useStore } from '../store'
import { GIF_FRAME_COUNT_RANGE, GIF_FRAME_DURATION_RANGE, type AppSettings, type TaskParams } from '../types'
import { StudioSelect } from './studio/StudioPrimitives'

/** Expose the existing request parameters without changing them on mount. */
export default function ImageGenerationOptions({ settings }: { settings: AppSettings }) {
  const params = useStore((s) => s.params)
  const setParams = useStore((s) => s.setParams)
  const profile = getActiveApiProfile(settings)
  const isFal = profile.provider === 'fal'
  const isCustomProvider = profile.provider !== 'openai' && !isFal
  const imageLimit = getOutputImageLimitForSettings(settings)
  const supports26 = supportsGptImage26Params(profile)
  const vectorOrAnimated = params.output_format === 'svg' || params.output_format === 'gif'
  const compressionDisabled = isFal || params.output_format === 'png' || vectorOrAnimated
  const backgroundDisabled = isFal
  const background = params.background ?? 'default'

  return (
    <section className="retouch-request-options" aria-label="生成参数">
      <div className="retouch-request-options-heading">
        <strong>生成参数</strong>
      </div>
      <div className="retouch-request-options-grid">
        <label>
          <span>输出张数</span>
          <select
            value={Math.min(imageLimit, Math.max(1, params.n))}
            onChange={(event) => setParams({ n: Number(event.target.value) })}
          >
            {Array.from({ length: imageLimit }, (_, index) => index + 1).map((count) => (
              <option key={count} value={count}>{count} 张</option>
            ))}
          </select>
          <small>{isFal ? 'fal.ai 支持 1–4 张' : '1–10 张，具体上限由服务商决定'}</small>
        </label>


        <label>
          <span>复杂度</span>
          <select
            value={supports26 ? params.complexity : 'auto'}
            disabled={!supports26}
            onChange={(event) => setParams({ complexity: event.target.value as TaskParams['complexity'] })}
          >
            <option value="auto">自动（不发送）</option>
            <option value="low">低（low）</option>
            <option value="medium">中（medium）</option>
            <option value="high">高（high）</option>
          </select>
          <small>{supports26 ? '控制模型渲染前的规划程度' : '需要 GPT Image 2.6 及以上模型'}</small>
        </label>

        {supports26 && params.output_format === 'gif' && (
          <>
            <label>
              <span>GIF 帧数</span>
              <input
                type="number"
                min={GIF_FRAME_COUNT_RANGE.min}
                max={GIF_FRAME_COUNT_RANGE.max}
                value={params.frame_count}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  if (!Number.isInteger(value)) return
                  setParams({ frame_count: Math.min(GIF_FRAME_COUNT_RANGE.max, Math.max(GIF_FRAME_COUNT_RANGE.min, value)) })
                }}
              />
              <small>{GIF_FRAME_COUNT_RANGE.min}–{GIF_FRAME_COUNT_RANGE.max}，默认 9</small>
            </label>
            <label>
              <span>每帧时长</span>
              <input
                type="number"
                min={GIF_FRAME_DURATION_RANGE.min}
                max={GIF_FRAME_DURATION_RANGE.max}
                value={params.frame_duration_ms}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  if (!Number.isInteger(value)) return
                  setParams({ frame_duration_ms: Math.min(GIF_FRAME_DURATION_RANGE.max, Math.max(GIF_FRAME_DURATION_RANGE.min, value)) })
                }}
              />
              <small>{GIF_FRAME_DURATION_RANGE.min}–{GIF_FRAME_DURATION_RANGE.max} 毫秒，默认 200</small>
            </label>
          </>
        )}

        <label>
          <span>内容审核</span>
          <select
            value={isFal ? 'auto' : params.moderation}
            disabled={isFal}
            onChange={(event) => setParams({ moderation: event.target.value as TaskParams['moderation'] })}
          >
            <option value="auto">自动（auto）</option>
            <option value="low">较低（low）</option>
          </select>
          <small>{isFal ? 'fal.ai 不支持此参数' : '选择服务商提供的审核强度'}</small>
        </label>

        <label>
          <span>压缩质量</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            step={1}
            value={compressionDisabled ? '' : params.output_compression ?? ''}
            placeholder="留空使用默认值"
            disabled={compressionDisabled}
            onChange={(event) => {
              if (event.target.value === '') {
                setParams({ output_compression: null })
                return
              }
              const value = Number(event.target.value)
              if (Number.isFinite(value)) {
                setParams({ output_compression: Math.min(100, Math.max(0, Math.round(value))) })
              }
            }}
          />
          <small>{isFal ? 'fal.ai 不支持此参数' : compressionDisabled ? 'PNG / SVG / GIF 不使用压缩质量' : '0–100，数值越高画质越高'}</small>
        </label>

        <label>
          <span>背景</span>
          <StudioSelect
            aria-label="背景"
            value={backgroundDisabled ? 'default' : background}
            disabled={backgroundDisabled}
            onValueChange={(value) => setParams({
              background: value === 'default' ? undefined : value as TaskParams['background'],
            })}
          >
            <option value="default">服务商默认</option>
            <option value="auto">自动（auto）</option>
            <option value="opaque">不透明（opaque）</option>
            <option value="transparent" disabled={params.output_format === 'jpeg'}>透明（transparent）</option>
          </StudioSelect>
          <small>{isFal ? 'fal.ai 不支持此参数' : isCustomProvider ? '自定义服务商由请求模板配置' : params.output_format === 'jpeg' ? '透明背景需要 PNG / WebP' : '透明背景需要模型支持'}</small>
        </label>
      </div>
      {isCustomProvider && <p>自定义服务商按请求模板映射生成参数。</p>}
    </section>
  )
}
