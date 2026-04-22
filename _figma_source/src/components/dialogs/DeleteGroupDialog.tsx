import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/app/components/ui/dialog'
import { useAccountStore, deleteGroups } from '@/stores/account-store'
import { toast } from 'sonner'

interface DeleteGroupDialogProps {
  open: boolean
  onClose: () => void
}

export default function DeleteGroupDialog({
  open,
  onClose,
}: DeleteGroupDialogProps) {
  const [selected, setSelected] = useState<string[]>([])
  const groups = useAccountStore((s) => s.groups)
  const groupsForDelete = groups.filter((g) => g.name !== '默认分组')

  const toggle = (name: string) => {
    setSelected((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    )
  }

  const handleSubmit = async () => {
    if (selected.length === 0) {
      toast.warning('请选择要删除的分组')
      return
    }
    if (
      !confirm(
        `确定要删除选中的 ${selected.length} 个分组吗？这些分组下的所有账号将被设置为"默认分组"`
      )
    )
      return

    const count = await deleteGroups(selected)
    toast.success(`成功删除 ${count} 个分组`)
    setSelected([])
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>删除分组</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <p className="text-[13px] text-slate-500">
            删除分组后，该分组下的账号将移到"默认分组"
          </p>
          {groupsForDelete.length === 0 ? (
            <p className="text-[13px] text-slate-400 text-center py-4">
              没有可删除的分组
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {groupsForDelete.map((g) => (
                <button
                  key={g.name}
                  onClick={() => toggle(g.name)}
                  className={`px-3 py-1.5 rounded-lg text-[13px] font-medium border transition-colors ${
                    selected.includes(g.name)
                      ? 'bg-red-50 border-red-300 text-red-600'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-red-200'
                  }`}
                >
                  <span
                    className="inline-block w-2 h-2 rounded-full mr-1.5"
                    style={{ backgroundColor: g.color }}
                  />
                  {g.name}
                  <span className="text-slate-400 ml-1">({g.count})</span>
                </button>
              ))}
            </div>
          )}
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
            disabled={selected.length === 0}
            className="px-4 py-2 text-[13px] font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shadow-sm disabled:opacity-50"
          >
            删除 ({selected.length})
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
