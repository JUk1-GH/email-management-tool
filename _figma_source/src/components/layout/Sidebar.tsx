import { motion } from 'motion/react'
import { Mail, List, FolderTree, Settings, LayoutGrid } from 'lucide-react'
import { useAccountStore } from '@/stores/account-store'

interface SidebarProps {
  activeTab: string
  onTabChange: (tab: string) => void
}

const tabs = [
  { id: 'overview', icon: LayoutGrid, label: '总览' },
  { id: 'list', icon: List, label: '邮箱列表' },
  { id: 'folders', icon: FolderTree, label: '分组管理' },
  { id: 'settings', icon: Settings, label: '设置' },
]

function SidebarItem({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ComponentType<any>
  label: string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center px-3 py-2 rounded-[12px] text-[14px] font-medium transition-all relative ${
        active
          ? 'text-blue-600 bg-blue-500/10'
          : 'text-slate-600 hover:text-slate-800 hover:bg-slate-100/50'
      }`}
    >
      {active && (
        <motion.div
          layoutId="sidebar-active-indicator"
          className="absolute left-0 w-1 h-4 bg-blue-500 rounded-r-full"
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        />
      )}
      <span className={`${active ? 'text-blue-500' : 'text-slate-400'} mr-3`}>
        <Icon size={18} />
      </span>
      {label}
    </button>
  )
}

export default function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const overallTotal = useAccountStore((s) => s.overallTotal)

  return (
    <aside className="hidden md:flex w-[260px] flex-col z-20 flex-shrink-0 bg-white/40 backdrop-blur-2xl border-r border-white/60 shadow-[4px_0_24px_-12px_rgba(0,0,0,0.05)]">
      <div className="h-[72px] flex items-center px-6">
        <div className="w-8 h-8 rounded-[10px] bg-gradient-to-tr from-blue-500 to-indigo-500 flex items-center justify-center mr-3 shadow-md shadow-blue-500/20">
          <Mail className="text-white" size={16} strokeWidth={2.5} />
        </div>
        <span className="text-slate-800 text-[17px] font-semibold tracking-tight">
          邮箱管家
        </span>
      </div>

      <nav className="flex-1 px-4 py-4 space-y-1">
        {tabs.map((tab) => (
          <SidebarItem
            key={tab.id}
            icon={tab.icon}
            label={tab.label}
            active={activeTab === tab.id}
            onClick={() => onTabChange(tab.id)}
          />
        ))}
      </nav>

      <div className="p-5">
        <div className="bg-white/50 backdrop-blur-md rounded-[16px] p-5 border border-white/80 shadow-sm flex flex-col relative overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <div className="p-1.5 rounded-lg bg-blue-500/10">
              <Mail className="text-blue-600" size={16} />
            </div>
            <span className="text-blue-600 text-xs font-semibold bg-blue-50 px-2 py-0.5 rounded-full">
              Pro
            </span>
          </div>
          <p className="text-slate-500 text-[13px] font-medium mb-0.5 mt-2">
            受管邮箱总数
          </p>
          <p className="text-slate-800 text-2xl font-bold tracking-tight">
            {overallTotal}
            <span className="text-slate-400 text-sm font-normal ml-1">
              / ∞
            </span>
          </p>
          <div className="w-full h-1.5 bg-slate-200/50 rounded-full mt-3 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all"
              style={{ width: `${Math.min((overallTotal / 100) * 100, 100)}%` }}
            />
          </div>
        </div>
      </div>
    </aside>
  )
}
