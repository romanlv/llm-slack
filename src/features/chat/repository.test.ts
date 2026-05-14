import { describe, expect, it, vi } from 'vitest'

import type { ChatMessage, ParentChat, PinnedMessage } from './domain'
import {
  archiveParentChat,
  countStartedBranchesByParentChat,
  countStartedBranchesForParentChat,
  createParentChat,
  db,
  deleteMessage,
  deleteParentChat,
  deleteThread,
  editMessageContent,
  ensureSeedParentChat,
  findOrCreateEmptyParentChat,
  getOrCreateThreadForMessage,
  getThreadConversation,
  listPinnedMessagesForConversation,
  listPinnedMessagesForParentChat,
  listSavedMessages,
  loadConversationPanes,
  pinMessage,
  saveMessage,
  starParentChat,
  syncRootReplyCountForThread,
  toggleSavedMessage,
  togglePinnedMessage,
  toggleStarParentChat,
  unsaveMessage,
} from './repository'

const MODEL_PARENT = {
  providerKind: 'openrouter' as const,
  providerModelId: 'model-parent',
}
const MODEL_THREAD = {
  providerKind: 'openrouter' as const,
  providerModelId: 'model-thread',
}

function parentChat(overrides: Partial<ParentChat> = {}): ParentChat {
  return {
    id: 'parent-1',
    title: 'Parent',
    model: MODEL_PARENT,
    createdAt: 1,
    updatedAt: 1,
    draft: '',
    lastActivityPreview: '',
    kind: 'dm',
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
    await db.threads.update(thread.id, { model: MODEL_THREAD })
    await db.messages.update('thread-root', { conversationId: thread.id })

    const nested = await getOrCreateThreadForMessage('thread-root')

    expect(thread).toMatchObject({
      parentChatId: 'parent-1',
      parentThreadId: undefined,
      rootMessageId: 'parent-root',
      depth: 1,
      model: MODEL_PARENT,
    })
    expect(nested).toMatchObject({
      parentChatId: 'parent-1',
      parentThreadId: thread.id,
      rootMessageId: 'thread-root',
      depth: 2,
      model: MODEL_THREAD,
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

  it('skips empty agent-DMs and channels when looking for a model-DM to reuse', async () => {
    // An empty agent-DM and an empty channel must not be hijacked as
    // model-DMs — the workspace would otherwise render the agent header
    // (with no model picker) for what the user asked to be a model-DM.
    await db.parentChats.bulkAdd([
      parentChat({ id: 'agent-dm', agentId: 'a1', updatedAt: 30 }),
      parentChat({ id: 'channel-empty', kind: 'channel', updatedAt: 40 }),
    ])

    const created = await findOrCreateEmptyParentChat()

    expect(created.id).not.toBe('agent-dm')
    expect(created.id).not.toBe('channel-empty')
    expect(created.kind).toBe('dm')
    expect(created.agentId).toBeFalsy()
  })

  it('applies the supplied model to a reused empty model-DM and to a newly created one', async () => {
    const overrideModel = {
      providerId: 'p-2',
      providerKind: 'openrouter' as const,
      providerModelId: 'override-id',
    }

    await db.parentChats.add(
      parentChat({ id: 'empty', updatedAt: 10, model: MODEL_PARENT }),
    )

    const reused = await findOrCreateEmptyParentChat(overrideModel)
    expect(reused.id).toBe('empty')
    expect(reused.model).toEqual(overrideModel)
    const persisted = await db.parentChats.get('empty')
    expect(persisted?.model).toEqual(overrideModel)

    // Now fill the existing chat and confirm a fresh one is created with
    // the supplied model — the user's pre-flight pick has to stick.
    await db.messages.add(
      message({ id: 'm1', conversationId: 'empty', parentChatId: 'empty' }),
    )
    const created = await findOrCreateEmptyParentChat(overrideModel)
    expect(created.id).not.toBe('empty')
    expect(created.model).toEqual(overrideModel)
  })

  it('createAgentDm always creates a fresh agent-DM with a placeholder title', async () => {
    const { createAgent } = await import('@/features/agents/agents-repository')
    const { createAgentDm } = await import('@/features/chat/repository')
    const agent = await createAgent({
      displayName: 'Critic',
      model: { providerKind: 'openrouter', providerModelId: 'm' },
    })

    const first = await createAgentDm(agent.id)
    expect(first.kind).toBe('dm')
    expect(first.agentId).toBe(agent.id)
    // Title stays as the default placeholder so the first prompt can
    // derive a per-chat label via updateParentChatActivity.
    expect(first.title).toBe('Untitled chat')

    const second = await createAgentDm(agent.id)
    expect(second.id).not.toBe(first.id)
    expect(second.agentId).toBe(agent.id)
  })

  it('createAgentDm refuses to create a chat for a missing agent', async () => {
    const { createAgentDm } = await import('@/features/chat/repository')
    await expect(createAgentDm('ghost')).rejects.toThrow(/does not exist/)
  })

  it('channel participants + settings round-trip with strictly-monotonic sortKey', async () => {
    const { createAgent } = await import('@/features/agents/agents-repository')
    const {
      addChannelParticipant,
      getChannelSettings,
      listChannelParticipants,
      removeChannelParticipant,
      setChannelParticipantMode,
      setChannelSettings,
    } = await import('@/features/chat/repository')
    const { withFrozenClock } = await import('@/test/clock')

    const channel = await createParentChat({ kind: 'channel', title: 'launch' })
    const a = await createAgent({
      displayName: 'A',
      model: { providerKind: 'openrouter', providerModelId: 'm' },
    })
    const b = await createAgent({
      displayName: 'B',
      model: { providerKind: 'openrouter', providerModelId: 'm' },
    })

    await setChannelSettings(channel.id, { maxChainedSubTurns: 1 })
    const settings = await getChannelSettings(channel.id)
    expect(settings).toMatchObject({ maxChainedSubTurns: 1, chainFollowupMode: 'auto-decide' })

    await withFrozenClock(5000, async () => {
      const pa = await addChannelParticipant({ chatId: channel.id, agentId: a.id })
      const pb = await addChannelParticipant({
        chatId: channel.id,
        agentId: b.id,
        mode: 'mention-only',
      })
      expect(pa.sortKey).toBe(5000)
      expect(pb.sortKey).toBe(5001)
    })

    const participants = await listChannelParticipants(channel.id)
    expect(participants.map((p) => p.agentId)).toEqual([a.id, b.id])

    await setChannelParticipantMode(channel.id, a.id, 'mention-only')
    const updated = await listChannelParticipants(channel.id)
    expect(updated.find((p) => p.agentId === a.id)?.mode).toBe('mention-only')

    await removeChannelParticipant(channel.id, a.id)
    expect((await listChannelParticipants(channel.id)).map((p) => p.agentId)).toEqual([b.id])
  })

  it('rejects adding the same agent twice or adding to a DM', async () => {
    const { createAgent } = await import('@/features/agents/agents-repository')
    const { addChannelParticipant } = await import('@/features/chat/repository')

    const channel = await createParentChat({ kind: 'channel', title: 'c' })
    const agent = await createAgent({
      displayName: 'X',
      model: { providerKind: 'openrouter', providerModelId: 'm' },
    })

    await addChannelParticipant({ chatId: channel.id, agentId: agent.id })
    await expect(
      addChannelParticipant({ chatId: channel.id, agentId: agent.id }),
    ).rejects.toThrow(/already a participant/)

    const dm = await createParentChat({ kind: 'dm', title: 'dm' })
    await expect(
      addChannelParticipant({ chatId: dm.id, agentId: agent.id }),
    ).rejects.toThrow(/is not a channel/)
  })

  it('rejects creating a channel chat with agentId set', async () => {
    await expect(
      createParentChat({ kind: 'channel', title: 'x', agentId: 'ghost' }),
    ).rejects.toThrow(/agentId must be null/)
  })

  it('thread of a channel snapshots the participant set at creation time (U11)', async () => {
    const { createAgent } = await import('@/features/agents/agents-repository')
    const {
      addChannelParticipant,
      getOrCreateThreadForMessage,
      listChannelParticipants,
      removeChannelParticipant,
    } = await import('@/features/chat/repository')

    const channel = await createParentChat({ kind: 'channel', title: 'launch' })
    const a = await createAgent({
      displayName: 'A',
      model: { providerKind: 'openrouter', providerModelId: 'm' },
    })
    const b = await createAgent({
      displayName: 'B',
      model: { providerKind: 'openrouter', providerModelId: 'm' },
    })
    await addChannelParticipant({ chatId: channel.id, agentId: a.id })
    await addChannelParticipant({ chatId: channel.id, agentId: b.id })

    await db.messages.add(
      message({
        id: 'root',
        conversationId: channel.id,
        parentChatId: channel.id,
        role: 'user',
      }),
    )
    const thread = await getOrCreateThreadForMessage('root')

    const threadParticipants = await listChannelParticipants(thread.id)
    expect(threadParticipants.map((p) => p.agentId).sort()).toEqual([a.id, b.id].sort())

    // After thread creation, removing A from the parent channel does NOT
    // remove A from the thread (frozen-branch rule, R17).
    await removeChannelParticipant(channel.id, a.id)
    const stillInThread = await listChannelParticipants(thread.id)
    expect(stillInThread.map((p) => p.agentId)).toContain(a.id)
  })

  it('thread of a DM does not create participant rows', async () => {
    const {
      getOrCreateThreadForMessage,
      listChannelParticipants,
    } = await import('@/features/chat/repository')

    const dm = await createParentChat({ kind: 'dm', title: 'dm' })
    await db.messages.add(
      message({
        id: 'root-dm',
        conversationId: dm.id,
        parentChatId: dm.id,
        role: 'user',
      }),
    )
    const thread = await getOrCreateThreadForMessage('root-dm')
    expect(await listChannelParticipants(thread.id)).toHaveLength(0)
  })

  it('createChannel atomically creates the chat row, settings, and participant rows', async () => {
    const { createAgent } = await import('@/features/agents/agents-repository')
    const {
      createChannel,
      getChannelSettings,
      listChannelParticipants,
    } = await import('@/features/chat/repository')

    const a = await createAgent({
      displayName: 'A',
      model: { providerKind: 'openrouter', providerModelId: 'm' },
    })
    const b = await createAgent({
      displayName: 'B',
      model: { providerKind: 'openrouter', providerModelId: 'm' },
    })

    const channel = await createChannel({
      title: 'launch',
      participants: [
        { agentId: a.id, mode: 'auto-decide' },
        { agentId: b.id, mode: 'mention-only' },
      ],
    })

    expect(channel.kind).toBe('channel')
    expect(channel.title).toBe('launch')
    expect(channel.agentId).toBeUndefined()

    const settings = await getChannelSettings(channel.id)
    expect(settings).toBeDefined()
    expect(settings?.chainFollowupMode).toBe('auto-decide')
    expect(settings?.allowAgentThreading).toBe(true)

    const participants = await listChannelParticipants(channel.id)
    expect(participants.map((p) => p.agentId)).toEqual([a.id, b.id])
    expect(participants.map((p) => p.mode)).toEqual(['auto-decide', 'mention-only'])
    // sortKey must be strictly monotonic so listing order is stable.
    expect(participants[1]!.sortKey).toBeGreaterThan(participants[0]!.sortKey)
  })

  it('createChannel allows zero participants — the channel exists, settings exist, no participant rows', async () => {
    const { createChannel, getChannelSettings, listChannelParticipants } =
      await import('@/features/chat/repository')

    const channel = await createChannel({ title: 'empty-room' })

    expect(channel.kind).toBe('channel')
    expect(await getChannelSettings(channel.id)).toBeDefined()
    expect(await listChannelParticipants(channel.id)).toHaveLength(0)
  })

  it('createChannel defaults each participant mode to the channel default when no mode is given', async () => {
    const { createAgent } = await import('@/features/agents/agents-repository')
    const { createChannel, listChannelParticipants } = await import(
      '@/features/chat/repository'
    )

    const a = await createAgent({
      displayName: 'A',
      model: { providerKind: 'openrouter', providerModelId: 'm' },
    })

    const channel = await createChannel({
      title: 'defaults',
      participants: [{ agentId: a.id }],
    })

    const [participant] = await listChannelParticipants(channel.id)
    expect(participant?.mode).toBe('auto-decide')
  })

  it('createChannel rolls back fully when an agent id does not exist', async () => {
    const { createAgent } = await import('@/features/agents/agents-repository')
    const { createChannel, listChannelParticipants } = await import(
      '@/features/chat/repository'
    )
    const before = await db.parentChats.count()

    const a = await createAgent({
      displayName: 'A',
      model: { providerKind: 'openrouter', providerModelId: 'm' },
    })

    await expect(
      createChannel({
        title: 'bad',
        participants: [{ agentId: a.id }, { agentId: 'ghost' }],
      }),
    ).rejects.toThrow(/ghost/)

    // Transaction rolled back: no new chat, no participant row, no settings.
    await expect(db.parentChats.count()).resolves.toBe(before)
    await expect(db.channelSettings.count()).resolves.toBe(0)
    await expect(
      listChannelParticipants(''),
    ).resolves.toHaveLength(0)
  })

  it('createChannel rejects duplicate agent ids in the participant list', async () => {
    const { createAgent } = await import('@/features/agents/agents-repository')
    const { createChannel } = await import('@/features/chat/repository')
    const a = await createAgent({
      displayName: 'A',
      model: { providerKind: 'openrouter', providerModelId: 'm' },
    })

    await expect(
      createChannel({
        title: 'dupes',
        participants: [{ agentId: a.id }, { agentId: a.id }],
      }),
    ).rejects.toThrow(/twice/)
  })

  it('createChannel rejects an empty title', async () => {
    const { createChannel } = await import('@/features/chat/repository')
    await expect(createChannel({ title: '   ' })).rejects.toThrow(/required/i)
  })

  it('seeds the first conversation once when called concurrently', async () => {
    const { demoSeed } = await import('@/features/chat/demo-seed')
    await Promise.all([ensureSeedParentChat(), ensureSeedParentChat()])

    await expect(db.parentChats.count()).resolves.toBe(1)
    await expect(db.agents.count()).resolves.toBe(demoSeed.agents.length)
    const channel = await db.parentChats.toCollection().first()
    expect(channel?.kind).toBe('channel')
    expect(channel?.title).toBe(demoSeed.channel.title)

    // Parent-channel messages and any threads roll up to one total.
    const expectedMessageCount = demoSeed.messages.reduce(
      (sum, spec) => sum + 1 + (spec.thread?.length ?? 0),
      0,
    )
    await expect(db.messages.count()).resolves.toBe(expectedMessageCount)

    // Channel participants for the parent, plus a snapshot per thread.
    const threadCount = demoSeed.messages.filter((m) => m.thread?.length).length
    await expect(db.chatParticipants.count()).resolves.toBe(
      demoSeed.agents.length * (1 + threadCount),
    )
    await expect(db.threads.count()).resolves.toBe(threadCount)
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

    const pinTimestamps = vi.spyOn(Date, 'now')
    pinTimestamps.mockReturnValue(100)
    await pinMessage('root')
    pinTimestamps.mockReturnValue(200)
    await pinMessage('thread-message')

    const pins = await listPinnedMessagesForParentChat('parent-1')

    expect(pins.map((pin) => pin.messageId)).toEqual(['root', 'thread-message'])
    expect(pins.map((pin) => pin.message.content)).toEqual(['root', 'thread pin'])
  })

  it('keeps pin order stable when two messages are pinned in the same millisecond', async () => {
    await db.parentChats.add(parentChat())
    await db.messages.bulkAdd([
      message({ id: 'first', content: 'first', createdAt: 10 }),
      message({ id: 'second', content: 'second', createdAt: 20 }),
    ])

    // Both pins see the same Date.now() value — emulates rapid clicks or a
    // future "pin all" flow. sortKey must still break the tie by insertion order.
    vi.spyOn(Date, 'now').mockReturnValue(500)

    await pinMessage('first')
    await pinMessage('second')

    const pins = await listPinnedMessagesForParentChat('parent-1')
    expect(pins.map((pin) => pin.messageId)).toEqual(['first', 'second'])
    expect(pins[0].sortKey).toBeLessThan(pins[1].sortKey)
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

  it('toggles starred state on a parent chat without bumping updatedAt', async () => {
    await db.parentChats.add(parentChat({ id: 'parent-1', updatedAt: 1_000 }))

    vi.spyOn(Date, 'now').mockReturnValue(2_000)
    const first = await toggleStarParentChat('parent-1')
    expect(first).toEqual({ starred: true })
    await expect(db.parentChats.get('parent-1')).resolves.toMatchObject({
      starredAt: 2_000,
      updatedAt: 1_000,
    })

    const second = await toggleStarParentChat('parent-1')
    expect(second).toEqual({ starred: false })
    const after = await db.parentChats.get('parent-1')
    expect(after?.starredAt).toBeUndefined()
    expect(after?.updatedAt).toBe(1_000)
  })

  it('throws when toggling star on a missing chat', async () => {
    await expect(toggleStarParentChat('missing')).rejects.toThrow(/not found/i)
  })

  it('clears starredAt when archiving so archived chats do not linger in Starred', async () => {
    await db.parentChats.add(parentChat({ id: 'parent-1' }))
    await starParentChat('parent-1')
    await archiveParentChat('parent-1')

    const after = await db.parentChats.get('parent-1')
    expect(after?.archivedAt).toEqual(expect.any(Number))
    expect(after?.starredAt).toBeUndefined()
  })

  it('counts only started branches (threads that have at least one message)', async () => {
    await db.parentChats.bulkAdd([
      parentChat({ id: 'parent-1' }),
      parentChat({ id: 'parent-2' }),
    ])
    await db.messages.add(message({ id: 'root-1', conversationId: 'parent-1' }))
    await db.messages.add(
      message({ id: 'root-2', conversationId: 'parent-1', createdAt: 2 }),
    )
    const startedThread = await getOrCreateThreadForMessage('root-1')
    await getOrCreateThreadForMessage('root-2')
    await db.messages.add(
      message({
        id: 'started-1',
        conversationType: 'thread',
        conversationId: startedThread.id,
        createdAt: 3,
      }),
    )
    await syncRootReplyCountForThread(startedThread.id)

    const counts = await countStartedBranchesByParentChat()
    expect(counts.get('parent-1')).toBe(1)
    expect(counts.get('parent-2')).toBeUndefined()
    await expect(countStartedBranchesForParentChat('parent-1')).resolves.toBe(1)
    await expect(countStartedBranchesForParentChat('parent-2')).resolves.toBe(0)
  })

  it('deletes a thread, its descendants, and resets the root reply count', async () => {
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
    const nested = await getOrCreateThreadForMessage('t2')
    await db.messages.add(
      message({
        id: 'n1',
        conversationType: 'thread',
        conversationId: nested.id,
        createdAt: 40,
      }),
    )
    await syncRootReplyCountForThread(thread.id)
    await syncRootReplyCountForThread(nested.id)
    await pinMessage('t1')
    await saveMessage('n1')

    await deleteThread(thread.id)

    await expect(db.threads.get(thread.id)).resolves.toBeUndefined()
    await expect(db.threads.get(nested.id)).resolves.toBeUndefined()
    await expect(db.messages.get('t1')).resolves.toBeUndefined()
    await expect(db.messages.get('t2')).resolves.toBeUndefined()
    await expect(db.messages.get('n1')).resolves.toBeUndefined()
    await expect(db.pinnedMessages.count()).resolves.toBe(0)
    await expect(db.savedMessages.count()).resolves.toBe(0)
    // Root message lives in the parent conversation and is preserved.
    await expect(db.messages.get('root')).resolves.toMatchObject({ directReplyCount: 0 })
  })

  it('is a no-op when deleting a missing thread', async () => {
    await db.parentChats.add(parentChat())
    await expect(deleteThread('missing-thread')).resolves.toBeUndefined()
  })
})

describe('loadConversationPanes', () => {
  it('returns all-undefined when the parent chat is missing', async () => {
    const panes = await loadConversationPanes('missing-chat')

    expect(panes.rootChat).toBeUndefined()
    expect(panes.main).toBeUndefined()
    expect(panes.side).toBeUndefined()
  })

  it('returns main = root parent chat and no side when no threadId is given', async () => {
    await db.parentChats.add(parentChat())

    const panes = await loadConversationPanes('parent-1')

    expect(panes.rootChat?.id).toBe('parent-1')
    expect(panes.main).toEqual({ kind: 'parent', parentChat: expect.objectContaining({ id: 'parent-1' }) })
    expect(panes.side).toBeUndefined()
  })

  it('at depth 1 puts the root channel in main and the thread on the side', async () => {
    await db.parentChats.add(parentChat())
    await db.messages.add(message({ id: 'root', content: 'root', directReplyCount: 1 }))
    const thread = await getOrCreateThreadForMessage('root')

    const panes = await loadConversationPanes('parent-1', thread.id)

    expect(panes.main).toEqual({ kind: 'parent', parentChat: expect.objectContaining({ id: 'parent-1' }) })
    expect(panes.side).toMatchObject({
      kind: 'thread',
      thread: { id: thread.id, parentChatId: 'parent-1' },
      rootMessage: { id: 'root' },
    })
  })

  it('at depth 2 puts the parent thread in main and the focused thread on the side', async () => {
    await db.parentChats.add(parentChat())
    await db.messages.add(message({ id: 'root', content: 'root', directReplyCount: 1 }))
    const parentThread = await getOrCreateThreadForMessage('root')
    await db.messages.add(
      message({
        id: 'thread-msg',
        conversationType: 'thread',
        conversationId: parentThread.id,
        content: 'inside parent thread',
        createdAt: 2,
        directReplyCount: 1,
      }),
    )
    const childThread = await getOrCreateThreadForMessage('thread-msg')

    const panes = await loadConversationPanes('parent-1', childThread.id)

    expect(panes.main).toMatchObject({
      kind: 'thread',
      thread: { id: parentThread.id },
      rootMessage: { id: 'root' },
    })
    expect(panes.side).toMatchObject({
      kind: 'thread',
      thread: { id: childThread.id, parentThreadId: parentThread.id },
      rootMessage: { id: 'thread-msg' },
    })
  })

  it('falls back to root-as-main with no side when the requested thread is missing locally', async () => {
    await db.parentChats.add(parentChat())

    const panes = await loadConversationPanes('parent-1', 'missing-thread')

    expect(panes.main).toEqual({ kind: 'parent', parentChat: expect.objectContaining({ id: 'parent-1' }) })
    expect(panes.side).toBeUndefined()
  })

  it('falls back to root-as-main when the side thread exists but its root message is gone', async () => {
    // Defensive against a transient cascade-delete window — we should still
    // render the root channel rather than crash on a missing message.
    await db.parentChats.add(parentChat())
    await db.threads.add({
      id: 'orphan-thread',
      parentChatId: 'parent-1',
      rootMessageId: 'missing-root',
      depth: 1,
      draft: '',
      model: null,
      createdAt: 1,
      updatedAt: 1,
    })

    const panes = await loadConversationPanes('parent-1', 'orphan-thread')

    expect(panes.main).toEqual({ kind: 'parent', parentChat: expect.objectContaining({ id: 'parent-1' }) })
    expect(panes.side).toBeUndefined()
  })
})
