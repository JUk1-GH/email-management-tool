import { useEffect, useRef, useState } from 'react'
import { Toaster, toast } from 'sonner'
import { localDB } from '@/lib/db'
import { useAccountStore } from '@/stores/account-store'
import { useAuthStore } from '@/stores/auth-store'
import { API_BASE } from '@/lib/config'
import AppShell from '@/components/layout/AppShell'
import AccountTable from '@/components/accounts/AccountTable'
import AccountToolbar from '@/components/accounts/AccountToolbar'
import ImportDialog from '@/components/dialogs/ImportDialog'
import GroupDialog from '@/components/dialogs/GroupDialog'
import AddGroupDialog from '@/components/dialogs/AddGroupDialog'
import DeleteGroupDialog from '@/components/dialogs/DeleteGroupDialog'
import EmailViewer from '@/components/dialogs/EmailViewer'
import AuthPanel from '@/components/auth/AuthPanel'
import CredentialVaultPanel from '@/components/auth/CredentialVaultPanel'

export default function App() {
  const [activeTab, setActiveTab] = useState('list')
  const [ready, setReady] = useState(false)
  const [autoCloudHydrated, setAutoCloudHydrated] = useState(false)
  const lastCloudSyncSignatureRef = useRef('')
  const lastAutoSyncAtRef = useRef(0)

  // Dialog visibility
  const [importOpen, setImportOpen] = useState(false)
  const [groupOpen, setGroupOpen] = useState(false)
  const [addGroupOpen, setAddGroupOpen] = useState(false)
  const [deleteGroupOpen, setDeleteGroupOpen] = useState(false)

  const init = useAccountStore((s) => s.init)
  const pullCloudAccounts = useAccountStore((s) => s.pullCloudAccounts)
  const pushAccountsToCloud = useAccountStore((s) => s.pushAccountsToCloud)
  const total = useAccountStore((s) => s.total)
  const overallTotal = useAccountStore((s) => s.overallTotal)
  const groups = useAccountStore((s) => s.groups)
  const search = useAccountStore((s) => s.search)
  const selectedGroup = useAccountStore((s) => s.selectedGroup)
  const selectedProvider = useAccountStore((s) => s.selectedProvider)
  const setSearch = useAccountStore((s) => s.setSearch)
  const setSelectedGroup = useAccountStore((s) => s.setSelectedGroup)
  const setSelectedProvider = useAccountStore((s) => s.setSelectedProvider)
  const loadAccounts = useAccountStore((s) => s.loadAccounts)
  const selectedAccounts = useAccountStore((s) => s.selectedAccounts)
  const cloudPulling = useAccountStore((s) => s.cloudPulling)
  const cloudSyncing = useAccountStore((s) => s.cloudSyncing)
  const initAuth = useAuthStore((s) => s.init)
  const authStatus = useAuthStore((s) => s.status)
  const cloudSummary = useAuthStore((s) => s.cloudSummary)

  useEffect(() => {
    ;(async () => {
      try {
        await localDB.init()
        const compactResult = await localDB.normalizeAndDeduplicateAccounts()
        await Promise.all([init(), initAuth()])
        if (compactResult.removed > 0) {
          toast.success(`已自动清理 ${compactResult.removed} 条重复账号`)
        }
        setReady(true)
      } catch (error) {
        console.error('初始化失败:', error)
      }
    })()
  }, [init, initAuth])

  useEffect(() => {
    if (authStatus !== 'authenticated' && autoCloudHydrated) {
      setAutoCloudHydrated(false)
    }
    if (authStatus !== 'authenticated') {
      lastCloudSyncSignatureRef.current = ''
      lastAutoSyncAtRef.current = 0
    }
  }, [authStatus, autoCloudHydrated])

  useEffect(() => {
    if (!ready) return
    if (autoCloudHydrated) return
    if (authStatus !== 'authenticated') return

    setAutoCloudHydrated(true)
    ;(async () => {
      try {
        const result = await pullCloudAccounts()
        lastCloudSyncSignatureRef.current = await buildCloudSyncSignature()
        toast.success(
          `已自动恢复 ${result.pulled} 条云端账号，完整资料 ${result.credentialsPulled} 条`
        )
      } catch (error) {
        console.error('自动拉取云端资料失败:', error)
        setAutoCloudHydrated(false)
      }
    })()
  }, [
    authStatus,
    autoCloudHydrated,
    cloudSummary?.account_count,
    cloudSummary?.credential_count,
    pullCloudAccounts,
    ready,
  ])

  useEffect(() => {
    if (!ready) return
    if (authStatus !== 'authenticated') return

    let cancelled = false

    const attemptAutoPush = async () => {
      if (cancelled) return
      if (cloudPulling || cloudSyncing) return

      try {
        const signature = await buildCloudSyncSignature()
        if (!signature) return
        if (signature === lastCloudSyncSignatureRef.current) return

        const now = Date.now()
        if (now - lastAutoSyncAtRef.current < 4000) return

        lastAutoSyncAtRef.current = now
        await pushAccountsToCloud()
        lastCloudSyncSignatureRef.current = signature
      } catch (error) {
        console.error('自动同步完整资料失败:', error)
      }
    }

    void attemptAutoPush()
    const interval = window.setInterval(() => {
      void attemptAutoPush()
    }, 15000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [authStatus, cloudPulling, cloudSyncing, pushAccountsToCloud, ready])

  const handleOpenGroup = () => {
    if (selectedAccounts.length === 0) {
      toast.warning('请先选择要设置分组的账号')
      return
    }
    setGroupOpen(true)
  }

  const clearFilters = async () => {
    setSearch('')
    setSelectedGroup('全部')
    setSelectedProvider('全部类型')
    await loadAccounts()
  }

  const pageMeta = getPageMeta(activeTab)

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F2F2F7]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-500 text-[14px]">正在初始化...</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <Toaster position="top-center" richColors />
      <AppShell
        activeTab={activeTab}
        onTabChange={setActiveTab}
        headerTitle={pageMeta.title}
        headerSubtitle={pageMeta.subtitle}
        showSearch={activeTab === 'list'}
      >
        {activeTab === 'overview' && (
          <OverviewSection
            overallTotal={overallTotal}
            filteredTotal={total}
            groupCount={groups.length}
            authStatus={authStatus}
            cloudSummary={cloudSummary}
            cloudPulling={cloudPulling}
            cloudSyncing={cloudSyncing}
            onOpenImport={() => setImportOpen(true)}
            onOpenGroup={handleOpenGroup}
          />
        )}

        {activeTab === 'list' && (
          <>
            <AccountToolbar
              onOpenImport={() => setImportOpen(true)}
              onOpenGroup={handleOpenGroup}
              onOpenAddGroup={() => setAddGroupOpen(true)}
              onOpenDeleteGroup={() => setDeleteGroupOpen(true)}
            />
            {overallTotal === 0 ? (
              <EmptyStateCard
                title="当前没有可显示的邮箱账号"
                description="这套系统把账号存放在浏览器本地 IndexedDB。你现在访问的是本地地址，和线上域名不是同一个 origin，所以线上浏览器里的本地数据不会自动带到这里。"
                primaryText="导入测试账号"
                secondaryText="切到总览"
                onPrimary={() => setImportOpen(true)}
                onSecondary={() => setActiveTab('overview')}
              />
            ) : total === 0 ? (
              <EmptyStateCard
                title="当前筛选条件下没有结果"
                description={`搜索词：${search || '无'}；分组：${selectedGroup}；类型：${selectedProvider}`}
                primaryText="清空筛选"
                onPrimary={clearFilters}
              />
            ) : (
              <AccountTable />
            )}
          </>
        )}

        {activeTab === 'folders' && (
          <GroupsSection
            groups={groups}
            onOpenGroup={handleOpenGroup}
            onOpenAddGroup={() => setAddGroupOpen(true)}
            onOpenDeleteGroup={() => setDeleteGroupOpen(true)}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsSection apiBase={API_BASE} />
        )}
      </AppShell>

      {/* Dialogs */}
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <GroupDialog open={groupOpen} onClose={() => setGroupOpen(false)} />
      <AddGroupDialog
        open={addGroupOpen}
        onClose={() => setAddGroupOpen(false)}
      />
      <DeleteGroupDialog
        open={deleteGroupOpen}
        onClose={() => setDeleteGroupOpen(false)}
      />
      <EmailViewer />
    </>
  )
}

async function buildCloudSyncSignature(): Promise<string> {
  const accounts = await localDB.getAllAccounts()
  return JSON.stringify(
    accounts.map((account) => ({
      email_address: account.邮箱地址 || '',
      provider: account.provider || 'microsoft',
      group_name: account.分组 || '默认分组',
      status: account.状态 || '正常',
      note: account.备注 || '',
      oauth_status: account.oauth_status || 'not_connected',
      oauth_email: account.oauth_email || '',
      oauth_updated_at: account.oauth_updated_at || '',
      import_sequence: Number(account.导入序号 || 0),
    }))
  )
}

function getPageMeta(activeTab: string): { title: string; subtitle: string } {
  switch (activeTab) {
    case 'overview':
      return {
        title: '总览',
        subtitle: '查看账号规模、分组情况和当前本地运行状态',
      }
    case 'folders':
      return {
        title: '分组管理',
        subtitle: '管理账号分组，并批量调整分组归属',
      }
    case 'settings':
      return {
        title: '设置',
        subtitle: '检查当前运行环境、接口地址和本地存储说明',
      }
    default:
      return {
        title: '邮箱列表',
        subtitle: '管理账号、筛选分组并查看邮件内容',
      }
  }
}

function OverviewSection({
  overallTotal,
  filteredTotal,
  groupCount,
  authStatus,
  cloudSummary,
  cloudPulling,
  cloudSyncing,
  onOpenImport,
  onOpenGroup,
}: {
  overallTotal: number
  filteredTotal: number
  groupCount: number
  authStatus: 'loading' | 'anonymous' | 'authenticated'
  cloudSummary: { account_count: number; credential_count?: number } | null
  cloudPulling: boolean
  cloudSyncing: boolean
  onOpenImport: () => void
  onOpenGroup: () => void
}) {
  const cards = [
    { label: '受管邮箱总数', value: overallTotal, tone: 'text-slate-800' },
    { label: '当前筛选结果', value: filteredTotal, tone: 'text-blue-600' },
    { label: '分组数量', value: groupCount, tone: 'text-emerald-600' },
    {
      label: '云同步状态',
      value:
        authStatus !== 'authenticated'
          ? '未登录'
          : cloudPulling
          ? '拉取中'
          : cloudSyncing
          ? '同步中'
          : `已上云 ${cloudSummary?.account_count || 0}`,
      tone:
        authStatus !== 'authenticated'
          ? 'text-slate-500'
          : cloudPulling || cloudSyncing
          ? 'text-blue-600'
          : 'text-emerald-600',
    },
  ]

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-[20px] border border-white/80 bg-white/60 backdrop-blur-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)]"
          >
            <p className="text-[13px] text-slate-500">{card.label}</p>
            <p className={`mt-3 text-3xl font-bold tracking-tight ${card.tone}`}>
              {card.value}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-[20px] border border-white/80 bg-white/60 backdrop-blur-2xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <h3 className="text-[16px] font-semibold text-slate-800">快速操作</h3>
        <p className="mt-1 text-[13px] text-slate-500">
          导入、编辑、删除账号后，登录状态下会自动同步完整资料；在新设备登录后也会自动拉取，不再需要手动点同步按钮。
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            onClick={onOpenImport}
            className="px-4 py-2 text-[13px] font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm"
          >
            导入账号
          </button>
          <button
            onClick={onOpenGroup}
            className="px-4 py-2 text-[13px] font-medium text-slate-700 bg-white border border-slate-200 hover:border-blue-200 rounded-lg transition-colors"
          >
            批量设置分组
          </button>
        </div>
      </div>
    </>
  )
}

function GroupsSection({
  groups,
  onOpenGroup,
  onOpenAddGroup,
  onOpenDeleteGroup,
}: {
  groups: Array<{ name: string; color: string; count: number }>
  onOpenGroup: () => void
  onOpenAddGroup: () => void
  onOpenDeleteGroup: () => void
}) {
  return (
    <>
      <div className="flex flex-wrap gap-3">
        <button
          onClick={onOpenGroup}
          className="px-4 py-2 text-[13px] font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm"
        >
          批量设置分组
        </button>
        <button
          onClick={onOpenAddGroup}
          className="px-4 py-2 text-[13px] font-medium text-slate-700 bg-white border border-slate-200 hover:border-blue-200 rounded-lg transition-colors"
        >
          新增分组
        </button>
        <button
          onClick={onOpenDeleteGroup}
          className="px-4 py-2 text-[13px] font-medium text-red-600 bg-red-50 border border-red-100 hover:bg-red-100 rounded-lg transition-colors"
        >
          删除分组
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((group) => (
          <div
            key={group.name}
            className="rounded-[20px] border border-white/80 bg-white/60 backdrop-blur-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)]"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span
                  className="inline-block h-3 w-3 rounded-full"
                  style={{ backgroundColor: group.color }}
                />
                <h3 className="text-[15px] font-semibold text-slate-800">
                  {group.name}
                </h3>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[12px] text-slate-500">
                {group.count} 个账号
              </span>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function SettingsSection({ apiBase }: { apiBase: string }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1.35fr,1fr]">
      <div className="space-y-4">
        <AuthPanel />
        <CredentialVaultPanel />
        <div className="rounded-[20px] border border-white/80 bg-white/60 backdrop-blur-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <h3 className="text-[16px] font-semibold text-slate-800">运行环境</h3>
          <div className="mt-4 space-y-3 text-[13px] text-slate-600">
            <div>
              <span className="text-slate-400">当前 Origin：</span>{' '}
              <span className="font-mono break-all">{window.location.origin}</span>
            </div>
            <div>
              <span className="text-slate-400">API_BASE：</span>{' '}
              <span className="font-mono break-all">{apiBase}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-[20px] border border-white/80 bg-white/60 backdrop-blur-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <h3 className="text-[16px] font-semibold text-slate-800">本地模式说明</h3>
          <p className="mt-4 text-[13px] leading-6 text-slate-600">
            账号和邮件缓存仍然主要保存在浏览器本地 IndexedDB。不同域名、端口或协议对应不同 origin，
            本地调试地址和线上域名之间不会自动共享敏感资料。
          </p>
        </div>

        <div className="rounded-[20px] border border-white/80 bg-white/60 backdrop-blur-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <h3 className="text-[16px] font-semibold text-slate-800">云端数据边界</h3>
          <div className="mt-4 space-y-3 text-[13px] leading-6 text-slate-600">
            <p>
              当前个人模式会自动同步完整账号资料，包括邮箱地址、provider、分组、状态、备注、OAuth 展示状态，以及密码、辅助邮箱、2FA、client_id、refresh token、过期时间等。
            </p>
            <p>
              完整账号资料会分层保存到后端，其中关键字段仍然使用单独加密存储，但界面上不再要求你手动区分。
            </p>
            <p>
              登录新设备后系统会自动拉取完整资料到当前浏览器；这里保留手动补拉和导出入口，方便排障和备份。
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function EmptyStateCard({
  title,
  description,
  primaryText,
  secondaryText,
  onPrimary,
  onSecondary,
}: {
  title: string
  description: string
  primaryText: string
  secondaryText?: string
  onPrimary: () => void | Promise<void>
  onSecondary?: () => void
}) {
  return (
    <div className="rounded-[20px] border border-white/80 bg-white/60 backdrop-blur-2xl p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
      <h3 className="text-[18px] font-semibold text-slate-800">{title}</h3>
      <p className="mt-3 max-w-[720px] text-[14px] leading-7 text-slate-500">
        {description}
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          onClick={() => void onPrimary()}
          className="px-4 py-2 text-[13px] font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm"
        >
          {primaryText}
        </button>
        {secondaryText && onSecondary && (
          <button
            onClick={onSecondary}
            className="px-4 py-2 text-[13px] font-medium text-slate-700 bg-white border border-slate-200 hover:border-blue-200 rounded-lg transition-colors"
          >
            {secondaryText}
          </button>
        )}
      </div>
    </div>
  )
}
