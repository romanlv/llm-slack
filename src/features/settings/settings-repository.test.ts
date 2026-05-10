import { describe, expect, it } from 'vitest'

import { db } from '@/features/chat/database'

import {
  DEFAULT_SETTINGS,
  DEFAULT_USER_NAME,
  getSettings,
  normalizeUserName,
  saveSettings,
  userInitials,
} from './settings-repository'

describe('settings repository', () => {
  it('merges profile defaults into older settings rows', async () => {
    await db.settings.put({
      id: 'app',
      theme: 'paper',
      defaultModel: null,
    } as typeof DEFAULT_SETTINGS)

    await expect(getSettings()).resolves.toMatchObject({
      userName: DEFAULT_USER_NAME,
      theme: 'paper',
    })
  })

  it('normalizes saved user names and derives initials', async () => {
    await expect(saveSettings({ userName: '  Ada   Lovelace  ' })).resolves.toMatchObject({
      userName: 'Ada Lovelace',
    })

    expect(normalizeUserName('   ')).toBe(DEFAULT_USER_NAME)
    expect(userInitials('Ada Lovelace')).toBe('AL')
    expect(userInitials('Prince')).toBe('PR')
  })
})
