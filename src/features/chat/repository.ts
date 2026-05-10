import Dexie from 'dexie'
import {
  messageToTransport,
  previewText,
  titleFromPrompt,
  type ChatMessage,
  type ConversationThread,
  type ConversationType,
  type MessageRole,
  type ParentChat,
  type ProviderUsage,
  type ThreadAncestor,
} from '@/features/chat/domain'
import { db } from '@/features/chat/database'
import { getSettings, type AppSettings } from '@/features/settings/settings-repository'

export {
  previewText,
  type AppSettings,
  type ChatMessage,
  type ConversationThread,
  type ConversationType,
  type MessageRole,
  type ParentChat,
  type ProviderUsage,
  type ThreadAncestor,
}

export { db }

export async function createParentChat(input?: Partial<Pick<ParentChat, 'model' | 'title'>>) {
  const settings = await getSettings()
  const now = Date.now()
  const chat: ParentChat = {
    id: crypto.randomUUID(),
    title: input?.title?.trim() || 'Untitled chat',
    model: input?.model?.trim() || settings.defaultModel,
    createdAt: now,
    updatedAt: now,
    draft: '',
    lastActivityPreview: 'Start the parent chat.',
  }

  await db.parentChats.add(chat)
  return chat
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

export async function ensureSeedParentChat() {
  const count = await db.parentChats.count()
  if (count > 0) {
    await getSettings()
    return
  }

  const parentChat = await createParentChat({ title: 'Welcome chat' })

  await db.messages.add({
    id: crypto.randomUUID(),
    conversationType: 'parent',
    conversationId: parentChat.id,
    parentChatId: parentChat.id,
    role: 'assistant',
    content:
      'Deepchat is ready. Use the parent chat for the main line of conversation, then open threads from specific messages.',
    createdAt: Date.now(),
    status: 'complete',
    directReplyCount: 0,
    model: parentChat.model,
  })

  await db.parentChats.update(parentChat.id, {
    lastActivityPreview: 'Open a thread from any message.',
    updatedAt: Date.now(),
  })
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
    updatedAt: Date.now(),
  })
}

export async function restoreParentChat(parentChatId: string) {
  await db.parentChats.update(parentChatId, {
    archivedAt: undefined,
    updatedAt: Date.now(),
  })
}

export async function deleteParentChat(parentChatId: string) {
  const threads = await db.threads.where('parentChatId').equals(parentChatId).toArray()
  const threadIds = threads.map((thread) => thread.id)

  await db.transaction('rw', db.parentChats, db.threads, db.messages, async () => {
    if (threadIds.length > 0) {
      await db.messages
        .where('conversationId')
        .anyOf(threadIds)
        .delete()
    }

    await db.messages
      .where('[conversationId+createdAt]')
      .between([parentChatId, Dexie.minKey], [parentChatId, Dexie.maxKey])
      .delete()

    await db.threads.where('parentChatId').equals(parentChatId).delete()
    await db.parentChats.delete(parentChatId)
  })
}

export async function setParentChatModel(parentChatId: string, model: string) {
  const trimmed = model.trim()
  if (!trimmed) {
    return
  }

  await db.parentChats.update(parentChatId, {
    model: trimmed,
    updatedAt: Date.now(),
  })
}

export async function setThreadModel(threadId: string, model: string) {
  const trimmed = model.trim()
  if (!trimmed) {
    return
  }

  await db.threads.update(threadId, {
    model: trimmed,
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
    throw new Error('Parent chat not found.')
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
    model: parentThread?.model ?? parentChat.model,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  await db.threads.add(thread)
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
  model: string
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
  model: string
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

  await db.transaction('rw', db.messages, db.threads, async () => {
    if (cascade.messageIds.length > 0) {
      await db.messages.bulkDelete(cascade.messageIds)
    }
    if (cascade.threadIds.length > 0) {
      await db.threads.bulkDelete(cascade.threadIds)
    }
  })

  if (owningThreadId) {
    await syncRootReplyCountForThread(owningThreadId)
  }
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
