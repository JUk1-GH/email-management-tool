import { create } from 'zustand'
import type { Account, Email } from '@/types'
import { localDB } from '@/lib/db'
import { fetchEmailDetail, refreshEmails, unlockCloudSecrets } from '@/lib/api'
import { useAccountStore } from './account-store'

const MICROSOFT_STATUS_MAP: Record<
  string,
  Pick<Account, '状态' | '备注'>
> = {
  banned: { 状态: '封禁', 备注: '账号被 Microsoft 封禁' },
  locked: { 状态: '锁定', 备注: '账号被 Microsoft 锁定' },
  expired: { 状态: '过期', 备注: 'Microsoft refresh token 已过期' },
  invalid: { 状态: '无效', 备注: 'Microsoft refresh token 无效' },
}

const LEGACY_TOKEN_MARKERS = ['封禁', '锁定', '过期', '无效']

async function tryHydrateCloudCredentials(emailAddress: string): Promise<Account | undefined> {
  try {
    const response = await unlockCloudSecrets([emailAddress])
    const secrets = response.data || []
    if (secrets.length === 0) {
      return undefined
    }
    await localDB.mergeCloudSecrets(secrets)
    await useAccountStore.getState().loadAccounts()
    return localDB.getAccount(emailAddress)
  } catch (error) {
    console.error('自动拉取完整账号资料失败:', error)
    return undefined
  }
}

function getStatusUpdate(
  provider: Account['provider'],
  errorType: string
): Pick<Account, '状态' | '备注' | 'oauth_status'> | null {
  if (provider === 'google') {
    if (errorType === 'expired') {
      return {
        状态: '过期',
        备注: 'Google OAuth refresh token 已过期或需要重新授权',
        oauth_status: 'expired',
      }
    }
    if (errorType === 'invalid') {
      return {
        状态: '无效',
        备注: 'Google OAuth 已失效，请重新绑定 Gmail',
        oauth_status: 'error',
      }
    }
    return null
  }
  return MICROSOFT_STATUS_MAP[errorType] || null
}

interface EmailState {
  visible: boolean
  currentEmail: string
  currentFolder: 'inbox' | 'junkemail'
  emails: Email[]
  filteredEmails: Email[]
  emailSearch: string
  loading: boolean
  refreshing: boolean
  currentEmailDetail: Email | null

  open: (email: string) => Promise<void>
  close: () => void
  switchFolder: (folder: 'inbox' | 'junkemail') => void
  loadCachedEmails: (
    email?: string,
    folder?: 'inbox' | 'junkemail'
  ) => Promise<void>
  refreshFromServer: () => Promise<void>
  filterEmails: (keyword: string) => void
  showDetail: (email: Email) => Promise<void>
  clearDetail: () => void
}

function applyEmailFilter(emails: Email[], keyword: string): Email[] {
  const normalizedKeyword = keyword.trim().toLowerCase()
  if (!normalizedKeyword) {
    return emails
  }

  return emails.filter(
    (email) =>
      (email.subject || '').toLowerCase().includes(normalizedKeyword) ||
      (email.from_address || '').toLowerCase().includes(normalizedKeyword)
  )
}

export const useEmailStore = create<EmailState>((set, get) => ({
  visible: false,
  currentEmail: '',
  currentFolder: 'inbox',
  emails: [],
  filteredEmails: [],
  emailSearch: '',
  loading: false,
  refreshing: false,
  currentEmailDetail: null,

  open: async (email) => {
    set({
      currentEmail: email,
      currentFolder: 'inbox',
      currentEmailDetail: null,
      emails: [],
      filteredEmails: [],
      emailSearch: '',
      visible: true,
    })

    try {
      await get().loadCachedEmails(email, 'inbox')
      await get().refreshFromServer()
    } catch (error) {
      if (get().emails.length === 0) {
        set({ visible: false })
      }
      throw error
    }
  },

  close: () => {
    set({ visible: false })
    // Refresh account list to show permission detection results
    useAccountStore.getState().loadAccounts()
  },

  switchFolder: (folder) => {
    set({ currentFolder: folder, currentEmailDetail: null })
    void get().loadCachedEmails(get().currentEmail, folder)
    void get().refreshFromServer()
  },

  loadCachedEmails: async (email, folder) => {
    const targetEmail = email || get().currentEmail
    const targetFolder = folder || get().currentFolder
    if (!targetEmail) {
      return
    }

    const cachedEmails = await localDB.getEmails(targetEmail, targetFolder)
    const keyword = get().emailSearch
    set({
      emails: cachedEmails,
      filteredEmails: applyEmailFilter(cachedEmails, keyword),
    })
  },

  refreshFromServer: async () => {
    const hasVisibleEmails = get().emails.length > 0
    set({
      loading: !hasVisibleEmails,
      refreshing: hasVisibleEmails,
    })
    const { currentEmail, currentFolder } = get()

    try {
      let currentAccount = await localDB.getAccount(currentEmail)
      if (!currentAccount) {
        throw new Error('未找到账号信息')
      }

      let provider = currentAccount.provider || 'microsoft'
      let { client_id, 刷新令牌, 令牌类型 } = currentAccount

      if (
        currentAccount.数据来源 &&
        (!刷新令牌 || (provider === 'microsoft' && !client_id))
      ) {
        const hydratedAccount = await tryHydrateCloudCredentials(currentEmail)
        if (hydratedAccount) {
          currentAccount = hydratedAccount
          provider = currentAccount.provider || 'microsoft'
          client_id = currentAccount.client_id
          刷新令牌 = currentAccount.刷新令牌
          令牌类型 = currentAccount.令牌类型
        }
      }

      if (provider === 'google' && !刷新令牌) {
        throw new Error(
          currentAccount.数据来源 === 'cloud'
            ? '云端还没有这条 Gmail 的完整授权资料，请先补齐并等待自动上云，或重新绑定 Gmail'
            : '该 Gmail 账号尚未完成 Gmail 授权，请先点击“绑定 Gmail”'
        )
      }

      if (provider === 'microsoft' && (!client_id || !刷新令牌)) {
        throw new Error(
          currentAccount.数据来源 === 'cloud'
            ? '云端还没有这条 Outlook 的完整账号资料，请先补齐并等待自动上云'
            : '账号缺少 client_id 或 refresh token，无法刷新邮件'
        )
      }

      if (LEGACY_TOKEN_MARKERS.includes(刷新令牌)) {
        throw new Error(
          '这个账号的 refresh token 之前被状态标记覆盖了，当前无法直接刷新。请重新导入该账号，或补回正确的 refresh token。'
        )
      }

      const response = await refreshEmails(
        currentEmail,
        client_id,
        刷新令牌,
        currentFolder,
        令牌类型 || (provider === 'google' ? 'gmail_api' : 'imap'),
        provider
      )

      if (!response.success) {
        const errorType = response.error_type
        const statusUpdate = errorType
          ? getStatusUpdate(provider, errorType)
          : null
        if (statusUpdate) {
          await localDB.updateAccount(currentEmail, statusUpdate)
          useAccountStore.getState().loadAccounts()
          set({ visible: false })
        }
        throw new Error(response.message || '刷新邮件失败')
      }

      const emails: Email[] = (response.data || []).map((e) => ({
        ...e,
        邮箱地址: currentEmail,
        folder: currentFolder,
      }))
      await localDB.replaceEmails(currentEmail, currentFolder, emails)

      await localDB.updateAccount(currentEmail, {
        状态: '正常',
        备注: '',
        oauth_status: provider === 'google' ? 'connected' : currentAccount.oauth_status,
        oauth_updated_at:
          provider === 'google'
            ? new Date().toISOString()
            : currentAccount.oauth_updated_at,
        刷新令牌:
          response.meta?.rotated_refresh_token || currentAccount.刷新令牌,
        权限已检测:
          provider === 'google' ? true : currentAccount.权限已检测,
      })
      useAccountStore.getState().loadAccounts()
      set({
        emails,
        filteredEmails: applyEmailFilter(emails, get().emailSearch),
      })
      return
    } catch (error) {
      console.error('刷新邮件失败:', error)
      throw error
    } finally {
      set({ loading: false, refreshing: false })
    }
  },

  filterEmails: (keyword) => {
    set({ emailSearch: keyword })
    const kw = keyword.toLowerCase()
    const { emails } = get()
    set({
      filteredEmails: applyEmailFilter(emails, kw),
    })
  },

  clearDetail: () => {
    set({ currentEmailDetail: null })
  },

  showDetail: async (email) => {
    set({ currentEmailDetail: email })

    if (email.body || email.body_html || !email.id) {
      return
    }

    const currentAccount = await localDB.getAccount(get().currentEmail)
    if (!currentAccount || currentAccount.provider !== 'google') {
      return
    }

    const detailResponse = await fetchEmailDetail(
      currentAccount.邮箱地址,
      currentAccount.client_id,
      currentAccount.刷新令牌,
      String(email.id),
      'google'
    )

    if (!detailResponse.success || !detailResponse.data) {
      throw new Error(detailResponse.message || '加载邮件详情失败')
    }

    const detailEmail: Email = {
      ...email,
      ...detailResponse.data,
      邮箱地址: currentAccount.邮箱地址,
      folder: get().currentFolder,
    }

    const nextEmails = get().emails.map((item) =>
      item.id === email.id ? detailEmail : item
    )
    const keyword = get().emailSearch.toLowerCase()
    const nextFilteredEmails = keyword
      ? nextEmails.filter(
          (item) =>
            (item.subject || '').toLowerCase().includes(keyword) ||
            (item.from_address || '').toLowerCase().includes(keyword)
        )
      : nextEmails
    set({
      emails: nextEmails,
      filteredEmails: nextFilteredEmails,
      currentEmailDetail: detailEmail,
    })
  },
}))
