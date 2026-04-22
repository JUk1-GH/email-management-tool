const FORBIDDEN_TAGS = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'form',
  'link',
  'meta',
  'base',
])

const URI_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction'])

function isUnsafeUri(value: string): boolean {
  const normalized = value.trim().replace(/[\u0000-\u001F\u007F\s]+/g, '').toLowerCase()
  return (
    normalized.startsWith('javascript:') ||
    normalized.startsWith('vbscript:') ||
    normalized.startsWith('data:text/html') ||
    normalized.startsWith('data:application/xhtml')
  )
}

export function sanitizeEmailHtml(rawHtml: string): string {
  const parser = new DOMParser()
  const doc = parser.parseFromString(rawHtml || '', 'text/html')

  doc.querySelectorAll('*').forEach((element) => {
    const tagName = element.tagName.toLowerCase()
    if (FORBIDDEN_TAGS.has(tagName)) {
      element.remove()
      return
    }

    for (const attr of Array.from(element.attributes)) {
      const attrName = attr.name.toLowerCase()
      const attrValue = attr.value || ''

      if (
        attrName.startsWith('on') ||
        attrName === 'srcdoc' ||
        attrName === 'http-equiv' ||
        URI_ATTRS.has(attrName) && isUnsafeUri(attrValue)
      ) {
        element.removeAttribute(attr.name)
      }
    }

    if (tagName === 'a') {
      element.setAttribute('target', '_blank')
      element.setAttribute('rel', 'noopener noreferrer nofollow')
    }
  })

  return doc.body.innerHTML
}
