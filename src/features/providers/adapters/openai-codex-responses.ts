import type { ProviderConnection } from '@/features/providers/entities'
import type { ModelRef } from '@/features/providers/model-ref'
import type {
  ChatProviderMessage,
  ChatProviderUsage,
  StreamChatInput,
  StreamChatResult,
} from '@/features/providers/provider-contract'

import { composeSignal } from './stream-signal'

// Streams chat completions against ChatGPT's Codex backend
// (https://chatgpt.com/backend-api/codex/responses). This is the only endpoint
// that accepts the OAuth access tokens issued by `codex login`; those tokens
// are JWTs scoped to the Codex CLI client and are rejected by the regular
// /v1/chat/completions endpoint with 401, even though they look like normal
// bearer tokens. Using this endpoint charges model calls against the user's
// ChatGPT Plus/Pro subscription instead of platform API credits.

const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'

// The Codex backend rejects requests without a non-empty `instructions`
// string. The exact content does not have to match Codex CLI's prompt for
// general-purpose chat use — any plausible system prompt works.
const DEFAULT_INSTRUCTIONS =
  'You are a helpful assistant. Reply directly without surrounding commentary.'

type JwtPayload = {
  ['https://api.openai.com/auth']?: { chatgpt_account_id?: unknown }
}

// Real Codex OAuth tokens decode to ~1 KB JWTs. Cap at 8 KB so a hostile or
// accidental multi-MB paste short-circuits the regex test (anchored regex is
// linear, but the input copy + atob would still pin the main thread).
const MAX_JWT_LENGTH = 8192

export function isCodexOAuthToken(value: string | undefined | null): boolean {
  if (!value) return false
  if (value.length > MAX_JWT_LENGTH + 16) return false
  const stripped = value.trim().replace(/^Bearer\s+/i, '')
  if (stripped.length > MAX_JWT_LENGTH) return false
  // JWTs always have three base64url segments separated by dots and start
  // with `eyJ` (the base64url encoding of `{"`).
  return /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(stripped)
}

function stripBearerPrefix(value: string): string {
  return value.trim().replace(/^Bearer\s+/i, '')
}

function decodeBase64Url(segment: string): string {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/')
  const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  return atob(padded + padding)
}

export function decodeJwt(token: string): JwtPayload | null {
  const stripped = stripBearerPrefix(token)
  const parts = stripped.split('.')
  if (parts.length !== 3) return null
  try {
    const json = decodeBase64Url(parts[1])
    // Convert binary string back to UTF-8 so non-ASCII characters in claims
    // (rare but possible) decode correctly.
    const bytes = Uint8Array.from(json, (c) => c.charCodeAt(0))
    const text = new TextDecoder().decode(bytes)
    return JSON.parse(text) as JwtPayload
  } catch {
    return null
  }
}

export function extractChatGPTAccountId(token: string): string | null {
  const payload = decodeJwt(token)
  const claim = payload?.['https://api.openai.com/auth']?.chatgpt_account_id
  // Validate the claim is a plain string — anything else (number, object,
  // value containing CR/LF) would either confuse the Codex backend or, if
  // assigned to a Headers value, throw a fetch TypeError at request time.
  if (typeof claim !== 'string') return null
  if (!/^[A-Za-z0-9_-]+$/.test(claim)) return null
  return claim
}

// Pass the picker's model id through verbatim — the Codex backend's set of
// accepted ids changes over time (gpt-5.5, gpt-5.4, gpt-5.3-codex, …) and we
// don't want to silently downgrade the user's choice. We only strip a leading
// "openai/" prefix that some external catalogs use ("openai/gpt-5.5"); we do
// NOT collapse arbitrary slash segments because those aren't model ids.
const OPENAI_PREFIX = 'openai/'
export function normalizeCodexModel(modelId: string): string {
  return modelId.startsWith(OPENAI_PREFIX) ? modelId.slice(OPENAI_PREFIX.length) : modelId
}

type CodexInputItem = {
  type: 'message'
  role: 'user' | 'assistant' | 'system' | 'developer'
  content: Array<{ type: 'input_text' | 'output_text'; text: string }>
}

function toCodexInput(messages: ChatProviderMessage[]): CodexInputItem[] {
  return messages.map((message) => {
    const role = message.role === 'system' ? 'developer' : message.role
    const partType = role === 'assistant' ? 'output_text' : 'input_text'
    return {
      type: 'message',
      role,
      content: [{ type: partType, text: message.content }],
    }
  })
}

function buildHeaders(accessToken: string, accountId: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    Authorization: `Bearer ${accessToken}`,
    'chatgpt-account-id': accountId,
    'OpenAI-Beta': 'responses=experimental',
    originator: 'codex_cli_rs',
  }
}

function parseErrorMessage(payload: unknown, raw: string, status: number, label: string): string {
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>
    const error = obj.error
    if (error && typeof error === 'object') {
      const message = (error as { message?: unknown }).message
      if (typeof message === 'string') return message
    }
    if (typeof obj.detail === 'string') return obj.detail
    if (typeof obj.message === 'string') return obj.message
  }
  const snippet = raw.trim().slice(0, 400)
  if (snippet) return `${label} ${status}: ${snippet}`
  return `${label} request failed with status ${status}.`
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeUsage(usage: unknown): ChatProviderUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  const data = usage as Record<string, unknown>
  const inputDetails = (data.input_tokens_details ?? {}) as Record<string, unknown>
  const outputDetails = (data.output_tokens_details ?? {}) as Record<string, unknown>
  const tokenFields = {
    promptTokens: numberValue(data.input_tokens),
    completionTokens: numberValue(data.output_tokens),
    totalTokens: numberValue(data.total_tokens),
    reasoningTokens: numberValue(outputDetails.reasoning_tokens),
    cachedTokens: numberValue(inputDetails.cached_tokens),
  }
  // Bail out if the payload had no recognizable token counters. Without this
  // an empty `response.completed.usage: {}` would clobber a previously
  // captured usage record via `usage = normalizeUsage(...) ?? usage`.
  if (!Object.values(tokenFields).some((value) => typeof value === 'number')) {
    return undefined
  }
  return {
    provider: 'openai-codex',
    ...tokenFields,
    recordedAt: Date.now(),
    raw: usage,
  }
}

type ResponsesEvent = {
  type?: string
  delta?: unknown
  response?: { id?: unknown; usage?: unknown }
  error?: { message?: unknown }
}

export async function streamCodexResponses(
  connection: ProviderConnection,
  model: ModelRef,
  input: StreamChatInput,
): Promise<StreamChatResult> {
  const accessToken = stripBearerPrefix(connection.apiKey)
  const accountId = extractChatGPTAccountId(connection.apiKey)
  if (!accountId) {
    throw new Error(
      `${connection.label}: OAuth token has no chatgpt_account_id claim. ` +
        'Re-run `codex login` and paste the fresh access_token from ~/.codex/auth.json.',
    )
  }

  const body = {
    model: normalizeCodexModel(model.providerModelId),
    input: toCodexInput(input.messages),
    stream: true,
    store: false,
    instructions: DEFAULT_INSTRUCTIONS,
    reasoning: { effort: 'medium', summary: 'auto' },
    text: { verbosity: 'medium' },
    include: ['reasoning.encrypted_content'],
  }

  const { signal, disarmTimeout } = composeSignal(input.signal)
  let response: Response
  try {
    response = await fetch(CODEX_RESPONSES_URL, {
      method: 'POST',
      headers: buildHeaders(accessToken, accountId),
      body: JSON.stringify(body),
      signal,
    })
  } finally {
    disarmTimeout()
  }

  if (!response.ok) {
    const raw = await response.text().catch(() => '')
    let payload: unknown
    try {
      payload = raw ? JSON.parse(raw) : undefined
    } catch {
      payload = undefined
    }
    throw new Error(parseErrorMessage(payload, raw, response.status, connection.label))
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

  // Returns true when a `[DONE]` sentinel was consumed and the caller should
  // stop reading. Throws on inline error events so the catch in the read
  // loop's finally still runs.
  const handleEvent = (event: string): boolean => {
    const dataLines = event
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
    if (dataLines.length === 0) return false

    const data = dataLines.join('\n')
    if (data === '[DONE]') return true

    let payload: ResponsesEvent
    try {
      payload = JSON.parse(data) as ResponsesEvent
    } catch {
      return false
    }

    if (typeof payload.error?.message === 'string') {
      throw new Error(payload.error.message)
    }
    if (!requestId && typeof payload.response?.id === 'string') {
      requestId = payload.response.id
      input.onMessageId?.(requestId)
    }
    switch (payload.type) {
      case 'response.output_text.delta':
        if (typeof payload.delta === 'string' && payload.delta) {
          fullText += payload.delta
          input.onChunk(payload.delta)
        }
        break
      case 'response.completed':
      case 'response.done':
        usage = normalizeUsage(payload.response?.usage) ?? usage
        break
      case 'response.failed':
      case 'error': {
        const message =
          typeof payload.error?.message === 'string'
            ? payload.error.message
            : `${connection.label} stream failed.`
        throw new Error(message)
      }
    }
    return false
  }

  try {
    let doneSeen = false
    while (!doneSeen) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split('\n\n')
      buffer = events.pop() ?? ''

      for (const event of events) {
        if (handleEvent(event)) {
          doneSeen = true
          break
        }
      }
    }
    // Flush a final event the server emitted without a trailing blank line.
    // SSE is supposed to terminate every event with `\n\n` but proxies
    // sometimes truncate the last separator; without this, the final
    // `response.completed` (carrying usage) would be silently dropped.
    if (!doneSeen && buffer.trim()) handleEvent(buffer)
  } finally {
    if (input.signal) {
      input.signal.removeEventListener('abort', onAbort)
    }
  }

  return { content: fullText, id: requestId, usage }
}
