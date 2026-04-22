const typeConfig: Record<string, { bg: string; text: string }> = {
  graph: { bg: 'bg-indigo-50/80 border-indigo-100/80', text: 'text-indigo-600' },
  imap: { bg: 'bg-teal-50/80 border-teal-100/80', text: 'text-teal-600' },
  o2: { bg: 'bg-purple-50/80 border-purple-100/80', text: 'text-purple-600' },
  gmail_api: { bg: 'bg-amber-50/80 border-amber-100/80', text: 'text-amber-700' },
}

const typeLabel: Record<string, string> = {
  graph: 'GRAPH',
  imap: 'IMAP',
  o2: 'O2',
  gmail_api: 'GMAIL API',
}

export default function PermissionBadge({ type }: { type: string | null }) {
  if (!type) {
    return (
      <span className="inline-flex items-center px-2 py-1 rounded-md text-[11px] font-medium bg-slate-50/80 text-slate-400 border border-slate-200/50 backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
        未检测
      </span>
    )
  }

  const config = typeConfig[type] || typeConfig.imap
  return (
    <span
      className={`inline-flex items-center px-2 py-1 rounded-md text-[11px] font-medium border backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] ${config.bg} ${config.text}`}
    >
      {typeLabel[type] || type.toUpperCase()}
    </span>
  )
}
