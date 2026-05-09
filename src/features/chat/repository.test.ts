import { describe, expect, it } from 'vitest'

import type { ChatMessage, ParentChat } from './domain'
import {
  db,
  deleteParentChat,
  getOrCreateThreadForMessage,
  getThreadConversation,
  syncRootReplyCountForThread,
} from './repository'

function parentChat(overrides: Partial<ParentChat> = {}): ParentChat {
  return {
    id: 'parent-1',
    title: 'Parent',
    model: 'model-parent',
    createdAt: 1,
    updatedAt: 1,
    draft: '',
    lastActivityPreview: '',
    ...overrides,
  }
}

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'message',
    conversationType: 'parent',
    conversationId: 'parent-1',
    parentChatId: 'parent-1',
    role: 'user',
    content: 'message',
    createdAt: 1,
    status: 'complete',
    directReplyCount: 0,
    ...overrides,
  }
}

describe('thread repository semantics', () => {
  it('creates parent and nested threads with same-parent ownership and model inheritance', async () => {
    await db.parentChats.add(parentChat())
    await db.messages.bulkAdd([
      message({ id: 'parent-root', content: 'parent root', createdAt: 10 }),
      message({ id: 'thread-root', conversationId: 'thread-1', conversationType: 'thread' }),
    ])

    const thread = await getOrCreateThreadForMessage('parent-root')
    await db.threads.update(thread.id, { model: 'model-thread' })
    await db.messages.update('thread-root', { conversationId: thread.id })

    const nested = await getOrCreateThreadForMessage('thread-root')

    expect(thread).toMatchObject({
      parentChatId: 'parent-1',
      parentThreadId: undefined,
      rootMessageId: 'parent-root',
      depth: 1,
      model: 'model-parent',
    })
    expect(nested).toMatchObject({
      parentChatId: 'parent-1',
      parentThreadId: thread.id,
      rootMessageId: 'thread-root',
      depth: 2,
      model: 'model-thread',
    })
  })

  it('assembles nested thread context only through the nested root message', async () => {
    await db.parentChats.add(parentChat())
    await db.messages.bulkAdd([
      message({ id: 'p1', content: 'parent before root', createdAt: 10 }),
      message({ id: 'p2', role: 'assistant', content: 'parent root', createdAt: 20 }),
      message({ id: 'p3', content: 'later parent message', createdAt: 30 }),
    ])

    const thread = await getOrCreateThreadForMessage('p2')
    await db.messages.bulkAdd([
      message({
        id: 't1',
        conversationType: 'thread',
        conversationId: thread.id,
        content: 'nested root',
        createdAt: 40,
      }),
      message({
        id: 't2',
        conversationType: 'thread',
        conversationId: thread.id,
        role: 'assistant',
        content: 'later thread reply',
        createdAt: 50,
      }),
    ])

    const nested = await getOrCreateThreadForMessage('t1')
    await db.messages.add(
      message({
        id: 'n1',
        conversationType: 'thread',
        conversationId: nested.id,
        content: 'nested message',
        createdAt: 60,
      }),
    )

    expect(await getThreadConversation(nested.id)).toEqual([
      { role: 'user', content: 'parent before root' },
      { role: 'assistant', content: 'parent root' },
      { role: 'user', content: 'nested root' },
      { role: 'user', content: 'nested message' },
    ])
  })

  it('counts only direct messages in the root thread', async () => {
    await db.parentChats.add(parentChat())
    await db.messages.add(message({ id: 'root', content: 'root', createdAt: 10 }))

    const thread = await getOrCreateThreadForMessage('root')
    await db.messages.bulkAdd([
      message({ id: 'direct-1', conversationType: 'thread', conversationId: thread.id }),
      message({ id: 'direct-2', conversationType: 'thread', conversationId: thread.id }),
    ])
    const nested = await getOrCreateThreadForMessage('direct-1')
    await db.messages.add(
      message({ id: 'nested-1', conversationType: 'thread', conversationId: nested.id }),
    )

    await syncRootReplyCountForThread(thread.id)

    await expect(db.messages.get('root')).resolves.toMatchObject({ directReplyCount: 2 })
  })

  it('deletes a parent chat with all owned threads and messages in one cascade', async () => {
    await db.parentChats.bulkAdd([parentChat(), parentChat({ id: 'parent-2' })])
    await db.messages.bulkAdd([
      message({ id: 'p1' }),
      message({ id: 'p2', parentChatId: 'parent-2', conversationId: 'parent-2' }),
    ])
    const thread = await getOrCreateThreadForMessage('p1')
    await db.messages.add(message({ id: 't1', conversationType: 'thread', conversationId: thread.id }))

    await deleteParentChat('parent-1')

    await expect(db.parentChats.get('parent-1')).resolves.toBeUndefined()
    await expect(db.threads.where('parentChatId').equals('parent-1').count()).resolves.toBe(0)
    await expect(db.messages.where('parentChatId').equals('parent-1').count()).resolves.toBe(0)
    await expect(db.parentChats.get('parent-2')).resolves.toBeDefined()
    await expect(db.messages.get('p2')).resolves.toBeDefined()
  })
})
