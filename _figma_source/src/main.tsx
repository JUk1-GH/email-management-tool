import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App'
import './styles/index.css'

async function loadRuntimeConfig() {
  return new Promise<void>((resolve) => {
    const script = document.createElement('script')
    script.src = './config.js'
    script.async = false
    script.onload = () => resolve()
    script.onerror = () => resolve()
    document.head.appendChild(script)
  })
}

async function bootstrap() {
  await loadRuntimeConfig()

  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void bootstrap()
