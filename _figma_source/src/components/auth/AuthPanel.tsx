import { useEffect, useState } from 'react'
import { Cloud, HardDrive, LockKeyhole, LogOut, Shield } from 'lucide-react'
import { toast } from 'sonner'
import { useAccountStore } from '@/stores/account-store'
import { useAuthStore } from '@/stores/auth-store'
import { fetchAuthSecurityConfig } from '@/lib/api'
import TurnstileWidget from './TurnstileWidget'

export default function AuthPanel() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [securityLoaded, setSecurityLoaded] = useState(false)
  const [securityError, setSecurityError] = useState('')
  const [turnstileEnabled, setTurnstileEnabled] = useState(false)
  const [turnstileSiteKey, setTurnstileSiteKey] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileResetKey, setTurnstileResetKey] = useState(0)

  const authStatus = useAuthStore((s) => s.status)
  const authenticating = useAuthStore((s) => s.authenticating)
  const user = useAuthStore((s) => s.user)
  const profile = useAuthStore((s) => s.profile)
  const cloudSummary = useAuthStore((s) => s.cloudSummary)
  const login = useAuthStore((s) => s.login)
  const register = useAuthStore((s) => s.register)
  const logout = useAuthStore((s) => s.logout)

  const overallTotal = useAccountStore((s) => s.overallTotal)
  const cloudPulling = useAccountStore((s) => s.cloudPulling)
  const cloudSyncing = useAccountStore((s) => s.cloudSyncing)

  const clearForm = () => {
    setEmail('')
    setPassword('')
    setDisplayName('')
    setTurnstileToken('')
    setTurnstileResetKey((value) => value + 1)
  }

  useEffect(() => {
    let cancelled = false

    fetchAuthSecurityConfig()
      .then((config) => {
        if (cancelled) return
        setTurnstileEnabled(Boolean(config.turnstile_enabled))
        setTurnstileSiteKey(config.turnstile_site_key || '')
        setSecurityLoaded(true)
        setSecurityError('')
      })
      .catch((error: Error) => {
        if (cancelled) return
        setSecurityLoaded(true)
        setSecurityError(error.message || '安全配置加载失败')
      })

    return () => {
      cancelled = true
    }
  }, [])

  const switchMode = (nextMode: 'login' | 'register') => {
    setMode(nextMode)
    setTurnstileToken('')
    setTurnstileResetKey((value) => value + 1)
  }

  const handleSubmit = async () => {
    try {
      if (!securityLoaded) {
        toast.error('安全配置还在加载，请稍后再试')
        return
      }
      if (securityError) {
        toast.error(securityError)
        return
      }
      if (turnstileEnabled && !turnstileToken) {
        toast.error('请先完成人机验证')
        return
      }

      if (mode === 'login') {
        await login(email, password, turnstileToken)
        toast.success('登录成功，当前已启用云端同步模式')
      } else {
        await register(email, password, displayName, turnstileToken)
        toast.success('注册成功，当前已启用云端同步模式')
      }

      clearForm()
    } catch (error) {
      toast.error((error as Error).message)
      if (turnstileEnabled) {
        setTurnstileToken('')
        setTurnstileResetKey((value) => value + 1)
      }
    }
  }

  const handleLogout = async () => {
    try {
      await logout()
      toast.success('已退出登录，当前回到本地模式')
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  const isAuthenticated = authStatus === 'authenticated' && Boolean(user)

  if (isAuthenticated && user && profile && cloudSummary) {
    return (
      <div className="rounded-[20px] border border-white/80 bg-white/60 backdrop-blur-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-[12px] font-medium text-emerald-700">
              <Cloud size={14} />
              <span>云端同步已启用</span>
            </div>
            <h3 className="mt-3 text-[18px] font-semibold text-slate-800">
              {user.display_name || user.email}
            </h3>
            <p className="mt-1 text-[13px] text-slate-500">{user.email}</p>
          </div>
          <button
            onClick={() => void handleLogout()}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-4 py-2 text-[13px] font-medium text-slate-600 transition-colors hover:bg-white"
          >
            <LogOut size={14} />
            <span>退出登录</span>
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <SummaryCard label="本地账号数" value={String(overallTotal)} icon={<HardDrive size={16} />} />
          <SummaryCard
            label="云端账号数"
            value={String(cloudSummary.account_count)}
            icon={<Cloud size={16} />}
          />
          <SummaryCard
            label="云端完整账号"
            value={String(cloudSummary.credential_count || 0)}
            icon={<Shield size={16} />}
          />
        </div>

        <div className="mt-5 space-y-2 rounded-[16px] border border-slate-100 bg-slate-50/80 p-4 text-[13px] text-slate-600">
          <p>
            当前状态：
            {cloudPulling
              ? ' 正在自动拉取云端资料'
              : cloudSyncing
              ? ' 正在自动同步本地变更'
              : ' 自动云同步已开启'}
          </p>
          <p>最近上行同步：{profile.last_cloud_push_at || '尚未同步'}</p>
          <p>最近下行拉取：{profile.last_cloud_pull_at || '尚未拉取'}</p>
          <p className="text-slate-500">
            登录后会自动同步完整账号资料到云端，并在新设备自动拉取到当前浏览器。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-[20px] border border-white/80 bg-white/60 backdrop-blur-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
      <div className="flex items-center gap-2">
        <LockKeyhole size={18} className="text-blue-600" />
        <h3 className="text-[16px] font-semibold text-slate-800">登录系统</h3>
      </div>

      <p className="mt-3 text-[13px] leading-6 text-slate-600">
        登录后会把完整账号资料自动同步到云端，在手机或其他设备登录后自动恢复并查看。
      </p>

      <div className="mt-4 inline-flex rounded-full border border-white/80 bg-white/80 p-1 text-[12px] font-medium">
        <button
          onClick={() => switchMode('login')}
          className={`rounded-full px-3 py-1.5 transition-colors ${
            mode === 'login' ? 'bg-slate-900 text-white' : 'text-slate-500'
          }`}
        >
          登录
        </button>
        <button
          onClick={() => switchMode('register')}
          className={`rounded-full px-3 py-1.5 transition-colors ${
            mode === 'register' ? 'bg-slate-900 text-white' : 'text-slate-500'
          }`}
        >
          注册
        </button>
      </div>

      <div className="mt-4 grid gap-3">
        {mode === 'register' && (
          <label className="grid gap-1.5 text-[13px] text-slate-600">
            <span>显示名称（可选）</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="例如 Juki"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[14px] text-slate-700 outline-none transition-colors focus:border-blue-300"
            />
          </label>
        )}
        <label className="grid gap-1.5 text-[13px] text-slate-600">
          <span>邮箱</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[14px] text-slate-700 outline-none transition-colors focus:border-blue-300"
          />
        </label>
        <label className="grid gap-1.5 text-[13px] text-slate-600">
          <span>密码</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="至少 8 位"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[14px] text-slate-700 outline-none transition-colors focus:border-blue-300"
          />
        </label>
        {turnstileEnabled && turnstileSiteKey ? (
          <div className="grid gap-1.5 text-[13px] text-slate-600">
            <span>人机验证</span>
            <TurnstileWidget
              siteKey={turnstileSiteKey}
              resetKey={turnstileResetKey}
              onToken={setTurnstileToken}
              onError={(message) => toast.error(message)}
            />
          </div>
        ) : null}
        {securityError ? (
          <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[12px] text-red-600">
            {securityError}
          </div>
        ) : null}
      </div>

      <button
        onClick={() => void handleSubmit()}
        disabled={authenticating || !securityLoaded || Boolean(securityError)}
        className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
      >
        <LockKeyhole size={14} />
        <span>
          {authenticating
            ? mode === 'login'
              ? '登录中...'
              : '注册中...'
            : mode === 'login'
            ? '登录并启用云同步'
            : '注册并启用云同步'}
        </span>
      </button>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon: React.ReactNode
}) {
  return (
    <div className="rounded-[16px] border border-white/80 bg-white/80 p-4 shadow-sm">
      <div className="flex items-center justify-between text-slate-400">
        <span className="text-[12px] uppercase tracking-wide">{label}</span>
        {icon}
      </div>
      <p className="mt-3 text-[20px] font-semibold text-slate-800">{value}</p>
    </div>
  )
}
