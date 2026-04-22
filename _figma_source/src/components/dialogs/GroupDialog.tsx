import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/app/components/ui/dialog'
import { useAccountStore } from '@/stores/account-store'
import { localDB } from '@/lib/db'
import { toast } from 'sonner'

interface GroupDialogProps {
  open: boolean
  onClose: () => void
}

export default function GroupDialog({ open, onClose }: GroupDialogProps) {
  const [selectedGroupName, setSelectedGroupName] = useState('')
  const groups = useAccountStore((s) => s.groups)
  const selectedAccounts = useAccountStore((s) => s.selectedAccounts)
  const loadAccounts = useAccountStore((s) => s.loadAccounts)
  const loadGroups = useAccountStore((s) => s.loadGroups)

  const handleSubmit = async () => {
    if (!selectedGroupName) {
      toast.warning('请选择分组名称')
      return
    }
    if (selectedAccounts.length === 0) {
      toast.warning('请先选择要设置分组的账号')
      return
    }

    try {
      const emails = selectedAccounts.map((acc) => acc.邮箱地址)
      const result = await localDB.batchUpdateGroup(emails, selectedGroupName)
      toast.success(`成功设置 ${result.success} 个账号的分组`)
      onClose()
      await loadGroups()
      await loadAccounts()
    } catch (error) {
      toast.error('设置分组失败: ' + (error as Error).message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>
            批量设置分组（{selectedAccounts.length} 个账号）
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <p className="text-[13px] text-slate-500">选择目标分组：</p>
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <button
                key={g.name}
                onClick={() => setSelectedGroupName(g.name)}
                className={`px-3 py-1.5 rounded-lg text-[13px] font-medium border transition-colors ${
                  selectedGroupName === g.name
                    ? 'bg-blue-50 border-blue-300 text-blue-600'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-blue-200'
                }`}
              >
                <span
                  className="inline-block w-2 h-2 rounded-full mr-1.5"
                  style={{ backgroundColor: g.color }}
                />
                {g.name}
              </button>
            ))}
          </div>
        </div>

        <DialogFooter>
          <button
            onClick={onClose}
            className="px-4 py-2 text-[13px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 text-[13px] font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm"
          >
            确定
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
