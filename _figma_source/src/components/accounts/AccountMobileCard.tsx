import { motion } from 'motion/react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  ShieldCheck,
} from 'lucide-react'
import type { Account } from '@/types'
import CopyButton from './CopyButton'
import StatusBadge from './StatusBadge'
import PermissionBadge from './PermissionBadge'
import GroupBadge from './GroupBadge'
import ProviderBadge from './ProviderBadge'
import AccountDetailsPanel from './AccountDetailsPanel'
import RowMenu from '@/components/shared/RowMenu'
import { useAuthStore } from '@/stores/auth-store'

function getAccountStatus(account: Account): string {
  if (account.状态 && account.状态 !== '正常') return account.状态
  if (account.provider === 'google' && !account.刷新令牌) return '未授权'
  if (account.provider === 'google' && account.oauth_status === 'not_connected') {
    return '未授权'
  }
  const token = account.刷新令牌
  if (token === '封禁') return '封禁'
  if (token === '锁定') return '锁定'
  if (token === '过期') return '过期'
  if (token === '无效') return '无效'
  return '正常'
}

interface AccountMobileCardProps {
  account: Account
  index: number
  globalIndex: number
  isSelected: boolean
  isExpanded: boolean
  onToggleSelect: (account: Account) => void
  onToggleDetails: (email: string) => void
  onView: (email: string) => void
  onGenerateTwoFactorCode: (account: Account) => void
  onRowMenuCommand: (command: string, account: Account) => void
}

export default function AccountMobileCard({
  account,
  index,
  globalIndex,
  isSelected,
  isExpanded,
  onToggleSelect,
  onToggleDetails,
  onView,
  onGenerateTwoFactorCode,
  onRowMenuCommand,
}: AccountMobileCardProps) {
  const status = getAccountStatus(account)
  const googleBound = account.provider === 'google' && Boolean(account.刷新令牌)
  const authStatus = useAuthStore((s) => s.status)
  const hasMailCredentials =
    account.provider === 'google'
      ? Boolean(account.刷新令牌)
      : Boolean(account.client_id && account.刷新令牌)
  const isCloudOnly = account.数据来源 === 'cloud' && !hasMailCredentials
  const canAutoHydrateCredentials =
    authStatus === 'authenticated' &&
    Boolean(account.数据来源 === 'cloud' || account.数据来源 === 'hybrid')
  const canViewMail = hasMailCredentials || canAutoHydrateCredentials
  const needsGoogleTwoFactor =
    account.provider === 'google' && !account.刷新令牌
  const canGenerateTwoFactor = needsGoogleTwoFactor && Boolean(account.两步验证 || authStatus === 'authenticated')

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.03 }}
      className={`rounded-[22px] border p-4 shadow-[0_10px_26px_rgb(15,23,42,0.06)] backdrop-blur-xl ${
        isSelected
          ? 'border-blue-200 bg-blue-50/60'
          : 'border-white/80 bg-white/75'
      }`}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => onToggleSelect(account)}
          className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors ${
            isSelected
              ? 'border-blue-500 bg-blue-500'
              : 'border-slate-300 bg-white/80'
          }`}
          aria-label={isSelected ? '取消选择账号' : '选择账号'}
        >
          {isSelected && (
            <CheckCircle2 size={12} className="text-white" strokeWidth={3} />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-slate-400">
                  #{globalIndex}
                </span>
                <span className="truncate text-[15px] font-semibold text-slate-800">
                  {account.邮箱地址}
                </span>
                <CopyButton text={account.邮箱地址} alwaysVisible />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <ProviderBadge provider={account.provider} />
                {(account.分组 || '默认分组') !== '默认分组' && (
                  <GroupBadge group={account.分组 || '默认分组'} />
                )}
                <StatusBadge status={status} />
                <PermissionBadge type={account.令牌类型} />
              </div>
            </div>

            <div className="rounded-[10px] border border-slate-200 bg-white/80">
              <RowMenu
                onCommand={(cmd) => onRowMenuCommand(cmd, account)}
                showBindGoogle={account.provider === 'google' && !googleBound}
                showDelete
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => onToggleDetails(account.邮箱地址)}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white/85 px-4 py-2 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              <span>{isExpanded ? '收起资料' : '查看资料'}</span>
            </button>
            {needsGoogleTwoFactor ? (
              <button
                onClick={() => onGenerateTwoFactorCode(account)}
                disabled={!canGenerateTwoFactor}
                className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border px-4 py-2 text-[13px] font-semibold transition ${
                  canGenerateTwoFactor
                    ? 'border-violet-100 bg-violet-50 text-violet-700 hover:bg-violet-100'
                    : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                }`}
                title={
                  canGenerateTwoFactor
                    ? '生成当前 2FA 动态码并复制到剪贴板'
                    : '当前账号没有可用的 2FA secret；请先补齐“两步验证”字段或等待完整资料上云'
                }
              >
                <ShieldCheck size={16} />
                <span>接码</span>
              </button>
            ) : (
              <button
                onClick={() => onView(account.邮箱地址)}
                disabled={!canViewMail}
                className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border px-4 py-2 text-[13px] font-semibold transition ${
                  canViewMail
                    ? 'border-blue-100 bg-blue-50 text-blue-600 hover:bg-blue-100'
                    : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                }`}
                title={
                  isCloudOnly
                    ? canAutoHydrateCredentials
                      ? '点击后会自动拉取完整资料，再继续拉邮件'
                      : '当前设备还没有这条账号的完整资料，暂时不能直接拉邮件'
                    : '查看邮件'
                }
              >
                <Eye size={16} />
                <span>
                  {hasMailCredentials ? '查看' : canAutoHydrateCredentials ? '拉取后查看' : '只读'}
                </span>
              </button>
            )}
          </div>

          {isExpanded && (
            <div className="pt-4">
              <div className="mb-3 rounded-2xl border border-slate-200/70 bg-slate-50/70 p-3">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-slate-700">
                    {account.密码 || '无'}
                  </span>
                  {account.密码 && <CopyButton text={account.密码} alwaysVisible />}
                </div>
              </div>
              <AccountDetailsPanel account={account} />
            </div>
          )}
        </div>
      </div>
    </motion.article>
  )
}
