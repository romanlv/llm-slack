import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'

import { afterEach, beforeEach, vi } from 'vitest'

import { db } from '@/features/chat/database'
import { dumpDb } from '@/test/dump-db'

beforeEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  db.close()
  await db.delete()
  await db.open()
})

afterEach(async (ctx) => {
  // On test failure, dump the DB state to help diagnose. Best-effort: if the
  // DB has already been closed or destroyed by the test body, swallow the
  // error — the surfaced failure already carries the primary signal.
  if (ctx.task.result?.state === 'fail' && db.isOpen()) {
    try {
      const snapshot = await dumpDb(db)
      console.error(`\n--- DB state for failing test "${ctx.task.name}" ---\n${snapshot}\n---`)
    } catch {
      // ignore
    }
  }
  vi.useRealTimers()
  db.close()
})
