import { useCallback, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { CheckCircle2 } from 'lucide-react'
import type { Account } from '@/types'
import { useAccountStore } from '@/stores/account-store'
import { useEmailStore } from '@/stores/email-store'
import { copyToClipboard } from '@/lib/clipboard'
import { localDB } from '@/lib/db'
import { bindGoogleOAuth, generateTwoFactorCode } from '@/lib/api'
import { toast } from 'sonner'
import AccountRow from './AccountRow'
import AccountMobileCard from './AccountMobileCard'
import Pagination from './Pagination'

export default function AccountTable() {
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null)
  const accounts = useAccountStore((s) => s.accounts)
  const selectedAccounts = useAccountStore((s) => s.selectedAccounts)
  const setSelectedAccounts = useAccountStore((s) => s.setSelectedAccounts)
  const setSelectAllMode = useAccountStore((s) => s.setSelectAllMode)
  const currentPage = useAccountStore((s) => s.currentPage)
  const setCurrentPage = useAccountStore((s) => s.setCurrentPage)
  const pageSize = useAccountStore((s) => s.pageSize)
  const total = useAccountStore((s) => s.total)
  const loadAccounts = useAccountStore((s) => s.loadAccounts)
  const loadGroups = useAccountStore((s) => s.loadGroups)
  const openEmail = useEmailStore((s) => s.open)
  const currentEmail = useEmailStore((s) => s.currentEmail)
  const closeEmailViewer = useEmailStore((s) => s.close)

  const allSelected =
    accounts.length > 0 &&
    accounts.every((acc) =>
      selectedAccounts.some((s) => s.邮箱地址 === acc.邮箱地址)
    )

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedAccounts([])
    } else {
      setSelectedAccounts([...accounts])
    }
  }, [allSelected, accounts, setSelectedAccounts])

  const toggleSelect = useCallback(
    (account: Account) => {
      const exists = selectedAccounts.some(
        (s) => s.邮箱地址 === account.邮箱地址
      )
      if (exists) {
        setSelectedAccounts(
          selectedAccounts.filter((s) => s.邮箱地址 !== account.邮箱地址)
        )
      } else {
        setSelectedAccounts([...selectedAccounts, account])
      }
    },
    [selectedAccounts, setSelectedAccounts]
  )

  const handleView = useCallback(
    (email: string) => {
      openEmail(email).catch((err: Error) => {
        toast.error(err.message)
      })
    },
    [openEmail]
  )

  const handleGenerateTwoFactor = useCallback(
    async (account: Account) => {
      try {
        const response = await generateTwoFactorCode(
          account.邮箱地址,
          account.两步验证 || ''
        )
        const code = response.data?.code || ''
        const expiresIn = response.data?.expires_in || 0
        if (!code) {
          throw new Error('后端没有返回有效的 2FA 动态码')
        }
        await copyToClipboard(code)
        toast.success(`2FA 动态码 ${code}，已复制，${expiresIn} 秒后更新`)
      } catch (error) {
        toast.error((error as Error).message)
      }
    },
    []
  )

  const handleDelete = useCallback(
    async (email: string) => {
      if (!confirm('确定要删除这个账号吗？')) return
      try {
        await localDB.deleteAccount(email)
        setExpandedEmail((current) => (current === email ? null : current))

        const remainingSelected = selectedAccounts.filter(
          (item) => item.邮箱地址 !== email
        )
        setSelectedAccounts(remainingSelected)
        setSelectAllMode(false)

        if (currentEmail === email) {
          closeEmailViewer()
        }

        const nextTotal = Math.max(total - 1, 0)
        const nextTotalPages = Math.max(1, Math.ceil(nextTotal / pageSize))
        if (currentPage > nextTotalPages) {
          setCurrentPage(nextTotalPages)
        }

        await loadGroups()
        await loadAccounts()
        toast.success('删除成功')
      } catch (error) {
        toast.error('删除失败: ' + (error as Error).message)
      }
    },
    [
      closeEmailViewer,
      currentEmail,
      currentPage,
      loadAccounts,
      loadGroups,
      pageSize,
      selectedAccounts,
      setCurrentPage,
      setSelectedAccounts,
      setSelectAllMode,
      total,
    ]
  )

  const handleToggleDetails = useCallback((email: string) => {
    setExpandedEmail((current) => (current === email ? null : email))
  }, [])

  const handleAccountUpdated = useCallback(async () => {
    await loadAccounts()
  }, [loadAccounts])

  const handleBindGoogle = useCallback(
    async (account: Account) => {
      try {
        const payload = await bindGoogleOAuth(account.邮箱地址)
        await localDB.updateAccount(account.邮箱地址, {
          provider: 'google',
          client_id: payload.client_id || account.client_id || '',
          刷新令牌: payload.refresh_token || '',
          令牌类型: 'gmail_api',
          oauth_email: payload.oauth_email || account.oauth_email || '',
          oauth_status: 'connected',
          oauth_updated_at: payload.oauth_updated_at || new Date().toISOString(),
          权限已检测: true,
          使用本地IP: false,
          状态: '正常',
          备注: '',
        })
        await loadAccounts()
        toast.success(
          payload.message || `Gmail 授权成功：${payload.oauth_email || account.邮箱地址}`
        )
      } catch (error) {
        toast.error((error as Error).message)
      }
    },
    [loadAccounts]
  )

  const handleRowMenuCommand = useCallback(
    async (command: string, account: Account) => {
      if (command === 'delete') {
        await handleDelete(account.邮箱地址)
      } else if (command === 'bindGoogle') {
        await handleBindGoogle(account)
      } else if (command === 'check') {
        if (!selectedAccounts.some((s) => s.邮箱地址 === account.邮箱地址)) {
          setSelectedAccounts([...selectedAccounts, account])
        }
        toast.success('已勾选本行')
      } else if (command === 'checkFrom') {
        const input = prompt('请输入要勾选的数量')
        if (!input) return
        const count = parseInt(input)
        if (isNaN(count) || count < 1) {
          toast.error('请输入有效的正整数')
          return
        }
        const startIndex = accounts.findIndex(
          (acc) => acc.邮箱地址 === account.邮箱地址
        )
        if (startIndex !== -1) {
          const toSelect = accounts.slice(startIndex, startIndex + count)
          const newSelection = [...selectedAccounts]
          toSelect.forEach((row) => {
            if (!newSelection.some((s) => s.邮箱地址 === row.邮箱地址)) {
              newSelection.push(row)
            }
          })
          setSelectedAccounts(newSelection)
          toast.success(`已勾选 ${toSelect.length} 个账号`)
        }
      } else if (command === 'checkAll') {
        setSelectAllMode(true)
        setSelectedAccounts([...accounts])
        toast.success(`已启用全选模式！批量操作将应用到所有 ${total} 个账号`)
      } else if (command === 'uncheckAll') {
        setSelectedAccounts([])
        setSelectAllMode(false)
        toast.success('已取消全部勾选')
      }
    },
    [
      accounts,
      handleBindGoogle,
      handleDelete,
      selectedAccounts,
      setSelectedAccounts,
      setSelectAllMode,
      total,
    ]
  )

  return (
    <div className="bg-white/60 backdrop-blur-2xl border border-white/80 rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
      <div className="space-y-3 p-3 xl:hidden">
        {accounts.map((account, idx) => (
          <AccountMobileCard
            key={account.邮箱地址}
            account={account}
            index={idx}
            globalIndex={(currentPage - 1) * pageSize + idx + 1}
            isSelected={selectedAccounts.some(
              (s) => s.邮箱地址 === account.邮箱地址
            )}
            isExpanded={expandedEmail === account.邮箱地址}
            onToggleSelect={toggleSelect}
            onToggleDetails={handleToggleDetails}
            onView={handleView}
            onGenerateTwoFactorCode={handleGenerateTwoFactor}
            onRowMenuCommand={handleRowMenuCommand}
            onAccountUpdated={handleAccountUpdated}
          />
        ))}
      </div>

      <div className="hidden overflow-x-auto xl:block">
        <table className="w-full text-left border-collapse whitespace-nowrap">
          <thead>
            <tr className="border-b border-slate-200/50">
              <th className="px-4 py-3 w-12 text-center bg-white/40 backdrop-blur-md">
                <div
                  onClick={toggleSelectAll}
                  className={`w-4 h-4 rounded-[4px] border flex items-center justify-center cursor-pointer transition-colors mx-auto ${
                    allSelected
                      ? 'bg-blue-500 border-blue-500'
                      : 'bg-white/50 border-slate-300 hover:border-blue-400'
                  }`}
                >
                  {allSelected && (
                    <CheckCircle2
                      size={12}
                      className="text-white"
                      strokeWidth={3}
                    />
                  )}
                </div>
              </th>
              <th className="px-3 py-3 w-12 text-center text-[12px] font-semibold text-slate-400 uppercase tracking-wider bg-white/40 backdrop-blur-md">
                #
              </th>
              <th className="px-4 py-3 text-[12px] font-semibold text-slate-400 uppercase tracking-wider bg-white/40 backdrop-blur-md">
                邮箱账户
              </th>
              <th className="px-4 py-3 text-[12px] font-semibold text-slate-400 uppercase tracking-wider bg-white/40 backdrop-blur-md">
                密码
              </th>
              <th className="px-4 py-3 text-[12px] font-semibold text-slate-400 uppercase tracking-wider bg-white/40 backdrop-blur-md">
                标签
              </th>
              <th className="px-4 py-3 text-[12px] font-semibold text-slate-400 uppercase tracking-wider bg-white/40 backdrop-blur-md">
                连接状态
              </th>
              <th className="px-4 py-3 text-[12px] font-semibold text-slate-400 uppercase tracking-wider bg-white/40 backdrop-blur-md">
                协议
              </th>
              <th className="px-4 py-3 text-right text-[12px] font-semibold text-slate-400 uppercase tracking-wider bg-white/40 backdrop-blur-md">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100/50">
            <AnimatePresence>
              {accounts.map((account, idx) => (
                <AccountRow
                  key={account.邮箱地址}
                  account={account}
                  index={idx}
                  globalIndex={(currentPage - 1) * pageSize + idx + 1}
                  isSelected={selectedAccounts.some(
                    (s) => s.邮箱地址 === account.邮箱地址
                  )}
                  isExpanded={expandedEmail === account.邮箱地址}
                  onToggleSelect={toggleSelect}
                  onToggleDetails={handleToggleDetails}
                  onView={handleView}
                  onGenerateTwoFactorCode={handleGenerateTwoFactor}
                  onBindGoogle={handleBindGoogle}
                  onRowMenuCommand={handleRowMenuCommand}
                  onAccountUpdated={handleAccountUpdated}
                />
              ))}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
      <Pagination />
    </div>
  )
}
