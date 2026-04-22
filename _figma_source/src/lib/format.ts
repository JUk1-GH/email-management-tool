import type { Account, Provider } from '@/types'

function isGmailAddress(value: string): boolean {
  const normalized = String(value || '').trim().toLowerCase()
  return (
    normalized.endsWith('@gmail.com') ||
    normalized.endsWith('@googlemail.com')
  )
}

function splitAccountParts(line: string): string[] {
  const trimmed = line.trim()
  if (trimmed.includes('\t')) {
    return trimmed.split('\t').map((s) => s.trim())
  }

  const pipeSeparated = trimmed.split(/\s*\|\s*/).map((s) => s.trim())
  if (pipeSeparated.length > 1) {
    return pipeSeparated
  }

  const dashSeparated = trimmed.split(/\s*(?:----|——|———|————)\s*/).map((s) => s.trim())
  if (dashSeparated.length > 1) {
    return dashSeparated
  }

  return [trimmed]
}

export function formatTime(timeStr: string | undefined | null): string {
  if (!timeStr) return '未知'
  try {
    const date = new Date(timeStr)
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return timeStr.substring(0, 16)
  }
}

export const PRESET_COLORS = [
  '#409eff', '#67c23a', '#e6a23c', '#f56c6c', '#909399',
  '#ff69b4', '#ba55d3', '#20b2aa', '#ff8c00', '#dc143c',
  '#32cd32', '#1e90ff', '#ff1493', '#00ced1', '#ffa500',
] as const

export function getDefaultGroupColor(groupName: string): string {
  let hash = 0
  for (let i = 0; i < groupName.length; i++) {
    hash = groupName.charCodeAt(i) + ((hash << 5) - hash)
  }
  return PRESET_COLORS[Math.abs(hash) % PRESET_COLORS.length]
}

/**
 * Parse text lines into account data.
 * Supports Tab, |, or ---- as delimiter.
 * Legacy format:
 *   邮箱地址\t密码\tclient_id\t刷新令牌\t令牌过期时间\t分组
 * Provider-aware format:
 *   provider\t邮箱地址\t密码\t辅助邮箱\t2FA\tclient_id\t刷新令牌\t令牌过期时间\t分组
 * Gmail compact inventory format:
 *   邮箱地址|密码|辅助邮箱|2FA
 */
export function parseTextToAccounts(
  text: string
): Partial<Account>[] {
  const lines = text.trim().split('\n')
  const accounts: Partial<Account>[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const parts = splitAccountParts(trimmed)

    const email = parts[0] || ''
    const providerToken = parts[0]?.toLowerCase()
    const isProviderAware =
      providerToken === 'microsoft' || providerToken === 'google'

    if (isProviderAware) {
      const provider = providerToken as Provider
      const accountEmail = parts[1] || ''
      if (!accountEmail || !accountEmail.includes('@')) continue

      const compactGoogleInventory =
        provider === 'google' && parts.length <= 6

      accounts.push({
        provider,
        邮箱地址: accountEmail,
        密码: parts[2] || '',
        辅助邮箱: parts[3] || '',
        两步验证: parts[4] || '',
        client_id: compactGoogleInventory ? '' : parts[5] || '',
        刷新令牌: compactGoogleInventory ? '' : parts[6] || '',
        令牌过期时间: compactGoogleInventory ? '' : parts[7] || '',
        分组: compactGoogleInventory ? parts[5] || '默认分组' : parts[8] || '默认分组',
        oauth_status:
          provider === 'google'
            ? compactGoogleInventory || !(parts[6] || '').trim()
              ? 'not_connected'
              : 'connected'
            : (parts[6] || '').trim()
            ? 'connected'
            : 'not_connected',
        令牌类型:
          provider === 'google' && (compactGoogleInventory || !(parts[6] || '').trim())
            ? null
            : provider === 'google'
            ? 'gmail_api'
            : null,
      })
      continue
    }

    if (!email || !email.includes('@')) continue

    const looksLikeCompactGoogleInventory =
      isGmailAddress(email) &&
      (
        (parts[2] || '').includes('@') ||
        parts.length <= 4
      )

    if (looksLikeCompactGoogleInventory) {
      accounts.push({
        provider: 'google',
        邮箱地址: email,
        密码: parts[1] || '',
        辅助邮箱: parts[2] || '',
        两步验证: parts[3] || '',
        client_id: '',
        刷新令牌: '',
        令牌过期时间: '',
        分组: parts[4] || '默认分组',
        oauth_status: 'not_connected',
        令牌类型: null,
      })
      continue
    }

    accounts.push({
      provider: 'microsoft',
      邮箱地址: email,
      密码: parts[1] || '',
      client_id: parts[2] || '',
      刷新令牌: parts[3] || '',
      令牌过期时间: parts[4] || '',
      分组: parts[5] || '默认分组',
      oauth_status: (parts[3] || '').trim() ? 'connected' : 'not_connected',
    })
  }

  return accounts
}
