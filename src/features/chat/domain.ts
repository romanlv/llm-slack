import type { ModelRef } from '@/features/providers/model-ref'

export type MessageRole = 'assistant' | 'system' | 'user'
export type MessageStatus = 'complete' | 'error' | 'streaming'
export type ConversationType = 'parent' | 'thread'

export type ChatKind = 'dm' | 'channel'

// Per-agent dial governing how readily the agent volunteers when not
// directly addressed. 1=wallflower, 5=eager. Maps to a prompt fragment in
// defaults.ts that's injected into the channel decide-to-respond prefix.
// Ignored for agent-DMs (always asked) and for mention-only candidates
// (never see the decide prefix).
export type ChattinessLevel = 1 | 2 | 3 | 4 | 5

export interface Agent {
  id: string
  displayName: string
  // Short, unique handle used to @-mention the agent in chat. Lowercased,
  // [a-z0-9_-]+; uniqueness is enforced by the agents store's &username
  // index (DB v9+).
  username: string
  // Per-agent model is mandatory — agents are addressable participants and
  // the orchestrator needs a model to call. Null at the row level would
  // require every call site to fall back to the chat's model, which only
  // makes sense for model-DMs (no agent).
  model: ModelRef
  systemPrompt: string
  chattiness: ChattinessLevel
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

export type ParticipationMode = 'auto-decide' | 'mention-only'

// Per-channel rule governing whether an agent's reply may itself trigger
// further agent replies in the same user-initiated turn. 'none' caps the
// turn at the first round of agent responses, 'mentions-only' lets agents
// follow up only when explicitly @-mentioned in a prior reply, and
// 'auto-decide' opens the full decide-to-respond loop for follow-ups.
export type ChainFollowupMode = 'none' | 'mentions-only' | 'auto-decide'

// Per-channel-per-agent participation row. chatId points to a parentChats
// row with kind='channel' in U5; U11 extends this to also accept threads.id.
export interface ChannelParticipant {
  id: string
  chatId: string
  agentId: string
  mode: ParticipationMode
  // Strictly-monotonic per chatId so listing has a stable order even when
  // two adds happen in the same millisecond.
  sortKey: number
  createdAt: number
}

export interface ChannelSettings {
  id: string // === chatId
  // Free-text room topic. Shown in the channel header and injected as
  // <description> in the channel transport prompt. Empty by default.
  description: string
  // Channel-wide house rules. Injected as <house_rules> in the channel
  // transport prompt. Distinct from a per-agent systemPrompt — applies to
  // every participant in the room. Empty by default.
  systemPrompt: string
  maxChainedSubTurns: number
  // Whether agent replies may themselves trigger further agent replies in
  // the same turn. See ChainFollowupMode for the semantics.
  chainFollowupMode: ChainFollowupMode
  maxMessagesPerAgentPerInput: number
  tokenBudgetPerInput: number
  // Slack-like behavior is the v0 default; channel owners can disable to
  // keep replies pinned to the main timeline (R14e).
  allowAgentThreading: boolean
  createdAt: number
  updatedAt: number
}


// Turn lifecycle (U6+). A turn is one user-initiated send; it may produce
// one attempt (DM) or many (channel fan-out). Stop reasons:
//   complete       — every candidate that could speak did, or the single
//                    attempt finished.
//   no-trigger     — a step yielded zero messages (every candidate stayed
//                    silent, or no candidates remained).
//   cap-hit        — orchestrator stopped because a safety cap fired
//                    (max chained sub-turns, max per-agent messages,
//                    token budget).
//   user-interrupt — the user cancelled mid-stream.
//   error          — every in-flight attempt errored without recovery.
export type StopReason = 'complete' | 'no-trigger' | 'cap-hit' | 'user-interrupt' | 'error'
export type TurnStatus = 'active' | 'closed'

export interface Turn {
  id: string
  parentChatId: string
  conversationType: ConversationType
  conversationId: string
  status: TurnStatus
  userMessageId: string
  stopReason?: StopReason
  createdAt: number
  updatedAt: number
}

export type ProviderAttemptStatus =
  | 'pending'
  | 'streaming'
  | 'complete'
  | 'cancelled'
  | 'error'
  | 'decided-silent'

export interface ProviderRequestAttempt {
  id: string
  turnId: string
  assistantMessageId: string
  agentId?: string
  model: ModelRef
  status: ProviderAttemptStatus
  attemptNumber: number
  providerRequestId?: string
  startedAt: number
  completedAt?: number
  errorCode?: string
  errorRetryable?: boolean
  usage?: ProviderUsage
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
