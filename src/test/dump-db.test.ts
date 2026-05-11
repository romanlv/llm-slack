import { describe, expect, it } from 'vitest'

import { db } from '@/features/chat/database'
import { dumpDb } from '@/test/dump-db'

describe('dumpDb', () => {
  it('returns deterministic, sorted output for the same DB state', async () => {
    await db.parentChats.add({
      id: 'p2',
      title: 'B',
      model: null,
      createdAt: 2,
      updatedAt: 2,
      draft: '',
      lastActivityPreview: '',
    })
    await db.parentChats.add({
      id: 'p1',
      title: 'A',
      model: null,
      createdAt: 1,
      updatedAt: 1,
      draft: '',
      lastActivityPreview: '',
    })

    const first = await dumpDb(db, { tables: ['parentChats'] })
    const second = await dumpDb(db, { tables: ['parentChats'] })
    expect(first).toBe(second)
    expect(first).toContain('# parentChats (2)')
    // Keys inside each row are alphabetical, so `createdAt` precedes `id`.
    expect(first.indexOf('"createdAt"')).toBeLessThan(first.indexOf('"id"'))
  })

  it('renders an empty table as a header with a zero count', async () => {
    const output = await dumpDb(db, { tables: ['providers'] })
    expect(output).toBe('# providers (0)')
  })

  it('sorts tables alphabetically when no filter is given', async () => {
    const output = await dumpDb(db)
    const headers = output
      .split('\n')
      .filter((line) => line.startsWith('# '))
      .map((line) => line.slice(2).split(' ')[0])
    const sorted = headers.slice().sort()
    expect(headers).toEqual(sorted)
  })
})
