import 'core-js/actual/array/at'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import 'streamdown/styles.css'
import './styles/layers.css'
import kumoStyles from '@cloudflare/kumo/styles/standalone?raw'
import './index.css'
import './styles/studio.css'
import './styles/compact.css'
import './styles/templates.css'
import './styles/apple-interface.css'
import { installMobileViewportGuards } from './lib/viewport'

const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
const syncTheme = () => { document.documentElement.dataset.mode = colorScheme.matches ? 'dark' : 'light' }
syncTheme()
colorScheme.addEventListener('change', syncTheme)
installMobileViewportGuards()

// Kumo ships already-compiled Tailwind 4 styles. Raw embedding keeps the legacy
// Tailwind 3 PostCSS plugin from compiling those vendor directives a second time.
const kumoStyle = document.createElement('style')
kumoStyle.dataset.kumoStyles = 'true'
kumoStyle.textContent = kumoStyles
document.head.appendChild(kumoStyle)

if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' }).catch((error) => {
        console.error('Service worker registration failed:', error)
      })
    })
  } else {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister())
    })
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
