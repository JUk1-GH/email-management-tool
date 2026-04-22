import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/app/components/ui/dropdown-menu'
import {
  MoreHorizontal,
  Check,
  CheckCheck,
  ListChecks,
  Link2,
  Trash2,
  X,
} from 'lucide-react'

interface RowMenuProps {
  onCommand: (command: string) => void
  showDelete?: boolean
  showBindGoogle?: boolean
}

export default function RowMenu({
  onCommand,
  showDelete = false,
  showBindGoogle = false,
}: RowMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex h-9 w-9 items-center justify-center rounded-[10px] transition-colors text-slate-400 hover:text-blue-500 hover:bg-blue-50"
          title="更多"
        >
          <MoreHorizontal size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={() => onCommand('check')}>
          <Check size={14} className="mr-2" />
          勾选本行
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onCommand('checkFrom')}>
          <ListChecks size={14} className="mr-2" />
          从本行勾N个
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onCommand('checkAll')}>
          <CheckCheck size={14} className="mr-2" />
          全选所有数据
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onCommand('uncheckAll')}>
          <X size={14} className="mr-2" />
          取消全部勾选
        </DropdownMenuItem>
        {(showBindGoogle || showDelete) && <DropdownMenuSeparator />}
        {showBindGoogle && (
          <DropdownMenuItem onClick={() => onCommand('bindGoogle')}>
            <Link2 size={14} className="mr-2" />
            绑定 Gmail
          </DropdownMenuItem>
        )}
        {showDelete && (
          <DropdownMenuItem
            onClick={() => onCommand('delete')}
            variant="destructive"
          >
            <Trash2 size={14} className="mr-2" />
            删除账号
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
