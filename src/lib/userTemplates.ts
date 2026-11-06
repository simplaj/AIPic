import { create } from 'zustand'
import { DEFAULT_PARAMS, IMAGE_COMPLEXITIES, IMAGE_QUALITIES, OUTPUT_FORMATS, type TaskParams } from '../types'
import type { RetouchGenerationMode, RetouchTemplate } from './retouchPresets'
import { normalizeImageSize } from './size'

export const USER_TEMPLATES_KEY = 'aipic.user-templates.v1'
export const TEMPLATE_COVERS = {
  product: { label: '产品摄影', file: 'product-still-life.jpg' },
  landscape: { label: '山野风景', file: 'editorial-landscape.jpg' },
  portrait: { label: '人像摄影', file: 'portrait-light.jpg' },
  desk: { label: '生活桌面', file: 'desk-editorial.jpg' },
  notes: { label: '书写灵感', file: 'notes-editorial.jpg' },
} as const
export type TemplateCover = keyof typeof TEMPLATE_COVERS
export type UserTemplate = RetouchTemplate & {
  category: 'custom'
  generationMode: RetouchGenerationMode
  cover: TemplateCover
  createdAt: number
  updatedAt: number
}
export type UserTemplateDraft = Pick<UserTemplate, 'title' | 'scenario' | 'prompt' | 'params' | 'generationMode' | 'cover'>
type TemplateStorage = Pick<Storage, 'getItem' | 'setItem'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeParams(value: unknown): Partial<TaskParams> {
  if (!isRecord(value) || !Object.keys(value).length) return {}
  const number = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback
  return {
    size: typeof value.size === 'string' ? normalizeImageSize(value.size) || 'auto' : 'auto',
    n: number(value.n, 1, 10, DEFAULT_PARAMS.n),
    quality: IMAGE_QUALITIES.includes(value.quality as TaskParams['quality']) ? value.quality as TaskParams['quality'] : DEFAULT_PARAMS.quality,
    output_format: OUTPUT_FORMATS.includes(value.output_format as TaskParams['output_format']) ? value.output_format as TaskParams['output_format'] : DEFAULT_PARAMS.output_format,
    complexity: IMAGE_COMPLEXITIES.includes(value.complexity as TaskParams['complexity']) ? value.complexity as TaskParams['complexity'] : DEFAULT_PARAMS.complexity,
    moderation: value.moderation === 'low' ? 'low' : 'auto',
    background: ['auto', 'opaque', 'transparent'].includes(String(value.background)) ? value.background as TaskParams['background'] : undefined,
    output_compression: typeof value.output_compression === 'number' ? number(value.output_compression, 0, 100, 100) : null,
    frame_count: number(value.frame_count, 2, 16, DEFAULT_PARAMS.frame_count),
    frame_duration_ms: number(value.frame_duration_ms, 20, 2000, DEFAULT_PARAMS.frame_duration_ms),
  }
}

function normalizeTemplate(value: unknown): UserTemplate | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.startsWith('custom-') ||
      typeof value.title !== 'string' || !value.title.trim() || typeof value.prompt !== 'string' || !value.prompt.trim()) return null
  return {
    id: value.id,
    category: 'custom',
    group: '我的模板',
    title: value.title.trim().slice(0, 60),
    scenario: typeof value.scenario === 'string' ? value.scenario.trim().slice(0, 160) : '',
    prompt: value.prompt.trim(),
    generationMode: value.generationMode === 'edit' ? 'edit' : 'text',
    cover: Object.prototype.hasOwnProperty.call(TEMPLATE_COVERS, String(value.cover)) ? value.cover as TemplateCover : 'desk',
    params: normalizeParams(value.params),
    createdAt: typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? value.createdAt : 0,
    updatedAt: typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
  }
}

export function isUserTemplate(template: RetouchTemplate): template is UserTemplate {
  return template.category === 'custom' && template.id.startsWith('custom-')
}

function browserStorage(): TemplateStorage | undefined {
  try { return typeof window !== 'undefined' ? window.localStorage : undefined } catch { return undefined }
}

export function readUserTemplates(storage?: TemplateStorage): UserTemplate[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(USER_TEMPLATES_KEY) ?? 'null')
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.templates)) return []
    const seen = new Set<string>()
    return parsed.templates.flatMap((item) => {
      const template = normalizeTemplate(item)
      if (!template || seen.has(template.id)) return []
      seen.add(template.id)
      return [template]
    })
  } catch { return [] }
}

type UserTemplateState = {
  templates: UserTemplate[]
  save: (draft: UserTemplateDraft, id?: string) => UserTemplate
  remove: (id: string) => void
  reload: () => void
}

export function createUserTemplateStore(storage = browserStorage()) {
  const persist = (templates: UserTemplate[]) => {
    if (!storage) throw new Error('当前浏览器未开放本地存储，模板尚未保存。')
    try { storage.setItem(USER_TEMPLATES_KEY, JSON.stringify({ version: 1, templates })) }
    catch { throw new Error('浏览器存储空间不足或不可用，模板尚未保存，请调整后重试。') }
  }
  return create<UserTemplateState>((set, get) => ({
    templates: readUserTemplates(storage),
    save(draft, id) {
      if (!draft.title.trim()) throw new Error('请填写模板名称。')
      if (!draft.prompt.trim()) throw new Error('请填写模板提示词。')
      const existing = id ? get().templates.find((template) => template.id === id) : undefined
      if (id && !existing) throw new Error('这份模板已被移除，请重新新建。')
      const now = Date.now()
      const template = normalizeTemplate({
        ...draft, id: existing?.id ?? `custom-${crypto.randomUUID()}`,
        createdAt: existing?.createdAt ?? now, updatedAt: now,
      })!
      const next = existing ? get().templates.map((item) => item.id === id ? template : item) : [template, ...get().templates]
      // Write before publishing the state: a failed save leaves the original intact.
      persist(next)
      set({ templates: next })
      return template
    },
    remove(id) {
      const next = get().templates.filter((template) => template.id !== id)
      persist(next)
      set({ templates: next })
    },
    reload() { set({ templates: readUserTemplates(storage) }) },
  }))
}

export const useUserTemplates = createUserTemplateStore()
