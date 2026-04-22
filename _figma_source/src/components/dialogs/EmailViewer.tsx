import {
  Dialog,
  DialogContent,
} from '@/app/components/ui/dialog'
import { ChevronLeft, RefreshCw } from 'lucide-react'
import { useEmailStore } from '@/stores/email-store'
import EmailList from './EmailList'
import EmailDetail from './EmailDetail'
import { toast } from 'sonner'

export default function EmailViewer() {
  const visible = useEmailStore((s) => s.visible)
  const currentEmail = useEmailStore((s) => s.currentEmail)
  const close = useEmailStore((s) => s.close)
  const loading = useEmailStore((s) => s.loading)
  const refreshing = useEmailStore((s) => s.refreshing)
  const refreshFromServer = useEmailStore((s) => s.refreshFromServer)
  const currentEmailDetail = useEmailStore((s) => s.currentEmailDetail)
  const clearDetail = useEmailStore((s) => s.clearDetail)

  const handleRefresh = async () => {
    try {
      await refreshFromServer()
      toast.success('邮件已刷新')
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  return (
    <Dialog open={visible} onOpenChange={(v) => !v && close()}>
      <DialogContent className="flex h-[92vh] w-[calc(100vw-16px)] max-w-[calc(100vw-16px)] flex-col overflow-hidden p-0 sm:h-[680px] sm:w-[calc(100vw-48px)] sm:max-w-[1180px]">
        <div className="border-b border-slate-200/50 bg-white/60 px-3 py-3 backdrop-blur-md sm:px-5 sm:pr-16">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[14px] font-semibold text-slate-800 sm:text-[15px]">
                邮件查看器
              </h2>
              <div className="mt-1 text-blue-600 font-mono text-[13px] break-all sm:text-[14px]">
                {currentEmail}
              </div>
            </div>
            <button
              onClick={handleRefresh}
              disabled={loading || refreshing}
              className="inline-flex shrink-0 items-center gap-2 rounded-[10px] bg-blue-600 px-3 py-2 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              <RefreshCw
                size={14}
                className={loading || refreshing ? 'animate-spin' : ''}
              />
              <span>{loading || refreshing ? '同步中...' : '刷新邮件'}</span>
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <div className={`${currentEmailDetail ? 'hidden sm:flex' : 'flex'} min-h-0 flex-1 sm:flex-[0_0_360px]`}>
            <EmailList />
          </div>

          <div className={`${currentEmailDetail ? 'flex' : 'hidden sm:flex'} min-h-0 min-w-0 flex-1 flex-col`}>
            <div className="flex items-center gap-2 border-b border-slate-200/50 bg-white/50 px-3 py-2 sm:hidden">
              <button
                type="button"
                onClick={clearDetail}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-slate-600"
              >
                <ChevronLeft size={14} />
                返回列表
              </button>
            </div>
            <EmailDetail />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
