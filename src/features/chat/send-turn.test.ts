import { beforeEach, describe, expect, it, vi } from 'vitest'

import { archiveParentChat, createParentChat, db, getOrCreateThreadForMessage } from './repository'
import { sendParentChatTurn, sendThreadTurn } from './send-turn'
import { saveSettings } from '@/features/settings/settings-repository'
import { sendOpenRouterChat } from '@/features/providers/openrouter'

vi.mock('@/features/providers/openrouter', () => ({
  sendOpenRouterChat: vi.fn(),
}))

const mockedSendOpenRouterChat = vi.mocked(sendOpenRouterChat)

beforeEach(() => {
  mockedSendOpenRouterChat.mockReset()
})

describe('send turn lifecycle', () => {
  it('prevents sends in archived parent chats before persisting messages', async () => {
    const parentChat = await createParentChat({ title: 'Archived', model: 'model-a' })
    await saveSettings({ openRouterApiKey: 'key' })
    await archiveParentChat(parentChat.id)

    await expect(sendParentChatTurn(parentChat.id, 'hello')).rejects.toThrow(
      'Archived parent chats cannot accept new sends.',
    )

    expect(mockedSendOpenRouterChat).not.toHaveBeenCalled()
    await expect(db.messages.count()).resolves.toBe(0)
  })

  it('prevents sends in threads owned by archived parent chats', async () => {
    const parentChat = await createParentChat({ title: 'Archived', model: 'model-a' })
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
      model: parentChat.model,
    })
    const thread = await getOrCreateThreadForMessage(rootMessageId)
    await saveSettings({ openRouterApiKey: 'key' })
    await archiveParentChat(parentChat.id)

    await expect(sendThreadTurn(thread.id, 'hello')).rejects.toThrow(
      'Archived parent chats cannot accept new sends.',
    )

    expect(mockedSendOpenRouterChat).not.toHaveBeenCalled()
    await expect(db.messages.where('conversationId').equals(thread.id).count()).resolves.toBe(0)
  })

  it('persists a failed parent send with a user message and errored assistant message', async () => {
    mockedSendOpenRouterChat.mockRejectedValueOnce(new Error('rate limited'))
    const parentChat = await createParentChat({ title: 'Untitled chat', model: 'model-a' })
    await saveSettings({ openRouterApiKey: 'key' })

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
      model: 'model-a',
    })
    expect(assistantMessage).toMatchObject({
      role: 'assistant',
      content: 'Request failed: rate limited',
      status: 'error',
      error: 'rate limited',
      model: 'model-a',
    })
    await expect(db.parentChats.get(parentChat.id)).resolves.toMatchObject({
      draft: '',
      title: 'Explain testing',
      lastActivityPreview: 'Request failed: rate limited',
    })
  })
})
