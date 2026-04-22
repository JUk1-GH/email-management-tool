import { useEmailStore } from '@/stores/email-store'
import { formatTime } from '@/lib/format'
import { sanitizeEmailHtml } from '@/lib/sanitize-email-html'

export default function EmailDetail() {
  const email = useEmailStore((s) => s.currentEmailDetail)

  const safeEmailBody = email
    ? sanitizeEmailHtml(email.body || email.body_html || email.body_preview || '')
    : ''

  const htmlContent = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
html, body {
  width: 100%;
  max-width: 100%;
  overflow-x: hidden;
}
body {
  margin: 0;
  padding: 0;
  font-family: 'Segoe UI', 'Microsoft YaHei', -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 14px; line-height: 1.6; color: #1e293b; background: #ffffff;
  word-wrap: break-word; overflow-wrap: break-word;
}
img { max-width: 100% !important; height: auto !important; display: inline-block; vertical-align: middle; }
img[src=""], img:not([src]), img[src*="cid:"], img[width="1"], img[height="1"],
img[src^="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP"] {
  display: none !important; width: 0 !important; height: 0 !important;
  margin: 0 !important; padding: 0 !important; opacity: 0 !important;
}
a { color: #0078d4; text-decoration: none; }
a:hover { text-decoration: underline; }
table { border-collapse: collapse; max-width: 100% !important; }
table td, table th { padding: 8px; vertical-align: top; }
* { max-width: 100%; box-sizing: border-box; }
[width] { max-width: 100% !important; }
[style*="width"] { max-width: 100% !important; }
[style*="min-width"] { min-width: 0 !important; }
div, section, article, main, header, footer, aside {
  max-width: 100% !important;
}
p { margin: 0 0 12px 0; }
h1, h2, h3, h4, h5, h6 { margin: 16px 0 12px 0; line-height: 1.3; }
.email-root {
  width: 100%;
  max-width: 100%;
  margin: 0 auto;
  padding: 16px 18px 24px;
  overflow-x: hidden;
}
.email-scale {
  transform-origin: top left;
}
@media (max-width: 640px) {
  .email-root {
    padding: 12px 14px 20px;
  }
  table {
    display: block;
    overflow-x: auto;
  }
}
</style>
</head>
<body>
  <div class="email-root">
    <div class="email-scale" id="email-scale">
      ${safeEmailBody}
    </div>
  </div>
</body>
</html>`

  if (!email) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 text-[14px]">
        选择一封邮件查看详情
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Email header */}
      <div className="border-b border-slate-200/50 bg-white/40 px-3 py-3 sm:px-5 sm:py-4">
        <h2 className="mb-2 text-[15px] font-semibold text-slate-800 sm:text-[16px]">
          {email.subject || '(无主题)'}
        </h2>
        <div className="flex flex-col gap-1 text-[12px] text-slate-500 sm:flex-row sm:items-center sm:gap-3 sm:text-[13px]">
          <span className="min-w-0 break-all">
            <span className="text-slate-700 font-medium">
              {email.from_name || '未知'}
            </span>{' '}
            &lt;{email.from_address}&gt;
          </span>
          <span className="hidden text-slate-300 sm:inline">|</span>
          <span className="text-[12px] text-slate-400 sm:text-[13px]">
            {formatTime(email.received_time)}
          </span>
        </div>
      </div>

      {/* Email body iframe */}
      <div className="flex-1 overflow-auto">
        <iframe
          title="email-content"
          className="w-full h-full border-0"
          referrerPolicy="no-referrer"
          sandbox="allow-popups"
          srcDoc={htmlContent}
        />
      </div>
    </div>
  )
}
