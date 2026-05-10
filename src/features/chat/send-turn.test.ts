import { beforeEach, describe, expect, it, vi } from 'vitest'

import { archiveParentChat, createParentChat, db, getOrCreateThreadForMessage } from './repository'
import { sendParentChatTurn, sendThreadTurn } from './send-turn'
import { openrouterAdapter } from '@/features/providers/adapters/openrouter'
import { upsertSingletonOpenRouter } from '@/features/providers/providers-repository'
import type { ModelRef } from '@/features/providers/model-ref'

vi.mock('@/features/providers/adapters/openrouter', async (importActual) => {
  const actual = await importActual<typeof import('@/features/providers/adapters/openrouter')>()
  return {
    ...actual,
    openrouterAdapter: {
      ...actual.openrouterAdapter,
      streamChat: vi.fn(),
    },
  }
})

const mockedStreamChat = vi.mocked(openrouterAdapter.streamChat)

const MODEL_A: ModelRef = {
  providerKind: 'openrouter',
  providerModelId: 'model-a',
}

async function seedOpenRouterProvider() {
  await upsertSingletonOpenRouter({ apiKey: 'key' })
}

beforeEach(async () => {
  mockedStreamChat.mockReset()
  await db.providers.clear()
  await db.modelOverrides.clear()
})

describe('send turn lifecycle', () => {
  it('prevents sends in archived parent chats before persisting messages', async () => {
    const parentChat = await createParentChat({ title: 'Archived', model: MODEL_A })
    await seedOpenRouterProvider()
    await archiveParentChat(parentChat.id)

    await expect(sendParentChatTurn(parentChat.id, 'hello')).rejects.toThrow(
      'Archived conversations cannot accept new sends.',
    )

    expect(mockedStreamChat).not.toHaveBeenCalled()
    await expect(db.messages.count()).resolves.toBe(0)
  })

  it('prevents sends in threads owned by archived parent chats', async () => {
    const parentChat = await createParentChat({ title: 'Archived', model: MODEL_A })
    const rootMessageId = crypto.randomUUID()
    await db.messages.add({
      id: rootMessageId,
      conversationType: 'parent',
      conversationId: parentChat.id,
      parentChatId: parentChat.id,
      role: 'user',
      content: 'root',
      createdAt: Date.now(),
      status: 'complete',
      directReplyCount: 0,
      model: parentChat.model ?? undefined,
    })
    const thread = await getOrCreateThreadForMessage(rootMessageId)
    await seedOpenRouterProvider()
    await archiveParentChat(parentChat.id)

    await expect(sendThreadTurn(thread.id, 'hello')).rejects.toThrow(
      'Archived conversations cannot accept new sends.',
    )

    expect(mockedStreamChat).not.toHaveBeenCalled()
    await expect(db.messages.where('conversationId').equals(thread.id).count()).resolves.toBe(0)
  })

  it('persists a failed parent send with a user message and errored assistant message', async () => {
    mockedStreamChat.mockRejectedValueOnce(new Error('rate limited'))
    const parentChat = await createParentChat({ title: 'Untitled chat', model: MODEL_A })
    await seedOpenRouterProvider()

    await expect(sendParentChatTurn(parentChat.id, '  Explain testing  ')).rejects.toThrow(
      'rate limited',
    )

    const messages = await db.messages
      .where('[conversationId+createdAt]')
      .between([parentChat.id, 0], [parentChat.id, Number.MAX_SAFE_INTEGER])
      .sortBy('createdAt')

    const userMessage = messages.find((message) => message.role === 'user')
    const assistantMessage = messages.find((message) => message.role === 'assistant')

    expect(messages).toHaveLength(2)
    expect(userMessage).toMatchObject({
      role: 'user',
      content: 'Explain testing',
      status: 'complete',
    })
    expect(userMessage?.model?.providerModelId).toBe('model-a')
    expect(assistantMessage).toMatchObject({
      role: 'assistant',
      content: 'Request failed: rate limited',
      status: 'error',
      error: 'rate limited',
    })
    expect(assistantMessage?.model?.providerModelId).toBe('model-a')
    await expect(db.parentChats.get(parentChat.id)).resolves.toMatchObject({
      draft: '',
      title: 'Explain testing',
      lastActivityPreview: 'Request failed: rate limited',
    })
  })
})
