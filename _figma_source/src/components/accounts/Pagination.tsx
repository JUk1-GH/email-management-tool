import { useAccountStore } from '@/stores/account-store'

export default function Pagination() {
  const total = useAccountStore((s) => s.total)
  const currentPage = useAccountStore((s) => s.currentPage)
  const pageSize = useAccountStore((s) => s.pageSize)
  const setCurrentPage = useAccountStore((s) => s.setCurrentPage)
  const setPageSize = useAccountStore((s) => s.setPageSize)
  const loadAccounts = useAccountStore((s) => s.loadAccounts)

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = Math.min((currentPage - 1) * pageSize + 1, total)
  const end = Math.min(currentPage * pageSize, total)

  const changePage = (page: number) => {
    if (page < 1 || page > totalPages) return
    setCurrentPage(page)
    loadAccounts()
  }

  const changePageSize = (size: number) => {
    setPageSize(size)
    loadAccounts()
  }

  // Generate page numbers to show
  const pages: (number | '...')[] = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else {
    pages.push(1)
    if (currentPage > 3) pages.push('...')
    for (
      let i = Math.max(2, currentPage - 1);
      i <= Math.min(totalPages - 1, currentPage + 1);
      i++
    ) {
      pages.push(i)
    }
    if (currentPage < totalPages - 2) pages.push('...')
    pages.push(totalPages)
  }

  return (
    <div className="bg-white/40 backdrop-blur-md border-t border-slate-200/50 px-5 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="text-[13px] text-slate-500">
          显示 {total > 0 ? start : 0} 到 {end}，共 {total} 条
        </span>
        <select
          value={pageSize}
          onChange={(e) => changePageSize(Number(e.target.value))}
          className="text-[13px] text-slate-600 bg-white/60 border border-white/80 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        >
          {[10, 20, 50, 100].map((size) => (
            <option key={size} value={size}>
              {size} 条/页
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center space-x-1 bg-slate-100/50 p-1 rounded-xl border border-slate-200/50 backdrop-blur-sm">
        <button
          onClick={() => changePage(currentPage - 1)}
          disabled={currentPage <= 1}
          className="px-3 py-1 rounded-lg text-[13px] font-medium text-slate-400 hover:text-slate-600 hover:bg-white/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          上页
        </button>
        {pages.map((p, i) =>
          p === '...' ? (
            <span
              key={`dots-${i}`}
              className="w-7 h-7 flex items-center justify-center text-[13px] text-slate-400"
            >
              ...
            </span>
          ) : (
            <button
              key={p}
              onClick={() => changePage(p)}
              className={`w-7 h-7 rounded-lg flex items-center justify-center text-[13px] font-medium transition-colors ${
                currentPage === p
                  ? 'bg-white text-slate-800 shadow-[0_1px_3px_rgba(0,0,0,0.1)]'
                  : 'text-slate-600 hover:bg-white/60'
              }`}
            >
              {p}
            </button>
          )
        )}
        <button
          onClick={() => changePage(currentPage + 1)}
          disabled={currentPage >= totalPages}
          className="px-3 py-1 rounded-lg text-[13px] font-medium text-slate-600 hover:bg-white/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          下页
        </button>
      </div>
    </div>
  )
}
