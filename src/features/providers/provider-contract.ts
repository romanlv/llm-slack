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
  bundledCatalog(): CatalogEntry[]
  streamChat(
    connection: ProviderConnection,
    model: ModelRef,
    input: StreamChatInput,
  ): Promise<StreamChatResult>
}
