import { Search, Cloud, HardDrive, LogOut, User } from 'lucide-react'
import { useAccountStore } from '@/stores/account-store'
import { useAuthStore } from '@/stores/auth-store'
import { useRef, useCallback } from 'react'
import { toast } from 'sonner'

interface HeaderProps {
  title: string
  subtitle?: string
  showSearch?: boolean
}

export default function Header({
  title,
  subtitle,
  showSearch = true,
}: HeaderProps) {
  const search = useAccountStore((s) => s.search)
  const setSearch = useAccountStore((s) => s.setSearch)
  const loadAccounts = useAccountStore((s) => s.loadAccounts)
  const authStatus = useAuthStore((s) => s.status)
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSearch = useCallback(
    (value: string) => {
      setSearch(value)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        loadAccounts()
      }, 500)
    },
    [setSearch, loadAccounts]
  )

  const handleLogout = useCallback(async () => {
    try {
      await logout()
      toast.success('已退出登录，当前回到本地模式')
    } catch (error) {
      toast.error((error as Error).message)
    }
  }, [logout])

  const isAuthenticated = authStatus === 'authenticated' && Boolean(user)

  return (
    <header className="h-[72px] bg-white/40 backdrop-blur-xl border-b border-white/60 flex items-center justify-between px-4 md:px-8 flex-shrink-0 z-30 sticky top-0">
      <div>
        <h1 className="text-[22px] font-semibold text-slate-800 tracking-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="text-[13px] text-slate-500 mt-0.5">{subtitle}</p>
        )}
      </div>

      <div className="flex items-center space-x-3">
        {showSearch && (
          <>
            <div className="relative group hidden md:block">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors"
                size={16}
              />
              <input
                type="text"
                placeholder="搜索邮箱..."
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                className="w-56 pl-9 pr-4 py-1.5 bg-white/60 backdrop-blur-md border border-white/80 rounded-full text-[14px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:bg-white transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]"
              />
            </div>
            <div className="w-px h-6 bg-slate-200/80 mx-1 hidden md:block" />
          </>
        )}
        <div className="hidden sm:flex items-center gap-2">
          <div
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium ${
              isAuthenticated
                ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 bg-slate-100 text-slate-600'
            }`}
          >
            {isAuthenticated ? <Cloud size={14} /> : <HardDrive size={14} />}
            <span>{isAuthenticated ? '云端模式' : '本地模式'}</span>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/80 bg-white/60 px-3 py-1.5 text-[12px] text-slate-600 shadow-sm">
            <User size={14} className="text-slate-400" />
            <span className="max-w-[180px] truncate">
              {user?.email || '未登录'}
            </span>
          </div>
          {isAuthenticated && (
            <button
              onClick={() => void handleLogout()}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/70 px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:bg-white"
            >
              <LogOut size={14} />
              <span>退出</span>
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
