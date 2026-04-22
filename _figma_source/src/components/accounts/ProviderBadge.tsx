import type { Provider } from '@/types'

const providerConfig: Record<
  Provider,
  { label: string; bg: string; text: string }
> = {
  microsoft: {
    label: 'Microsoft',
    bg: 'bg-sky-50/80 border-sky-100/80',
    text: 'text-sky-700',
  },
  google: {
    label: 'Google',
    bg: 'bg-rose-50/80 border-rose-100/80',
    text: 'text-rose-700',
  },
}

export default function ProviderBadge({
  provider,
}: {
  provider: Provider
}) {
  const config = providerConfig[provider]

  return (
    <span
      className={`inline-flex items-center px-2 py-1 rounded-md text-[11px] font-medium border backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] ${config.bg} ${config.text}`}
    >
      {config.label}
    </span>
  )
}
