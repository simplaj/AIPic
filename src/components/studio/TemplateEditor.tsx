import { useId, useState, type RefObject } from 'react'
import { Input, InputArea } from '@cloudflare/kumo/components/input'
import { Switch } from '@cloudflare/kumo/components/switch'
import { Check, RotateCcw } from 'lucide-react'
import type { TaskParams } from '../../types'
import type { RetouchGenerationMode } from '../../lib/retouchPresets'
import { TEMPLATE_COVERS, type TemplateCover, type UserTemplate, type UserTemplateDraft } from '../../lib/userTemplates'
import { StudioButton, StudioSelect, StudioSheet } from './StudioPrimitives'

export default function TemplateEditor({ template, prompt, params, generationMode, returnFocusRef, onSave, onClose }: {
  template?: UserTemplate
  prompt: string
  params: TaskParams
  generationMode: RetouchGenerationMode
  returnFocusRef: RefObject<HTMLElement | null>
  onSave: (draft: UserTemplateDraft, id?: string) => void
  onClose: () => void
}) {
  const formId = useId()
  const [title, setTitle] = useState(template?.title ?? '')
  const [scenario, setScenario] = useState(template?.scenario ?? '')
  const [templatePrompt, setTemplatePrompt] = useState(template?.prompt ?? prompt)
  const [mode, setMode] = useState(template?.generationMode ?? generationMode)
  const [cover, setCover] = useState<TemplateCover>(template?.cover ?? 'desk')
  const [savedParams, setSavedParams] = useState<Partial<TaskParams>>({ ...(template?.params ?? params) })
  const [includeParams, setIncludeParams] = useState(Object.keys(template?.params ?? params).length > 0)
  const [error, setError] = useState('')
  return <StudioSheet open onOpenChange={(open) => !open && onClose()} title={template ? '编辑模板' : '新建模板'}
    description="把常用的创作要求，保存成自己的模板。" returnFocusRef={returnFocusRef}
    footer={<><StudioButton tone="ghost" onClick={onClose}>取消</StudioButton><StudioButton tone="primary" type="submit" form={formId}><Check size={14} />保存模板</StudioButton></>}>
    <form id={formId} className="studio-template-form" onSubmit={(event) => {
      event.preventDefault()
      setError('')
      try { onSave({ title, scenario, prompt: templatePrompt, generationMode: mode, cover, params: includeParams ? savedParams : {} }, template?.id) }
      catch (failure) { setError(failure instanceof Error ? failure.message : '保存失败，请重试。') }
    }}>
      <label className="studio-field">模板名称<Input autoFocus aria-label="模板名称" value={title} onValueChange={setTitle} maxLength={60} required placeholder="例如：我的品牌商品主图" /></label>
      <label className="studio-field">一句话介绍<Input aria-label="模板介绍" value={scenario} onValueChange={setScenario} maxLength={160} placeholder="可选，描述这份模板适合的场景" /></label>
      <label className="studio-field">提示词<InputArea aria-label="模板提示词" value={templatePrompt} onValueChange={setTemplatePrompt} rows={7} required placeholder="写下主体、风格、构图，以及希望保留的细节…" /></label>
      <div className="studio-field-grid">
        <label className="studio-field">生成方式<StudioSelect aria-label="模板生成方式" value={mode} onValueChange={(value) => setMode(value as RetouchGenerationMode)}><option value="text">文生图</option><option value="edit">图生图</option></StudioSelect></label>
        <label className="studio-field">卡片封面<StudioSelect aria-label="模板封面" value={cover} onValueChange={(value) => setCover(value as TemplateCover)}>{Object.entries(TEMPLATE_COVERS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</StudioSelect></label>
      </div>
      <div className="studio-template-cover-preview"><img src={`${import.meta.env.BASE_URL}studio/${TEMPLATE_COVERS[cover].file}`} alt="模板封面预览" /><span>{title.trim() || '我的模板'}<small>{mode === 'text' ? '文生图' : '图生图'} · 保存在本机</small></span></div>
      <div className="studio-template-param-choice">
        <div className="studio-switch-field"><label htmlFor={`${formId}-params`}>保存生成参数<small>尺寸、画质和格式会随模板一起应用。</small></label><Switch id={`${formId}-params`} aria-label="保存生成参数" size="sm" checked={includeParams} onCheckedChange={setIncludeParams} /></div>
        {includeParams && <p>{savedParams.n ?? 1} 张 · {savedParams.size === 'auto' || !savedParams.size ? '自动尺寸' : savedParams.size.replace('x', ' × ')} · {(savedParams.output_format ?? 'png').toUpperCase()}</p>}
        <StudioButton tone="ghost" onClick={() => { setSavedParams({ ...params }); setIncludeParams(true) }}><RotateCcw size={12} />使用工作区当前参数</StudioButton>
      </div>
      {error && <p className="studio-template-form-error" role="alert">{error}</p>}
    </form>
  </StudioSheet>
}
