import { useCallback, useState } from 'react'
import { CheckCircle2, Copy, ShieldCheck } from 'lucide-react'
import type { Account } from '@/types'
import { copyToClipboard } from '@/lib/clipboard'
import { formatTime } from '@/lib/format'
import CopyButton from './CopyButton'

function getValue(value: string | undefined | null): string {
  const normalized = String(value || '').trim()
  return normalized || '无'
}

function getSourceLabel(source: Account['数据来源']): string {
  if (source === 'hybrid') return '本地 + 云端'
  if (source === 'cloud') return '仅云端'
  return '本地'
}

function buildCopyLine(account: Account): string {
  return [
    account.provider || 'microsoft',
    account.邮箱地址 || '',
    account.密码 || '',
    account.辅助邮箱 || '',
    account.两步验证 || '',
    account.client_id || '',
    account.刷新令牌 || '',
    account.令牌过期时间 || '',
    account.分组 || '默认分组',
    account.oauth_email || '',
    account.oauth_status || '',
    account.状态 || '',
    account.备注 || '',
  ].join('----')
}

interface FieldCardProps {
  label: string
  value?: string
  copyValue?: string
  mono?: boolean
  className?: string
}

function FieldCard({
  label,
  value,
  copyValue,
  mono = false,
  className = '',
}: FieldCardProps) {
  const displayValue = getValue(value)
  const actualCopyValue = getValue(copyValue ?? value)
  const hasValue = displayValue !== '无'

  return (
    <div
      className={`rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-[0_4px_18px_rgb(15,23,42,0.05)] ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          {label}
        </p>
        {hasValue && (
          <CopyButton text={actualCopyValue} alwaysVisible />
        )}
      </div>
      <p
        className={`mt-2 break-all whitespace-pre-wrap text-[13px] leading-6 ${
          mono ? 'font-mono text-slate-700' : 'text-slate-700'
        } ${hasValue ? '' : 'text-slate-400'}`}
      >
        {displayValue}
      </p>
    </div>
  )
}

export default function AccountDetailsPanel({ account }: { account: Account }) {
  const [copied, setCopied] = useState(false)

  const handleCopyAll = useCallback(async () => {
    await copyToClipboard(buildCopyLine(account))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }, [account])

  return (
    <div className="rounded-[22px] border border-slate-200/70 bg-gradient-to-br from-slate-50 via-white to-sky-50/70 p-4 md:p-5 shadow-[0_8px_24px_rgb(15,23,42,0.06)]">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-[12px] font-semibold text-sky-700">
              <ShieldCheck size={14} />
              完整账号资料
            </span>
            <span className="rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-[12px] font-medium text-slate-600">
              {account.provider === 'google' ? 'Google' : 'Microsoft'}
            </span>
            <span className="rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-[12px] font-medium text-slate-600">
              {getSourceLabel(account.数据来源)}
            </span>
          </div>
          <p className="mt-3 text-[13px] leading-6 text-slate-500">
            这里直接显示邮箱、密码、辅助邮箱、2FA、client_id、refresh token 和同步状态。每个字段都能单独复制。
          </p>
        </div>
        <button
          type="button"
          onClick={handleCopyAll}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky-200 bg-white/80 px-4 py-2 text-[13px] font-semibold text-sky-700 transition hover:bg-sky-50"
        >
          {copied ? <CheckCircle2 size={15} /> : <Copy size={15} />}
          {copied ? '已复制整条资料' : '复制整条资料'}
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <FieldCard label="邮箱地址" value={account.邮箱地址} copyValue={account.邮箱地址} />
        <FieldCard label="密码" value={account.密码} copyValue={account.密码} mono />
        <FieldCard
          label="辅助邮箱"
          value={account.辅助邮箱}
          copyValue={account.辅助邮箱}
        />
        <FieldCard label="2FA" value={account.两步验证} copyValue={account.两步验证} mono />
        <FieldCard label="分组" value={account.分组 || '默认分组'} />
        <FieldCard label="状态" value={account.状态 || '正常'} />
        <FieldCard label="OAuth 邮箱" value={account.oauth_email} copyValue={account.oauth_email} />
        <FieldCard label="OAuth 状态" value={account.oauth_status || '未记录'} />
        <FieldCard
          label="协议"
          value={
            account.令牌类型 ||
            (account.provider === 'google' ? 'gmail_api' : '未检测')
          }
        />
        <FieldCard
          label="Client ID"
          value={account.client_id}
          copyValue={account.client_id}
          mono
          className="md:col-span-2 xl:col-span-1"
        />
        <FieldCard
          label="Refresh Token"
          value={account.刷新令牌}
          copyValue={account.刷新令牌}
          mono
          className="md:col-span-2 xl:col-span-2"
        />
        <FieldCard
          label="令牌过期时间"
          value={account.令牌过期时间 ? formatTime(account.令牌过期时间) : '无'}
          copyValue={account.令牌过期时间}
        />
        <FieldCard label="云端更新时间" value={account.云端更新时间 ? formatTime(account.云端更新时间) : '无'} copyValue={account.云端更新时间} />
        <FieldCard label="备注" value={account.备注} copyValue={account.备注} className="md:col-span-2 xl:col-span-3" />
      </div>
    </div>
  )
}
