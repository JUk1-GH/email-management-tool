import { useRef, useEffect } from 'react'
import { useEmailStore } from '@/stores/email-store'
import { formatTime } from '@/lib/format'

export default function EmailDetail() {
  const email = useEmailStore((s) => s.currentEmailDetail)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!email || !iframeRef.current) return

    const iframe = iframeRef.current
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
    if (!iframeDoc) return

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
</style>
</head>
<body>
  <div class="email-root">
    <div class="email-scale" id="email-scale">
      ${email.body || email.body_html || email.body_preview || ''}
    </div>
  </div>
  <script>
    (function () {
      var root = document.getElementById('email-scale');
      if (!root) return;

      function fitContent() {
        root.style.transform = 'scale(1)';
        root.style.width = 'auto';
        root.style.minWidth = '0';

        var viewportWidth = document.documentElement.clientWidth || window.innerWidth || 0;
        if (!viewportWidth) return;

        var availableWidth = Math.max(viewportWidth - 36, 320);
        var contentWidth = Math.max(root.scrollWidth, root.getBoundingClientRect().width || 0);
        if (!contentWidth || contentWidth <= availableWidth) return;

        var scale = availableWidth / contentWidth;
        if (scale >= 1) return;

        root.style.transform = 'scale(' + scale + ')';
        root.style.width = (contentWidth / scale) + 'px';
        document.body.style.minHeight = Math.ceil(root.scrollHeight * scale + 48) + 'px';
      }

      window.addEventListener('load', fitContent);
      window.addEventListener('resize', fitContent);
      setTimeout(fitContent, 0);
      setTimeout(fitContent, 80);
      setTimeout(fitContent, 300);
    })();
  </script>
</body>
</html>`

    iframeDoc.open()
    iframeDoc.write(htmlContent)
    iframeDoc.close()

    // Handle broken images
    try {
      const images = iframeDoc.querySelectorAll('img')
      images.forEach((img) => {
        const src = img.getAttribute('src') || ''
        if (
          !src ||
          src.includes('cid:') ||
          img.width === 1 ||
          img.height === 1
        ) {
          img.style.display = 'none'
        }
        img.onerror = () => {
          img.style.display = 'none'
        }
      })
    } catch {
      // Cross-origin restriction
    }
  }, [email])

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
      <div className="px-5 py-4 border-b border-slate-200/50 bg-white/40">
        <h2 className="text-[16px] font-semibold text-slate-800 mb-2">
          {email.subject || '(无主题)'}
        </h2>
        <div className="flex items-center gap-3 text-[13px] text-slate-500">
          <span>
            <span className="text-slate-700 font-medium">
              {email.from_name || '未知'}
            </span>{' '}
            &lt;{email.from_address}&gt;
          </span>
          <span className="text-slate-300">|</span>
          <span>{formatTime(email.received_time)}</span>
        </div>
      </div>

      {/* Email body iframe */}
      <div className="flex-1 overflow-auto">
        <iframe
          ref={iframeRef}
          title="email-content"
          className="w-full h-full border-0"
          sandbox="allow-same-origin"
        />
      </div>
    </div>
  )
}
