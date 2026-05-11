import type { ProviderConnection } from '@/features/providers/entities'
import type { ModelRef, ProviderKind } from '@/features/providers/model-ref'
import type {
  CatalogEntry,
  ChatProviderUsage,
  ProviderAdapter,
  StreamChatInput,
  StreamChatResult,
} from '@/features/providers/provider-contract'

import { composeSignal } from './stream-signal'

// Generic streaming client for any host that speaks the OpenAI Chat
// Completions protocol (api.openai.com, Ollama, llama.cpp server, Together,
// Groq, vLLM, …). The factory exists so the OpenAI adapter and the
// OpenAI-compatible adapter share one implementation — the only differences
// are the base URL, the bundled catalog, the usage tag, and whether an API
// key is mandatory.
export interface OpenAIChatCompletionsConfig {
  kind: ProviderKind
  // Default endpoint, anchored at /v1 (no trailing /chat/completions). Used
  // when the connection doesn't carry its own baseUrl. May be omitted for
  // adapters whose connections always specify their own host.
  defaultBaseUrl?: string
  bundled: CatalogEntry[]
  // Stamped on the normalized usage record so consumers can attribute token
  // counts to a specific provider in logs and the UI.
  usageTag: string
  requiresApiKey: boolean
}

export function createOpenAIChatCompletionsAdapter(
  config: OpenAIChatCompletionsConfig,
): ProviderAdapter {
  return {
    kind: config.kind,
    requiresApiKey: config.requiresApiKey,
    bundledCatalog: () => config.bundled,
    streamChat: (connection, model, input) =>
      streamChat(config, connection, model, input),
  }
}

type OpenAIStreamChoice = {
  delta?: { content?: unknown }
  message?: { content?: unknown }
}

type OpenAIStreamPayload = {
  id?: string
  choices?: OpenAIStreamChoice[]
  usage?: unknown
  error?: { message?: string }
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function objectValue(value: unknown) {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

function normalizeUsage(usage: unknown, usageTag: string): ChatProviderUsage | undefined {
  const data = objectValue(usage)
  if (!data) return undefined

  const completionDetails = objectValue(data.completion_tokens_details)
  const promptDetails = objectValue(data.prompt_tokens_details)
  const normalized: ChatProviderUsage = {
    provider: usageTag,
    promptTokens: numberValue(data.prompt_tokens),
    completionTokens: numberValue(data.completion_tokens),
    totalTokens: numberValue(data.total_tokens),
    reasoningTokens: numberValue(completionDetails?.reasoning_tokens),
    cachedTokens: numberValue(promptDetails?.cached_tokens),
    recordedAt: Date.now(),
    raw: usage,
  }
  return Object.values(normalized).some((value) => typeof value === 'number')
    ? normalized
    : undefined
}

function toTextContent(content: unknown) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part) {
          const text = (part as { text?: unknown }).text
          return typeof text === 'string' ? text : ''
        }
        return ''
      })
      .join('')
  }
  return ''
}

function getErrorMessage(payload: unknown, status: number, label: string) {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = (payload as { error?: { message?: unknown } }).error
    if (error && typeof error.message === 'string') return error.message
  }
  return `${label} request failed with status ${status}.`
}

// Resolves the chat-completions URL by combining (connection.baseUrl ??
// defaultBaseUrl) with the standard /chat/completions suffix. Trailing
// slashes on the base are tolerated. Adapters that require a runtime baseUrl
// (no default) throw a connection-time error here rather than letting fetch
// produce a confusing TypeError.
function resolveEndpoint(
  config: OpenAIChatCompletionsConfig,
  connection: ProviderConnection,
) {
  const base = (connection.baseUrl?.trim() || config.defaultBaseUrl)?.replace(/\/+$/, '')
  if (!base) {
    throw new Error(
      `Connection "${connection.label}" has no endpoint URL. Set one in Settings.`,
    )
  }
  return `${base}/chat/completions`
}

function buildHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const trimmed = apiKey.trim()
  if (trimmed) {
    headers.Authorization = `Bearer ${trimmed}`
  }
  return headers
}

async function streamChat(
  config: OpenAIChatCompletionsConfig,
  connection: ProviderConnection,
  model: ModelRef,
  input: StreamChatInput,
): Promise<StreamChatResult> {
  const endpoint = resolveEndpoint(config, connection)
  const { signal, disarmTimeout } = composeSignal(input.signal)
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: buildHeaders(connection.apiKey),
      body: JSON.stringify({
        model: model.providerModelId,
        messages: input.messages,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal,
    })
  } finally {
    disarmTimeout()
  }

  if (!response.ok) {
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      payload = undefined
    }
    throw new Error(getErrorMessage(payload, response.status, connection.label))
  }

  if (!response.body) {
    throw new Error(`${connection.label} returned no response body.`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''
  let requestId = ''
  let usage: ChatProviderUsage | undefined

  const onAbort = () => {
    void reader.cancel()
  }
  if (input.signal) {
    if (input.signal.aborted) onAbort()
    else input.signal.addEventListener('abort', onAbort, { once: true })
  }

  try {
  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''

    for (const event of events) {
      const dataLines = event
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())

      if (dataLines.length === 0) continue

      const data = dataLines.join('\n')
      if (data === '[DONE]') {
        return { content: fullText, id: requestId, usage }
      }

      let payload: OpenAIStreamPayload
      try {
        payload = JSON.parse(data) as OpenAIStreamPayload
      } catch {
        continue
      }

      if (payload.error?.message) {
        throw new Error(payload.error.message)
      }

      if (!requestId && typeof payload.id === 'string') {
        requestId = payload.id
        input.onMessageId?.(requestId)
      }

      usage = normalizeUsage(payload.usage, config.usageTag) ?? usage

      const choice = payload.choices?.[0]
      const content =
        toTextContent(choice?.delta?.content) || toTextContent(choice?.message?.content)

      if (content) {
        fullText += content
        input.onChunk(content)
      }
    }
  }
  } finally {
    if (input.signal) {
      input.signal.removeEventListener('abort', onAbort)
    }
  }

  return { content: fullText, id: requestId, usage }
}
