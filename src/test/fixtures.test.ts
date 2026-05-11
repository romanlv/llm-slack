import { describe, expect, it } from 'vitest'

import { db } from '@/features/chat/database'
import {
  makeModelRef,
  resetFixtureCounter,
  seedMessageInParent,
  seedModelDm,
  seedProvider,
} from '@/test/fixtures'

describe('scenario builders', () => {
  it('seedProvider persists a row that providers queries can read back', async () => {
    const provider = await seedProvider({ apiKey: 'sk-test' })
    const rows = await db.providers.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(provider.id)
    expect(rows[0].apiKey).toBe('sk-test')
  })

  it('seedModelDm produces a chat with a sensible default model', async () => {
    resetFixtureCounter()
    const chat = await seedModelDm()
    expect(chat.model).toEqual(
      expect.objectContaining({
        providerKind: 'openrouter',
        providerModelId: expect.stringMatching(/^model-/),
      }),
    )
    const persisted = await db.parentChats.get(chat.id)
    expect(persisted?.id).toBe(chat.id)
  })

  it('seedMessageInParent links the message back to its parent chat', async () => {
    const chat = await seedModelDm()
    const message = await seedMessageInParent(chat.id, {
      role: 'user',
      content: 'first message',
    })
    const stored = await db.messages.get(message.id)
    expect(stored?.parentChatId).toBe(chat.id)
    expect(stored?.conversationType).toBe('parent')
    expect(stored?.conversationId).toBe(chat.id)
  })

  it('makeModelRef accepts overrides and falls back sensibly otherwise', () => {
    const ref = makeModelRef({ providerKind: 'anthropic', providerModelId: 'claude-x' })
    expect(ref).toEqual({ providerKind: 'anthropic', providerModelId: 'claude-x' })
  })
})
