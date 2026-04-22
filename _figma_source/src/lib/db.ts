import type {
  Account,
  AccountDataSource,
  CloudAccountRecord,
  CloudSecretRecord,
  Email,
  OAuthStatus,
  Provider,
  TokenType,
} from '@/types'

function normalizeEmailKey(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

function normalizeProvider(value: unknown): Provider {
  return value === 'google' ? 'google' : 'microsoft'
}

function normalizeTokenType(value: unknown): TokenType {
  if (
    value === 'graph' ||
    value === 'o2' ||
    value === 'imap' ||
    value === 'gmail_api'
  ) {
    return value
  }
  return null
}

function normalizeAccountDataSource(value: unknown): AccountDataSource {
  if (value === 'cloud' || value === 'hybrid') {
    return value
  }
  return 'local'
}

function deriveOAuthStatus(
  provider: Provider,
  refreshToken: string,
  currentStatus?: OAuthStatus
): OAuthStatus {
  if (currentStatus) return currentStatus
  if (provider === 'google') {
    return refreshToken ? 'connected' : 'not_connected'
  }
  return refreshToken ? 'connected' : 'not_connected'
}

function normalizeAccountRecord(
  account: Partial<Account>,
  fallbackSequence = 0
): Account {
  const provider = normalizeProvider(account.provider)
  const refreshToken = String(account.刷新令牌 || '').trim()
  const tokenType = normalizeTokenType(account.令牌类型)

  return {
    邮箱地址: normalizeEmailKey(account.邮箱地址),
    密码: String(account.密码 || '').trim(),
    client_id: String(account.client_id || '').trim(),
    刷新令牌: refreshToken,
    令牌过期时间: String(account.令牌过期时间 || '').trim(),
    分组: String(account.分组 || '默认分组').trim() || '默认分组',
    导入序号: Number(account.导入序号 || fallbackSequence || 0),
    provider,
    令牌类型:
      tokenType || (provider === 'google' && refreshToken ? 'gmail_api' : null),
    权限已检测:
      account.权限已检测 === undefined
        ? provider === 'google' && Boolean(refreshToken)
        : Boolean(account.权限已检测),
    使用本地IP: Boolean(account.使用本地IP),
    辅助邮箱: String(account.辅助邮箱 || '').trim(),
    两步验证: String(account.两步验证 || '').trim(),
    oauth_email: String(account.oauth_email || '').trim(),
    oauth_status: deriveOAuthStatus(
      provider,
      refreshToken,
      account.oauth_status
    ),
    oauth_updated_at: String(account.oauth_updated_at || '').trim(),
    状态:
      account.状态 ||
      (provider === 'google' && !refreshToken ? '未授权' : '正常'),
    备注: String(account.备注 || '').trim(),
    数据来源: normalizeAccountDataSource(account.数据来源),
    云端更新时间: String(account.云端更新时间 || '').trim(),
  }
}

function buildEmailCacheKey(email: Partial<Email>): string {
  const emailAddress = normalizeEmailKey(email.邮箱地址)
  const folder = String(email.folder || 'inbox').trim() || 'inbox'
  const remoteId = String(email.id ?? '').trim()
  const receivedTime = String(email.received_time || '').trim()
  const subject = String(email.subject || '').trim()
  const fromAddress = String(email.from_address || '').trim()

  return [
    emailAddress,
    folder,
    remoteId || receivedTime || subject || fromAddress || crypto.randomUUID(),
  ].join('::')
}

function mergeAccountRecords(primary: Account, incoming: Account): Account {
  const primaryHasSecrets = Boolean(
    primary.密码 ||
      primary.client_id ||
      primary.刷新令牌 ||
      primary.辅助邮箱 ||
      primary.两步验证
  )
  const incomingHasSecrets = Boolean(
    incoming.密码 ||
      incoming.client_id ||
      incoming.刷新令牌 ||
      incoming.辅助邮箱 ||
      incoming.两步验证
  )
  const base = primaryHasSecrets || !incomingHasSecrets ? primary : incoming
  const secondary = base === primary ? incoming : primary

  return normalizeAccountRecord({
    ...secondary,
    ...base,
    邮箱地址: base.邮箱地址 || secondary.邮箱地址,
    分组: base.分组 || secondary.分组 || '默认分组',
    导入序号:
      Number(base.导入序号 || 0) || Number(secondary.导入序号 || 0) || 0,
    oauth_email: base.oauth_email || secondary.oauth_email || '',
    oauth_status: base.oauth_status || secondary.oauth_status || 'not_connected',
    oauth_updated_at: base.oauth_updated_at || secondary.oauth_updated_at || '',
    状态: base.状态 || secondary.状态 || '正常',
    备注: base.备注 || secondary.备注 || '',
    数据来源:
      base.数据来源 === 'hybrid' || secondary.数据来源 === 'hybrid'
        ? 'hybrid'
        : base.数据来源 || secondary.数据来源 || 'local',
    云端更新时间: base.云端更新时间 || secondary.云端更新时间 || '',
  })
}

/**
 * IndexedDB 数据库封装类
 * 1:1 移植自 jemail-app/db.js，保持完全兼容
 * DB 名、版本、中文字段名、索引结构不变
 */
class LocalDatabase {
  private dbName = 'EmailManagementDB'
  private version = 4
  private db: IDBDatabase | null = null

  async init(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version)

      request.onerror = () => {
        console.error('❌ 数据库打开失败:', request.error)
        reject(request.error)
      }

      request.onsuccess = () => {
        this.db = request.result
        console.log('✅ 浏览器本地数据库初始化成功')
        resolve(this.db)
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        const transaction = (event.target as IDBOpenDBRequest).transaction!
        const oldVersion = event.oldVersion

        // 创建账号表
        if (!db.objectStoreNames.contains('accounts')) {
          const accountStore = db.createObjectStore('accounts', {
            keyPath: '邮箱地址',
          })
          accountStore.createIndex('分组', '分组', { unique: false })
          accountStore.createIndex('刷新令牌', '刷新令牌', { unique: false })
          accountStore.createIndex('导入序号', '导入序号', { unique: false })
        } else {
          const accountStore = transaction.objectStore('accounts')
          if (!accountStore.indexNames.contains('导入序号')) {
            accountStore.createIndex('导入序号', '导入序号', { unique: false })
          }
          if (oldVersion < 3) {
            const cursorRequest = accountStore.openCursor()
            cursorRequest.onsuccess = (cursorEvent) => {
              const cursor = (cursorEvent.target as IDBRequest<IDBCursorWithValue>)
                .result
              if (!cursor) return
              cursor.update(
                normalizeAccountRecord(
                  cursor.value as Partial<Account>,
                  Number(cursor.value?.导入序号 || 0)
                )
              )
              cursor.continue()
            }
          }
        }

        // 创建邮件表
        if (oldVersion < 4 && db.objectStoreNames.contains('emails')) {
          db.deleteObjectStore('emails')
        }

        if (!db.objectStoreNames.contains('emails')) {
          const emailStore = db.createObjectStore('emails', {
            keyPath: 'cache_key',
          })
          emailStore.createIndex('邮箱地址', '邮箱地址', { unique: false })
          emailStore.createIndex('folder', 'folder', { unique: false })
          emailStore.createIndex('邮箱_文件夹', ['邮箱地址', 'folder'], {
            unique: false,
          })
          emailStore.createIndex('remote_id', 'remote_id', { unique: false })
        }
      }
    })
  }

  private getDB(): IDBDatabase {
    if (!this.db) throw new Error('数据库未初始化')
    return this.db
  }

  async normalizeAndDeduplicateAccounts(): Promise<{
    changed: boolean
    removed: number
  }> {
    const accounts = await new Promise<Partial<Account>[]>((resolve, reject) => {
      const store = this.getDB()
        .transaction(['accounts'], 'readonly')
        .objectStore('accounts')
      const request = store.getAll()

      request.onsuccess = () => resolve((request.result || []) as Partial<Account>[])
      request.onerror = () => reject(request.error)
    })

    const mergedByEmail = new Map<string, Account>()
    let changed = false

    for (const raw of accounts) {
      const normalized = normalizeAccountRecord(raw)
      const key = normalized.邮箱地址
      const existing = mergedByEmail.get(key)
      if (!existing) {
        mergedByEmail.set(key, normalized)
        if (String(raw.邮箱地址 || '').trim() !== key) {
          changed = true
        }
        continue
      }

      changed = true
      mergedByEmail.set(key, mergeAccountRecords(existing, normalized))
    }

    const dedupedAccounts = [...mergedByEmail.values()].sort(
      (a, b) => (a.导入序号 || 0) - (b.导入序号 || 0)
    )

    if (!changed && dedupedAccounts.length === accounts.length) {
      return { changed: false, removed: 0 }
    }

    await new Promise<void>((resolve, reject) => {
      const transaction = this.getDB().transaction(['accounts'], 'readwrite')
      const store = transaction.objectStore('accounts')
      store.clear()
      dedupedAccounts.forEach((account) => store.put(account))
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })

    return {
      changed: true,
      removed: Math.max(accounts.length - dedupedAccounts.length, 0),
    }
  }

  async getAllAccounts(): Promise<Account[]> {
    return new Promise((resolve, reject) => {
      const store = this.getDB()
        .transaction(['accounts'], 'readonly')
        .objectStore('accounts')
      const request = store.getAll()

      request.onsuccess = () => {
        const accounts = ((request.result || []) as Partial<Account>[]).map(
          (account) => normalizeAccountRecord(account)
        )
        accounts.sort((a, b) => (a.导入序号 || 0) - (b.导入序号 || 0))
        resolve(accounts)
      }
      request.onerror = () => reject(request.error)
    })
  }

  async addAccounts(
    accounts: Partial<Account>[]
  ): Promise<{ success: number; error: number }> {
    const existingAccounts = await this.getAllAccounts()
    let maxSeq = 0
    existingAccounts.forEach((acc) => {
      if (acc.导入序号 && acc.导入序号 > maxSeq) maxSeq = acc.导入序号
    })

    return new Promise((resolve, reject) => {
      const transaction = this.getDB().transaction(['accounts'], 'readwrite')
      const store = transaction.objectStore('accounts')
      let successCount = 0
      let errorCount = 0

      accounts.forEach((account, index) => {
        const normalized = normalizeAccountRecord(account, maxSeq + index + 1)
        const request = store.put(normalized)
        request.onsuccess = () => successCount++
        request.onerror = () => errorCount++
      })

      transaction.oncomplete = () =>
        resolve({ success: successCount, error: errorCount })
      transaction.onerror = () => reject(transaction.error)
    })
  }

  async deleteAccount(email: string): Promise<boolean> {
    const normalizedEmail = normalizeEmailKey(email)
    return new Promise((resolve, reject) => {
      const transaction = this.getDB().transaction(
        ['accounts', 'emails'],
        'readwrite'
      )

      transaction.objectStore('accounts').delete(normalizedEmail)

      const emailStore = transaction.objectStore('emails')
      const index = emailStore.index('邮箱地址')
      const request = index.openCursor(IDBKeyRange.only(normalizedEmail))

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
        if (cursor) {
          cursor.delete()
          cursor.continue()
        }
      }

      transaction.oncomplete = () => resolve(true)
      transaction.onerror = () => reject(transaction.error)
    })
  }

  async batchDeleteAccounts(emails: string[]): Promise<boolean[]> {
    return Promise.all(emails.map((email) => this.deleteAccount(email)))
  }

  async updateAccountGroup(
    email: string,
    groupName: string
  ): Promise<boolean> {
    const normalizedEmail = normalizeEmailKey(email)
    return new Promise((resolve, reject) => {
      const transaction = this.getDB().transaction(['accounts'], 'readwrite')
      const store = transaction.objectStore('accounts')
      const request = store.get(normalizedEmail)

      request.onsuccess = () => {
        const account = request.result
        if (account) {
          const normalized = normalizeAccountRecord(account)
          normalized.分组 = groupName
          store.put(normalized)
        }
      }

      transaction.oncomplete = () => resolve(true)
      transaction.onerror = () => reject(transaction.error)
    })
  }

  async batchUpdateGroup(
    emails: string[],
    groupName: string
  ): Promise<{ success: number; failed: number }> {
    const results = await Promise.all(
      emails.map((email) => this.updateAccountGroup(email, groupName))
    )
    const successCount = results.filter((r) => r === true).length
    return { success: successCount, failed: results.length - successCount }
  }

  async getAllGroups(): Promise<string[]> {
    const accounts = await this.getAllAccounts()
    const groups = [...new Set(accounts.map((acc) => acc.分组 || '默认分组'))]
    return groups.sort()
  }

  async getGroupCounts(): Promise<Record<string, number>> {
    const accounts = await this.getAllAccounts()
    const counts: Record<string, number> = {}
    accounts.forEach((acc) => {
      const group = acc.分组 || '默认分组'
      counts[group] = (counts[group] || 0) + 1
    })
    return counts
  }

  async deleteGroup(groupName: string): Promise<number> {
    const accounts = await this.getAllAccounts()
    const affected = accounts.filter((acc) => acc.分组 === groupName)

    return new Promise((resolve, reject) => {
      const transaction = this.getDB().transaction(['accounts'], 'readwrite')
      const store = transaction.objectStore('accounts')

      affected.forEach((account) => {
        account.分组 = '默认分组'
        store.put(account)
      })

      transaction.oncomplete = () => resolve(affected.length)
      transaction.onerror = () => reject(transaction.error)
    })
  }

  async getAccount(email: string): Promise<Account | undefined> {
    const normalizedEmail = normalizeEmailKey(email)
    return new Promise((resolve, reject) => {
      const store = this.getDB()
        .transaction(['accounts'], 'readonly')
        .objectStore('accounts')
      const request = store.get(normalizedEmail)

      request.onsuccess = () =>
        resolve(
          request.result
            ? normalizeAccountRecord(request.result as Partial<Account>)
            : undefined
        )
      request.onerror = () => reject(request.error)
    })
  }

  async updateAccount(
    email: string,
    updates: Partial<Account>
  ): Promise<boolean> {
    const normalizedEmail = normalizeEmailKey(email)
    return new Promise((resolve, reject) => {
      const transaction = this.getDB().transaction(['accounts'], 'readwrite')
      const store = transaction.objectStore('accounts')
      const request = store.get(normalizedEmail)

      request.onsuccess = () => {
        const account = request.result
        if (account) {
          const normalized = normalizeAccountRecord(account)
          Object.assign(normalized, updates)
          store.put(normalizeAccountRecord(normalized))
        }
      }

      transaction.oncomplete = () => resolve(true)
      transaction.onerror = () => reject(transaction.error)
    })
  }

  async updateAccountPermission(
    email: string,
    permissionData: {
      token_type: string
      use_local_ip: boolean
    }
  ): Promise<boolean> {
    const normalizedEmail = normalizeEmailKey(email)
    return new Promise((resolve, reject) => {
      const transaction = this.getDB().transaction(['accounts'], 'readwrite')
      const store = transaction.objectStore('accounts')
      const request = store.get(normalizedEmail)

      request.onsuccess = () => {
        const account = request.result
        if (account) {
          const normalized = normalizeAccountRecord(account)
          normalized.令牌类型 = normalizeTokenType(permissionData.token_type)
          normalized.使用本地IP = permissionData.use_local_ip
          normalized.权限已检测 = true
          if (normalized.令牌类型 === 'gmail_api') {
            normalized.provider = 'google'
            normalized.oauth_status = 'connected'
          }
          store.put(normalizeAccountRecord(normalized))
        }
      }

      transaction.oncomplete = () => resolve(true)
      transaction.onerror = () => reject(transaction.error)
    })
  }

  async replaceEmails(
    emailAddress: string,
    folder: string,
    emails: Partial<Email>[]
  ): Promise<number> {
    const normalizedEmail = normalizeEmailKey(emailAddress)
    const normalizedFolder = String(folder || 'inbox').trim() || 'inbox'

    return new Promise((resolve, reject) => {
      const transaction = this.getDB().transaction(['emails'], 'readwrite')
      const store = transaction.objectStore('emails')
      const index = store.index('邮箱_文件夹')
      let count = 0

      const deleteRequest = index.openCursor(
        IDBKeyRange.only([normalizedEmail, normalizedFolder])
      )

      deleteRequest.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
        if (cursor) {
          cursor.delete()
          cursor.continue()
          return
        }

        emails.forEach((email) => {
          const normalizedEmailRecord = {
            ...email,
            邮箱地址: normalizedEmail,
            folder: normalizedFolder as Email['folder'],
          }
          const request = store.put({
            ...normalizedEmailRecord,
            remote_id: String(email.id ?? '').trim(),
            cache_key: buildEmailCacheKey(normalizedEmailRecord),
          })
          request.onsuccess = () => count++
        })
      }

      deleteRequest.onerror = () => reject(deleteRequest.error)

      transaction.oncomplete = () => resolve(count)
      transaction.onerror = () => reject(transaction.error)
    })
  }

  async getEmails(
    email: string,
    folder = 'inbox',
    limit = 100
  ): Promise<Email[]> {
    const normalizedEmail = normalizeEmailKey(email)
    return new Promise((resolve, reject) => {
      const store = this.getDB()
        .transaction(['emails'], 'readonly')
        .objectStore('emails')
      const index = store.index('邮箱_文件夹')
      const request = index.getAll([normalizedEmail, folder])

      request.onsuccess = () => {
        const results = (request.result || []) as Email[]
        results.sort(
          (a, b) =>
            new Date(b.received_time).getTime() -
            new Date(a.received_time).getTime()
        )
        resolve(results.slice(0, limit))
      }
      request.onerror = () => reject(request.error)
    })
  }

  async clearAll(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const transaction = this.getDB().transaction(
        ['accounts', 'emails'],
        'readwrite'
      )

      transaction.objectStore('accounts').clear()
      transaction.objectStore('emails').clear()

      transaction.oncomplete = () => resolve(true)
      transaction.onerror = () => reject(transaction.error)
    })
  }

  async exportData(): Promise<{
    version: number
    exportTime: string
    accounts: Account[]
    emails: Email[]
  }> {
    const accounts = await this.getAllAccounts()
    const emailsStore = this.getDB()
      .transaction(['emails'], 'readonly')
      .objectStore('emails')
    const emails = await new Promise<Email[]>((resolve, reject) => {
      const request = emailsStore.getAll()
      request.onsuccess = () => resolve((request.result || []) as Email[])
      request.onerror = () => reject(request.error)
    })

    return {
      version: 2,
      exportTime: new Date().toISOString(),
      accounts,
      emails,
    }
  }

  async importData(
    data: { accounts: Account[]; emails: Email[] },
    overwrite = false
  ): Promise<{ accounts: number; emails: number }> {
    if (overwrite) await this.clearAll()

    const transaction = this.getDB().transaction(
      ['accounts', 'emails'],
      'readwrite'
    )
    const accountStore = transaction.objectStore('accounts')
    const emailStore = transaction.objectStore('emails')

    data.accounts.forEach((account) =>
      accountStore.put(normalizeAccountRecord(account))
    )
    data.emails.forEach((email) => emailStore.put(email))

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () =>
        resolve({
          accounts: data.accounts.length,
          emails: data.emails.length,
        })
      transaction.onerror = () => reject(transaction.error)
    })
  }

  async mergeCloudAccounts(
    records: CloudAccountRecord[]
  ): Promise<{ created: number; updated: number }> {
    let created = 0
    let updated = 0

    for (const record of records) {
      const existing = await this.getAccount(record.email_address)
      const merged: Partial<Account> = {
        邮箱地址: record.email_address,
        provider: record.provider,
        密码: existing?.密码 || '',
        client_id: existing?.client_id || '',
        刷新令牌: existing?.刷新令牌 || '',
        令牌过期时间: existing?.令牌过期时间 || '',
        分组: record.group_name || existing?.分组 || '默认分组',
        导入序号: Number(record.import_sequence || existing?.导入序号 || 0),
        令牌类型: existing?.令牌类型 || null,
        权限已检测: existing?.权限已检测 || false,
        使用本地IP: existing?.使用本地IP || false,
        辅助邮箱: existing?.辅助邮箱 || '',
        两步验证: existing?.两步验证 || '',
        oauth_email: record.oauth_email || '',
        oauth_status: record.oauth_status,
        oauth_updated_at: record.oauth_updated_at || '',
        状态:
          (record.status as Account['状态']) ||
          existing?.状态 ||
          '正常',
        备注: record.note || '',
        数据来源:
          existing && existing.数据来源 && existing.数据来源 !== 'cloud'
            ? 'hybrid'
            : 'cloud',
        云端更新时间: record.updated_at || record.last_synced_at || '',
      }

      if (existing) {
        await this.updateAccount(record.email_address, merged)
        updated++
      } else {
        await this.addAccounts([merged])
        updated += 0
        created++
      }
    }

    return { created, updated }
  }

  async mergeCloudSecrets(
    records: CloudSecretRecord[]
  ): Promise<{ updated: number; created: number }> {
    let updated = 0
    let created = 0

    for (const record of records) {
      const existing = await this.getAccount(record.email_address)
      const provider = record.provider || existing?.provider || 'microsoft'
      const merged: Partial<Account> = {
        邮箱地址: record.email_address,
        provider,
        密码: record.password || existing?.密码 || '',
        client_id: record.client_id || existing?.client_id || '',
        刷新令牌: record.refresh_token || existing?.刷新令牌 || '',
        令牌过期时间: record.token_expires_at || existing?.令牌过期时间 || '',
        分组: record.group_name || existing?.分组 || '默认分组',
        导入序号: Number(record.import_sequence || existing?.导入序号 || 0),
        令牌类型:
          record.refresh_token && provider === 'google'
            ? 'gmail_api'
            : existing?.令牌类型 || null,
        权限已检测:
          existing?.权限已检测 || Boolean(record.refresh_token && provider === 'google'),
        使用本地IP: existing?.使用本地IP || false,
        辅助邮箱: record.recovery_email || existing?.辅助邮箱 || '',
        两步验证: record.twofa_secret || existing?.两步验证 || '',
        oauth_email: existing?.oauth_email || '',
        oauth_status:
          record.refresh_token || existing?.刷新令牌
            ? 'connected'
            : existing?.oauth_status || 'not_connected',
        oauth_updated_at: existing?.oauth_updated_at || '',
        状态:
          existing?.状态 ||
          (provider === 'google' && !(record.refresh_token || existing?.刷新令牌)
            ? '未授权'
            : '正常'),
        备注: existing?.备注 || '',
        数据来源: existing?.数据来源 === 'cloud' ? 'hybrid' : existing?.数据来源 || 'hybrid',
        云端更新时间: record.updated_at || existing?.云端更新时间 || '',
      }

      if (existing) {
        await this.updateAccount(record.email_address, merged)
        updated++
      } else {
        await this.addAccounts([merged])
        created++
      }
    }

    return { updated, created }
  }
}

export const localDB = new LocalDatabase()
