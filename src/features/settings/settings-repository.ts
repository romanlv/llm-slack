import { db } from '@/features/chat/database'
import type { ModelRef } from '@/features/providers/model-ref'

export type AppTheme = 'aubergine' | 'midnight' | 'paper'

export const DEFAULT_USER_NAME = 'Local User'

export const APP_THEMES: ReadonlyArray<{ id: AppTheme; label: string; description: string }> = [
  {
    id: 'aubergine',
    label: 'Aubergine',
    description: 'Default Slack-flavored palette · deep plum sidebar, green send.',
  },
  {
    id: 'midnight',
    label: 'Midnight',
    description: 'Dark mode · low-light surfaces with indigo accents.',
  },
  {
    id: 'paper',
    label: 'Paper',
    description: 'Warm off-white workspace · orange accent.',
  },
]

export interface AppSettings {
  id: 'app'
  userName: string
  avatarDataUrl?: string
  defaultModel: ModelRef | null
  theme: AppTheme
  onboardedAt?: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'app',
  userName: DEFAULT_USER_NAME,
  defaultModel: null,
  theme: 'aubergine',
}

export function normalizeUserName(userName: string) {
  const compact = userName.trim().replace(/\s+/g, ' ')
  return compact || DEFAULT_USER_NAME
}

export function userInitials(userName: string) {
  const normalized = normalizeUserName(userName)
  const parts = normalized.split(' ')

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase()
  }

  return `${parts[0][0] ?? ''}${parts.at(-1)?.[0] ?? ''}`.toUpperCase()
}

export async function getSettings() {
  const existing = await db.settings.get('app')
  if (existing) {
    return { ...DEFAULT_SETTINGS, ...existing }
  }

  return DEFAULT_SETTINGS
}

export async function saveSettings(updates: Partial<Omit<AppSettings, 'id'>>) {
  const current = await getSettings()
  const next: AppSettings = {
    ...current,
    ...updates,
    id: 'app',
  }
  next.userName = normalizeUserName(next.userName)

  await db.settings.put(next)
  return next
}
