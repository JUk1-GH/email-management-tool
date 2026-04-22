export type Provider = 'microsoft' | 'google'
export type TokenType = 'graph' | 'o2' | 'imap' | 'gmail_api' | null
export type OAuthStatus =
  | 'not_connected'
  | 'connected'
  | 'expired'
  | 'error'
export type AccountDataSource = 'local' | 'cloud' | 'hybrid'

// ==================== Account ====================

export interface Account {
  邮箱地址: string
  密码: string
  client_id: string
  刷新令牌: string
  令牌过期时间: string
  分组: string
  导入序号: number
  provider: Provider
  令牌类型: TokenType
  权限已检测: boolean
  使用本地IP: boolean
  辅助邮箱?: string
  两步验证?: string
  oauth_email?: string
  oauth_status?: OAuthStatus
  oauth_updated_at?: string
  状态?: '正常' | '封禁' | '锁定' | '过期' | '无效' | '未授权'
  备注?: string
  数据来源?: AccountDataSource
  云端更新时间?: string
}

// ==================== Email ====================

export interface Email {
  id?: number
  邮箱地址: string
  folder: 'inbox' | 'junkemail'
  subject: string
  from_address: string
  from_name: string
  received_time: string
  body_preview: string
  body?: string
  body_html?: string
  is_read?: boolean
}

// ==================== Group ====================

export interface GroupInfo {
  name: string
  color: string
  count: number
}

export interface CustomGroup {
  name: string
  color: string
}

// ==================== API ====================

export interface DetectPermissionRequest {
  client_id: string
  refresh_token: string
}

export interface DetectPermissionResponse {
  success: boolean
  token_type: 'graph' | 'imap' | 'o2' | 'gmail_api'
  use_local_ip: boolean
  meta?: {
    token_endpoint: string
    rotated_refresh_token: boolean
  }
}

export interface RefreshEmailsRequest {
  email_address: string
  client_id: string
  refresh_token: string
  folder: string
  token_type: string
  provider: Provider
}

export interface RefreshEmailsResponse {
  success: boolean
  message: string
  data?: Email[]
  error_type?: 'banned' | 'locked' | 'expired' | 'invalid'
  meta?: {
    strategy: string
    provider?: Provider
    rotated_refresh_token?: string
  }
}

export interface EmailDetailResponse {
  success: boolean
  message: string
  data?: Email
  error_type?: 'banned' | 'locked' | 'expired' | 'invalid'
  meta?: {
    strategy: string
    provider?: Provider
    rotated_refresh_token?: string
  }
}

export interface GoogleOAuthCallbackPayload {
  type: 'google_oauth_result'
  success: boolean
  message: string
  provider: 'google'
  email_address: string
  oauth_email?: string
  client_id?: string
  refresh_token?: string
  token_type?: 'gmail_api'
  expires_in?: number
  oauth_updated_at?: string
  error_code?: string
}

// ==================== Auth / Cloud Sync ====================

export interface AuthUser {
  id: number
  email: string
  display_name: string
  created_at: string
  updated_at: string
  last_login_at: string
}

export interface UserProfile {
  sync_mode: 'local_plus_cloud'
  allow_sensitive_sync: boolean
  last_cloud_push_at: string
  last_cloud_pull_at: string
}

export interface CloudSummary {
  account_count: number
  credential_count?: number
}

export interface AuthResponse {
  success: boolean
  message: string
  token?: string
  user?: AuthUser
  profile?: UserProfile
  cloud_summary?: CloudSummary
  error_type?: string
}

export interface AuthSecurityConfig {
  success: boolean
  turnstile_enabled: boolean
  turnstile_site_key: string
}

export interface CloudAccountRecord {
  email_address: string
  provider: Provider
  group_name: string
  status: string
  note: string
  oauth_status: OAuthStatus
  oauth_email: string
  oauth_updated_at: string
  import_sequence: number
  updated_at: string
  last_synced_at: string
}

export interface CloudAccountsResponse {
  success: boolean
  message: string
  data?: CloudAccountRecord[]
  meta?: {
    count: number
    last_cloud_pull_at: string
  }
  error_type?: string
}

export interface CloudSyncResponse {
  success: boolean
  message: string
  data?: {
    upserted: number
    deleted: number
    total: number
    last_cloud_push_at: string
  }
  error_type?: string
}

export interface CloudSecretRecord {
  email_address: string
  provider: Provider
  group_name: string
  status: string
  import_sequence: number
  password: string
  recovery_email: string
  twofa_secret: string
  client_id: string
  refresh_token: string
  token_expires_at: string
  updated_at: string
}

export interface CloudSecretsUnlockResponse {
  success: boolean
  message: string
  data?: CloudSecretRecord[]
  meta?: {
    count: number
  }
  error_type?: string
}

export interface CloudSecretsSyncResponse {
  success: boolean
  message: string
  data?: {
    upserted: number
    total: number
    updated_at: string
  }
  error_type?: string
}

export interface TwoFactorCodeData {
  email_address: string
  code: string
  digits: number
  period: number
  algorithm: string
  expires_in: number
  valid_until: string
  source: 'payload' | 'cloud'
}

export interface TwoFactorCodeResponse {
  success: boolean
  message: string
  data?: TwoFactorCodeData
  error_type?: string
}
