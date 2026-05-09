import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'

import { afterEach, beforeEach, vi } from 'vitest'

import { db } from '@/features/chat/database'

beforeEach(async () => {
  vi.restoreAllMocks()
  db.close()
  await db.delete()
  await db.open()
})

afterEach(() => {
  db.close()
})
