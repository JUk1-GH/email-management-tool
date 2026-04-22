import { API_BASE } from './config'
import type {
  AuthResponse,
  CloudAccountsResponse,
  CloudSecretsSyncResponse,
  CloudSecretsUnlockResponse,
  CloudSyncResponse,
  DetectPermissionResponse,
  EmailDetailResponse,
  GoogleOAuthCallbackPayload,
  RefreshEmailsResponse,
  TwoFactorCodeResponse,
  Provider,
} from '@/types'

export const AUTH_TOKEN_STORAGE_KEY = 'jemail.auth.token'

export function getStoredAuthToken(): string {
  try {
    return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

export function setStoredAuthToken(token: string): void {
  if (!token) {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY)
    return
  }
  localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token)
}

function buildJsonHeaders(includeAuth = false): HeadersInit {
  const headers: HeadersInit = { 'Content-Type': 'application/json' }
  if (includeAuth) {
    const token = getStoredAuthToken()
    if (token) {
      ;(headers as Record<string, string>).Authorization = `Bearer ${token}`
    }
  }
  return headers
}

async function parseApiResponse(response: Response): Promise<{
  isJson: boolean
  data: any
  text: string
}> {
  const contentType = response.headers.get('content-type') || ''
  const text = await response.text()

  if (contentType.includes('application/json')) {
    try {
      return {
        isJson: true,
        data: JSON.parse(text),
        text,
      }
    } catch {
      return {
        isJson: false,
        data: null,
        text,
      }
    }
  }

  return {
    isJson: false,
    data: null,
    text,
  }
}

export async function detectPermission(
  clientId: string,
  refreshToken: string
): Promise<DetectPermissionResponse> {
  const response = await fetch(`${API_BASE}/detect-permission`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      refresh_token: refreshToken,
    }),
  })

  const parsed = await parseApiResponse(response)

  if (!response.ok) {
    return { success: false, token_type: 'imap', use_local_ip: false }
  }

  if (!parsed.isJson || !parsed.data) {
    return { success: false, token_type: 'imap', use_local_ip: false }
  }

  return parsed.data
}

async function requestAuth(
  path: string,
  body?: Record<string, unknown>,
  method = 'POST'
): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: buildJsonHeaders(false),
    body: method === 'GET' ? undefined : JSON.stringify(body || {}),
  })
  const parsed = await parseApiResponse(response)

  if (!response.ok || !parsed.isJson || !parsed.data) {
    throw new Error(formatApiErrorMessage(parsed.data, parsed.text, '认证请求失败'))
  }

  return parsed.data as AuthResponse
}

export async function registerWithEmail(
  email: string,
  password: string,
  displayName = ''
): Promise<AuthResponse> {
  return requestAuth('/api/auth/register', {
    email,
    password,
    display_name: displayName,
  })
}

export async function loginWithEmail(
  email: string,
  password: string
): Promise<AuthResponse> {
  return requestAuth('/api/auth/login', { email, password })
}

export async function fetchCurrentUser(): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE}/api/auth/me`, {
    method: 'GET',
    headers: buildJsonHeaders(true),
  })
  const parsed = await parseApiResponse(response)

  if (!response.ok || !parsed.isJson || !parsed.data) {
    throw new Error(formatApiErrorMessage(parsed.data, parsed.text, '登录状态校验失败'))
  }

  return parsed.data as AuthResponse
}

export async function logoutCurrentUser(): Promise<void> {
  const response = await fetch(`${API_BASE}/api/auth/logout`, {
    method: 'POST',
    headers: buildJsonHeaders(true),
  })
  const parsed = await parseApiResponse(response)

  if (!response.ok) {
    throw new Error(formatApiErrorMessage(parsed.data, parsed.text, '退出登录失败'))
  }
}

export async function fetchCloudAccounts(): Promise<CloudAccountsResponse> {
  const response = await fetch(`${API_BASE}/api/cloud/accounts`, {
    method: 'GET',
    headers: buildJsonHeaders(true),
  })
  const parsed = await parseApiResponse(response)

  if (!response.ok || !parsed.isJson || !parsed.data) {
    throw new Error(formatApiErrorMessage(parsed.data, parsed.text, '获取云端资料失败'))
  }

  return parsed.data as CloudAccountsResponse
}

export async function syncCloudAccounts(
  accounts: Array<Record<string, unknown>>,
  replaceMissing = true
): Promise<CloudSyncResponse> {
  const response = await fetch(`${API_BASE}/api/cloud/accounts/sync`, {
    method: 'POST',
    headers: buildJsonHeaders(true),
    body: JSON.stringify({
      accounts,
      replace_missing: replaceMissing,
    }),
  })
  const parsed = await parseApiResponse(response)

  if (!response.ok || !parsed.isJson || !parsed.data) {
    throw new Error(formatApiErrorMessage(parsed.data, parsed.text, '同步云端资料失败'))
  }

  return parsed.data as CloudSyncResponse
}

export async function syncCloudSecrets(
  accounts: Array<Record<string, unknown>>
): Promise<CloudSecretsSyncResponse> {
  const response = await fetch(`${API_BASE}/api/cloud/secrets/sync`, {
    method: 'POST',
    headers: buildJsonHeaders(true),
    body: JSON.stringify({
      accounts,
    }),
  })
  const parsed = await parseApiResponse(response)

  if (!response.ok || !parsed.isJson || !parsed.data) {
    throw new Error(formatApiErrorMessage(parsed.data, parsed.text, '完整账号资料同步失败'))
  }

  return parsed.data as CloudSecretsSyncResponse
}

export async function unlockCloudSecrets(
  emails: string[] = []
): Promise<CloudSecretsUnlockResponse> {
  const response = await fetch(`${API_BASE}/api/cloud/secrets/unlock`, {
    method: 'POST',
    headers: buildJsonHeaders(true),
    body: JSON.stringify({
      emails,
    }),
  })
  const parsed = await parseApiResponse(response)

  if (!response.ok || !parsed.isJson || !parsed.data) {
    throw new Error(formatApiErrorMessage(parsed.data, parsed.text, '完整账号资料拉取失败'))
  }

  return parsed.data as CloudSecretsUnlockResponse
}

export async function refreshEmails(
  emailAddress: string,
  clientId: string,
  refreshToken: string,
  folder: string,
  tokenType: string,
  provider: Provider
): Promise<RefreshEmailsResponse> {
  const response = await fetch(`${API_BASE}/api/emails/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email_address: emailAddress,
      client_id: clientId,
      refresh_token: refreshToken,
      folder,
      token_type: tokenType,
      provider,
    }),
  })

  const parsed = await parseApiResponse(response)
  const data = parsed.data

  if (!response.ok) {
    if (!parsed.isJson || !data) {
      const preview = parsed.text
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120)

      return {
        success: false,
        message: preview
          ? `接口返回了非 JSON 内容：${preview}`
          : '接口返回了非 JSON 内容，请检查 API 地址或后端服务状态',
      }
    }

    return {
      success: false,
      message: formatApiErrorMessage(data),
      error_type: data.error_type,
    }
  }

  if (!parsed.isJson || !data) {
    const preview = parsed.text
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120)

    return {
      success: false,
      message: preview
        ? `接口返回了非 JSON 内容：${preview}`
        : '接口返回了非 JSON 内容，请检查 API 地址或后端服务状态',
    }
  }

  return data
}

export async function fetchEmailDetail(
  emailAddress: string,
  clientId: string,
  refreshToken: string,
  messageId: string,
  provider: Provider
): Promise<EmailDetailResponse> {
  const response = await fetch(`${API_BASE}/api/emails/detail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email_address: emailAddress,
      client_id: clientId,
      refresh_token: refreshToken,
      message_id: messageId,
      provider,
    }),
  })

  const parsed = await parseApiResponse(response)
  const data = parsed.data

  if (!response.ok) {
    if (!parsed.isJson || !data) {
      const preview = parsed.text.replace(/\s+/g, ' ').trim().slice(0, 120)
      return {
        success: false,
        message: preview
          ? `接口返回了非 JSON 内容：${preview}`
          : '接口返回了非 JSON 内容，请检查 API 地址或后端服务状态',
      }
    }

    return {
      success: false,
      message: formatApiErrorMessage(data),
      error_type: data.error_type,
    }
  }

  if (!parsed.isJson || !data) {
    const preview = parsed.text.replace(/\s+/g, ' ').trim().slice(0, 120)
    return {
      success: false,
      message: preview
        ? `接口返回了非 JSON 内容：${preview}`
        : '接口返回了非 JSON 内容，请检查 API 地址或后端服务状态',
    }
  }

  return data
}

export async function generateTwoFactorCode(
  emailAddress: string,
  twofaSecret = ''
): Promise<TwoFactorCodeResponse> {
  const response = await fetch(`${API_BASE}/api/twofa/code`, {
    method: 'POST',
    headers: buildJsonHeaders(true),
    body: JSON.stringify({
      email_address: emailAddress,
      twofa_secret: twofaSecret,
    }),
  })

  const parsed = await parseApiResponse(response)

  if (!response.ok || !parsed.isJson || !parsed.data) {
    throw new Error(formatApiErrorMessage(parsed.data, parsed.text, '生成 2FA 动态码失败'))
  }

  return parsed.data as TwoFactorCodeResponse
}

export function buildGoogleOAuthStartUrl(accountEmail: string): string {
  const url = new URL(`${API_BASE}/api/oauth/google/start`, window.location.origin)
  url.searchParams.set('account_email', accountEmail)
  url.searchParams.set('return_origin', window.location.origin)
  return url.toString()
}

export async function bindGoogleOAuth(
  accountEmail: string
): Promise<GoogleOAuthCallbackPayload> {
  const popup = window.open(
    buildGoogleOAuthStartUrl(accountEmail),
    'jemail-google-oauth',
    'width=560,height=760,menubar=no,toolbar=no,location=yes,resizable=yes,scrollbars=yes'
  )

  if (!popup) {
    throw new Error('浏览器拦截了 Gmail 授权弹窗，请允许弹窗后重试')
  }

  const apiOrigin = new URL(API_BASE, window.location.origin).origin

  return new Promise((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      settled = true
      window.removeEventListener('message', handleMessage)
      window.clearInterval(closeWatcher)
      window.clearTimeout(timeoutTimer)
      try {
        if (!popup.closed) popup.close()
      } catch {
        // Ignore popup close errors.
      }
    }

    const fail = (message: string) => {
      cleanup()
      reject(new Error(message))
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== apiOrigin) return

      const payload = event.data as GoogleOAuthCallbackPayload | null
      if (!payload || payload.type !== 'google_oauth_result') return
      if (payload.provider !== 'google') return
      if (
        payload.email_address &&
        payload.email_address.toLowerCase() !== accountEmail.toLowerCase()
      ) {
        fail('Gmail 授权返回的邮箱与当前账号不一致，请重新绑定')
        return
      }
      if (!payload.success) {
        fail(payload.message || 'Gmail 授权失败')
        return
      }

      cleanup()
      resolve(payload)
    }

    const closeWatcher = window.setInterval(() => {
      if (settled) return
      if (popup.closed) {
        fail('Gmail 授权窗口已关闭，绑定已取消')
      }
    }, 500)

    const timeoutTimer = window.setTimeout(() => {
      if (!settled) {
        fail('等待 Gmail 授权超时，请重试')
      }
    }, 5 * 60 * 1000)

    window.addEventListener('message', handleMessage)
  })
}

function formatApiErrorMessage(
  data: any,
  rawText = '',
  fallback = '请求失败'
): string {
  const base = data?.message || rawText || fallback
  const provider = data?.details?.provider_response
  const attempts = Array.isArray(data?.details?.attempts)
    ? data.details.attempts.filter(Boolean).join(' | ')
    : ''

  const extras = [provider, attempts].filter(Boolean).join(' | ')
  return extras ? `${base}：${extras}` : base
}
