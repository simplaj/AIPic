/// <reference types="vite/client" />
declare module '@cloudflare/kumo/styles/standalone'

declare const __APP_VERSION__: string
declare const __APP_BUILD_ID__: string
declare const __DEV_PROXY_CONFIG__: unknown

interface ImportMetaEnv {
  readonly VITE_TASK_BACKEND?: string
  readonly VITE_DEFAULT_API_URL?: string
  readonly VITE_API_PROXY_AVAILABLE?: string
  readonly VITE_API_PROXY_LOCKED?: string
  readonly VITE_DOCKER_DEPLOYMENT?: string
  readonly VITE_DOCKER_LEGACY_API_URL_USED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
