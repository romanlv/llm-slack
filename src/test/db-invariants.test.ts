import { describe, expect, it } from 'vitest'

import { db } from '@/features/chat/database'
import { InvariantViolation, assertDbInvariants } from '@/test/db-invariants'
import {
  seedMessageInParent,
  seedModelDm,
  seedProvider,
} from '@/test/fixtures'

describe('assertDbInvariants', () => {
  it('passes on a freshly seeded clean DB', async () => {
    const chat = await seedModelDm()
    await seedMessageInParent(chat.id, { content: 'hi' })
    await expect(assertDbInvariants(db)).resolves.toBeUndefined()
  })

  it('passes on an empty DB', async () => {
    await expect(assertDbInvariants(db)).resolves.toBeUndefined()
  })

  it('fails with a named violation when a message references a missing parentChat', async () => {
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

    await assertDbInvariants(db).then(
      () => {
        throw new Error('expected InvariantViolation')
      },
      (error: unknown) => {
        expect(error).toBeInstanceOf(InvariantViolation)
        const violation = error as InvariantViolation
        const rules = violation.failures.map((f) => f.rule)
        expect(rules).toContain('message.parentChatId resolves')
        expect(violation.message).toContain('orphan-msg')
      },
    )
  })

  it('fails when a thread message references a non-existent thread', async () => {
    const chat = await seedModelDm()
    await db.messages.add({
      id: 'thread-msg',
      conversationType: 'thread',
      conversationId: 'ghost-thread',
      parentChatId: chat.id,
      role: 'user',
      content: 'orphan thread',
      createdAt: 1,
      status: 'complete',
      directReplyCount: 0,
    })

    await expect(assertDbInvariants(db)).rejects.toThrow(
      /thread message.conversationId resolves/,
    )
  })

  it('fails when modelOverrides.providerId points at a missing provider', async () => {
    await db.modelOverrides.add({
      id: 'o1',
      providerId: 'ghost-provider',
      providerModelId: 'm',
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    })

    await expect(assertDbInvariants(db)).rejects.toThrow(
      /modelOverrides.providerId resolves/,
    )
  })

  it('passes when overrides reference an existing provider', async () => {
    const provider = await seedProvider()
    await db.modelOverrides.add({
      id: 'o1',
      providerId: provider.id,
      providerModelId: 'm',
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    })
    await expect(assertDbInvariants(db)).resolves.toBeUndefined()
  })
})
