import type { ModelRef } from '@/features/providers/model-ref'

export type MessageRole = 'assistant' | 'system' | 'user'
export type MessageStatus = 'complete' | 'error' | 'streaming'
export type ConversationType = 'parent' | 'thread'

export type ChatKind = 'dm' | 'channel'

export interface Agent {
  id: string
  displayName: string
  // Per-agent model is mandatory — agents are addressable participants and
  // the orchestrator needs a model to call. Null at the row level would
  // require every call site to fall back to the chat's model, which only
  // makes sense for model-DMs (no agent).
  model: ModelRef
  systemPrompt: string
  createdAt: number
  updatedAt: number
}

export interface ParentChat {
  id: string
  title: string
  model: ModelRef | null
  // 'dm' covers today's model-DMs and the U3 agent-DM shape; 'channel' is
  // U5+. Legacy rows are backfilled to 'dm' in the v6 upgrade.
  kind: ChatKind
  // Set only for agent-DMs (kind='dm' with a configured agent). Null for
  // model-DMs and channels. R1 invariant: must be null when kind='channel'.
  agentId?: string | null
  createdAt: number
  updatedAt: number
  archivedAt?: number
  starredAt?: number
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
  model: ModelRef | null
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

// Snapshot of an agent's display-relevant identity at the time the message
// was authored. Mirrors the ModelRef snapshot pattern — if the agent
// definition is later deleted or renamed, history stays renderable.
export interface AgentMessageSnapshot {
  displayName: string
  model: ModelRef
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
  model?: ModelRef
  // Set only for assistant messages authored by an agent (agent-DM or
  // channel). Null/absent on model-DM messages.
  agentId?: string | null
  agentSnapshot?: AgentMessageSnapshot
  providerRequestId?: string
  providerUsage?: ProviderUsage
  error?: string
  editedAt?: number
}

export interface PinnedMessage {
  id: string
  parentChatId: string
  conversationType: ConversationType
  conversationId: string
  messageId: string
  messageRevisionId?: string
  pinnedAt: number
  sortKey: number
  note?: string
}

export interface SavedMessage {
  id: string
  parentChatId: string
  conversationType: ConversationType
  conversationId: string
  messageId: string
  messageRevisionId?: string
  createdAt: number
  note?: string
}

export interface ThreadAncestor {
  thread: ConversationThread
  rootMessage: ChatMessage
}

export function previewText(content: string) {
  return stripMarkdown(content).trim().replace(/\s+/g, ' ').slice(0, 140)
}

function stripMarkdown(content: string) {
  return content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
}

export function titleFromPrompt(content: string) {
  const compact = previewText(content)
  return compact.length > 52 ? `${compact.slice(0, 49)}...` : compact
}

export function messageToTransport(messages: ChatMessage[]) {
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
