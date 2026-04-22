import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/app/components/ui/dialog'
import { addGroup } from '@/stores/account-store'
import { PRESET_COLORS } from '@/lib/format'
import ColorPicker from '@/components/shared/ColorPicker'
import { toast } from 'sonner'

interface AddGroupDialogProps {
  open: boolean
  onClose: () => void
}

export default function AddGroupDialog({ open, onClose }: AddGroupDialogProps) {
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(PRESET_COLORS[0])

  const handleSubmit = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.warning('请输入分组名称')
      return
    }

    const success = await addGroup(trimmed, color)
    if (!success) {
      toast.warning('该分组已存在')
      return
    }

    toast.success('分组创建成功')
    setName('')
    setColor(PRESET_COLORS[0])
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>新增分组</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <label className="text-[13px] font-medium text-slate-700 block mb-1.5">
              分组名称
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="输入分组名称"
              className="w-full px-3 py-2 text-[14px] bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-300"
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
          </div>

          <div>
            <label className="text-[13px] font-medium text-slate-700 block mb-1.5">
              分组颜色
            </label>
            <ColorPicker value={color} onChange={setColor} />
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
            创建
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
