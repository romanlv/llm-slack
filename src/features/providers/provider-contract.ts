export type ChatProviderMessage = {
  role: 'assistant' | 'system' | 'user'
  content: string
}

export type ChatProviderUsage = {
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

export type StreamChatCompletionInput = {
  apiKey: string
  model: string
  messages: ChatProviderMessage[]
  siteName?: string
  siteUrl?: string
  onChunk: (chunk: string) => void
  onMessageId?: (id: string) => void
}

export type StreamChatCompletionResult = {
  content: string
  id: string
  usage?: ChatProviderUsage
}
