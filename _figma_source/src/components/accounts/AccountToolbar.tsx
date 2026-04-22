import {
  Upload,
  FolderPlus,
  Trash2,
  Filter,
  Mail,
  ChevronDown,
  Copy,
  ClipboardList,
  ClipboardCheck,
  MoreHorizontal,
  Cloud,
  CloudCog,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/app/components/ui/dropdown-menu'
import { useAccountStore } from '@/stores/account-store'
import { useAuthStore } from '@/stores/auth-store'
import { useEmailStore } from '@/stores/email-store'
import { localDB } from '@/lib/db'
import { copyToClipboard } from '@/lib/clipboard'
import { formatAccountForImport } from '@/lib/format'
import { toast } from 'sonner'

interface AccountToolbarProps {
  onOpenImport: () => void
  onOpenGroup: () => void
  onOpenAddGroup: () => void
  onOpenDeleteGroup: () => void
}

export default function AccountToolbar({
  onOpenImport,
  onOpenGroup,
  onOpenAddGroup,
  onOpenDeleteGroup,
}: AccountToolbarProps) {
  const groups = useAccountStore((s) => s.groups)
  const selectedGroup = useAccountStore((s) => s.selectedGroup)
  const setSelectedGroup = useAccountStore((s) => s.setSelectedGroup)
  const selectedProvider = useAccountStore((s) => s.selectedProvider)
  const setSelectedProvider = useAccountStore((s) => s.setSelectedProvider)
  const loadAccounts = useAccountStore((s) => s.loadAccounts)
  const selectedAccounts = useAccountStore((s) => s.selectedAccounts)
  const selectAllMode = useAccountStore((s) => s.selectAllMode)
  const setSelectedAccounts = useAccountStore((s) => s.setSelectedAccounts)
  const setSelectAllMode = useAccountStore((s) => s.setSelectAllMode)
  const total = useAccountStore((s) => s.total)
  const loadGroups = useAccountStore((s) => s.loadGroups)
  const getFilteredAccounts = useAccountStore((s) => s.getFilteredAccounts)
  const currentEmail = useEmailStore((s) => s.currentEmail)
  const closeEmailViewer = useEmailStore((s) => s.close)
  const cloudPulling = useAccountStore((s) => s.cloudPulling)
  const cloudSyncing = useAccountStore((s) => s.cloudSyncing)
  const authStatus = useAuthStore((s) => s.status)
  const user = useAuthStore((s) => s.user)

  const handleGroupChange = (group: string) => {
    setSelectedGroup(group)
    loadAccounts()
  }

  const handleProviderChange = (provider: '全部类型' | 'microsoft' | 'google') => {
    setSelectedProvider(provider)
    loadAccounts()
  }

  const handleExport = async () => {
    try {
      const data = await localDB.exportData()
      const lines = data.accounts.map((acc) => formatAccountForImport(acc))
      const textContent = lines.join('\n')
      const blob = new Blob([textContent], {
        type: 'text/plain;charset=utf-8',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `邮箱账号导出_${new Date().toISOString().slice(0, 10)}.txt`
      link.click()
      URL.revokeObjectURL(url)
      toast.success(`导出成功！共 ${data.accounts.length} 个账号`)
    } catch (error) {
      toast.error('导出失败: ' + (error as Error).message)
    }
  }

  const handleBatchDelete = async () => {
    let accounts = []
    if (selectAllMode) {
      accounts = await getFilteredAccounts()
    } else {
      if (selectedAccounts.length === 0) {
        toast.warning('请先选择要删除的账号')
        return
      }
      accounts = selectedAccounts
    }

    if (accounts.length === 0) {
      toast.warning('没有可删除的账号')
      return
    }

    if (
      !confirm(`确定要删除选中的 ${accounts.length} 个账号吗？此操作不可恢复！`)
    )
      return

    try {
      const emails = accounts.map((acc) => acc.邮箱地址)
      await localDB.batchDeleteAccounts(emails)
      if (currentEmail && emails.includes(currentEmail)) {
        closeEmailViewer()
      }
      if (selectAllMode) setSelectAllMode(false)
      setSelectedAccounts([])
      await loadGroups()
      await loadAccounts()
      toast.success(`成功删除 ${emails.length} 个账号`)
    } catch (error) {
      toast.error('删除失败: ' + (error as Error).message)
    }
  }

  const handleBatchCopy = async (command: 'accounts' | 'passwords' | 'both') => {
    let accounts = []
    if (selectAllMode) {
      accounts = await getFilteredAccounts()
    } else {
      if (selectedAccounts.length === 0) {
        toast.warning('请先选择要复制的账号')
        return
      }
      accounts = selectedAccounts
    }

    let data: string[] = []
    if (command === 'accounts') {
      data = accounts.map((acc) => acc.邮箱地址)
    } else if (command === 'passwords') {
      data = accounts.filter((acc) => acc.密码).map((acc) => acc.密码)
    } else if (command === 'both') {
      data = accounts
        .filter((acc) => acc.密码)
        .map((acc) => `${acc.邮箱地址}----${acc.密码}`)
    }

    if (data.length === 0) {
      toast.warning('没有可复制的数据')
      return
    }

    await copyToClipboard(data.join('\n'))
    toast.success(`已复制 ${data.length} 条数据到剪贴板`)
  }

  const selectedCount = selectAllMode ? total : selectedAccounts.length
  const isAuthenticated = authStatus === 'authenticated' && Boolean(user)

  return (
    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
      <div className="flex flex-wrap items-center gap-2 xl:flex-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex min-h-10 items-center space-x-1.5 px-3 py-2 bg-white/60 backdrop-blur-md border border-white/80 rounded-[12px] text-[13px] font-medium text-slate-700 hover:bg-white shadow-sm transition-all">
              <Mail size={14} className="text-slate-500" />
              <span>
                {selectedProvider === '全部类型'
                  ? '全部类型'
                  : selectedProvider === 'google'
                  ? 'Gmail'
                  : 'Outlook'}
              </span>
              <ChevronDown size={14} className="text-slate-400" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-40">
            <DropdownMenuItem onClick={() => handleProviderChange('全部类型')}>
              全部类型
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleProviderChange('microsoft')}>
              Outlook
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleProviderChange('google')}>
              Gmail
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Group filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex min-h-10 items-center space-x-1.5 px-3 py-2 bg-white/60 backdrop-blur-md border border-white/80 rounded-[12px] text-[13px] font-medium text-slate-700 hover:bg-white shadow-sm transition-all">
              <Filter size={14} className="text-slate-500" />
              <span>{selectedGroup === '全部' ? '全部分组' : selectedGroup}</span>
              <ChevronDown size={14} className="text-slate-400" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-40">
            <DropdownMenuItem onClick={() => handleGroupChange('全部')}>
              全部分组
            </DropdownMenuItem>
            {groups.map((g) => (
              <DropdownMenuItem
                key={g.name}
                onClick={() => handleGroupChange(g.name)}
              >
                <span
                  className="w-2 h-2 rounded-full mr-2 flex-shrink-0"
                  style={{ backgroundColor: g.color }}
                />
                {g.name}
                <span className="ml-auto text-slate-400 text-xs">
                  {g.count}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="text-[13px] text-slate-500 font-medium px-1 sm:px-2">
          已选择{' '}
          <span className="text-slate-800 font-semibold">{selectedCount}</span>{' '}
          项
          {selectAllMode && (
            <span className="text-blue-500 ml-1">(全选模式)</span>
          )}
        </div>
        {isAuthenticated && (
          <div
            className={`inline-flex min-h-10 items-center gap-2 rounded-[12px] border px-3 py-2 text-[12px] font-medium ${
              cloudPulling || cloudSyncing
                ? 'border-blue-100 bg-blue-50 text-blue-700'
                : 'border-emerald-100 bg-emerald-50 text-emerald-700'
            }`}
          >
            {cloudPulling || cloudSyncing ? (
              <CloudCog size={14} className="animate-pulse" />
            ) : (
              <Cloud size={14} />
            )}
            <span>
              {cloudPulling
                ? '云端拉取中'
                : cloudSyncing
                ? '自动上云中'
                : '已启用自动云同步'}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 xl:justify-end xl:self-start">
        <ToolButton icon={<Upload size={14} />} onClick={onOpenImport}>
          导入
        </ToolButton>
        <ToolButton icon={<ClipboardCheck size={14} />} onClick={handleExport}>
          导出
        </ToolButton>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex min-h-10 items-center justify-center space-x-1.5 px-3 py-2 rounded-[12px] text-[13px] font-medium transition-all bg-white/60 backdrop-blur-md hover:bg-white text-slate-700 border border-white/80 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
              <MoreHorizontal size={14} />
              <span>更多</span>
              <ChevronDown size={12} className="text-slate-400" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => handleBatchCopy('accounts')}>
              <ClipboardList size={14} className="mr-2" />
              复制账号
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleBatchCopy('passwords')}>
              <ClipboardCheck size={14} className="mr-2" />
              复制密码
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleBatchCopy('both')}>
              <Copy size={14} className="mr-2" />
              复制账号+密码
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onOpenGroup}>
              <FolderPlus size={14} className="mr-2" />
              设置分组
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenAddGroup}>
              <FolderPlus size={14} className="mr-2" />
              新增分组
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenDeleteGroup}>
              <FolderPlus size={14} className="mr-2" />
              删除分组
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleBatchDelete}
              disabled={selectedCount === 0}
              variant="destructive"
            >
              <Trash2 size={14} className="mr-2" />
              批量删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

function ToolButton({
  children,
  icon,
  onClick,
  disabled = false,
}: {
  children: React.ReactNode
  icon: React.ReactNode
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-10 items-center justify-center space-x-1.5 px-3 py-2 rounded-[12px] text-[13px] font-medium transition-all border shadow-[0_1px_2px_rgba(0,0,0,0.05)] ${
        disabled
          ? 'cursor-not-allowed border-slate-200 bg-slate-100/70 text-slate-400'
          : 'bg-white/60 backdrop-blur-md hover:bg-white text-slate-700 border-white/80'
      }`}
    >
      <span>{icon}</span>
      <span>{children}</span>
    </button>
  )
}
