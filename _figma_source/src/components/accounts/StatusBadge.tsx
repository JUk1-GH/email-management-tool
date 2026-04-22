const statusConfig: Record<string, { dot: string; bg: string; text: string; animate?: boolean }> = {
  正常: { dot: 'bg-emerald-500', bg: 'bg-emerald-50/80 border-emerald-100/80', text: 'text-emerald-600' },
  封禁: { dot: 'bg-red-500', bg: 'bg-red-50/80 border-red-100/80', text: 'text-red-600' },
  锁定: { dot: 'bg-orange-500', bg: 'bg-orange-50/80 border-orange-100/80', text: 'text-orange-600' },
  过期: { dot: 'bg-slate-400', bg: 'bg-slate-50/80 border-slate-200/80', text: 'text-slate-500' },
  无效: { dot: 'bg-slate-400', bg: 'bg-slate-50/80 border-slate-200/80', text: 'text-slate-500' },
  未授权: { dot: 'bg-amber-500', bg: 'bg-amber-50/80 border-amber-100/80', text: 'text-amber-700' },
  检测中: { dot: 'bg-amber-500', bg: 'bg-amber-50/80 border-amber-100/80', text: 'text-amber-600', animate: true },
}

export default function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] || statusConfig['正常']

  return (
    <span
      className={`inline-flex items-center space-x-1 px-2 py-1 rounded-md text-[11px] font-medium border backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] ${config.bg} ${config.text}`}
    >
      <div className={`w-1.5 h-1.5 rounded-full ${config.dot} ${config.animate ? 'animate-pulse' : ''}`} />
      <span>{status}</span>
    </span>
  )
}
