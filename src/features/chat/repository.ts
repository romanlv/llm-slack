import Dexie from 'dexie'
import {
  messageToTransport,
  previewText,
  titleFromPrompt,
  type ChannelParticipant,
  type ChatMessage,
  type ConversationThread,
  type ConversationType,
  type MessageRole,
  type ParentChat,
  type PinnedMessage,
  type ProviderUsage,
  type SavedMessage,
  type ThreadAncestor,
} from '@/features/chat/domain'
import { db } from '@/features/chat/database'
import type { ModelRef } from '@/features/providers/model-ref'
import { getSettings, type AppSettings } from '@/features/settings/settings-repository'

// Channel-shape operations live in channels-repository.ts; re-exported here
// so existing callers (which expect `from '@/features/chat/repository'`)
// keep working without a wide rewire. New callers should import directly
// from channels-repository.
export {
  addChannelParticipant,
  assertChannelChat,
  createChannel,
  getChannelSettings,
  listChannelParticipants,
  removeChannelParticipant,
  setChannelParticipantMode,
  setChannelSettings,
} from '@/features/chat/channels-repository'
export type {
  AddParticipantInput,
  CreateChannelInput,
  CreateChannelParticipantInput,
} from '@/features/chat/channels-repository'

export {
  previewText,
  type AppSettings,
  type ChatMessage,
  type ConversationThread,
  type ConversationType,
  type MessageRole,
  type ParentChat,
  type PinnedMessage,
  type ProviderUsage,
  type SavedMessage,
  type ThreadAncestor,
}

export { db }

export type PinnedMessageWithMessage = PinnedMessage & {
  message: ChatMessage
}

export type SavedMessageWithContext = SavedMessage & {
  message: ChatMessage
  parentChat: ParentChat
  thread?: ConversationThread
  threadRootMessage?: ChatMessage
}

let seedParentChatPromise: Promise<void> | null = null

export async function createParentChat(
  input?: Partial<Pick<ParentChat, 'model' | 'title' | 'kind' | 'agentId'>>,
) {
  const now = Date.now()
  const kind: ParentChat['kind'] = input?.kind ?? 'dm'
  if (kind === 'channel' && input?.agentId) {
    throw new Error('parentChats.agentId must be null when kind="channel".')
  }
  const chat: ParentChat = {
    id: crypto.randomUUID(),
    title: input?.title?.trim() || 'Untitled chat',
    model: input?.model ?? null,
    kind,
    ...(input?.agentId ? { agentId: input.agentId } : {}),
    createdAt: now,
    updatedAt: now,
    draft: '',
    lastActivityPreview: 'Start the conversation.',
  }

  await db.parentChats.add(chat)
  return chat
}

// Per-agent equivalent of findOrCreateEmptyParentChat. Returns the most
// recent non-archived agent-DM for `agentId` if one exists, otherwise
// creates a fresh one snapshotting the agent's current model.
export async function findOrCreateAgentDm(agentId: string) {
  const existing = await db.parentChats
    .where('agentId')
    .equals(agentId)
    .filter((chat) => chat.kind === 'dm' && !chat.archivedAt)
    .sortBy('updatedAt')

  if (existing.length > 0) {
    return existing[existing.length - 1]
  }

  const agent = await db.agents.get(agentId)
  if (!agent) {
    throw new Error(`Cannot create agent-DM: agent "${agentId}" does not exist.`)
  }

  return createParentChat({
    kind: 'dm',
    agentId,
    title: agent.displayName,
    model: agent.model,
  })
}

export async function findOrCreateEmptyParentChat() {
  const chats = await db.parentChats.orderBy('updatedAt').reverse().toArray()

  for (const chat of chats) {
    if (chat.archivedAt) {
      continue
    }

    const count = await db.messages
      .where('[conversationId+createdAt]')
      .between([chat.id, Dexie.minKey], [chat.id, Dexie.maxKey])
      .filter((message) => message.conversationType === 'parent')
      .count()

    if (count === 0) {
      return chat
    }
  }

  return createParentChat()
}

async function seedParentChatIfNeeded() {
  // Idempotency gate: any pre-existing parent chat (demo, user-created,
  // or imported) suppresses the seed. We never overwrite existing data.
  const count = await db.parentChats.count()
  if (count > 0) {
    await getSettings()
    return
  }

  const { createAgent } = await import('@/features/agents/agents-repository')
  const {
    createChannel,
    setChannelSettings,
  } = await import('@/features/chat/channels-repository')
  const { demoSeed } = await import('@/features/chat/demo-seed')

  // Public APIs validate input and apply current defaults, so this seed
  // automatically picks up new defaultable fields without changes here.
  const agents = await Promise.all(
    demoSeed.agents.map((spec) =>
      createAgent({
        displayName: spec.displayName,
        username: spec.username,
        model: spec.model,
        systemPrompt: spec.systemPrompt,
        chattiness: spec.chattiness,
      }),
    ),
  )
  const agentByUsername = new Map(agents.map((agent) => [agent.username, agent]))

  const channel = await createChannel({
    title: demoSeed.channel.title,
    participants: agents.map((agent) => ({ agentId: agent.id })),
  })
  await setChannelSettings(channel.id, {
    description: demoSeed.channel.description,
    systemPrompt: demoSeed.channel.systemPrompt,
  })

  // Messages are baked directly: they need precise control over
  // `agentSnapshot` and `model` so the rendered cast keeps its identity
  // even if the user later deletes or edits the seeded agents.
  // Stable, strictly-increasing timestamps come from a single counter so
  // parent and thread messages share one ordering domain.
  let nextTime = Date.now()
  const stamp = () => {
    const value = nextTime
    nextTime += 1
    return value
  }

  const buildMessage = (
    spec: { from: string; content: string },
    overrides: { conversationType: ConversationType; conversationId: string },
    directReplyCount: number,
  ): ChatMessage => {
    if (spec.from === 'user') {
      return {
        id: crypto.randomUUID(),
        conversationType: overrides.conversationType,
        conversationId: overrides.conversationId,
        parentChatId: channel.id,
        role: 'user',
        content: spec.content,
        createdAt: stamp(),
        status: 'complete',
        directReplyCount,
      }
    }
    const agent = agentByUsername.get(spec.from)
    if (!agent) {
      throw new Error(
        `demoSeed message references unknown @${spec.from}; check demo-seed.ts`,
      )
    }
    return {
      id: crypto.randomUUID(),
      conversationType: overrides.conversationType,
      conversationId: overrides.conversationId,
      parentChatId: channel.id,
      role: 'assistant',
      content: spec.content,
      createdAt: stamp(),
      status: 'complete',
      directReplyCount,
      model: agent.model,
      agentId: agent.id,
      agentSnapshot: {
        displayName: agent.displayName,
        model: agent.model,
      },
    }
  }

  // First pass: parent-channel messages. The reply count is derived from
  // the spec's nested thread length, so the chip cannot disagree with the
  // thread it points at.
  const parentMessages = demoSeed.messages.map((spec) =>
    buildMessage(
      spec,
      { conversationType: 'parent', conversationId: channel.id },
      spec.thread?.length ?? 0,
    ),
  )
  await db.messages.bulkAdd(parentMessages)

  // Second pass: any nested threads. `getOrCreateThreadForMessage` handles
  // the participant snapshot (R17) and depth bookkeeping for us.
  for (const [index, spec] of demoSeed.messages.entries()) {
    if (!spec.thread || spec.thread.length === 0) continue
    const rootMessage = parentMessages[index]!
    const thread = await getOrCreateThreadForMessage(rootMessage.id)
    const threadMessages = spec.thread.map((threadSpec) =>
      buildMessage(
        threadSpec,
        { conversationType: 'thread', conversationId: thread.id },
        0,
      ),
    )
    await db.messages.bulkAdd(threadMessages)
  }

  const lastMessage = demoSeed.messages.at(-1)
  await db.parentChats.update(channel.id, {
    lastActivityPreview: lastMessage ? previewText(lastMessage.content) : '',
    updatedAt: nextTime,
  })
}

export async function ensureSeedParentChat() {
  seedParentChatPromise ??= seedParentChatIfNeeded().finally(() => {
    seedParentChatPromise = null
  })

  return seedParentChatPromise
}

export async function renameParentChat(parentChatId: string, title: string) {
  const trimmed = title.trim()
  await db.parentChats.update(parentChatId, {
    title: trimmed || 'Untitled chat',
    updatedAt: Date.now(),
  })
}

export async function archiveParentChat(parentChatId: string) {
  await db.parentChats.update(parentChatId, {
    archivedAt: Date.now(),
    starredAt: undefined,
    updatedAt: Date.now(),
  })
}

export async function restoreParentChat(parentChatId: string) {
  await db.parentChats.update(parentChatId, {
    archivedAt: undefined,
    updatedAt: Date.now(),
  })
}

export async function starParentChat(parentChatId: string) {
  await db.parentChats.update(parentChatId, {
    starredAt: Date.now(),
  })
}

export async function unstarParentChat(parentChatId: string) {
  await db.parentChats.update(parentChatId, {
    starredAt: undefined,
  })
}

export async function toggleStarParentChat(parentChatId: string) {
  const chat = await db.parentChats.get(parentChatId)
  if (!chat) {
    throw new Error('Conversation not found.')
  }

  if (chat.starredAt) {
    await unstarParentChat(parentChatId)
    return { starred: false as const }
  }

  await starParentChat(parentChatId)
  return { starred: true as const }
}

export async function deleteParentChat(parentChatId: string) {
  const threads = await db.threads.where('parentChatId').equals(parentChatId).toArray()
  const threadIds = threads.map((thread) => thread.id)

  await db.transaction(
    'rw',
    [db.parentChats, db.threads, db.messages, db.pinnedMessages, db.savedMessages],
    async () => {
      if (threadIds.length > 0) {
        await db.messages.where('conversationId').anyOf(threadIds).delete()
      }

      await db.messages
        .where('[conversationId+createdAt]')
        .between([parentChatId, Dexie.minKey], [parentChatId, Dexie.maxKey])
        .delete()

      await db.threads.where('parentChatId').equals(parentChatId).delete()
      await db.pinnedMessages.where('parentChatId').equals(parentChatId).delete()
      await db.savedMessages.where('parentChatId').equals(parentChatId).delete()
      await db.parentChats.delete(parentChatId)
    },
  )
}

// A thread is "started" once its root message has at least one direct reply.
// Empty threads (created by clicking "branch" but never sent into) are kept in
// storage so the user can return to them via the same source message, but they
// are not counted as branches for display.
export async function countStartedBranchesByParentChat(): Promise<Map<string, number>> {
  const threads = await db.threads.toArray()
  if (threads.length === 0) {
    return new Map()
  }

  const rootIds = Array.from(new Set(threads.map((thread) => thread.rootMessageId)))
  const rootRows = await db.messages.bulkGet(rootIds)
  const replyCountByRootId = new Map<string, number>()
  for (const row of rootRows) {
    if (row) {
      replyCountByRootId.set(row.id, row.directReplyCount)
    }
  }

  return threads.reduce((map, thread) => {
    if ((replyCountByRootId.get(thread.rootMessageId) ?? 0) <= 0) {
      return map
    }
    map.set(thread.parentChatId, (map.get(thread.parentChatId) ?? 0) + 1)
    return map
  }, new Map<string, number>())
}

export async function countStartedBranchesForParentChat(parentChatId: string) {
  const threads = await db.threads.where('parentChatId').equals(parentChatId).toArray()
  if (threads.length === 0) {
    return 0
  }

  const rootRows = await db.messages.bulkGet(threads.map((thread) => thread.rootMessageId))
  return rootRows.filter((row) => row && row.directReplyCount > 0).length
}

export async function setParentChatModel(parentChatId: string, model: ModelRef | null) {
  await db.parentChats.update(parentChatId, {
    model,
    updatedAt: Date.now(),
  })
}

export async function setThreadModel(threadId: string, model: ModelRef | null) {
  await db.threads.update(threadId, {
    model,
    updatedAt: Date.now(),
  })
}

export async function saveParentDraft(parentChatId: string, draft: string) {
  await db.parentChats.update(parentChatId, { draft })
}

export async function saveThreadDraft(threadId: string, draft: string) {
  await db.threads.update(threadId, { draft, updatedAt: Date.now() })
}

export async function getOrCreateThreadForMessage(messageId: string) {
  const existing = await db.threads.where('rootMessageId').equals(messageId).first()
  if (existing) {
    return existing
  }

  const rootMessage = await db.messages.get(messageId)
  if (!rootMessage) {
    throw new Error('Root message not found.')
  }

  const parentChat = await db.parentChats.get(rootMessage.parentChatId)
  if (!parentChat) {
    throw new Error('Conversation not found.')
  }

  const parentThreadId =
    rootMessage.conversationType === 'thread' ? rootMessage.conversationId : undefined
  const parentThread = parentThreadId ? await db.threads.get(parentThreadId) : undefined

  const thread: ConversationThread = {
    id: crypto.randomUUID(),
    parentChatId: rootMessage.parentChatId,
    parentThreadId,
    rootMessageId: rootMessage.id,
    depth: parentThread ? parentThread.depth + 1 : 1,
    draft: '',
    model: parentThread?.model ?? parentChat.model ?? null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  await db.threads.add(thread)

  // U11 — thread participant snapshot. When a thread roots off a channel
  // (directly or transitively), copy the participant set + per-agent mode
  // at creation time. Later additions/removals on the channel do not
  // flow into the thread (R17 frozen-branch rule extended to participants).
  if (parentChat.kind === 'channel') {
    const sourceChatId = parentThreadId ?? rootMessage.parentChatId
    const sourceParticipants = await db.chatParticipants
      .where('chatId')
      .equals(sourceChatId)
      .sortBy('sortKey')
    if (sourceParticipants.length > 0) {
      const baseTime = Date.now()
      const snapshot: ChannelParticipant[] = sourceParticipants.map((src, index) => ({
        id: crypto.randomUUID(),
        chatId: thread.id,
        agentId: src.agentId,
        mode: src.mode,
        sortKey: baseTime + index,
        createdAt: baseTime,
      }))
      await db.chatParticipants.bulkAdd(snapshot)
    }
  }

  return thread
}

export async function getRootMessageForThread(threadId: string) {
  const thread = await db.threads.get(threadId)
  if (!thread) {
    return undefined
  }

  return db.messages.get(thread.rootMessageId)
}

export async function appendUserMessage(input: {
  conversationType: ConversationType
  conversationId: string
  parentChatId: string
  prompt: string
  model: ModelRef | undefined
}) {
  const trimmed = input.prompt.trim()
  if (!trimmed) {
    throw new Error('Prompt is empty.')
  }

  const message: ChatMessage = {
    id: crypto.randomUUID(),
    conversationType: input.conversationType,
    conversationId: input.conversationId,
    parentChatId: input.parentChatId,
    role: 'user',
    content: trimmed,
    createdAt: Date.now(),
    status: 'complete',
    directReplyCount: 0,
    model: input.model,
  }

  await db.messages.add(message)
  return message
}

export async function createAssistantMessage(input: {
  conversationType: ConversationType
  conversationId: string
  parentChatId: string
  model: ModelRef | undefined
  // Agent authorship (agent-DM and, later, channel). When agentId is set,
  // agentSnapshot must also be set so authorship survives a future delete
  // of the agent definition.
  agentId?: string
  agentSnapshot?: ChatMessage['agentSnapshot']
}) {
  const message: ChatMessage = {
    id: crypto.randomUUID(),
    conversationType: input.conversationType,
    conversationId: input.conversationId,
    parentChatId: input.parentChatId,
    role: 'assistant',
    content: '',
    createdAt: Date.now(),
    status: 'streaming',
    directReplyCount: 0,
    model: input.model,
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(input.agentSnapshot ? { agentSnapshot: input.agentSnapshot } : {}),
  }

  await db.messages.add(message)
  return message
}

export async function updateMessage(
  messageId: string,
  updates: Partial<
    Pick<
      ChatMessage,
      | 'content'
      | 'providerRequestId'
      | 'providerUsage'
      | 'status'
      | 'error'
      | 'directReplyCount'
    >
  >,
) {
  await db.messages.update(messageId, updates)
}

export async function completeMessage(
  messageId: string,
  content: string,
  providerUsage?: ProviderUsage,
) {
  await db.messages.update(messageId, {
    content,
    error: undefined,
    ...(providerUsage ? { providerUsage } : {}),
    status: 'complete',
  })
}

export async function failMessage(messageId: string, content: string, error: string) {
  await db.messages.update(messageId, {
    content,
    error,
    status: 'error',
  })
}

async function assertMessageConversationIsValid(message: ChatMessage) {
  const parentChat = await db.parentChats.get(message.parentChatId)
  if (!parentChat) {
    throw new Error('Conversation not found.')
  }

  if (message.conversationType === 'parent') {
    if (message.conversationId !== message.parentChatId) {
      throw new Error('Parent message has an invalid conversation.')
    }
    return
  }

  const thread = await db.threads.get(message.conversationId)
  if (!thread || thread.parentChatId !== message.parentChatId) {
    throw new Error('Thread message has an invalid conversation.')
  }
}

export async function pinMessage(messageId: string) {
  return db.transaction(
    'rw',
    db.parentChats,
    db.threads,
    db.messages,
    db.pinnedMessages,
    async () => {
      const message = await db.messages.get(messageId)
      if (!message) {
        throw new Error('Message not found.')
      }

      await assertMessageConversationIsValid(message)

      const existing = await db.pinnedMessages
        .where('[conversationId+messageId]')
        .equals([message.conversationId, message.id])
        .first()

      if (existing) {
        return existing
      }

      const now = Date.now()
      // sortKey must be strictly monotonic per parent chat: two pins created in
      // the same millisecond would otherwise tie, and Dexie's sortBy on equal
      // keys leaves their relative order undefined.
      const latestPin = await db.pinnedMessages
        .where('parentChatId')
        .equals(message.parentChatId)
        .reverse()
        .sortBy('sortKey')
      const sortKey = Math.max(now, (latestPin[0]?.sortKey ?? 0) + 1)
      const pin: PinnedMessage = {
        id: crypto.randomUUID(),
        parentChatId: message.parentChatId,
        conversationType: message.conversationType,
        conversationId: message.conversationId,
        messageId: message.id,
        pinnedAt: now,
        sortKey,
      }

      await db.pinnedMessages.add(pin)
      return pin
    },
  )
}

export async function togglePinnedMessage(messageId: string) {
  const message = await db.messages.get(messageId)
  if (!message) {
    throw new Error('Message not found.')
  }

  const existing = await db.pinnedMessages
    .where('[conversationId+messageId]')
    .equals([message.conversationId, message.id])
    .first()

  if (existing) {
    await db.pinnedMessages.delete(existing.id)
    return { pinned: false as const, pin: undefined }
  }

  const pin = await pinMessage(message.id)
  return { pinned: true as const, pin }
}

export async function listPinnedMessagesForConversation(conversationId: string) {
  const pins = await db.pinnedMessages
    .where('[conversationId+sortKey]')
    .between([conversationId, Dexie.minKey], [conversationId, Dexie.maxKey])
    .sortBy('sortKey')

  return hydratePinnedMessages(pins)
}

export async function listPinnedMessagesForParentChat(parentChatId: string) {
  const pins = await db.pinnedMessages.where('parentChatId').equals(parentChatId).sortBy('sortKey')

  return hydratePinnedMessages(pins)
}

async function hydratePinnedMessages(pins: PinnedMessage[]) {
  const messages = await db.messages.bulkGet(pins.map((pin) => pin.messageId))
  const messagesById = new Map(
    messages.filter((message): message is ChatMessage => Boolean(message)).map((message) => [
      message.id,
      message,
    ]),
  )

  return pins.flatMap<PinnedMessageWithMessage>((pin) => {
    const message = messagesById.get(pin.messageId)
    if (
      !message ||
      message.parentChatId !== pin.parentChatId ||
      message.conversationType !== pin.conversationType ||
      message.conversationId !== pin.conversationId
    ) {
      return []
    }

    return [{ ...pin, message }]
  })
}

export async function saveMessage(messageId: string) {
  return db.transaction(
    'rw',
    db.parentChats,
    db.threads,
    db.messages,
    db.savedMessages,
    async () => {
      const message = await db.messages.get(messageId)
      if (!message) {
        throw new Error('Message not found.')
      }

      await assertMessageConversationIsValid(message)

      const existing = await db.savedMessages.where('messageId').equals(message.id).first()
      if (existing) {
        return existing
      }

      const saved: SavedMessage = {
        id: crypto.randomUUID(),
        parentChatId: message.parentChatId,
        conversationType: message.conversationType,
        conversationId: message.conversationId,
        messageId: message.id,
        createdAt: Date.now(),
      }

      await db.savedMessages.add(saved)
      return saved
    },
  )
}

export async function unsaveMessage(messageId: string) {
  const existing = await db.savedMessages.where('messageId').equals(messageId).first()
  if (!existing) {
    return false
  }

  await db.savedMessages.delete(existing.id)
  return true
}

export async function toggleSavedMessage(messageId: string) {
  const existing = await db.savedMessages.where('messageId').equals(messageId).first()

  if (existing) {
    await db.savedMessages.delete(existing.id)
    return { saved: false as const, savedMessage: undefined }
  }

  const savedMessage = await saveMessage(messageId)
  return { saved: true as const, savedMessage }
}

export async function listSavedMessages(): Promise<SavedMessageWithContext[]> {
  const saved = await db.savedMessages.orderBy('createdAt').reverse().toArray()
  if (saved.length === 0) {
    return []
  }

  const messageIds = saved.map((entry) => entry.messageId)
  const parentChatIds = Array.from(new Set(saved.map((entry) => entry.parentChatId)))
  const threadIds = Array.from(
    new Set(
      saved
        .filter((entry) => entry.conversationType === 'thread')
        .map((entry) => entry.conversationId),
    ),
  )

  const [messageRows, parentChatRows, threadRows] = await Promise.all([
    db.messages.bulkGet(messageIds),
    db.parentChats.bulkGet(parentChatIds),
    db.threads.bulkGet(threadIds),
  ])

  const presentMessages = messageRows.filter(
    (entry): entry is ChatMessage => Boolean(entry),
  )
  const presentParentChats = parentChatRows.filter(
    (entry): entry is ParentChat => Boolean(entry),
  )
  const presentThreads = threadRows.filter(
    (entry): entry is ConversationThread => Boolean(entry),
  )
  const messagesById = new Map(presentMessages.map((entry) => [entry.id, entry] as const))
  const parentChatsById = new Map(
    presentParentChats.map((entry) => [entry.id, entry] as const),
  )
  const threadsById = new Map(presentThreads.map((entry) => [entry.id, entry] as const))

  const threadRootIds = Array.from(
    new Set(presentThreads.map((entry) => entry.rootMessageId)),
  )
  const threadRootRows = threadRootIds.length > 0 ? await db.messages.bulkGet(threadRootIds) : []
  const threadRootsById = new Map(
    threadRootRows
      .filter((entry): entry is ChatMessage => Boolean(entry))
      .map((entry) => [entry.id, entry] as const),
  )

  return saved.flatMap<SavedMessageWithContext>((entry) => {
    const message = messagesById.get(entry.messageId)
    const parentChat = parentChatsById.get(entry.parentChatId)
    if (
      !message ||
      !parentChat ||
      message.parentChatId !== entry.parentChatId ||
      message.conversationType !== entry.conversationType ||
      message.conversationId !== entry.conversationId
    ) {
      return []
    }

    const thread =
      entry.conversationType === 'thread' ? threadsById.get(entry.conversationId) : undefined
    const threadRootMessage = thread ? threadRootsById.get(thread.rootMessageId) : undefined

    return [{ ...entry, message, parentChat, thread, threadRootMessage }]
  })
}

export async function updateParentChatActivity(
  parentChatId: string,
  preview: string,
  titleSeed?: string,
) {
  const parentChat = await db.parentChats.get(parentChatId)
  if (!parentChat) {
    return
  }

  await db.parentChats.update(parentChatId, {
    title:
      parentChat.title === 'Untitled chat' && titleSeed
        ? titleFromPrompt(titleSeed)
        : parentChat.title,
    updatedAt: Date.now(),
    lastActivityPreview: previewText(preview),
  })
}

export async function finalizeParentChatAfterSend(
  parentChatId: string,
  prompt: string,
  response: string,
) {
  await db.parentChats.update(parentChatId, {
    draft: '',
    updatedAt: Date.now(),
  })
  await updateParentChatActivity(parentChatId, response || prompt, prompt)
}

export async function finalizeThreadAfterSend(
  threadId: string,
  parentChatId: string,
  prompt: string,
  response: string,
) {
  await db.threads.update(threadId, {
    draft: '',
    updatedAt: Date.now(),
  })
  await updateParentChatActivity(parentChatId, response || prompt, prompt)
  await syncRootReplyCountForThread(threadId)
}

export async function markParentDraftSent(parentChatId: string, prompt: string) {
  await db.parentChats.update(parentChatId, {
    draft: '',
    updatedAt: Date.now(),
    lastActivityPreview: previewText(prompt),
  })
  await updateParentChatActivity(parentChatId, prompt, prompt)
}

export async function markThreadDraftSent(threadId: string, parentChatId: string, prompt: string) {
  await db.threads.update(threadId, {
    draft: '',
    updatedAt: Date.now(),
  })
  await updateParentChatActivity(parentChatId, prompt, prompt)
  await syncRootReplyCountForThread(threadId)
}

export async function getParentConversation(parentChatId: string) {
  const messages = await db.messages
    .where('[conversationId+createdAt]')
    .between([parentChatId, Dexie.minKey], [parentChatId, Dexie.maxKey])
    .sortBy('createdAt')

  return messageToTransport(messages.filter((message) => message.conversationType === 'parent'))
}

async function getConversationUpToMessage(messageId: string): Promise<
  Array<{ role: MessageRole; content: string }>
> {
  const message = await db.messages.get(messageId)
  if (!message) {
    throw new Error('Message not found.')
  }

  if (message.conversationType === 'parent') {
    const messages = await db.messages
      .where('[conversationId+createdAt]')
      .between(
        [message.parentChatId, Dexie.minKey],
        [message.parentChatId, message.createdAt],
        true,
        true,
      )
      .sortBy('createdAt')

    return messageToTransport(messages.filter((item) => item.conversationType === 'parent'))
  }

  const parentThread = await db.threads.get(message.conversationId)
  if (!parentThread) {
    throw new Error('Thread not found.')
  }

  const inherited = await getConversationUpToMessage(parentThread.rootMessageId)
  const threadMessages = await db.messages
    .where('[conversationId+createdAt]')
    .between(
      [message.conversationId, Dexie.minKey],
      [message.conversationId, message.createdAt],
      true,
      true,
    )
    .sortBy('createdAt')

  return [
    ...inherited,
    ...messageToTransport(threadMessages.filter((item) => item.conversationType === 'thread')),
  ]
}

export async function getThreadConversation(threadId: string) {
  const thread = await db.threads.get(threadId)
  if (!thread) {
    throw new Error('Thread not found.')
  }

  const inherited = await getConversationUpToMessage(thread.rootMessageId)
  const threadMessages = await db.messages
    .where('[conversationId+createdAt]')
    .between([threadId, Dexie.minKey], [threadId, Dexie.maxKey])
    .sortBy('createdAt')

  return [
    ...inherited,
    ...messageToTransport(threadMessages.filter((message) => message.conversationType === 'thread')),
  ]
}

export async function editMessageContent(messageId: string, content: string) {
  const trimmed = content.trim()
  if (!trimmed) {
    throw new Error('Message content cannot be empty.')
  }

  const existing = await db.messages.get(messageId)
  if (!existing) {
    throw new Error('Message not found.')
  }

  if (existing.content === trimmed) {
    return existing
  }

  await db.messages.update(messageId, {
    content: trimmed,
    editedAt: Date.now(),
  })

  const updated = await db.messages.get(messageId)
  return updated
}

async function collectCascadeForMessage(messageId: string) {
  const messageIds = new Set<string>()
  const threadIds = new Set<string>()
  const queue: string[] = [messageId]

  while (queue.length > 0) {
    const current = queue.shift() as string
    if (messageIds.has(current)) {
      continue
    }
    messageIds.add(current)

    const rootedThreads = await db.threads.where('rootMessageId').equals(current).toArray()
    for (const thread of rootedThreads) {
      if (threadIds.has(thread.id)) {
        continue
      }
      threadIds.add(thread.id)

      const threadMessages = await db.messages
        .where('[conversationId+createdAt]')
        .between([thread.id, Dexie.minKey], [thread.id, Dexie.maxKey])
        .primaryKeys()

      for (const childId of threadMessages) {
        if (typeof childId === 'string') {
          queue.push(childId)
        }
      }
    }
  }

  return { messageIds: [...messageIds], threadIds: [...threadIds] }
}

export async function deleteMessage(messageId: string) {
  const target = await db.messages.get(messageId)
  if (!target) {
    return
  }

  const cascade = await collectCascadeForMessage(messageId)
  const owningThreadId =
    target.conversationType === 'thread' ? target.conversationId : undefined

  await db.transaction(
    'rw',
    db.messages,
    db.threads,
    db.pinnedMessages,
    db.savedMessages,
    async () => {
      if (cascade.messageIds.length > 0) {
        await db.messages.bulkDelete(cascade.messageIds)
        await db.pinnedMessages.where('messageId').anyOf(cascade.messageIds).delete()
        await db.savedMessages.where('messageId').anyOf(cascade.messageIds).delete()
      }
      if (cascade.threadIds.length > 0) {
        await db.threads.bulkDelete(cascade.threadIds)
      }
    },
  )

  if (owningThreadId) {
    await syncRootReplyCountForThread(owningThreadId)
  }
}

export async function deleteThread(threadId: string) {
  const thread = await db.threads.get(threadId)
  if (!thread) {
    return
  }

  const threadIdsToDelete = new Set<string>()
  const queue: string[] = [threadId]
  while (queue.length > 0) {
    const current = queue.shift() as string
    if (threadIdsToDelete.has(current)) {
      continue
    }
    threadIdsToDelete.add(current)

    const children = await db.threads.where('parentThreadId').equals(current).toArray()
    for (const child of children) {
      queue.push(child.id)
    }
  }

  const idsArray = [...threadIdsToDelete]

  await db.transaction(
    'rw',
    [db.messages, db.threads, db.pinnedMessages, db.savedMessages],
    async () => {
      // Collect message ids first so saved-entry cleanup can use the indexed
      // messageId path (savedMessages has no conversationId index).
      const messageIds = (await db.messages
        .where('conversationId')
        .anyOf(idsArray)
        .primaryKeys()) as string[]

      if (messageIds.length > 0) {
        await db.savedMessages.where('messageId').anyOf(messageIds).delete()
      }
      await db.pinnedMessages.where('conversationId').anyOf(idsArray).delete()
      await db.messages.where('conversationId').anyOf(idsArray).delete()
      await db.threads.bulkDelete(idsArray)
      // The root message lives in the parent conversation and is preserved.
      // Reset its reply count so the "N msgs" pill and branch counts update.
      await db.messages.update(thread.rootMessageId, { directReplyCount: 0 })
    },
  )
}

export async function syncRootReplyCountForThread(threadId: string) {
  const thread = await db.threads.get(threadId)
  if (!thread) {
    return
  }

  const count = await db.messages
    .where('[conversationId+createdAt]')
    .between([threadId, Dexie.minKey], [threadId, Dexie.maxKey])
    .count()

  await db.messages.update(thread.rootMessageId, { directReplyCount: count })
}

export async function getThreadAncestorChain(threadId: string) {
  const chain: ThreadAncestor[] = []
  let current = await db.threads.get(threadId)

  while (current?.parentThreadId) {
    const parent = await db.threads.get(current.parentThreadId)
    if (!parent) {
      break
    }

    const rootMessage = await db.messages.get(parent.rootMessageId)
    if (!rootMessage) {
      break
    }

    chain.unshift({
      thread: parent,
      rootMessage,
    })

    current = parent
  }

  return chain
}

// A single conversation surface — either the root parent chat, or a thread.
// Split as two named types so the side pane (which is always a thread when
// present) can be typed without needing a runtime narrowing dance.
export type ParentView = { kind: 'parent'; parentChat: ParentChat }
export type ThreadView = { kind: 'thread'; thread: ConversationThread; rootMessage: ChatMessage }
export type ConversationView = ParentView | ThreadView

export interface ConversationPanes {
  // The root parent chat is the channel context — kept available even when
  // `main` is a thread so channel-scoped chrome (sidebar, pinned, settings)
  // can still anchor to it.
  rootChat: ParentChat | undefined
  // What the main column renders. Equals `rootChat` at depth 0/1, and the
  // immediate parent thread at depth ≥ 2.
  main: ConversationView | undefined
  // What the side column renders. Always a thread when set; callers can
  // dereference `side.thread` without narrowing.
  side: ThreadView | undefined
}

// Derives "main" and "side" surfaces from a URL pair (chatId, threadId).
// Invariant: main is always the parent of side. At depth 1 that parent is
// the root channel; at depth ≥ 2 it is the immediate parent thread. When no
// threadId is supplied, side is undefined and main is the root channel.
export async function loadConversationPanes(
  chatId: string,
  threadId?: string,
): Promise<ConversationPanes> {
  const rootChat = await db.parentChats.get(chatId)
  if (!rootChat) {
    return { rootChat: undefined, main: undefined, side: undefined }
  }

  if (!threadId) {
    return {
      rootChat,
      main: { kind: 'parent', parentChat: rootChat },
      side: undefined,
    }
  }

  const sideThread = await db.threads.get(threadId)
  const sideRoot = sideThread ? await db.messages.get(sideThread.rootMessageId) : undefined
  // If either the thread or its root message is missing locally, treat the
  // side as absent and let the workspace render its "missing branch" state
  // while keeping main pointed at the channel.
  if (!sideThread || !sideRoot) {
    return {
      rootChat,
      main: { kind: 'parent', parentChat: rootChat },
      side: undefined,
    }
  }

  const side: ConversationView = {
    kind: 'thread',
    thread: sideThread,
    rootMessage: sideRoot,
  }

  if (sideThread.parentThreadId) {
    const parentThread = await db.threads.get(sideThread.parentThreadId)
    const parentThreadRoot = parentThread
      ? await db.messages.get(parentThread.rootMessageId)
      : undefined
    if (parentThread && parentThreadRoot) {
      return {
        rootChat,
        main: { kind: 'thread', thread: parentThread, rootMessage: parentThreadRoot },
        side,
      }
    }
  }

  return {
    rootChat,
    main: { kind: 'parent', parentChat: rootChat },
    side,
  }
}
