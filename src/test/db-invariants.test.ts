import { describe, expect, it } from 'vitest'

import { db } from '@/features/chat/database'
import { InvariantViolation, assertDbInvariants } from '@/test/db-invariants'
import { seedMessageInParent, seedModelDm } from '@/test/fixtures'

describe('assertDbInvariants', () => {
  it('passes on a seeded clean DB', async () => {
    const chat = await seedModelDm()
    await seedMessageInParent(chat.id, { content: 'hi' })
    await expect(assertDbInvariants(db)).resolves.toBeUndefined()
  })

  it('reports a named violation when a message references a missing parentChat', async () => {
    await db.messages.add({
      id: 'orphan-msg',
      conversationType: 'parent',
      conversationId: 'ghost-chat',
      parentChatId: 'ghost-chat',
      role: 'user',
      content: 'orphan',
      createdAt: 1,
      status: 'complete',
      directReplyCount: 0,
    })

    await expect(assertDbInvariants(db)).rejects.toThrow(
      /message.parentChatId resolves/,
    )
    // The thrown error is the structured InvariantViolation type so callers
    // can introspect failures, not just match the message string.
    await assertDbInvariants(db).catch((error: unknown) => {
      expect(error).toBeInstanceOf(InvariantViolation)
    })
  })
})
