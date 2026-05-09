import Dexie, { type EntityTable } from 'dexie'
import { DEFAULT_OPENROUTER_MODEL } from '@/lib/openrouter-models'

export type MessageRole = 'assistant' | 'system' | 'user'
export type MessageStatus = 'complete' | 'error' | 'streaming'
export type ConversationType = 'parent' | 'thread'

export interface ParentChat {
  id: string
  title: string
  model: string
  createdAt: number
  updatedAt: number
  archivedAt?: number
  draft: string
  lastActivityPreview: string
}

export interface ConversationThread {
  id: string
  parentChatId: string
  parentThreadId?: string
  rootMessageId: string
  depth: number
  draft: string
  model: string
  createdAt: number
  updatedAt: number
}

export interface ProviderUsage {
  provider: string
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  cachedTokens?: number
  costCredits?: number
  contextWindowTokens?: number
  remainingTokens?: number
  recordedAt: number
  raw?: unknown
}

export interface ChatMessage {
  id: string
  conversationType: ConversationType
  conversationId: string
  parentChatId: string
  role: MessageRole
  content: string
  createdAt: number
  status: MessageStatus
  directReplyCount: number
  model?: string
  providerRequestId?: string
  providerUsage?: ProviderUsage
  error?: string
}

export type AppTheme = 'aubergine' | 'midnight' | 'paper'

export const APP_THEMES: ReadonlyArray<{ id: AppTheme; label: string; description: string }> = [
  {
    id: 'aubergine',
    label: 'Aubergine',
    description: 'Default Slack-flavored palette · deep plum sidebar, green send.',
  },
  {
    id: 'midnight',
    label: 'Midnight',
    description: 'Dark mode · low-light surfaces with indigo accents.',
  },
  {
    id: 'paper',
    label: 'Paper',
    description: 'Warm off-white workspace · orange accent.',
  },
]

export interface AppSettings {
  id: 'app'
  openRouterApiKey: string
  defaultModel: string
  siteUrl: string
  siteName: string
  theme: AppTheme
}

export interface ThreadAncestor {
  thread: ConversationThread
  rootMessage: ChatMessage
}

const DEFAULT_MODEL = DEFAULT_OPENROUTER_MODEL

const DEFAULT_SETTINGS: AppSettings = {
  id: 'app',
  openRouterApiKey: '',
  defaultModel: DEFAULT_MODEL,
  siteUrl: typeof window !== 'undefined' ? window.location.origin : '',
  siteName: 'Deepchat',
  theme: 'aubergine',
}

class DeepchatDatabase extends Dexie {
  parentChats!: EntityTable<ParentChat, 'id'>
  threads!: EntityTable<ConversationThread, 'id'>
  messages!: EntityTable<ChatMessage, 'id'>
  settings!: EntityTable<AppSettings, 'id'>

  constructor() {
    super('deepchat-threaded')

    this.version(1).stores({
      parentChats: 'id, createdAt, updatedAt, archivedAt',
      threads: 'id, rootMessageId, parentChatId, parentThreadId, updatedAt',
      messages:
        'id, conversationType, conversationId, parentChatId, createdAt, [conversationId+createdAt]',
      settings: 'id',
    })
  }
}

export const db = new DeepchatDatabase()

export function previewText(content: string) {
  return content.trim().replace(/\s+/g, ' ').slice(0, 140)
}

function titleFromPrompt(content: string) {
  const compact = previewText(content)
  return compact.length > 52 ? `${compact.slice(0, 49)}...` : compact
}

export async function getSettings() {
  const existing = await db.settings.get('app')
  if (existing) {
    return { ...DEFAULT_SETTINGS, ...existing }
  }

  await db.settings.put(DEFAULT_SETTINGS)
  return DEFAULT_SETTINGS
}

export async function saveSettings(updates: Partial<Omit<AppSettings, 'id'>>) {
  const current = await getSettings()
  const next: AppSettings = {
    ...current,
    ...updates,
    id: 'app',
  }

  await db.settings.put(next)
  return next
}

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

function messageToTransport(messages: ChatMessage[]) {
  return messages
    .filter((message) => {
      if (message.role === 'assistant') {
        return message.status === 'complete' && message.content.trim().length > 0
      }

      return message.content.trim().length > 0
    })
    .map((message) => ({
      role: message.role,
      content: message.content,
    }))
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
      .between([message.parentChatId, Dexie.minKey], [message.parentChatId, message.createdAt])
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
    .between([message.conversationId, Dexie.minKey], [message.conversationId, message.createdAt])
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
