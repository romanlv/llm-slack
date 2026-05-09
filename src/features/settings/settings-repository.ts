import { db } from '@/features/chat/database'
import { DEFAULT_OPENROUTER_MODEL } from '@/features/providers/openrouter-models'

export type AppTheme = 'aubergine' | 'midnight' | 'paper'

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
  openRouterApiKey: string
  defaultModel: string
  siteUrl: string
  siteName: string
  theme: AppTheme
}

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'app',
  openRouterApiKey: '',
  defaultModel: DEFAULT_OPENROUTER_MODEL,
  siteUrl: typeof window !== 'undefined' ? window.location.origin : '',
  siteName: 'Deepchat',
  theme: 'aubergine',
}

export async function getSettings() {
  const existing = await db.settings.get('app')
  if (existing) {
    return { ...DEFAULT_SETTINGS, ...existing }
  }

  await db.settings.put(DEFAULT_SETTINGS)
  return DEFAULT_SETTINGS
}

export async function saveSettings(updates: Partial<Omit<AppSettings, 'id'>>) {
  const current = await getSettings()
  const next: AppSettings = {
    ...current,
    ...updates,
    id: 'app',
  }

  await db.settings.put(next)
  return next
}
