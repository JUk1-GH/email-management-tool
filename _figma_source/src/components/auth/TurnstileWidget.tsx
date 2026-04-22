import { useEffect, useRef } from 'react'

declare global {
  interface Window {
    turnstile?: {
      render: (
        element: HTMLElement,
        options: {
          sitekey: string
          callback: (token: string) => void
          'expired-callback': () => void
          'error-callback': () => void
        }
      ) => string
      remove: (widgetId: string) => void
    }
  }
}

const TURNSTILE_SCRIPT_ID = 'jemail-turnstile-script'

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) {
    return Promise.resolve()
  }

  const existingScript = document.getElementById(TURNSTILE_SCRIPT_ID)
  if (existingScript) {
    return new Promise((resolve, reject) => {
      existingScript.addEventListener('load', () => resolve(), { once: true })
      existingScript.addEventListener('error', () => reject(new Error('Turnstile 脚本加载失败')), {
        once: true,
      })
    })
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.id = TURNSTILE_SCRIPT_ID
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Turnstile 脚本加载失败'))
    document.head.appendChild(script)
  })
}

export default function TurnstileWidget({
  siteKey,
  resetKey,
  onToken,
  onError,
}: {
  siteKey: string
  resetKey: number
  onToken: (token: string) => void
  onError: (message: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onTokenRef = useRef(onToken)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    onTokenRef.current = onToken
    onErrorRef.current = onError
  }, [onToken, onError])

  useEffect(() => {
    let disposed = false
    let widgetId = ''

    onTokenRef.current('')

    loadTurnstileScript()
      .then(() => {
        if (disposed || !containerRef.current || !window.turnstile) {
          return
        }
        containerRef.current.innerHTML = ''
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(''),
          'error-callback': () => {
            onTokenRef.current('')
            onErrorRef.current('人机验证加载失败，请刷新验证后重试')
          },
        })
      })
      .catch((error: Error) => {
        if (!disposed) {
          onTokenRef.current('')
          onErrorRef.current(error.message)
        }
      })

    return () => {
      disposed = true
      if (widgetId && window.turnstile) {
        window.turnstile.remove(widgetId)
      }
    }
  }, [siteKey, resetKey])

  return (
    <div className="rounded-xl border border-slate-200 bg-white/80 px-3 py-3">
      <div ref={containerRef} className="min-h-[65px]" />
    </div>
  )
}
