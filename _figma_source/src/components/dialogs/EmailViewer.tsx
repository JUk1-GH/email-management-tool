import {
  Dialog,
  DialogContent,
} from '@/app/components/ui/dialog'
import { RefreshCw } from 'lucide-react'
import { useEmailStore } from '@/stores/email-store'
import EmailList from './EmailList'
import EmailDetail from './EmailDetail'
import { toast } from 'sonner'

export default function EmailViewer() {
  const visible = useEmailStore((s) => s.visible)
  const currentEmail = useEmailStore((s) => s.currentEmail)
  const close = useEmailStore((s) => s.close)
  const loading = useEmailStore((s) => s.loading)
  const refreshFromServer = useEmailStore((s) => s.refreshFromServer)

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
      <DialogContent className="sm:max-w-[900px] h-[600px] p-0 overflow-hidden flex flex-col">
        <div className="px-5 pr-16 py-3 border-b border-slate-200/50 bg-white/60 backdrop-blur-md flex items-center justify-between gap-3 flex-shrink-0">
          <h2 className="text-[15px] font-semibold text-slate-800 min-w-0">
            邮件查看器 —{' '}
            <span className="text-blue-600 font-mono text-[14px] break-all">
              {currentEmail}
            </span>
          </h2>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="mr-3 inline-flex items-center gap-2 rounded-[10px] bg-blue-600 px-3 py-2 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            <RefreshCw
              size={14}
              className={loading ? 'animate-spin' : ''}
            />
            <span>{loading ? '刷新中...' : '刷新邮件'}</span>
          </button>
        </div>
        <div className="flex flex-1 min-h-0">
          <EmailList />
          <EmailDetail />
        </div>
      </DialogContent>
    </Dialog>
  )
}
