import type { CustomGroup } from '@/types'

// ==================== groupColors ====================

export function loadGroupColors(): Record<string, string> {
  const saved = localStorage.getItem('groupColors')
  if (saved) {
    try {
      return JSON.parse(saved)
    } catch {
      return {}
    }
  }
  return {}
}

export function saveGroupColors(colors: Record<string, string>): void {
  localStorage.setItem('groupColors', JSON.stringify(colors))
}

// ==================== customGroups ====================

export function getCustomGroups(): CustomGroup[] {
  const saved = localStorage.getItem('customGroups')
  if (saved) {
    try {
      return JSON.parse(saved)
    } catch {
      return []
    }
  }
  return []
}

export function saveCustomGroup(name: string, color: string): void {
  const groups = getCustomGroups()
  if (!groups.find((g) => g.name === name)) {
    groups.push({ name, color })
    localStorage.setItem('customGroups', JSON.stringify(groups))
  }
}

export function removeCustomGroup(name: string): void {
  const groups = getCustomGroups()
  const filtered = groups.filter((g) => g.name !== name)
  localStorage.setItem('customGroups', JSON.stringify(filtered))
}
