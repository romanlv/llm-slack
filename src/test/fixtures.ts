import { db } from '@/features/chat/database'
import type {
  ChatMessage,
  ConversationThread,
  ParentChat,
} from '@/features/chat/domain'
import type { ProviderConnection } from '@/features/providers/entities'
import type { ModelRef, ProviderKind } from '@/features/providers/model-ref'

let counter = 0
const seq = (prefix: string) => `${prefix}-${(counter++).toString().padStart(4, '0')}`

export function resetFixtureCounter() {
  counter = 0
}

export interface SeedProviderOptions {
  id?: string
  kind?: ProviderKind
  label?: string
  apiKey?: string
  metadata?: Record<string, string>
  baseUrl?: string
}

export async function seedProvider(options: SeedProviderOptions = {}): Promise<ProviderConnection> {
  const now = Date.now()
  const provider: ProviderConnection = {
    id: options.id ?? seq('prov'),
    kind: options.kind ?? 'openrouter',
    label: options.label ?? 'OpenRouter',
    apiKey: options.apiKey ?? 'test-key',
    metadata: options.metadata ?? {},
    createdAt: now,
    updatedAt: now,
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
  }
  await db.providers.add(provider)
  return provider
}

export function makeModelRef(input?: Partial<ModelRef>): ModelRef {
  return {
    providerKind: input?.providerKind ?? 'openrouter',
    providerModelId: input?.providerModelId ?? seq('model'),
    ...(input?.providerId ? { providerId: input.providerId } : {}),
  }
}

export interface SeedModelDmOptions {
  id?: string
  title?: string
  model?: ModelRef | null
}

export async function seedModelDm(options: SeedModelDmOptions = {}): Promise<ParentChat> {
  const now = Date.now()
  const chat: ParentChat = {
    id: options.id ?? seq('chat'),
    title: options.title ?? 'Test chat',
    model: options.model ?? makeModelRef(),
    createdAt: now,
    updatedAt: now,
    draft: '',
    lastActivityPreview: '',
  }
  await db.parentChats.add(chat)
  return chat
}

export interface SeedMessageOptions {
  id?: string
  role?: ChatMessage['role']
  content?: string
  status?: ChatMessage['status']
  createdAt?: number
  model?: ChatMessage['model']
}

export async function seedMessageInParent(
  parentChatId: string,
  options: SeedMessageOptions = {},
): Promise<ChatMessage> {
  const message: ChatMessage = {
    id: options.id ?? seq('msg'),
    conversationType: 'parent',
    conversationId: parentChatId,
    parentChatId,
    role: options.role ?? 'user',
    content: options.content ?? 'hello',
    createdAt: options.createdAt ?? Date.now(),
    status: options.status ?? 'complete',
    directReplyCount: 0,
    ...(options.model ? { model: options.model } : {}),
  }
  await db.messages.add(message)
  return message
}

export async function seedMessageInThread(
  thread: ConversationThread,
  options: SeedMessageOptions = {},
): Promise<ChatMessage> {
  const message: ChatMessage = {
    id: options.id ?? seq('msg'),
    conversationType: 'thread',
    conversationId: thread.id,
    parentChatId: thread.parentChatId,
    role: options.role ?? 'user',
    content: options.content ?? 'hello',
    createdAt: options.createdAt ?? Date.now(),
    status: options.status ?? 'complete',
    directReplyCount: 0,
    ...(options.model ? { model: options.model } : {}),
  }
  await db.messages.add(message)
  return message
}

// NOTE: seedAgent / seedAgentDm / seedChannel will land alongside U1
// (agents table) and U5 (chatParticipants, channelSettings). They are
// intentionally absent here so they can't be called against an unsupported
// schema — adding them as throwing stubs would obscure the actual error.
