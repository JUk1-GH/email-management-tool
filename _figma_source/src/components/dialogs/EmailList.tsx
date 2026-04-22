import { Search, Inbox, AlertTriangle } from 'lucide-react'
import { useEmailStore } from '@/stores/email-store'
import { formatTime } from '@/lib/format'
import { ScrollArea } from '@/app/components/ui/scroll-area'
import type { Email } from '@/types'

export default function EmailList() {
  const filteredEmails = useEmailStore((s) => s.filteredEmails)
  const emailSearch = useEmailStore((s) => s.emailSearch)
  const filterEmails = useEmailStore((s) => s.filterEmails)
  const currentFolder = useEmailStore((s) => s.currentFolder)
  const switchFolder = useEmailStore((s) => s.switchFolder)
  const currentEmailDetail = useEmailStore((s) => s.currentEmailDetail)
  const showDetail = useEmailStore((s) => s.showDetail)
  const loading = useEmailStore((s) => s.loading)

  return (
    <div className="w-[320px] flex-shrink-0 border-r border-slate-200/50 flex flex-col">
      {/* Folder tabs */}
      <div className="flex border-b border-slate-200/50 px-3 pt-3">
        <button
          onClick={() => switchFolder('inbox')}
          className={`flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium rounded-t-lg transition-colors ${
            currentFolder === 'inbox'
              ? 'bg-white text-blue-600 border border-b-0 border-slate-200/50'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Inbox size={14} />
          收件箱
        </button>
        <button
          onClick={() => switchFolder('junkemail')}
          className={`flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium rounded-t-lg transition-colors ${
            currentFolder === 'junkemail'
              ? 'bg-white text-blue-600 border border-b-0 border-slate-200/50'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <AlertTriangle size={14} />
          垃圾邮件
        </button>
      </div>

      {/* Search */}
      <div className="p-3">
        <div className="relative">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
            size={14}
          />
          <input
            type="text"
            value={emailSearch}
            onChange={(e) => filterEmails(e.target.value)}
            placeholder="搜索邮件..."
            className="w-full pl-8 pr-3 py-1.5 text-[13px] bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        </div>
      </div>

      {/* Email list */}
      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="ml-2 text-[13px] text-slate-500">加载中...</span>
          </div>
        ) : filteredEmails.length === 0 ? (
          <div className="text-center py-12 text-[13px] text-slate-400">
            暂无邮件
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredEmails.map((email, idx) => (
              <EmailListItem
                key={email.id ?? idx}
                email={email}
                isActive={currentEmailDetail?.id === email.id}
                onClick={() => {
                  showDetail(email).catch((error: Error) => {
                    console.error('加载邮件详情失败:', error)
                  })
                }}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

function EmailListItem({
  email,
  isActive,
  onClick,
}: {
  email: Email
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-3 transition-colors ${
        isActive ? 'bg-blue-50/80' : 'hover:bg-slate-50/80'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-medium text-slate-700 truncate flex-1">
          {email.from_name || email.from_address}
        </span>
        <span className="text-[11px] text-slate-400 flex-shrink-0">
          {formatTime(email.received_time)}
        </span>
      </div>
      <p className="text-[13px] text-slate-600 truncate mt-0.5">
        {email.subject || '(无主题)'}
      </p>
      <p className="text-[12px] text-slate-400 truncate mt-0.5">
        {email.body_preview}
      </p>
    </button>
  )
}
