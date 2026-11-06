export interface AppBuild {
  version: string
  buildId: string
}

export const RELOAD_GUARD_KEY = 'aipic.version-reload'

export function parseAppBuild(value: unknown): AppBuild | null {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  if (typeof data.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(data.version)) return null
  if (typeof data.buildId !== 'string' || !/^[\w.-]{6,100}$/.test(data.buildId)) return null
  return { version: data.version, buildId: data.buildId }
}

/** A persisted one-attempt guard prevents reload loops if a CDN keeps serving old HTML. */
export function createVersionChecker(options: {
  current: AppBuild
  fetchBuild: () => Promise<unknown>
  isBusy: () => boolean
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  reload: (build: AppBuild) => void
  onPending: (build: AppBuild | null, reason?: 'busy' | 'retry') => void
}) {
  let pending: AppBuild | null = null
  let checking = false
  let disposed = false
  let reloading = false
  const apply = (force = false) => {
    if (!pending || disposed || reloading) return
    if (options.isBusy()) { options.onPending(pending, 'busy'); return }
    const key = `${options.current.buildId}:${pending.buildId}`
    let tried = false
    try { tried = options.storage.getItem(RELOAD_GUARD_KEY) === key } catch { /* memory guard still applies */ }
    if (tried && !force) { options.onPending(pending, 'retry'); return }
    try { options.storage.setItem(RELOAD_GUARD_KEY, key) } catch { /* restricted browser storage */ }
    reloading = true
    options.reload(pending)
  }
  return {
    apply,
    async check(force = false) {
      if (checking || disposed || reloading) return
      checking = true
      try {
        const build = parseAppBuild(await options.fetchBuild())
        if (disposed || !build) return
        if (build.buildId === options.current.buildId) {
          pending = null
          options.onPending(null)
          try { options.storage.removeItem(RELOAD_GUARD_KEY) } catch { /* restricted browser storage */ }
          return
        }
        pending = build
        apply(force)
      } catch { /* A network outage must not reload or interrupt the editor. */ }
      finally { checking = false }
    },
    dispose() { disposed = true },
  }
}
