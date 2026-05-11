import type { ModelMetadata } from '@/features/providers/entities'
import type { ProviderConnection } from '@/features/providers/entities'
import type { ModelRef, ProviderKind } from '@/features/providers/model-ref'

export type ChatMessageRole = 'assistant' | 'system' | 'user'

export interface ChatProviderMessage {
  role: ChatMessageRole
  content: string
}

export interface ChatProviderUsage {
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

export interface StreamChatInput {
  messages: ChatProviderMessage[]
  onChunk: (chunk: string) => void
  onMessageId?: (id: string) => void
  // Caller-provided cancellation signal. Adapters forward it into the
  // underlying fetch and abort the body reader when it fires. If absent,
  // adapters apply an internal connect-timeout AbortController so a hung
  // provider doesn't pin a connection forever.
  signal?: AbortSignal
}

export interface StreamChatResult {
  content: string
  id: string
  usage?: ChatProviderUsage
}

export interface CatalogEntry extends ModelMetadata {
  providerModelId: string
}

export interface ProviderAdapter {
  kind: ProviderKind
  // Whether streamChat requires a non-empty apiKey on the ProviderConnection.
  // Hosted adapters (OpenAI/Anthropic/OpenRouter) set true. Local-endpoint
  // adapters that may run unauthenticated (OpenAI-compatible against Ollama,
  // llama.cpp) set false. send-turn enforces this before dispatching.
  requiresApiKey: boolean
  bundledCatalog(): CatalogEntry[]
  streamChat(
    connection: ProviderConnection,
    model: ModelRef,
    input: StreamChatInput,
  ): Promise<StreamChatResult>
}
