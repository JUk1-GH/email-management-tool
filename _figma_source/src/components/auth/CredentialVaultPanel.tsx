import { useState } from 'react'
import { DownloadCloud, KeyRound, UploadCloud } from 'lucide-react'
import { toast } from 'sonner'
import { localDB } from '@/lib/db'
import { syncCloudSecrets, unlockCloudSecrets } from '@/lib/api'
import { formatAccountForImport } from '@/lib/format'
import { useAccountStore } from '@/stores/account-store'
import { useAuthStore } from '@/stores/auth-store'
import type { Account, CloudSecretRecord } from '@/types'

function hasSensitiveValue(account: Account): boolean {
  return Boolean(
    account.密码 ||
      account.辅助邮箱 ||
      account.两步验证 ||
      account.client_id ||
      account.刷新令牌 ||
      account.令牌过期时间
  )
}

function buildSecretPayload(account: Account): Record<string, unknown> {
  return {
    email_address: account.邮箱地址,
    provider: account.provider || 'microsoft',
    group_name: account.分组 || '默认分组',
    status: account.状态 || '正常',
    note: account.备注 || '',
    oauth_status: account.oauth_status || 'not_connected',
    oauth_email: account.oauth_email || '',
    oauth_updated_at: account.oauth_updated_at || '',
    import_sequence: Number(account.导入序号 || 0),
    password: account.密码 || '',
    recovery_email: account.辅助邮箱 || '',
    twofa_secret: account.两步验证 || '',
    client_id: account.client_id || '',
    refresh_token: account.刷新令牌 || '',
    token_expires_at: account.令牌过期时间 || '',
  }
}

function mergeForExport(accounts: Account[], secrets: CloudSecretRecord[]): string {
  const accountByEmail = new Map(accounts.map((account) => [account.邮箱地址.toLowerCase(), account]))
  return secrets
    .map((secret) => {
      const account = accountByEmail.get(secret.email_address.toLowerCase())
      return formatAccountForImport({
        provider: secret.provider || account?.provider || 'microsoft',
        邮箱地址: secret.email_address,
        密码: secret.password || account?.密码 || '',
        辅助邮箱: secret.recovery_email || account?.辅助邮箱 || '',
        两步验证: secret.twofa_secret || account?.两步验证 || '',
        client_id: secret.client_id || account?.client_id || '',
        刷新令牌: secret.refresh_token || account?.刷新令牌 || '',
        令牌过期时间: secret.token_expires_at || account?.令牌过期时间 || '',
        分组: secret.group_name || account?.分组 || '默认分组',
      })
    })
    .join('\n')
}

function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export default function CredentialVaultPanel() {
  const [busy, setBusy] = useState<'pull' | 'push' | 'export' | ''>('')
  const authStatus = useAuthStore((s) => s.status)
  const user = useAuthStore((s) => s.user)
  const cloudSummary = useAuthStore((s) => s.cloudSummary)
  const refreshMe = useAuthStore((s) => s.refreshMe)
  const loadAccounts = useAccountStore((s) => s.loadAccounts)
  const loadGroups = useAccountStore((s) => s.loadGroups)
  const pushAccountsToCloud = useAccountStore((s) => s.pushAccountsToCloud)

  const isAuthenticated = authStatus === 'authenticated' && Boolean(user)

  const pullSecrets = async () => {
    setBusy('pull')
    try {
      const response = await unlockCloudSecrets()
      const records = response.data || []
      const result = await localDB.mergeCloudSecrets(records)
      await loadGroups()
      await loadAccounts()
      await refreshMe()
      toast.success(
        `已拉取 ${records.length} 条完整账号资料，更新 ${result.updated} 条，新建 ${result.created} 条`
      )
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy('')
    }
  }

  const pushSecrets = async () => {
    setBusy('push')
    try {
      await pushAccountsToCloud()
      const accounts = await localDB.getAllAccounts()
      const payload = accounts.filter(hasSensitiveValue).map(buildSecretPayload)
      if (payload.length === 0) {
        toast.warning('当前本机没有可同步的完整账号资料')
        return
      }
      const response = await syncCloudSecrets(payload)
      await refreshMe()
      toast.success(
        `完整账号资料已加密同步 ${response.data?.upserted || 0} 条，云端共 ${response.data?.total || 0} 条`
      )
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy('')
    }
  }

  const exportSecrets = async () => {
    setBusy('export')
    try {
      const response = await unlockCloudSecrets()
      const secrets = response.data || []
      if (secrets.length === 0) {
        toast.warning('云端还没有完整账号资料')
        return
      }
      const accounts = await localDB.getAllAccounts()
      const content = mergeForExport(accounts, secrets)
      downloadText(`完整账号资料_${new Date().toISOString().slice(0, 10)}.txt`, content)
      toast.success(`已导出 ${secrets.length} 条完整账号资料`)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="rounded-[20px] border border-amber-100 bg-gradient-to-br from-amber-50/90 via-white/75 to-orange-50/70 p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              <KeyRound size={16} />
            </span>
            <h3 className="text-[16px] font-semibold text-slate-800">完整账号资料</h3>
          </div>
          <p className="mt-3 text-[13px] leading-6 text-slate-600">
            个人模式下，密码、辅助邮箱、2FA、client_id、refresh token 也会自动加密上云。这里保留手动补拉、补传和导出入口。
          </p>
        </div>
        <span className="rounded-full border border-amber-200 bg-white/70 px-3 py-1 text-[12px] font-medium text-amber-700">
          云端完整账号 {cloudSummary?.credential_count || 0} 条
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={pullSecrets}
          disabled={!isAuthenticated || Boolean(busy)}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          <KeyRound size={14} />
          {busy === 'pull' ? '拉取中...' : '立即拉取完整资料'}
        </button>
        <button
          type="button"
          onClick={pushSecrets}
          disabled={!isAuthenticated || Boolean(busy)}
          className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-white/70 px-3 py-2 text-[13px] font-medium text-amber-700 transition hover:bg-white disabled:cursor-not-allowed disabled:text-slate-400"
        >
          <UploadCloud size={14} />
          {busy === 'push' ? '同步中...' : '立即补传云端'}
        </button>
        <button
          type="button"
          onClick={exportSecrets}
          disabled={!isAuthenticated || Boolean(busy)}
          className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-white/70 px-3 py-2 text-[13px] font-medium text-amber-700 transition hover:bg-white disabled:cursor-not-allowed disabled:text-slate-400"
        >
          <DownloadCloud size={14} />
          {busy === 'export' ? '导出中...' : '导出云端完整资料'}
        </button>
      </div>
    </div>
  )
}
