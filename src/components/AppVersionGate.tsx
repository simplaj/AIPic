import { useEffect, useState } from 'react'
import { Button } from '@cloudflare/kumo/components/button'
import { useStore } from '../store'
import { createVersionChecker, type AppBuild } from '../lib/appVersion'

export default function AppVersionGate() {
  const [pending, setPending] = useState<{ build: AppBuild; reason?: string } | null>(null)
  useEffect(() => {
    if (import.meta.env.DEV) return
    const isBusy = () => {
      const state = useStore.getState()
      return state.tasks.some((task) => task.status === 'running') || state.agentConversations.some((conversation) => conversation.rounds.some((round) => round.status === 'running'))
    }
    const memory = new Map<string, string>()
    let storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => { memory.set(key, value) },
      removeItem: (key) => { memory.delete(key) },
    }
    try { storage = window.sessionStorage } catch { /* private storage */ }
    const checker = createVersionChecker({
      current: { version: __APP_VERSION__, buildId: __APP_BUILD_ID__ }, storage, isBusy,
      fetchBuild: async () => {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 8000)
        try {
          const url = new URL(`${import.meta.env.BASE_URL}version.json`, window.location.href)
          url.searchParams.set('_check', String(Date.now()))
          const response = await fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' }, signal: controller.signal })
          return response.ok ? response.json() : null
        } finally { clearTimeout(timer) }
      },
      reload: (build) => {
        // Keep localStorage/IndexedDB: draft, configuration, and history survive the reload.
        const url = new URL(window.location.href)
        url.searchParams.set('_aipic_build', build.buildId)
        window.location.replace(url.href)
      },
      onPending: (build, reason) => setPending(build ? { build, reason } : null),
    })
    const check = () => { if (!document.hidden) void checker.check() }
    const force = () => { void checker.check(true) }
    const unsubscribe = useStore.subscribe(() => checker.apply())
    check()
    const interval = setInterval(check, 30_000)
    window.addEventListener('focus', check)
    window.addEventListener('online', check)
    window.addEventListener('aipic:check-version', force)
    document.addEventListener('visibilitychange', check)
    navigator.serviceWorker?.addEventListener('controllerchange', check)
    return () => {
      checker.dispose(); unsubscribe(); clearInterval(interval)
      window.removeEventListener('focus', check); window.removeEventListener('online', check)
      window.removeEventListener('aipic:check-version', force); document.removeEventListener('visibilitychange', check)
      navigator.serviceWorker?.removeEventListener('controllerchange', check)
    }
  }, [])
  if (!pending) return null
  return <div className="studio-version-notice" role="status">
    <span>v{pending.build.version} 已就绪，{pending.reason === 'busy' ? '当前任务完成后自动刷新。' : '旧页面缓存尚未更新。'}</span>
    {pending.reason === 'retry' && <Button size="sm" onClick={() => window.dispatchEvent(new Event('aipic:check-version'))}>重新刷新</Button>}
  </div>
}
