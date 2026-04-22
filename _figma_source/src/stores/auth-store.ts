import { create } from 'zustand'
import {
  fetchCurrentUser,
  getStoredAuthToken,
  loginWithEmail,
  logoutCurrentUser,
  registerWithEmail,
  setStoredAuthToken,
} from '@/lib/api'
import type { AuthResponse, AuthUser, CloudSummary, UserProfile } from '@/types'

type AuthStatus = 'loading' | 'anonymous' | 'authenticated'

function applyAuthState(
  payload: AuthResponse,
  tokenOverride?: string
): Pick<AuthState, 'status' | 'token' | 'user' | 'profile' | 'cloudSummary' | 'error'> {
  const token = tokenOverride || payload.token || getStoredAuthToken()
  return {
    status: payload.user ? 'authenticated' : 'anonymous',
    token,
    user: payload.user || null,
    profile: payload.profile || null,
    cloudSummary: payload.cloud_summary || null,
    error: '',
  }
}

interface AuthState {
  initialized: boolean
  authenticating: boolean
  status: AuthStatus
  token: string
  user: AuthUser | null
  profile: UserProfile | null
  cloudSummary: CloudSummary | null
  error: string

  init: () => Promise<void>
  refreshMe: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, displayName?: string) => Promise<void>
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  initialized: false,
  authenticating: false,
  status: 'loading',
  token: '',
  user: null,
  profile: null,
  cloudSummary: null,
  error: '',

  init: async () => {
    const token = getStoredAuthToken()
    if (!token) {
      set({
        initialized: true,
        authenticating: false,
        status: 'anonymous',
        token: '',
        user: null,
        profile: null,
        cloudSummary: null,
        error: '',
      })
      return
    }

    set({ status: 'loading', token, authenticating: false })

    try {
      const payload = await fetchCurrentUser()
      set({
        initialized: true,
        authenticating: false,
        ...applyAuthState(payload, token),
      })
    } catch (error) {
      setStoredAuthToken('')
      set({
        initialized: true,
        authenticating: false,
        status: 'anonymous',
        token: '',
        user: null,
        profile: null,
        cloudSummary: null,
        error: (error as Error).message,
      })
    }
  },

  refreshMe: async () => {
    const token = getStoredAuthToken()
    if (!token) {
      set({
        status: 'anonymous',
        token: '',
        user: null,
        profile: null,
        cloudSummary: null,
        error: '',
      })
      return
    }

    const payload = await fetchCurrentUser()
    set(applyAuthState(payload, token))
  },

  login: async (email, password) => {
    set({ authenticating: true, error: '' })
    try {
      const payload = await loginWithEmail(email, password)
      const token = payload.token || ''
      setStoredAuthToken(token)
      set({
        initialized: true,
        authenticating: false,
        ...applyAuthState(payload, token),
      })
    } catch (error) {
      set({
        initialized: true,
        authenticating: false,
        status: 'anonymous',
        token: '',
        user: null,
        profile: null,
        cloudSummary: null,
        error: (error as Error).message,
      })
      throw error
    }
  },

  register: async (email, password, displayName = '') => {
    set({ authenticating: true, error: '' })
    try {
      const payload = await registerWithEmail(email, password, displayName)
      const token = payload.token || ''
      setStoredAuthToken(token)
      set({
        initialized: true,
        authenticating: false,
        ...applyAuthState(payload, token),
      })
    } catch (error) {
      set({
        initialized: true,
        authenticating: false,
        status: 'anonymous',
        token: '',
        user: null,
        profile: null,
        cloudSummary: null,
        error: (error as Error).message,
      })
      throw error
    }
  },

  logout: async () => {
    try {
      if (getStoredAuthToken()) {
        await logoutCurrentUser()
      }
    } finally {
      setStoredAuthToken('')
      set({
        initialized: true,
        authenticating: false,
        status: 'anonymous',
        token: '',
        user: null,
        profile: null,
        cloudSummary: null,
        error: '',
      })
    }
  },
}))
