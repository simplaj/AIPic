import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

/** The id changes on every build, even when package.json's release version is unchanged. */
export function buildVersionPlugin(version: string): { plugin: Plugin; buildId: string } {
  const buildId = `${version}-${randomUUID().slice(0, 12)}`
  const manifest = JSON.stringify({ version, buildId, builtAt: new Date().toISOString() })
  return {
    buildId,
    plugin: {
      name: 'aipic-build-version',
      configureServer(server) {
        const packageFile = path.join(server.config.root, 'package.json')
        server.watcher.add(packageFile)
        server.watcher.on('change', (file) => {
          if (path.resolve(file) === packageFile) void server.restart()
        })
        server.middlewares.use((req, res, next) => {
          if (req.url?.split('?')[0]?.endsWith('/version.json')) {
            res.setHeader('Content-Type', 'application/json')
            res.setHeader('Cache-Control', 'no-store, max-age=0')
            res.end(manifest)
            return
          }
          next()
        })
      },
      transformIndexHtml() {
        return [{ tag: 'meta', attrs: { name: 'aipic-build', content: buildId }, injectTo: 'head' }]
      },
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: manifest })
        const worker = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
        this.emitFile({ type: 'asset', fileName: 'sw.js', source: worker.replaceAll('__AIPIC_BUILD_ID__', buildId) })
      },
    },
  }
}
