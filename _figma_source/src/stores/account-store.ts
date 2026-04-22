import { create } from 'zustand'
import type { Account, GroupInfo, Provider } from '@/types'
import {
  fetchCloudAccounts,
  syncCloudSecrets,
  syncCloudAccounts as syncCloudAccountsRequest,
  unlockCloudSecrets,
} from '@/lib/api'
import { localDB } from '@/lib/db'
import {
  loadGroupColors,
  saveGroupColors,
  getCustomGroups,
  saveCustomGroup,
  removeCustomGroup,
} from '@/lib/storage'
import { getDefaultGroupColor, PRESET_COLORS } from '@/lib/format'
import { useAuthStore } from './auth-store'

function buildCloudSyncPayload(account: Account) {
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
  }
}

function hasSensitiveValue(account: Account) {
  return Boolean(
    account.密码 ||
      account.辅助邮箱 ||
      account.两步验证 ||
      account.client_id ||
      account.刷新令牌 ||
      account.令牌过期时间
  )
}

function buildCloudSecretPayload(account: Account) {
  return {
    ...buildCloudSyncPayload(account),
    password: account.密码 || '',
    recovery_email: account.辅助邮箱 || '',
    twofa_secret: account.两步验证 || '',
    client_id: account.client_id || '',
    refresh_token: account.刷新令牌 || '',
    token_expires_at: account.令牌过期时间 || '',
  }
}

interface AccountState {
  // Data
  accounts: Account[]
  total: number
  overallTotal: number
  groups: GroupInfo[]
  groupColors: Record<string, string>
  selectedAccounts: Account[]
  selectAllMode: boolean

  // Pagination
  currentPage: number
  pageSize: number

  // Filters
  search: string
  selectedGroup: string
  selectedProvider: '全部类型' | Provider

  // UI state
  loading: boolean
  importing: boolean
  permissionDetecting: boolean
  permissionDetectProgress: number
  permissionDetectTotal: number
  cloudPulling: boolean
  cloudSyncing: boolean
  cloudLastError: string

  // Actions
  init: () => Promise<void>
  loadAccounts: () => Promise<void>
  loadGroups: () => Promise<void>

  setSearch: (search: string) => void
  setSelectedGroup: (group: string) => void
  setSelectedProvider: (provider: '全部类型' | Provider) => void
  setCurrentPage: (page: number) => void
  setPageSize: (size: number) => void
  setSelectedAccounts: (accounts: Account[]) => void
  setSelectAllMode: (mode: boolean) => void

  getGroupColor: (groupName: string) => string

  // Get all filtered accounts (for select-all mode operations)
  getFilteredAccounts: () => Promise<Account[]>
  pullCloudAccounts: () => Promise<{
    pulled: number
    created: number
    updated: number
    credentialsPulled: number
    credentialsCreated: number
    credentialsUpdated: number
  }>
  pushAccountsToCloud: () => Promise<{ synced: number; total: number }>
}

export const useAccountStore = create<AccountState>((set, get) => ({
  accounts: [],
  total: 0,
  overallTotal: 0,
  groups: [],
  groupColors: {},
  selectedAccounts: [],
  selectAllMode: false,

  currentPage: 1,
  pageSize: 10,

  search: '',
  selectedGroup: '全部',
  selectedProvider: '全部类型',

  loading: false,
  importing: false,
  permissionDetecting: false,
  permissionDetectProgress: 0,
  permissionDetectTotal: 0,
  cloudPulling: false,
  cloudSyncing: false,
  cloudLastError: '',

  init: async () => {
    const groupColors = loadGroupColors()
    set({ groupColors })
    await get().loadGroups()
    await get().loadAccounts()
  },

  loadAccounts: async () => {
    set({ loading: true })
    try {
      let allAccounts = await localDB.getAllAccounts()
      const overallTotal = allAccounts.length
      const {
        selectedGroup,
        selectedProvider,
        search,
        currentPage,
        pageSize,
      } = get()

      // Filter by group
      if (selectedGroup && selectedGroup !== '全部') {
        allAccounts = allAccounts.filter(
          (acc) => (acc.分组 || '默认分组') === selectedGroup
        )
      }

      if (selectedProvider !== '全部类型') {
        allAccounts = allAccounts.filter(
          (acc) => (acc.provider || 'microsoft') === selectedProvider
        )
      }

      // Search filter
      if (search) {
        const keyword = search.toLowerCase()
        allAccounts = allAccounts.filter(
          (acc) => acc.邮箱地址 && acc.邮箱地址.toLowerCase().includes(keyword)
        )
      }

      const total = allAccounts.length
      const totalPages = Math.max(1, Math.ceil(total / pageSize))
      const safePage = Math.min(currentPage, totalPages)
      if (safePage !== currentPage) {
        set({ currentPage: safePage })
      }

      const start = (safePage - 1) * pageSize
      const accounts = allAccounts.slice(start, start + pageSize)

      set({ accounts, total, overallTotal })
    } catch (error) {
      console.error('加载账号失败:', error)
    } finally {
      set({ loading: false })
    }
  },

  loadGroups: async () => {
    try {
      const groupNames = await localDB.getAllGroups()
      const groupCounts = await localDB.getGroupCounts()
      const { groupColors } = get()

      const dbGroups: GroupInfo[] = groupNames.map((name) => ({
        name,
        color: groupColors[name] || getDefaultGroupColor(name),
        count: groupCounts[name] || 0,
      }))

      // Merge custom groups from localStorage
      const customGroups = getCustomGroups()
      const allGroupNames = new Set(dbGroups.map((g) => g.name))

      customGroups.forEach((cg) => {
        if (!allGroupNames.has(cg.name)) {
          dbGroups.push({ name: cg.name, color: cg.color, count: 0 })
        }
      })

      set({ groups: dbGroups })
    } catch (error) {
      console.error('加载分组失败:', error)
    }
  },

  setSearch: (search) => set({ search, currentPage: 1 }),
  setSelectedGroup: (selectedGroup) =>
    set({ selectedGroup, currentPage: 1 }),
  setSelectedProvider: (selectedProvider) =>
    set({ selectedProvider, currentPage: 1 }),
  setCurrentPage: (currentPage) => set({ currentPage }),
  setPageSize: (pageSize) => set({ pageSize, currentPage: 1 }),
  setSelectedAccounts: (selectedAccounts) => set({ selectedAccounts }),
  setSelectAllMode: (selectAllMode) => set({ selectAllMode }),

  getGroupColor: (groupName: string) => {
    if (!groupName) groupName = '默认分组'
    const { groups } = get()
    const group = groups.find((g) => g.name === groupName)
    return group ? group.color : getDefaultGroupColor(groupName)
  },

  getFilteredAccounts: async () => {
    let allAccounts = await localDB.getAllAccounts()
    const { selectedGroup, selectedProvider, search } = get()

    if (search) {
      const searchLower = search.toLowerCase()
      allAccounts = allAccounts.filter(
        (acc) =>
          acc.邮箱地址?.toLowerCase().includes(searchLower) ||
          acc.密码?.toLowerCase().includes(searchLower)
      )
    }

    if (selectedGroup !== '全部') {
      allAccounts = allAccounts.filter(
        (acc) => acc.分组 === selectedGroup
      )
    }

    if (selectedProvider !== '全部类型') {
      allAccounts = allAccounts.filter(
        (acc) => (acc.provider || 'microsoft') === selectedProvider
      )
    }

    return allAccounts
  },

  pullCloudAccounts: async () => {
    set({ cloudPulling: true, cloudLastError: '' })
    try {
      const response = await fetchCloudAccounts()
      const records = response.data || []
      const result = await localDB.mergeCloudAccounts(records)
      let credentialsPulled = 0
      let credentialsCreated = 0
      let credentialsUpdated = 0

      try {
        const secretsResponse = await unlockCloudSecrets()
        const secrets = secretsResponse.data || []
        if (secrets.length > 0) {
          const mergeResult = await localDB.mergeCloudSecrets(secrets)
          credentialsPulled = secrets.length
          credentialsCreated = mergeResult.created
          credentialsUpdated = mergeResult.updated
        }
      } catch (error) {
        console.error('拉取完整账号资料失败:', error)
      }

      await get().loadGroups()
      await get().loadAccounts()
      await useAuthStore.getState().refreshMe()
      return {
        pulled: records.length,
        created: result.created,
        updated: result.updated,
        credentialsPulled,
        credentialsCreated,
        credentialsUpdated,
      }
    } catch (error) {
      const message = (error as Error).message
      set({ cloudLastError: message })
      throw error
    } finally {
      set({ cloudPulling: false })
    }
  },

  pushAccountsToCloud: async () => {
    set({ cloudSyncing: true, cloudLastError: '' })
    try {
      const accounts = await localDB.getAllAccounts()
      const payload = accounts.map(buildCloudSyncPayload)
      const response = await syncCloudAccountsRequest(payload, true)
      const secretPayload = accounts
        .filter(hasSensitiveValue)
        .map(buildCloudSecretPayload)
      if (secretPayload.length > 0) {
        await syncCloudSecrets(secretPayload)
      }
      await useAuthStore.getState().refreshMe()
      return {
        synced: response.data?.upserted || payload.length,
        total: response.data?.total || payload.length,
      }
    } catch (error) {
      const message = (error as Error).message
      set({ cloudLastError: message })
      throw error
    } finally {
      set({ cloudSyncing: false })
    }
  },
}))

// Helper to save a new custom group
export async function addGroup(
  name: string,
  color: string
): Promise<boolean> {
  const store = useAccountStore.getState()
  if (store.groups.find((g) => g.name === name)) return false

  saveCustomGroup(name, color)
  const newColors = { ...store.groupColors, [name]: color }
  saveGroupColors(newColors)
  useAccountStore.setState({ groupColors: newColors })
  await store.loadGroups()
  return true
}

export async function deleteGroups(groupNames: string[]): Promise<number> {
  let successCount = 0
  const store = useAccountStore.getState()
  const newColors = { ...store.groupColors }

  for (const name of groupNames) {
    try {
      await localDB.deleteGroup(name)
      removeCustomGroup(name)
      delete newColors[name]
      successCount++
    } catch (error) {
      console.error(`删除分组 ${name} 失败:`, error)
    }
  }

  saveGroupColors(newColors)
  useAccountStore.setState({ groupColors: newColors })
  await store.loadGroups()
  await store.loadAccounts()
  return successCount
}
