import { defineConfig } from 'vitest/config'
import type { ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { normalizeDevProxyConfig } from './src/lib/devProxy'
import { buildVersionPlugin } from './scripts/build-version'

function loadDevProxyConfig() {
  try {
    return normalizeDevProxyConfig(
      JSON.parse(readFileSync('./dev-proxy.config.json', 'utf-8')) as unknown,
    )
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    throw error
  }
}

export default defineConfig(({ command, mode }) => {
  const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))
  const versionBuild = buildVersionPlugin(pkg.version)
  const devProxyConfig = command === 'serve' && mode !== 'test' ? loadDevProxyConfig() : null

  return {
    plugins: [react(), versionBuild.plugin],
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __APP_BUILD_ID__: JSON.stringify(versionBuild.buildId),
      __DEV_PROXY_CONFIG__: JSON.stringify(devProxyConfig),
    },
    server: {
      host: true,
      proxy: {
        '/api/flyreq': {
          target: 'http://127.0.0.1:8788',
          changeOrigin: true,
          ws: true,
          timeout: 3_600_000,
          proxyTimeout: 3_600_000,
        },
        ...(devProxyConfig?.enabled
          ? {
            [devProxyConfig.prefix]: {
              target: devProxyConfig.target,
              changeOrigin: devProxyConfig.changeOrigin,
              secure: devProxyConfig.secure,
              timeout: 3_600_000,
              proxyTimeout: 3_600_000,
              configure: (proxy: Parameters<NonNullable<ProxyOptions['configure']>>[0]) => {
                proxy.on('proxyReq', (proxyReq) => {
                  proxyReq.removeHeader('origin')
                  proxyReq.removeHeader('x-aipic-proxy-stream')
                  proxyReq.removeHeader('x-aipic-timeout-seconds')
                })
              },
              rewrite: (path: string) =>
                path.replace(
                  new RegExp(`^${devProxyConfig.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
                    '',
                  ),
              },
            }
          : {}),
      },
    },
    test: {
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.git/**',
        '**/.cache/**',
        '**/._*',
      ],
    },
  }
})
