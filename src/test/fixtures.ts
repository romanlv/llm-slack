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
    kind: 'dm',
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

export interface SeedAgentOptions {
  id?: string
  displayName?: string
  username?: string
  model?: ModelRef
  systemPrompt?: string
  chattiness?: import('@/features/chat/domain').ChattinessLevel
  createdAt?: number
}

export async function seedAgent(options: SeedAgentOptions = {}): Promise<import('@/features/chat/domain').Agent> {
  const now = options.createdAt ?? Date.now()
  const id = options.id ?? seq('agent')
  const agent = {
    id,
    displayName: options.displayName ?? `Agent ${counter}`,
    username: options.username ?? id.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    model: options.model ?? makeModelRef(),
    systemPrompt: options.systemPrompt ?? '',
    chattiness: options.chattiness ?? 2,
    createdAt: now,
    updatedAt: now,
  }
  await db.agents.add(agent)
  return agent
}

export interface SeedAgentDmOptions {
  id?: string
  agent: import('@/features/chat/domain').Agent
  title?: string
}

export async function seedAgentDm(options: SeedAgentDmOptions): Promise<ParentChat> {
  const now = Date.now()
  const chat: ParentChat = {
    id: options.id ?? seq('chat'),
    title: options.title ?? `DM: ${options.agent.displayName}`,
    model: options.agent.model,
    kind: 'dm',
    agentId: options.agent.id,
    createdAt: now,
    updatedAt: now,
    draft: '',
    lastActivityPreview: '',
  }
  await db.parentChats.add(chat)
  return chat
}

export interface SeedChannelParticipant {
  agent: import('@/features/chat/domain').Agent
  mode?: import('@/features/chat/domain').ParticipationMode
}

export interface SeedChannelOptions {
  id?: string
  title?: string
  participants?: SeedChannelParticipant[]
  settings?: Partial<
    Omit<import('@/features/chat/domain').ChannelSettings, 'id' | 'createdAt' | 'updatedAt'>
  >
}

export async function seedChannel(
  options: SeedChannelOptions = {},
): Promise<ParentChat> {
  const now = Date.now()
  const chat: ParentChat = {
    id: options.id ?? seq('chan'),
    title: options.title ?? 'Test channel',
    model: null,
    kind: 'channel',
    agentId: null,
    createdAt: now,
    updatedAt: now,
    draft: '',
    lastActivityPreview: '',
  }
  await db.parentChats.add(chat)

  const { addChannelParticipant, setChannelSettings } = await import(
    '@/features/chat/repository'
  )
  await setChannelSettings(chat.id, options.settings ?? {})
  for (const p of options.participants ?? []) {
    await addChannelParticipant({ chatId: chat.id, agentId: p.agent.id, mode: p.mode })
  }
  return chat
}
