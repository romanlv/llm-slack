import type {
  ChatProviderUsage,
  StreamChatCompletionInput,
  StreamChatCompletionResult,
} from '@/features/providers/provider-contract'

type OpenRouterStreamChoice = {
  delta?: { content?: unknown }
  message?: { content?: unknown }
}

type OpenRouterStreamPayload = {
  id?: string
  choices?: OpenRouterStreamChoice[]
  usage?: unknown
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function objectValue(value: unknown) {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

function normalizeUsage(usage: unknown): ChatProviderUsage | undefined {
  const data = objectValue(usage)
  if (!data) {
    return undefined
  }

  const promptDetails = objectValue(data.prompt_tokens_details)
  const completionDetails = objectValue(data.completion_tokens_details)
  const normalized: ChatProviderUsage = {
    provider: 'openrouter',
    promptTokens: numberValue(data.prompt_tokens),
    completionTokens: numberValue(data.completion_tokens),
    totalTokens: numberValue(data.total_tokens),
    reasoningTokens: numberValue(completionDetails?.reasoning_tokens),
    cachedTokens: numberValue(promptDetails?.cached_tokens),
    costCredits: numberValue(data.cost),
    contextWindowTokens: numberValue(data.context_window_tokens),
    remainingTokens: numberValue(data.remaining_tokens),
    recordedAt: Date.now(),
    raw: usage,
  }

  return Object.values(normalized).some((value) => typeof value === 'number')
    ? normalized
    : undefined
}

function toTextContent(content: unknown) {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part
        }

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

function getErrorMessage(payload: unknown, status: number) {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = (payload as { error?: { message?: unknown } }).error
    if (error && typeof error.message === 'string') {
      return error.message
    }
  }

  return `OpenRouter request failed with status ${status}.`
}

export async function sendOpenRouterChat({
  apiKey,
  messages,
  model,
  onChunk,
  onMessageId,
  siteName,
  siteUrl,
}: StreamChatCompletionInput): Promise<StreamChatCompletionResult> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(siteUrl ? { 'HTTP-Referer': siteUrl } : {}),
      ...(siteName ? { 'X-Title': siteName } : {}),
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
  })

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
    throw new Error('OpenRouter returned no response body.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''
  let requestId = ''
  let usage: ChatProviderUsage | undefined

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''

    for (const event of events) {
      const lines = event
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)

      const dataLines = lines
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())

      if (dataLines.length === 0) {
        continue
      }

      const data = dataLines.join('\n')
      if (data === '[DONE]') {
        return { content: fullText, id: requestId, usage }
      }

      let payload: OpenRouterStreamPayload
      try {
        payload = JSON.parse(data) as OpenRouterStreamPayload
      } catch {
        continue
      }

      if (!requestId && typeof payload.id === 'string') {
        requestId = payload.id
        onMessageId?.(requestId)
      }

      usage = normalizeUsage(payload.usage) ?? usage

      const choice = payload.choices?.[0]
      const content =
        toTextContent(choice?.delta?.content) || toTextContent(choice?.message?.content)

      if (content) {
        fullText += content
        onChunk(content)
      }
    }
  }

  return { content: fullText, id: requestId, usage }
}
