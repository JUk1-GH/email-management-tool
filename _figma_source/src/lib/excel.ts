import * as XLSX from 'xlsx'
import * as mammoth from 'mammoth'
import type { Account, Provider } from '@/types'
import { parseTextToAccounts } from './format'

function isGmailAddress(value: string): boolean {
  const normalized = String(value || '').trim().toLowerCase()
  return (
    normalized.endsWith('@gmail.com') ||
    normalized.endsWith('@googlemail.com')
  )
}

/**
 * Parse Excel file (.xlsx/.xls) into account data.
 * Legacy columns:
 *   邮箱地址, 密码, client_id, 刷新令牌, 令牌过期时间, 分组
 * Provider-aware columns:
 *   provider, 邮箱地址, 密码, 辅助邮箱, 2FA, client_id, 刷新令牌, 令牌过期时间, 分组
 */
export function parseExcelFile(
  file: File
): Promise<Partial<Account>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: 'array' })

        const firstSheetName = workbook.SheetNames[0]
        const worksheet = workbook.Sheets[firstSheetName]

        const jsonData = XLSX.utils.sheet_to_json<string[]>(worksheet, {
          header: 1,
          defval: '',
        })

        const accounts: Partial<Account>[] = []

        // Detect header row
        let startRow = 0
        if (jsonData.length > 0) {
          const firstCell = String(jsonData[0][0] || '').toLowerCase()
          if (
            firstCell.includes('provider') ||
            firstCell.includes('邮箱') ||
            firstCell.includes('email') ||
            firstCell.includes('账号')
          ) {
            startRow = 1
          }
        }

        for (let i = startRow; i < jsonData.length; i++) {
          const row = jsonData[i]
          if (!row || row.length === 0 || !row[0]) continue

          const firstCell = String(row[0] || '').trim().toLowerCase()
          const isProviderAware =
            firstCell === 'microsoft' || firstCell === 'google'

          if (isProviderAware) {
            const provider = firstCell as Provider
            const email = String(row[1] || '').trim()
            if (!email || !email.includes('@')) continue

            const compactGoogleInventory =
              provider === 'google' && row.length <= 6

            accounts.push({
              provider,
              邮箱地址: email,
              密码: String(row[2] || '').trim(),
              辅助邮箱: String(row[3] || '').trim(),
              两步验证: String(row[4] || '').trim(),
              client_id: compactGoogleInventory ? '' : String(row[5] || '').trim(),
              刷新令牌: compactGoogleInventory ? '' : String(row[6] || '').trim(),
              令牌过期时间: compactGoogleInventory ? '' : String(row[7] || '').trim(),
              分组:
                String(
                  compactGoogleInventory ? row[5] || '默认分组' : row[8] || '默认分组'
                ).trim() || '默认分组',
              oauth_status:
                provider === 'google'
                  ? compactGoogleInventory || !String(row[6] || '').trim()
                    ? 'not_connected'
                    : 'connected'
                  : String(row[6] || '').trim()
                  ? 'connected'
                  : 'not_connected',
              令牌类型:
                provider === 'google' &&
                !(compactGoogleInventory || !String(row[6] || '').trim())
                  ? 'gmail_api'
                  : null,
            })
            continue
          }

          const email = String(row[0] || '').trim()
          if (!email || !email.includes('@')) continue

          const looksLikeCompactGoogleInventory =
            isGmailAddress(email) &&
            (
              String(row[2] || '').includes('@') ||
              row.length <= 4
            )

          if (looksLikeCompactGoogleInventory) {
            accounts.push({
              provider: 'google',
              邮箱地址: email,
              密码: String(row[1] || '').trim(),
              辅助邮箱: String(row[2] || '').trim(),
              两步验证: String(row[3] || '').trim(),
              client_id: '',
              刷新令牌: '',
              令牌过期时间: '',
              分组: String(row[4] || '默认分组').trim() || '默认分组',
              oauth_status: 'not_connected',
              令牌类型: null,
            })
            continue
          }

          accounts.push({
            provider: 'microsoft',
            邮箱地址: email,
            密码: String(row[1] || '').trim(),
            client_id: String(row[2] || '').trim(),
            刷新令牌: String(row[3] || '').trim(),
            令牌过期时间: String(row[4] || '').trim(),
            分组: String(row[5] || '默认分组').trim() || '默认分组',
            oauth_status: String(row[3] || '').trim()
              ? 'connected'
              : 'not_connected',
          })
        }

        resolve(accounts)
      } catch (error) {
        reject(new Error('Excel文件解析失败: ' + (error as Error).message))
      }
    }

    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsArrayBuffer(file)
  })
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target!.result as string)
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsText(file, 'utf-8')
  })
}

export function extractDocxText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = async (event) => {
      try {
        const arrayBuffer = event.target?.result as ArrayBuffer
        const result = await mammoth.extractRawText({ arrayBuffer })
        resolve(result.value || '')
      } catch (error) {
        reject(new Error('Word 文件解析失败: ' + (error as Error).message))
      }
    }

    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsArrayBuffer(file)
  })
}

export async function parseImportFile(
  file: File
): Promise<Partial<Account>[]> {
  const fileName = file.name.toLowerCase()

  if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
    return parseExcelFile(file)
  }

  if (fileName.endsWith('.docx')) {
    const text = await extractDocxText(file)
    return parseTextToAccounts(text)
  }

  const text = await readFileAsText(file)
  return parseTextToAccounts(text)
}
