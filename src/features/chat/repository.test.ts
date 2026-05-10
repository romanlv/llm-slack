import Dexie from 'dexie'
import { describe, expect, it, vi } from 'vitest'

import type { ChatMessage, ParentChat, PinnedMessage } from './domain'
import { DeepchatDatabase } from './database'
import {
  createParentChat,
  db,
  deleteMessage,
  deleteParentChat,
  editMessageContent,
  findOrCreateEmptyParentChat,
  getOrCreateThreadForMessage,
  getThreadConversation,
  listPinnedMessagesForConversation,
  listPinnedMessagesForParentChat,
  listSavedMessages,
  pinMessage,
  saveMessage,
  syncRootReplyCountForThread,
  toggleSavedMessage,
  togglePinnedMessage,
  unsaveMessage,
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

  it('edits a message, trims content, stamps editedAt, and rejects empty input', async () => {
    await db.parentChats.add(parentChat())
    await db.messages.add(message({ id: 'm1', content: 'original', createdAt: 10 }))

    vi.spyOn(Date, 'now').mockReturnValue(987)

    const updated = await editMessageContent('m1', '   updated body   ')

    expect(updated).toMatchObject({ content: 'updated body', editedAt: 987 })
    await expect(editMessageContent('m1', '   ')).rejects.toThrow(/empty/i)
    await expect(editMessageContent('missing', 'x')).rejects.toThrow(/not found/i)

    const noOp = await editMessageContent('m1', 'updated body')
    expect(noOp?.editedAt).toBe(987)
  })

  it('cascade-deletes a thread root message along with rooted threads and their messages', async () => {
    await db.parentChats.add(parentChat())
    await db.messages.add(message({ id: 'root', content: 'root', createdAt: 10 }))
    await db.messages.add(message({ id: 'sibling', content: 'sibling', createdAt: 20 }))

    const thread = await getOrCreateThreadForMessage('root')
    await db.messages.bulkAdd([
      message({
        id: 't1',
        conversationType: 'thread',
        conversationId: thread.id,
        content: 'thread message',
        createdAt: 30,
      }),
      message({
        id: 't2',
        conversationType: 'thread',
        conversationId: thread.id,
        content: 'nested-root candidate',
        createdAt: 40,
      }),
    ])
    const nested = await getOrCreateThreadForMessage('t2')
    await db.messages.add(
      message({
        id: 'n1',
        conversationType: 'thread',
        conversationId: nested.id,
        content: 'inside nested thread',
        createdAt: 50,
      }),
    )

    await deleteMessage('root')

    await expect(db.messages.get('root')).resolves.toBeUndefined()
    await expect(db.messages.get('t1')).resolves.toBeUndefined()
    await expect(db.messages.get('t2')).resolves.toBeUndefined()
    await expect(db.messages.get('n1')).resolves.toBeUndefined()
    await expect(db.threads.get(thread.id)).resolves.toBeUndefined()
    await expect(db.threads.get(nested.id)).resolves.toBeUndefined()
    await expect(db.messages.get('sibling')).resolves.toBeDefined()
  })

  it('decrements the parent thread reply count when a message inside a thread is deleted', async () => {
    await db.parentChats.add(parentChat())
    await db.messages.add(message({ id: 'root', content: 'root', createdAt: 10 }))
    const thread = await getOrCreateThreadForMessage('root')
    await db.messages.bulkAdd([
      message({
        id: 't1',
        conversationType: 'thread',
        conversationId: thread.id,
        createdAt: 20,
      }),
      message({
        id: 't2',
        conversationType: 'thread',
        conversationId: thread.id,
        createdAt: 30,
      }),
    ])
    await syncRootReplyCountForThread(thread.id)
    await expect(db.messages.get('root')).resolves.toMatchObject({ directReplyCount: 2 })

    await deleteMessage('t1')

    await expect(db.messages.get('t1')).resolves.toBeUndefined()
    await expect(db.messages.get('root')).resolves.toMatchObject({ directReplyCount: 1 })
    await expect(db.threads.get(thread.id)).resolves.toBeDefined()
  })

  it('returns the most recent empty non-archived parent chat instead of creating another', async () => {
    await db.parentChats.bulkAdd([
      parentChat({ id: 'with-msgs', title: 'Has messages', updatedAt: 5 }),
      parentChat({ id: 'empty-old', title: 'Empty old', updatedAt: 10 }),
      parentChat({ id: 'empty-new', title: 'Empty new', updatedAt: 20 }),
      parentChat({ id: 'empty-archived', title: 'Empty archived', archivedAt: 1, updatedAt: 30 }),
    ])
    await db.messages.add(message({ id: 'm1', conversationId: 'with-msgs', parentChatId: 'with-msgs' }))

    const reused = await findOrCreateEmptyParentChat()

    expect(reused.id).toBe('empty-new')
    await expect(db.parentChats.count()).resolves.toBe(4)
  })

  it('creates a new parent chat when no empty non-archived chat exists', async () => {
    await createParentChat({ title: 'Filled' })
    const filled = (await db.parentChats.toArray())[0]
    await db.messages.add(
      message({ id: 'm1', conversationId: filled.id, parentChatId: filled.id }),
    )

    const created = await findOrCreateEmptyParentChat()

    expect(created.id).not.toBe(filled.id)
    await expect(db.parentChats.count()).resolves.toBe(2)
  })

  it('deletes a parent chat with all owned threads and messages in one cascade', async () => {
    await db.parentChats.bulkAdd([parentChat(), parentChat({ id: 'parent-2' })])
    await db.messages.bulkAdd([
      message({ id: 'p1' }),
      message({ id: 'p2', parentChatId: 'parent-2', conversationId: 'parent-2' }),
    ])
    const thread = await getOrCreateThreadForMessage('p1')
    await db.messages.add(message({ id: 't1', conversationType: 'thread', conversationId: thread.id }))
    await pinMessage('p1')
    await pinMessage('t1')

    await deleteParentChat('parent-1')

    await expect(db.parentChats.get('parent-1')).resolves.toBeUndefined()
    await expect(db.threads.where('parentChatId').equals('parent-1').count()).resolves.toBe(0)
    await expect(db.messages.where('parentChatId').equals('parent-1').count()).resolves.toBe(0)
    await expect(db.pinnedMessages.where('parentChatId').equals('parent-1').count()).resolves.toBe(0)
    await expect(db.parentChats.get('parent-2')).resolves.toBeDefined()
    await expect(db.messages.get('p2')).resolves.toBeDefined()
  })

  it('pins messages idempotently inside their own conversation', async () => {
    await db.parentChats.add(parentChat())
    await db.messages.add(message({ id: 'p1', content: 'parent message', createdAt: 10 }))
    const thread = await getOrCreateThreadForMessage('p1')
    await db.messages.add(
      message({
        id: 't1',
        conversationType: 'thread',
        conversationId: thread.id,
        content: 'thread message',
        createdAt: 20,
      }),
    )

    vi.spyOn(Date, 'now').mockReturnValue(1234)

    const firstPin = await pinMessage('p1')
    const secondPin = await pinMessage('p1')
    const threadPin = await pinMessage('t1')

    expect(secondPin.id).toBe(firstPin.id)
    expect(firstPin).toMatchObject({
      parentChatId: 'parent-1',
      conversationType: 'parent',
      conversationId: 'parent-1',
      messageId: 'p1',
      pinnedAt: 1234,
      sortKey: 1234,
    })
    expect(threadPin).toMatchObject({
      parentChatId: 'parent-1',
      conversationType: 'thread',
      conversationId: thread.id,
      messageId: 't1',
    })
    await expect(db.pinnedMessages.count()).resolves.toBe(2)
  })

  it('lists pinned messages by conversation sort order and skips orphaned pins', async () => {
    await db.parentChats.add(parentChat())
    await db.messages.bulkAdd([
      message({ id: 'p1', content: 'first', createdAt: 10 }),
      message({ id: 'p2', content: 'second', createdAt: 20 }),
    ])
    const orphan: PinnedMessage = {
      id: 'orphan-pin',
      parentChatId: 'parent-1',
      conversationType: 'parent',
      conversationId: 'parent-1',
      messageId: 'missing-message',
      pinnedAt: 5,
      sortKey: 5,
    }
    await db.pinnedMessages.bulkAdd([
      orphan,
      {
        id: 'pin-2',
        parentChatId: 'parent-1',
        conversationType: 'parent',
        conversationId: 'parent-1',
        messageId: 'p2',
        pinnedAt: 20,
        sortKey: 20,
      },
      {
        id: 'pin-1',
        parentChatId: 'parent-1',
        conversationType: 'parent',
        conversationId: 'parent-1',
        messageId: 'p1',
        pinnedAt: 10,
        sortKey: 10,
      },
    ])

    const pins = await listPinnedMessagesForConversation('parent-1')

    expect(pins.map((pin) => pin.messageId)).toEqual(['p1', 'p2'])
    expect(pins.map((pin) => pin.message.content)).toEqual(['first', 'second'])
  })

  it('lists pinned messages across every thread under a parent chat', async () => {
    await db.parentChats.add(parentChat())
    await db.messages.add(message({ id: 'root', content: 'root', createdAt: 10 }))
    const thread = await getOrCreateThreadForMessage('root')
    await db.messages.add(
      message({
        id: 'thread-message',
        conversationType: 'thread',
        conversationId: thread.id,
        content: 'thread pin',
        createdAt: 20,
      }),
    )

    vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(200)

    await pinMessage('root')
    await pinMessage('thread-message')

    const pins = await listPinnedMessagesForParentChat('parent-1')

    expect(pins.map((pin) => pin.messageId)).toEqual(['root', 'thread-message'])
    expect(pins.map((pin) => pin.message.content)).toEqual(['root', 'thread pin'])
  })

  it('toggles a pinned message off and cleans pins when messages are deleted', async () => {
    await db.parentChats.add(parentChat())
    await db.messages.add(message({ id: 'root', content: 'root', createdAt: 10 }))
    const thread = await getOrCreateThreadForMessage('root')
    await db.messages.add(
      message({
        id: 't1',
        conversationType: 'thread',
        conversationId: thread.id,
        content: 'thread message',
        createdAt: 20,
      }),
    )

    await expect(togglePinnedMessage('root')).resolves.toMatchObject({ pinned: true })
    await expect(togglePinnedMessage('root')).resolves.toMatchObject({ pinned: false })
    await expect(db.pinnedMessages.count()).resolves.toBe(0)

    await pinMessage('root')
    await pinMessage('t1')
    await deleteMessage('root')

    await expect(db.messages.get('root')).resolves.toBeUndefined()
    await expect(db.messages.get('t1')).resolves.toBeUndefined()
    await expect(db.pinnedMessages.count()).resolves.toBe(0)
  })

  it('saves a message idempotently and prevents duplicate saves across conversations', async () => {
    await db.parentChats.add(parentChat())
    await db.messages.add(message({ id: 'p1', content: 'parent message', createdAt: 10 }))
    const thread = await getOrCreateThreadForMessage('p1')
    await db.messages.add(
      message({
        id: 't1',
        conversationType: 'thread',
        conversationId: thread.id,
        content: 'thread message',
        createdAt: 20,
      }),
    )

    vi.spyOn(Date, 'now').mockReturnValue(4321)

    const first = await saveMessage('p1')
    const second = await saveMessage('p1')
    const threadSave = await saveMessage('t1')

    expect(second.id).toBe(first.id)
    expect(first).toMatchObject({
      parentChatId: 'parent-1',
      conversationType: 'parent',
      conversationId: 'parent-1',
      messageId: 'p1',
      createdAt: 4321,
    })
    expect(threadSave).toMatchObject({
      conversationType: 'thread',
      conversationId: thread.id,
      messageId: 't1',
    })
    await expect(db.savedMessages.count()).resolves.toBe(2)
  })

  it('toggles a saved message off and lists newest-first across chats', async () => {
    await db.parentChats.bulkAdd([parentChat(), parentChat({ id: 'parent-2', title: 'Other' })])
    await db.messages.bulkAdd([
      message({ id: 'p1', content: 'first', createdAt: 10 }),
      message({
        id: 'p2',
        parentChatId: 'parent-2',
        conversationId: 'parent-2',
        content: 'second',
        createdAt: 20,
      }),
    ])

    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(100)
    const firstToggle = await toggleSavedMessage('p1')
    dateNow.mockReturnValue(200)
    const secondToggle = await toggleSavedMessage('p2')

    expect(firstToggle).toMatchObject({ saved: true })
    expect(secondToggle).toMatchObject({ saved: true })

    const initial = await listSavedMessages()
    expect(initial.map((entry) => entry.messageId)).toEqual(['p2', 'p1'])
    expect(initial[0].parentChat.id).toBe('parent-2')
    expect(initial[1].parentChat.id).toBe('parent-1')

    const off = await toggleSavedMessage('p1')
    expect(off).toMatchObject({ saved: false })
    await expect(unsaveMessage('p1')).resolves.toBe(false)

    const afterToggle = await listSavedMessages()
    expect(afterToggle.map((entry) => entry.messageId)).toEqual(['p2'])
  })

  it('drops orphaned saved entries and resolves thread context', async () => {
    await db.parentChats.add(parentChat())
    await db.messages.add(message({ id: 'root', content: 'root', createdAt: 10 }))
    const thread = await getOrCreateThreadForMessage('root')
    await db.messages.add(
      message({
        id: 't1',
        conversationType: 'thread',
        conversationId: thread.id,
        content: 'inside thread',
        createdAt: 20,
      }),
    )

    await saveMessage('t1')

    await db.savedMessages.add({
      id: 'orphan',
      parentChatId: 'parent-1',
      conversationType: 'parent',
      conversationId: 'parent-1',
      messageId: 'missing',
      createdAt: 5,
    })

    const list = await listSavedMessages()
    expect(list).toHaveLength(1)
    expect(list[0].messageId).toBe('t1')
    expect(list[0].thread?.id).toBe(thread.id)
    expect(list[0].threadRootMessage?.id).toBe('root')
    expect(list[0].parentChat.id).toBe('parent-1')
  })

  it('clears saved entries when their message is deleted via cascade', async () => {
    await db.parentChats.add(parentChat())
    await db.messages.add(message({ id: 'root', content: 'root', createdAt: 10 }))
    const thread = await getOrCreateThreadForMessage('root')
    await db.messages.add(
      message({
        id: 't1',
        conversationType: 'thread',
        conversationId: thread.id,
        createdAt: 20,
      }),
    )

    await saveMessage('root')
    await saveMessage('t1')
    await expect(db.savedMessages.count()).resolves.toBe(2)

    await deleteMessage('root')

    await expect(db.savedMessages.count()).resolves.toBe(0)
  })

  it('clears saved entries scoped to a parent chat when it is deleted', async () => {
    await db.parentChats.bulkAdd([parentChat(), parentChat({ id: 'parent-2', title: 'Other' })])
    await db.messages.bulkAdd([
      message({ id: 'p1' }),
      message({ id: 'p2', parentChatId: 'parent-2', conversationId: 'parent-2' }),
    ])
    await saveMessage('p1')
    await saveMessage('p2')

    await deleteParentChat('parent-1')

    const remaining = await db.savedMessages.toArray()
    expect(remaining.map((entry) => entry.messageId)).toEqual(['p2'])
  })

  it('migrates version 1 data by adding the pinned messages table', async () => {
    const databaseName = `deepchat-migration-${crypto.randomUUID()}`

    const legacyDb = new Dexie(databaseName)
    legacyDb.version(1).stores({
      parentChats: 'id, createdAt, updatedAt, archivedAt',
      threads: 'id, rootMessageId, parentChatId, parentThreadId, updatedAt',
      messages:
        'id, conversationType, conversationId, parentChatId, createdAt, [conversationId+createdAt]',
      settings: 'id',
    })
    await legacyDb.open()
    await legacyDb.table('parentChats').add(parentChat())
    await legacyDb.table('messages').add(message({ id: 'p1' }))
    legacyDb.close()

    const migratedDb = new DeepchatDatabase(databaseName)
    await migratedDb.open()

    await expect(migratedDb.parentChats.get('parent-1')).resolves.toBeDefined()
    await expect(migratedDb.messages.get('p1')).resolves.toBeDefined()
    await expect(migratedDb.pinnedMessages.count()).resolves.toBe(0)
    await expect(migratedDb.savedMessages.count()).resolves.toBe(0)
    await migratedDb.pinnedMessages.add({
      id: 'pin-1',
      parentChatId: 'parent-1',
      conversationType: 'parent',
      conversationId: 'parent-1',
      messageId: 'p1',
      pinnedAt: 10,
      sortKey: 10,
    })
    await migratedDb.savedMessages.add({
      id: 'saved-1',
      parentChatId: 'parent-1',
      conversationType: 'parent',
      conversationId: 'parent-1',
      messageId: 'p1',
      createdAt: 11,
    })
    await expect(migratedDb.pinnedMessages.count()).resolves.toBe(1)
    await expect(migratedDb.savedMessages.count()).resolves.toBe(1)

    migratedDb.close()
    await migratedDb.delete()
  })

  it('migrates version 2 data by adding the saved messages table', async () => {
    const databaseName = `deepchat-migration-v2-${crypto.randomUUID()}`

    const legacyDb = new Dexie(databaseName)
    legacyDb.version(1).stores({
      parentChats: 'id, createdAt, updatedAt, archivedAt',
      threads: 'id, rootMessageId, parentChatId, parentThreadId, updatedAt',
      messages:
        'id, conversationType, conversationId, parentChatId, createdAt, [conversationId+createdAt]',
      settings: 'id',
    })
    legacyDb.version(2).stores({
      parentChats: 'id, createdAt, updatedAt, archivedAt',
      threads: 'id, rootMessageId, parentChatId, parentThreadId, updatedAt',
      messages:
        'id, conversationType, conversationId, parentChatId, createdAt, [conversationId+createdAt]',
      pinnedMessages:
        'id, parentChatId, conversationType, conversationId, messageId, pinnedAt, sortKey, [conversationId+sortKey], &[conversationId+messageId], [parentChatId+pinnedAt]',
      settings: 'id',
    })
    await legacyDb.open()
    await legacyDb.table('parentChats').add(parentChat())
    await legacyDb.table('messages').add(message({ id: 'p1' }))
    await legacyDb.table('pinnedMessages').add({
      id: 'pin-1',
      parentChatId: 'parent-1',
      conversationType: 'parent',
      conversationId: 'parent-1',
      messageId: 'p1',
      pinnedAt: 10,
      sortKey: 10,
    })
    legacyDb.close()

    const migratedDb = new DeepchatDatabase(databaseName)
    await migratedDb.open()

    await expect(migratedDb.pinnedMessages.count()).resolves.toBe(1)
    await expect(migratedDb.savedMessages.count()).resolves.toBe(0)
    await migratedDb.savedMessages.add({
      id: 'saved-1',
      parentChatId: 'parent-1',
      conversationType: 'parent',
      conversationId: 'parent-1',
      messageId: 'p1',
      createdAt: 99,
    })
    await expect(migratedDb.savedMessages.count()).resolves.toBe(1)

    migratedDb.close()
    await migratedDb.delete()
  })
})
