import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { Badge } from '@cloudflare/kumo/components/badge'
import { ArrowRight, Check, X } from 'lucide-react'
import { StudioButton } from './StudioPrimitives'

export const STUDIO_GUIDE_KEY = 'aipic.studio-guide.v1'

export function useStudioGuide() {
  const [step, setStep] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null
    try { return localStorage.getItem(STUDIO_GUIDE_KEY) ? null : 0 } catch { return 0 }
  })
  const finish = (completed = false) => {
    try { localStorage.setItem(STUDIO_GUIDE_KEY, completed ? 'completed' : 'dismissed') } catch { /* session-only guide */ }
    setStep(null)
  }
  return { step, go: setStep, start: () => setStep(0), finish }
}

const steps = [
  { target: 'templates', title: '从一个模板开始', text: '工作区就是创作入口。点击「选择模板」挑选预设，也可以直接在创作栏写下想法。', action: '打开模板库' },
  { target: 'template-card', title: '选中就进入工作区', text: '点击「使用模板」会立即带入提示词和参数；带示例的模板还可以一键填入完整演示。', action: '试试第一张模板' },
  { target: 'prompt', title: '把模板变成你的作品', text: '提示词已经准备好了。在这里补充商品、标题或你想修改的细节；也可以上传参考图。', action: '下一步：输出设置' },
  { target: 'output', title: '确认尺寸与格式', text: '打开输出设置，调整张数、尺寸、质量和格式。关闭后回到创作栏，流式传输默认关闭。', action: '打开输出设置' },
  { target: 'generate', title: '准备好就开始创作', text: '先连接自己的 API，再点击生成。结果在画布展示，并自动进入历史。教程不会替你提交请求。', action: '完成引导' },
]

export default function StudioGuide({ step, paused, onAction, onDismiss }: {
  step: number | null
  paused: boolean
  onAction: () => void
  onDismiss: () => void
}) {
  const titleId = useId()
  const [position, setPosition] = useState<{ x: number; y: number; width: number; height: number; panelX: number; panelY: number; panelWidth: number } | null>(null)
  useEffect(() => {
    if (step === null || paused) { setPosition(null); return }
    const update = () => {
      const target = Array.from(document.querySelectorAll<HTMLElement>(`[data-guide="${steps[step].target}"]`))
        .find((node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0)
      if (!target) { setPosition(null); return }
      const r = target.getBoundingClientRect()
      const width = window.innerWidth
      const height = window.innerHeight
      const x = Math.max(4, r.left - 4), y = Math.max(4, r.top - 4)
      const panelWidth = Math.min(310, width - 24)
      const panelX = Math.max(12, Math.min(width - panelWidth - 12, x))
      const panelY = r.bottom + 212 < height ? r.bottom + 12 : r.top > 216 ? r.top - 204 : Math.max(12, height - 204)
      setPosition({ x, y, width: Math.min(width - x - 4, r.width + 8), height: Math.min(height - y - 4, r.height + 8), panelX, panelY, panelWidth })
    }
    const frame = requestAnimationFrame(update)
    window.addEventListener('resize', update)
    document.addEventListener('scroll', update, true)
    const resize = new ResizeObserver(update)
    resize.observe(document.documentElement)
    return () => { cancelAnimationFrame(frame); resize.disconnect(); window.removeEventListener('resize', update); document.removeEventListener('scroll', update, true) }
  }, [step, paused])
  useEffect(() => {
    if (step === null || paused) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onDismiss() } }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [step, paused, onDismiss])
  if (step === null || paused || !position) return null
  return createPortal(<>
    <div className="studio-guide-highlight" style={{ left: position.x, top: position.y, width: position.width, height: position.height }} />
    <section className="studio-guide" role="dialog" aria-modal="false" aria-labelledby={titleId} style={{ left: position.panelX, top: position.panelY, width: position.panelWidth }}>
      <div className="studio-guide-header"><Badge variant="info">新手引导 · {step + 1}/5</Badge><StudioButton tone="ghost" aria-label="跳过新手引导" onClick={onDismiss}><X size={15} /></StudioButton></div>
      <h2 id={titleId}>{steps[step].title}</h2><p>{steps[step].text}</p>
      <div className="studio-guide-footer"><span>可随时从「使用指南」重看</span><StudioButton tone="primary" onClick={onAction}>{steps[step].action}{step === 4 ? <Check size={13} /> : <ArrowRight size={13} />}</StudioButton></div>
    </section>
  </>, document.body)
}
