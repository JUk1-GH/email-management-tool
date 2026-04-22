declare global {
  interface Window {
    JEMAIL_CONFIG?: { API_BASE?: string }
  }
}

function normalizeApiBase(value: string): string {
  return (value || '').replace(/\/+$/, '')
}

const runtimeConfig = window.JEMAIL_CONFIG || {}
const inferredApiBase = window.location.origin

export const API_BASE =
  normalizeApiBase(runtimeConfig.API_BASE ?? '') ||
  normalizeApiBase(inferredApiBase)
