import { motion } from 'motion/react'
import {
  Link2,
  CheckCircle2,
  Eye,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
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

interface AccountRowProps {
  account: Account
  index: number
  globalIndex: number
  isSelected: boolean
  isExpanded: boolean
  onToggleSelect: (account: Account) => void
  onToggleDetails: (email: string) => void
  onView: (email: string) => void
  onGenerateTwoFactorCode: (account: Account) => void
  onBindGoogle: (account: Account) => void
  onRowMenuCommand: (command: string, account: Account) => void
  onAccountUpdated?: () => void
}

export default function AccountRow({
  account,
  index,
  globalIndex,
  isSelected,
  isExpanded,
  onToggleSelect,
  onToggleDetails,
  onView,
  onGenerateTwoFactorCode,
  onBindGoogle,
  onRowMenuCommand,
  onAccountUpdated,
}: AccountRowProps) {
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
    <>
      <motion.tr
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, delay: index * 0.03 }}
        className={`group transition-colors h-[52px] ${
          isSelected ? 'bg-blue-500/5' : 'hover:bg-white/40'
        }`}
      >
        <td className="px-4 py-2 text-center">
          <div
            onClick={() => onToggleSelect(account)}
            className={`w-4 h-4 rounded-[4px] border flex items-center justify-center cursor-pointer transition-colors mx-auto ${
              isSelected
                ? 'bg-blue-500 border-blue-500'
                : 'bg-white/50 border-slate-300 hover:border-blue-400'
            }`}
          >
            {isSelected && (
              <CheckCircle2 size={12} className="text-white" strokeWidth={3} />
            )}
          </div>
        </td>
        <td className="px-3 py-2 text-center text-[13px] text-slate-400 font-medium">
          {globalIndex}
        </td>
        <td className="px-4 py-2">
          <div className="flex items-center gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[14px] text-slate-700 font-medium tracking-tight truncate max-w-[340px] xl:max-w-[420px]">
                  {account.邮箱地址}
                </span>
                <CopyButton text={account.邮箱地址} />
                <ProviderBadge provider={account.provider} />
              </div>
            </div>
          </div>
        </td>
        <td className="px-4 py-2">
          <div className="flex items-center space-x-2">
            <span className="text-[13px] text-slate-600 font-mono tracking-tight truncate max-w-[180px]">
              {account.密码 || '无'}
            </span>
            {account.密码 && <CopyButton text={account.密码} />}
          </div>
        </td>
        <td className="px-4 py-2">
          <GroupBadge group={account.分组 || '默认分组'} />
        </td>
        <td className="px-4 py-2">
          <StatusBadge status={status} />
        </td>
        <td className="px-4 py-2">
          <PermissionBadge type={account.令牌类型} />
        </td>
        <td className="px-4 py-2 text-right">
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => onToggleDetails(account.邮箱地址)}
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-slate-200 bg-white/80 px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
              title={isExpanded ? '收起资料' : '查看资料'}
            >
              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              <span>{isExpanded ? '收起资料' : '查看资料'}</span>
            </button>
            {account.provider === 'google' && (
              <button
                onClick={() => onBindGoogle(account)}
                className="inline-flex items-center gap-1.5 rounded-[10px] border border-amber-100 bg-amber-50 px-3 py-1.5 text-[12px] font-medium text-amber-700 transition-colors hover:bg-amber-100"
                title={googleBound ? '重新绑定 Gmail' : '绑定 Gmail'}
              >
                <Link2 size={14} />
                <span>{googleBound ? '重新绑定' : '绑定 Gmail'}</span>
              </button>
            )}
            {needsGoogleTwoFactor ? (
              <button
                onClick={() => onGenerateTwoFactorCode(account)}
                disabled={!canGenerateTwoFactor}
                className={`inline-flex items-center gap-1.5 rounded-[10px] border px-3 py-1.5 text-[12px] font-medium transition-colors ${
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
                <ShieldCheck size={14} />
                <span>接码</span>
              </button>
            ) : (
              <button
                onClick={() => onView(account.邮箱地址)}
                disabled={!canViewMail}
                className={`inline-flex items-center gap-1.5 rounded-[10px] border px-3 py-1.5 text-[12px] font-medium transition-colors ${
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
                <Eye size={14} />
                <span>
                  {hasMailCredentials ? '查看' : canAutoHydrateCredentials ? '拉取后查看' : '只读'}
                </span>
              </button>
            )}
            <div className="rounded-[10px] border border-slate-200 bg-white/70">
              <RowMenu
                onCommand={(cmd) => onRowMenuCommand(cmd, account)}
                showDelete
              />
            </div>
          </div>
        </td>
      </motion.tr>
      {isExpanded && (
        <tr className="bg-slate-50/60">
          <td colSpan={8} className="px-4 pb-4 pt-0">
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className="pt-2"
            >
              <AccountDetailsPanel account={account} onAccountUpdated={onAccountUpdated} />
            </motion.div>
          </td>
        </tr>
      )}
    </>
  )
}
