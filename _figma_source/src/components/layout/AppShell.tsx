import { FolderTree, LayoutGrid, List, Settings } from 'lucide-react'
import BackgroundBlobs from './BackgroundBlobs'
import Sidebar from './Sidebar'
import Header from './Header'

interface AppShellProps {
  activeTab: string
  onTabChange: (tab: string) => void
  headerTitle: string
  headerSubtitle?: string
  showSearch?: boolean
  children: React.ReactNode
}

export default function AppShell({
  activeTab,
  onTabChange,
  headerTitle,
  headerSubtitle,
  showSearch = true,
  children,
}: AppShellProps) {
  return (
    <div className="min-h-screen flex font-sans selection:bg-indigo-200/50 bg-[#F2F2F7] overflow-hidden relative">
      <BackgroundBlobs />
      <Sidebar activeTab={activeTab} onTabChange={onTabChange} />

      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden z-10">
        <Header
          title={headerTitle}
          subtitle={headerSubtitle}
          showSearch={showSearch}
        />
        <div className="md:hidden border-b border-white/60 bg-white/35 backdrop-blur-xl px-3 py-2">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {MOBILE_TABS.map((tab) => {
              const Icon = tab.icon
              const active = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => onTabChange(tab.id)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-[12px] font-medium transition-colors ${
                    active
                      ? 'border-blue-100 bg-blue-50 text-blue-600'
                      : 'border-white/80 bg-white/70 text-slate-600'
                  }`}
                >
                  <Icon size={14} />
                  <span>{tab.label}</span>
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex-1 overflow-auto p-3 md:p-6 xl:p-8 custom-scrollbar">
          <div className="mx-auto max-w-[1360px] space-y-5">{children}</div>
        </div>
      </main>
    </div>
  )
}

const MOBILE_TABS = [
  { id: 'overview', icon: LayoutGrid, label: '总览' },
  { id: 'list', icon: List, label: '邮箱' },
  { id: 'folders', icon: FolderTree, label: '分组' },
  { id: 'settings', icon: Settings, label: '设置' },
]
