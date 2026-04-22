import { useState, useCallback } from 'react'
import { Copy, CheckCircle2 } from 'lucide-react'
import { copyToClipboard } from '@/lib/clipboard'

interface CopyButtonProps {
  text: string
  alwaysVisible?: boolean
}

export default function CopyButton({
  text,
  alwaysVisible = false,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      await copyToClipboard(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    },
    [text]
  )

  return (
    <button
      onClick={handleCopy}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md p-1 transition-all ${
        alwaysVisible
          ? 'text-slate-400 hover:bg-blue-50 hover:text-blue-500 opacity-100'
          : 'text-slate-300 hover:bg-blue-50 hover:text-blue-500 opacity-0 group-hover:opacity-100'
      }`}
      title="复制"
    >
      {copied ? (
        <CheckCircle2 size={13} className="text-emerald-500" />
      ) : (
        <Copy size={13} />
      )}
    </button>
  )
}
