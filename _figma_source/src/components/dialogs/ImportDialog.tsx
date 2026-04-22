import { useState, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/app/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/app/components/ui/tabs'
import { useAccountStore } from '@/stores/account-store'
import { localDB } from '@/lib/db'
import { parseTextToAccounts } from '@/lib/format'
import { parseImportFile } from '@/lib/excel'
import type { Account } from '@/types'
import { toast } from 'sonner'

interface ImportDialogProps {
  open: boolean
  onClose: () => void
}

export default function ImportDialog({ open, onClose }: ImportDialogProps) {
  const [method, setMethod] = useState<'text' | 'file'>('text')
  const [importText, setImportText] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const loadAccounts = useAccountStore((s) => s.loadAccounts)
  const loadGroups = useAccountStore((s) => s.loadGroups)

  const lineCount = importText
    ? importText
        .trim()
        .split('\n')
        .filter((l) => l.trim()).length
    : 0

  const parsePendingAccounts = async (): Promise<Partial<Account>[]> => {
    if (method === 'text') {
      if (!importText || !importText.trim()) {
        throw new Error('请粘贴账号信息后再继续')
      }
      return parseTextToAccounts(importText)
    }

    if (!selectedFile) {
      throw new Error('请先选择要处理的文件')
    }

    return parseImportFile(selectedFile)
  }

  const handleImport = async () => {
    setImporting(true)
    try {
      const accounts = await parsePendingAccounts()

      if (accounts.length === 0) {
        toast.warning('未解析到有效的账号信息')
        return
      }

      const result = await localDB.addAccounts(accounts)
      toast.success(`成功导入 ${result.success} 个账号`)
      onClose()
      await loadAccounts()
      await loadGroups()
    } catch (error) {
      toast.error('导入失败: ' + (error as Error).message)
    } finally {
      setImporting(false)
    }
  }

  const handleDeleteByCurrentInput = async () => {
    if (
      !confirm(
        '会按当前文本或文件里解析出来的邮箱地址删除对应账号。这个操作会同时删除这些账号的本地邮件缓存，确定继续吗？'
      )
    ) {
      return
    }

    setDeleting(true)
    try {
      const accounts = await parsePendingAccounts()
      const emails = [...new Set(
        accounts
          .map((account) => String(account.邮箱地址 || '').trim())
          .filter((email) => email && email.includes('@'))
      )]

      if (emails.length === 0) {
        toast.warning('当前内容里没有解析出可删除的邮箱地址')
        return
      }

      await localDB.batchDeleteAccounts(emails)
      await loadAccounts()
      await loadGroups()
      toast.success(`已删除 ${emails.length} 个账号`)
    } catch (error) {
      toast.error('删除失败: ' + (error as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  const handleClose = () => {
    setImportText('')
    setSelectedFile(null)
    setMethod('text')
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>导入账号</DialogTitle>
        </DialogHeader>

        <Tabs
          value={method}
          onValueChange={(v) => setMethod(v as 'text' | 'file')}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="text">文本导入</TabsTrigger>
            <TabsTrigger value="file">文件导入</TabsTrigger>
          </TabsList>

          <TabsContent value="text" className="space-y-3 mt-4">
            <p className="text-[13px] text-slate-500">
              兼容多种格式，字段用 Tab、`|`、`,` 或 `----` 分隔：
              <br />
              <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">
                microsoft----邮箱地址----密码----client_id----刷新令牌----令牌过期时间----分组
              </code>
              <br />
              <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">
                google----邮箱地址----密码----辅助邮箱----2FA----分组
              </code>
              <br />
              旧 Outlook 格式也兼容：
              <code className="text-xs bg-slate-100 px-1 py-0.5 rounded ml-1">
                邮箱地址----密码----client_id----刷新令牌----令牌过期时间----分组
              </code>
              <br />
              也支持你这种紧凑格式：
              <code className="text-xs bg-slate-100 px-1 py-0.5 rounded ml-1">
                邮箱地址|密码|辅助邮箱|2FA
              </code>
              <span className="mx-1">或</span>
              <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">
                邮箱地址,密码,辅助邮箱,2FA
              </code>
            </p>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="在此粘贴账号信息..."
              className="w-full h-48 p-3 text-[13px] font-mono bg-slate-50 border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-300"
            />
            <p className="text-[12px] text-slate-400">
              共 {lineCount} 行有效数据
            </p>
          </TabsContent>

          <TabsContent value="file" className="space-y-3 mt-4">
            <p className="text-[13px] text-slate-500">
              支持 .txt / .xlsx / .xls / .docx 格式文件。Word 文档会先提取纯文本，再按账号格式解析。
            </p>
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-200 rounded-lg p-8 text-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition-colors"
            >
              {selectedFile ? (
                <p className="text-[14px] text-slate-700 font-medium">
                  {selectedFile.name}
                  <span className="text-slate-400 ml-2">
                    ({(selectedFile.size / 1024).toFixed(1)} KB)
                  </span>
                </p>
              ) : (
                <p className="text-slate-400 text-[14px]">
                  点击选择文件或拖拽文件到此处
                </p>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.xlsx,.xls,.docx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) setSelectedFile(file)
                e.target.value = ''
              }}
            />
          </TabsContent>
        </Tabs>

        <DialogFooter className="gap-2 sm:gap-2">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-[13px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => void handleDeleteByCurrentInput()}
            disabled={importing || deleting}
            className="px-4 py-2 text-[13px] font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors disabled:opacity-50"
          >
            {deleting ? '删除中...' : '删除这些账号'}
          </button>
          <button
            onClick={() => handleImport()}
            disabled={importing || deleting}
            className="px-4 py-2 text-[13px] font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 shadow-sm"
          >
            {importing ? '导入中...' : '追加导入'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
