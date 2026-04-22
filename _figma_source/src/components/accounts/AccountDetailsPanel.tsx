import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Copy, Pencil, ShieldCheck, X, Check } from 'lucide-react'
import type { Account } from '@/types'
import { copyToClipboard } from '@/lib/clipboard'
import { formatAccountForImport, formatTime } from '@/lib/format'
import { localDB } from '@/lib/db'
import CopyButton from './CopyButton'
import { toast } from 'sonner'

function getValue(value: string | undefined | null): string {
  const normalized = String(value || '').trim()
  return normalized || '无'
}

function getSourceLabel(source: Account['数据来源']): string {
  if (source === 'hybrid') return '本地 + 云端'
  if (source === 'cloud') return '仅云端'
  return '本地'
}

interface CompactFieldRowProps {
  label: string
  value?: string
  copyValue?: string
  mono?: boolean
  multiline?: boolean
  editable?: boolean
  editMode?: boolean
  onSave?: (newValue: string) => Promise<void> | void
}

function CompactFieldRow({
  label,
  value,
  copyValue,
  mono,
  multiline,
  editable,
  editMode,
  onSave,
}: CompactFieldRowProps) {
  const displayValue = getValue(value)
  const actualCopyValue = getValue(copyValue ?? value)
  const hasValue = displayValue !== '无'

  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const startEditing = useCallback(() => {
    if (!editable) return
    setDraft(value || '')
    setIsEditing(true)
  }, [editable, value])

  const cancelEditing = useCallback(() => {
    setIsEditing(false)
    setDraft('')
  }, [])

  const confirmEditing = useCallback(async () => {
    try {
      setSaving(true)
      if (onSave) {
        await onSave(draft)
      }
      setIsEditing(false)
      setDraft('')
    } catch {
      // The field saver owns user-facing error messages.
    } finally {
      setSaving(false)
    }
  }, [draft, onSave])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelEditing()
      } else if (e.key === 'Enter' && !multiline) {
        e.preventDefault()
        confirmEditing()
      } else if (e.key === 'Enter' && e.metaKey && multiline) {
        e.preventDefault()
        confirmEditing()
      }
    },
    [cancelEditing, confirmEditing, multiline]
  )

  useEffect(() => {
    if (isEditing) {
      if (multiline && textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.select()
      } else if (inputRef.current) {
        inputRef.current.focus()
        inputRef.current.select()
      }
    }
  }, [isEditing, multiline])

  if (isEditing) {
    const sharedInputClasses =
      'w-full rounded-lg border border-blue-200 bg-blue-50/50 px-2.5 py-1.5 text-[13px] text-slate-700 outline-none ring-2 ring-blue-200/60 transition-all duration-150 placeholder:text-slate-300'
    const monoClass = mono ? ' font-mono' : ''

    return (
      <div className="flex flex-col gap-2 border-b border-slate-100/60 py-2.5 last:border-0 -mx-2 px-2 rounded-lg bg-blue-50/30">
        <div className="grid grid-cols-[100px_minmax(0,1fr)_64px] items-start gap-3 pl-1">
          <span className="w-[100px] shrink-0 text-[12px] font-medium text-blue-500">
            {label}
          </span>
          <div className="flex-1 min-w-0">
            {multiline ? (
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={3}
                className={`${sharedInputClasses}${monoClass} resize-none`}
                placeholder={`输入${label}…`}
              />
            ) : (
              <input
                ref={inputRef}
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                className={`${sharedInputClasses}${monoClass}`}
                placeholder={`输入${label}…`}
              />
            )}
          </div>
          <div className="flex h-7 items-center justify-end gap-1 shrink-0 pr-1">
            <button
              type="button"
              onClick={confirmEditing}
              disabled={saving}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md p-1 text-emerald-500 transition-all hover:bg-emerald-50 hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
              title="确认保存"
            >
              <Check size={14} strokeWidth={2.5} />
            </button>
            <button
              type="button"
              onClick={cancelEditing}
              disabled={saving}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md p-1 text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
              title="取消编辑"
            >
              <X size={14} strokeWidth={2.5} />
            </button>
          </div>
        </div>
        {multiline && (
          <p className="pl-[113px] text-[11px] text-slate-400">
            ⌘+Enter 保存 · Esc 取消
          </p>
        )}
      </div>
    )
  }

  const showPencil = editable && editMode

  return (
    <div className="group/row grid grid-cols-[100px_minmax(0,1fr)_64px] items-start gap-3 border-b border-slate-100/60 py-2.5 last:border-0 hover:bg-slate-50/80 -mx-2 px-2 rounded-lg transition-colors">
      <span className="w-[100px] shrink-0 pl-1 pt-0.5 text-[12px] font-medium text-slate-400">
        {label}
      </span>
      <div className="min-w-0 pt-0.5">
        <div
          className={`min-w-0 text-[13px] ${
            multiline ? 'line-clamp-2 break-all' : 'truncate'
          } ${mono ? 'font-mono text-slate-600' : 'text-slate-700'} ${
            showPencil ? 'cursor-pointer' : ''
          }`}
          title={multiline ? displayValue : undefined}
          onClick={showPencil ? startEditing : undefined}
        >
          {displayValue}
        </div>
      </div>
      <div className="flex h-7 items-center justify-end gap-1 pr-1">
        {showPencil && (
          <button
            type="button"
            onClick={startEditing}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md p-1 text-blue-400 transition-all hover:bg-blue-50 hover:text-blue-600"
            title={`编辑${label}`}
          >
            <Pencil size={14} strokeWidth={2} />
          </button>
        )}
        {hasValue ? <CopyButton text={actualCopyValue} /> : <span className="h-7 w-7" aria-hidden="true" />}
      </div>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-[16px] border border-slate-200/70 bg-white p-4 shadow-[0_2px_12px_rgb(15,23,42,0.02)] h-full">
      <h3 className="mb-2.5 text-[11px] font-bold uppercase tracking-widest text-slate-400">
        {title}
      </h3>
      <div className="flex flex-col">{children}</div>
    </div>
  )
}

interface AccountDetailsPanelProps {
  account: Account
  onAccountUpdated?: () => void
}

export default function AccountDetailsPanel({
  account,
  onAccountUpdated,
}: AccountDetailsPanelProps) {
  const [copied, setCopied] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const isMicrosoft = account.provider !== 'google'
  const isGoogle = account.provider === 'google'

  const handleCopyAll = useCallback(async () => {
    await copyToClipboard(formatAccountForImport(account))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }, [account])

  const makeFieldSaver = useCallback(
    (fieldKey: keyof Account) => {
      return async (newValue: string) => {
        try {
          await localDB.updateAccount(account.邮箱地址, {
            [fieldKey]: newValue,
          } as Partial<Account>)
          await onAccountUpdated?.()
          toast.success('字段已保存，稍后会自动同步到云端')
        } catch (error) {
          console.error(`保存字段 ${String(fieldKey)} 失败:`, error)
          toast.error('保存失败: ' + (error as Error).message)
          throw error
        }
      }
    },
    [account.邮箱地址, onAccountUpdated]
  )

  return (
    <div className="rounded-[22px] border border-blue-100/60 rounded-tl-none bg-gradient-to-b from-blue-50/30 to-transparent p-4 md:p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-100 bg-sky-50 px-2.5 py-1 text-[11px] font-bold text-sky-700 tracking-wide">
            <ShieldCheck size={14} strokeWidth={2.5} />
            完整凭证档案
          </span>
          <span className="rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 text-[11px] font-medium text-slate-600">
            {isGoogle ? 'Google' : 'Microsoft'}
          </span>
          <span className="rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 text-[11px] font-medium text-slate-600">
            {getSourceLabel(account.数据来源)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopyAll}
            className="inline-flex items-center justify-center shrink-0 gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-[12px] font-semibold text-slate-600 transition hover:bg-slate-50 shadow-sm"
          >
            {copied ? (
              <CheckCircle2 size={14} className="text-emerald-500" />
            ) : (
              <Copy size={14} className="text-slate-400" />
            )}
            {copied ? '已复制导入格式' : '复制导入格式'}
          </button>
          <button
            type="button"
            onClick={() => setEditMode((prev) => !prev)}
            className={`inline-flex items-center justify-center shrink-0 gap-1.5 rounded-xl border px-3.5 py-1.5 text-[12px] font-semibold transition shadow-sm ${
              editMode
                ? 'border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Pencil size={14} className={editMode ? 'text-blue-500' : 'text-slate-400'} />
            {editMode ? '完成编辑' : '编辑'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Section title="基础安全信息">
          <CompactFieldRow label="邮箱地址" value={account.邮箱地址} />
          <CompactFieldRow
            label="独立密码"
            value={account.密码}
            mono
            editable
            editMode={editMode}
            onSave={makeFieldSaver('密码')}
          />
          <CompactFieldRow
            label="辅助邮箱"
            value={account.辅助邮箱}
            editable
            editMode={editMode}
            onSave={makeFieldSaver('辅助邮箱')}
          />
          {isGoogle && (
            <CompactFieldRow
              label="2FA 密钥"
              value={account.两步验证}
              mono
              multiline
              editable
              editMode={editMode}
              onSave={makeFieldSaver('两步验证')}
            />
          )}
          <CompactFieldRow
            label="备注信息"
            value={account.备注}
            multiline
            editable
            editMode={editMode}
            onSave={makeFieldSaver('备注')}
          />
        </Section>

        {isMicrosoft ? (
          <Section title="Microsoft OAuth 参数">
            <CompactFieldRow
              label="Client ID"
              value={account.client_id}
              mono
              multiline
              editable
              editMode={editMode}
              onSave={makeFieldSaver('client_id')}
            />
            <CompactFieldRow
              label="Refresh Token"
              value={account.刷新令牌}
              mono
              multiline
              editable
              editMode={editMode}
              onSave={makeFieldSaver('刷新令牌')}
            />
            <CompactFieldRow
              label="令牌过期时间"
              value={
                account.令牌过期时间
                  ? formatTime(account.令牌过期时间)
                  : '无'
              }
            />
            <CompactFieldRow
              label="云端更新时间"
              value={
                account.云端更新时间
                  ? formatTime(account.云端更新时间)
                  : '无'
              }
            />
          </Section>
        ) : (
          <Section title="Google OAuth 信息">
            <CompactFieldRow
              label="OAuth 邮箱"
              value={account.oauth_email}
            />
            <CompactFieldRow
              label="接入状态"
              value={account.oauth_status || '未记录'}
            />
            <CompactFieldRow
              label="云端更新时间"
              value={
                account.云端更新时间
                  ? formatTime(account.云端更新时间)
                  : '无'
              }
            />
          </Section>
        )}
      </div>
    </div>
  )
}
