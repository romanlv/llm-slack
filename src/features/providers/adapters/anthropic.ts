import type { ProviderConnection } from '@/features/providers/entities'
import type { ModelRef } from '@/features/providers/model-ref'
import type {
  CatalogEntry,
  ChatProviderMessage,
  ChatProviderUsage,
  ProviderAdapter,
  StreamChatInput,
  StreamChatResult,
} from '@/features/providers/provider-contract'

import { composeSignal } from './stream-signal'

const BUNDLED: CatalogEntry[] = [
  {
    providerModelId: 'claude-opus-4-7',
    name: 'Claude Opus 4.7',
    contextLength: 1_000_000,
  },
  {
    providerModelId: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    contextLength: 1_000_000,
  },
  {
    providerModelId: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    contextLength: 200_000,
  },
]

const ANTHROPIC_VERSION = '2023-06-01'
const DEFAULT_MAX_OUTPUT_TOKENS = 4096

type AnthropicDelta = {
  type?: string
  text?: string
}

type AnthropicEvent = {
  type?: string
  message?: { id?: string; usage?: Record<string, unknown> }
  delta?: AnthropicDelta
  usage?: Record<string, unknown>
  error?: { message?: string }
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function buildAuthHeaders(apiKey: string) {
  const trimmed = apiKey.trim()
  const headers: Record<string, string> = {
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
    'Content-Type': 'application/json',
  }
  if (trimmed.startsWith('sk-ant-oat')) {
    // OAuth bearer (Claude.ai subscription tokens, including Claude Code).
    headers.Authorization = `Bearer ${trimmed}`
  } else {
    headers['x-api-key'] = trimmed
  }
  return headers
}

function splitSystemAndChat(messages: ChatProviderMessage[]) {
  const system: string[] = []
  const chat: { role: 'user' | 'assistant'; content: string }[] = []
  for (const message of messages) {
    if (message.role === 'system') {
      system.push(message.content)
    } else {
      chat.push({ role: message.role, content: message.content })
    }
  }
  return { system: system.join('\n\n').trim(), chat }
}

function normalizeUsage(
  start: Record<string, unknown> | undefined,
  end: Record<string, unknown> | undefined,
): ChatProviderUsage | undefined {
  const input = numberValue(start?.input_tokens)
  const cached = numberValue(start?.cache_read_input_tokens) ?? numberValue(start?.cached_tokens)
  const output = numberValue(end?.output_tokens) ?? numberValue(start?.output_tokens)

  if (input === undefined && output === undefined) {
    return undefined
  }

  const total =
    input !== undefined && output !== undefined ? input + output : undefined

  return {
    provider: 'anthropic',
    promptTokens: input,
    completionTokens: output,
    totalTokens: total,
    cachedTokens: cached,
    recordedAt: Date.now(),
    raw: { start, end },
  }
}

function getErrorMessage(payload: unknown, status: number) {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = (payload as { error?: { message?: unknown } }).error
    if (error && typeof error.message === 'string') {
      return error.message
    }
  }
  return `Anthropic request failed with status ${status}.`
}

async function streamChat(
  connection: ProviderConnection,
  model: ModelRef,
  input: StreamChatInput,
): Promise<StreamChatResult> {
  const { system, chat } = splitSystemAndChat(input.messages)

  const body: Record<string, unknown> = {
    model: model.providerModelId,
    max_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
    messages: chat,
    stream: true,
  }
  if (system) {
    body.system = system
  }

  const { signal, disarmTimeout } = composeSignal(input.signal)
  let response: Response
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: buildAuthHeaders(connection.apiKey),
      body: JSON.stringify(body),
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
    throw new Error(getErrorMessage(payload, response.status))
  }

  if (!response.body) {
    throw new Error('Anthropic returned no response body.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''
  let requestId = ''
  let startUsage: Record<string, unknown> | undefined
  let endUsage: Record<string, unknown> | undefined

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
        return { content: fullText, id: requestId, usage: normalizeUsage(startUsage, endUsage) }
      }

      let payload: AnthropicEvent
      try {
        payload = JSON.parse(data) as AnthropicEvent
      } catch {
        continue
      }

      if (payload.type === 'message_start') {
        const id = payload.message?.id
        if (typeof id === 'string' && !requestId) {
          requestId = id
          input.onMessageId?.(id)
        }
        if (payload.message?.usage) {
          startUsage = payload.message.usage
        }
      } else if (payload.type === 'content_block_delta') {
        const text = payload.delta?.text
        if (typeof text === 'string' && text.length > 0) {
          fullText += text
          input.onChunk(text)
        }
      } else if (payload.type === 'message_delta') {
        if (payload.usage) {
          endUsage = payload.usage
        }
      } else if (payload.type === 'error') {
        throw new Error(payload.error?.message ?? 'Anthropic stream error.')
      }
    }
  }
  } finally {
    if (input.signal) {
      input.signal.removeEventListener('abort', onAbort)
    }
  }

  return { content: fullText, id: requestId, usage: normalizeUsage(startUsage, endUsage) }
}

export const anthropicAdapter: ProviderAdapter = {
  kind: 'anthropic',
  requiresApiKey: true,
  bundledCatalog: () => BUNDLED,
  streamChat,
}
