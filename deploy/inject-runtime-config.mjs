import { cp, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const target = process.env.AIPIC_STATIC_DIR || '/app/dist'
const proxyAvailable = process.env.ENABLE_API_PROXY === 'true'
const replacements = {
  __VITE_DEFAULT_API_URL_PLACEHOLDER__: process.env.DEFAULT_API_URL ?? 'https://2api.dev/v1',
  __VITE_API_PROXY_AVAILABLE_PLACEHOLDER__: String(proxyAvailable),
  __VITE_API_PROXY_LOCKED_PLACEHOLDER__: String(proxyAvailable && process.env.LOCK_API_PROXY === 'true'),
  __VITE_DOCKER_DEPLOYMENT_PLACEHOLDER__: 'true',
  __VITE_DOCKER_LEGACY_API_URL_USED_PLACEHOLDER__: String(Boolean(process.env.API_URL)),
}

// Always start from the original bundle so restarting with new settings works.
await cp('/app/dist-template', target, { recursive: true })
async function inject(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await inject(filename)
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      let content = await readFile(filename, 'utf8')
      for (const [placeholder, value] of Object.entries(replacements)) {
        // Escape for either JavaScript quote style, including newlines/backslashes.
        const escaped = JSON.stringify(value).slice(1, -1).replaceAll("'", '\\u0027').replaceAll('<', '\\u003c')
        content = content.replaceAll(placeholder, escaped)
      }
      await writeFile(filename, content)
    }
  }
}
await inject(path.join(target, 'assets'))
