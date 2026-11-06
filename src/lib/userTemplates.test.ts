import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createUserTemplateStore, readUserTemplates, USER_TEMPLATES_KEY, type UserTemplateDraft } from './userTemplates'

function storage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}
const draft: UserTemplateDraft = {
  title: '品牌商品图', scenario: '自然光与真实材质', prompt: '保留商品标志与包装。\n用自然柔光呈现。',
  params: { ...DEFAULT_PARAMS, size: '1536x1024', quality: 'high' }, generationMode: 'text', cover: 'product',
}

describe('personal templates', () => {
  it('persists a complete recipe and restores it in a fresh store', () => {
    const disk = storage(), store = createUserTemplateStore(disk)
    const result = store.getState().save(draft)
    expect(result.id).toMatch(/^custom-/)
    expect(createUserTemplateStore(disk).getState().templates).toEqual([result])
    expect(result.prompt).toBe(draft.prompt)
    expect(result.params.size).toBe('1536x1024')
  })
  it('updates the same template instead of creating a duplicate', () => {
    const disk = storage(), store = createUserTemplateStore(disk)
    const original = store.getState().save(draft)
    const updated = store.getState().save({ ...draft, title: '新版商品图', prompt: '新的提示词' }, original.id)
    expect(updated.id).toBe(original.id)
    expect(updated.createdAt).toBe(original.createdAt)
    expect(readUserTemplates(disk)).toEqual([updated])
  })
  it('keeps prompt-only recipes free of generation overrides', () => {
    const disk = storage(), store = createUserTemplateStore(disk)
    const result = store.getState().save({ ...draft, params: {} })
    expect(result.params).toEqual({})
    expect(readUserTemplates(disk)[0].params).toEqual({})
  })
  it('removes only the requested recipe and persists deletion', () => {
    const disk = storage(), store = createUserTemplateStore(disk)
    const one = store.getState().save(draft)
    const two = store.getState().save({ ...draft, title: '另一份模板' })
    store.getState().remove(one.id)
    expect(readUserTemplates(disk)).toEqual([two])
  })
  it('leaves saved templates intact if persistence fails', () => {
    const disk = storage(), store = createUserTemplateStore(disk)
    const original = store.getState().save(draft)
    disk.setItem = () => { throw new Error('QuotaExceededError') }
    expect(() => store.getState().save({ ...draft, title: '未保存的修改' }, original.id)).toThrow('尚未保存')
    expect(store.getState().templates).toEqual([original])
    expect(() => store.getState().remove(original.id)).toThrow('尚未保存')
    expect(store.getState().templates).toEqual([original])
  })
  it('rejects empty fields and editing an unknown id', () => {
    const store = createUserTemplateStore(storage())
    expect(() => store.getState().save({ ...draft, title: ' ' })).toThrow('名称')
    expect(() => store.getState().save({ ...draft, prompt: '\n' })).toThrow('提示词')
    expect(() => store.getState().save(draft, 'custom-missing')).toThrow('已被移除')
    expect(store.getState().templates).toEqual([])
  })
  it('recovers valid entries, ignores corrupt entries, and normalizes stored parameters', () => {
    const disk = storage()
    const valid = { ...draft, id: 'custom-known', createdAt: 42, cover: '__proto__', params: { n: 500, quality: 'invalid', apiKey: 'unrelated-secret' } }
    disk.setItem(USER_TEMPLATES_KEY, JSON.stringify({ version: 1, templates: [null, { id: 'builtin' }, valid, valid] }))
    const restored = readUserTemplates(disk)
    expect(restored).toHaveLength(1)
    expect(restored[0].cover).toBe('desk')
    expect(restored[0].params.n).toBe(10)
    expect(restored[0].params.quality).toBe(DEFAULT_PARAMS.quality)
    expect(JSON.stringify(restored)).not.toContain('unrelated-secret')
  })
  it('handles unreadable storage and malformed JSON', () => {
    const disk = storage()
    disk.setItem(USER_TEMPLATES_KEY, 'not json')
    expect(readUserTemplates(disk)).toEqual([])
    expect(readUserTemplates({ getItem: () => { throw new Error('Blocked') }, setItem() {} })).toEqual([])
  })
})
