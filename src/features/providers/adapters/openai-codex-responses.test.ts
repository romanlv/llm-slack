import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  decodeJwt,
  extractChatGPTAccountId,
  isCodexOAuthToken,
  normalizeCodexModel,
  streamCodexResponses,
} from './openai-codex-responses'
import type { ProviderConnection } from '../entities'
import type { ModelRef } from '../model-ref'

function base64url(value: string) {
  return btoa(value).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function makeJwt(payload: Record<string, unknown>) {
  const header = base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))
  const body = base64url(JSON.stringify(payload))
  const sig = base64url('signature')
  return `${header}.${body}.${sig}`
}

function jwtWithAccount(accountId = 'acct_123') {
  return makeJwt({ 'https://api.openai.com/auth': { chatgpt_account_id: accountId } })
}

function streamResponse(chunks: string[]) {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    }),
    { status: 200 },
  )
}

function connection(overrides: Partial<ProviderConnection> = {}): ProviderConnection {
  return {
    id: 'connection-openai',
    kind: 'openai',
    label: 'OpenAI',
    apiKey: jwtWithAccount(),
    metadata: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

const MODEL: ModelRef = {
  providerKind: 'openai',
  providerModelId: 'gpt-5.4-mini',
}

describe('isCodexOAuthToken', () => {
  it('detects JWT-shaped tokens', () => {
    expect(isCodexOAuthToken(jwtWithAccount())).toBe(true)
  })
  it('accepts a Bearer prefix', () => {
    expect(isCodexOAuthToken(`Bearer ${jwtWithAccount()}`)).toBe(true)
  })
  it('accepts a JWT padded with whitespace', () => {
    expect(isCodexOAuthToken(`   ${jwtWithAccount()}\n`)).toBe(true)
  })
  it('rejects sk- API keys', () => {
    expect(isCodexOAuthToken('sk-proj-abc123')).toBe(false)
    expect(isCodexOAuthToken('sk-ant-api03-xyz')).toBe(false)
  })
  it('rejects a Bearer-prefixed sk- key (no JWT shape underneath)', () => {
    expect(isCodexOAuthToken('Bearer sk-proj-abc123')).toBe(false)
  })
  it('rejects blanks', () => {
    expect(isCodexOAuthToken('')).toBe(false)
    expect(isCodexOAuthToken(null)).toBe(false)
  })
  it('rejects oversized strings without running the regex against them', () => {
    const huge = 'eyJ' + 'a'.repeat(20_000) + '.' + 'b'.repeat(10) + '.' + 'c'.repeat(10)
    expect(isCodexOAuthToken(huge)).toBe(false)
  })
})

describe('decodeJwt + extractChatGPTAccountId', () => {
  it('decodes the payload of a well-formed JWT', () => {
    const token = makeJwt({ sub: 'user_1' })
    expect(decodeJwt(token)).toMatchObject({ sub: 'user_1' })
  })
  it('extracts chatgpt_account_id from the auth claim', () => {
    expect(extractChatGPTAccountId(jwtWithAccount('acct_abc'))).toBe('acct_abc')
  })
  it('returns null when claim is missing', () => {
    const token = makeJwt({ sub: 'user_1' })
    expect(extractChatGPTAccountId(token)).toBeNull()
  })
  it('returns null when claim is a non-string (would crash fetch headers)', () => {
    const numericClaim = makeJwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 42 } })
    expect(extractChatGPTAccountId(numericClaim)).toBeNull()
  })
  it('returns null when claim contains CR/LF (would corrupt headers)', () => {
    const injected = makeJwt({
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct\r\nX-Injected: 1' },
    })
    expect(extractChatGPTAccountId(injected)).toBeNull()
  })
})

describe('normalizeCodexModel', () => {
  it('passes the picker model through unchanged', () => {
    expect(normalizeCodexModel('gpt-5.5')).toBe('gpt-5.5')
    expect(normalizeCodexModel('gpt-5.4-mini')).toBe('gpt-5.4-mini')
    expect(normalizeCodexModel('gpt-5.3-codex')).toBe('gpt-5.3-codex')
  })
  it('strips an "openai/" provider prefix if present', () => {
    expect(normalizeCodexModel('openai/gpt-5.5')).toBe('gpt-5.5')
  })
  it('does NOT collapse arbitrary slash-separated paths', () => {
    // A literal model id that contains a slash but no openai/ prefix must
    // round-trip unchanged — silently stripping the leading segment would
    // misroute the request to a different (or non-existent) model.
    expect(normalizeCodexModel('vendor/model-x')).toBe('vendor/model-x')
    expect(normalizeCodexModel('openai/foo/bar')).toBe('foo/bar')
  })
})

describe('streamCodexResponses', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('posts to the Codex backend with OAuth + account-id headers', async () => {
    const fetchMock = vi.fn(async () =>
      streamResponse([
        'data: {"type":"response.created","response":{"id":"resp_1"}}\n\n',
        'data: {"type":"response.output_text.delta","delta":"Hel"}\n\n',
        'data: {"type":"response.output_text.delta","delta":"lo"}\n\n',
        'data: {"type":"response.completed","response":{"id":"resp_1","usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5}}}\n\n',
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)

    const onChunk = vi.fn()
    const onMessageId = vi.fn()
    const result = await streamCodexResponses(connection({ apiKey: jwtWithAccount('acct_x') }), MODEL, {
      messages: [{ role: 'user', content: 'hi' }],
      onChunk,
      onMessageId,
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://chatgpt.com/backend-api/codex/responses')
    expect(init.headers).toMatchObject({
      Authorization: expect.stringMatching(/^Bearer eyJ/),
      'chatgpt-account-id': 'acct_x',
      'OpenAI-Beta': 'responses=experimental',
      originator: 'codex_cli_rs',
    })
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('gpt-5.4-mini')
    expect(body.stream).toBe(true)
    expect(body.store).toBe(false)
    expect(body.input[0]).toMatchObject({
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'hi' }],
    })

    expect(onChunk).toHaveBeenNthCalledWith(1, 'Hel')
    expect(onChunk).toHaveBeenNthCalledWith(2, 'lo')
    expect(onMessageId).toHaveBeenCalledWith('resp_1')
    expect(result.content).toBe('Hello')
    expect(result.id).toBe('resp_1')
    expect(result.usage).toMatchObject({
      provider: 'openai-codex',
      promptTokens: 3,
      completionTokens: 2,
      totalTokens: 5,
    })
  })

  it('throws a clear error when the JWT has no chatgpt_account_id', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const tokenWithoutClaim = makeJwt({ sub: 'user_1' })

    await expect(
      streamCodexResponses(connection({ apiKey: tokenWithoutClaim }), MODEL, {
        messages: [{ role: 'user', content: 'hi' }],
        onChunk: vi.fn(),
      }),
    ).rejects.toThrow(/chatgpt_account_id/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces non-2xx provider errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'Token expired' } }), { status: 401 }),
      ),
    )

    await expect(
      streamCodexResponses(connection(), MODEL, {
        messages: [{ role: 'user', content: 'hi' }],
        onChunk: vi.fn(),
      }),
    ).rejects.toThrow('Token expired')
  })

  it('surfaces inline error events from the SSE stream', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        streamResponse([
          'data: {"type":"response.failed","error":{"message":"Rate limit reached"}}\n\n',
        ]),
      ),
    )

    await expect(
      streamCodexResponses(connection(), MODEL, {
        messages: [{ role: 'user', content: 'hi' }],
        onChunk: vi.fn(),
      }),
    ).rejects.toThrow('Rate limit reached')
  })

  it('maps system messages to developer role and assistant to output_text', async () => {
    const fetchMock = vi.fn(async () =>
      streamResponse(['data: {"type":"response.completed","response":{"id":"r"}}\n\n']),
    )
    vi.stubGlobal('fetch', fetchMock)

    await streamCodexResponses(connection(), MODEL, {
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'assistant', content: 'prev' },
        { role: 'user', content: 'hi' },
      ],
      onChunk: vi.fn(),
    })

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.input).toEqual([
      { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'sys' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'prev' }] },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
    ])
  })

  it('honors a [DONE] sentinel and returns content accumulated so far', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        streamResponse([
          'data: {"type":"response.output_text.delta","delta":"hey"}\n\n',
          'data: [DONE]\n\n',
          // any later events should be ignored
          'data: {"type":"response.output_text.delta","delta":"oops"}\n\n',
        ]),
      ),
    )
    const onChunk = vi.fn()
    const result = await streamCodexResponses(connection(), MODEL, {
      messages: [{ role: 'user', content: 'hi' }],
      onChunk,
    })
    expect(result.content).toBe('hey')
    expect(onChunk).toHaveBeenCalledTimes(1)
  })

  it('flushes a final event when the stream closes without a trailing blank line', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        streamResponse([
          'data: {"type":"response.output_text.delta","delta":"hi"}\n\n',
          // Final event terminated by a single \n instead of \n\n — a real
          // proxy truncation pattern. Without the post-loop flush, this
          // event (carrying usage) would be silently dropped.
          'data: {"type":"response.completed","response":{"id":"r","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n',
        ]),
      ),
    )
    const result = await streamCodexResponses(connection(), MODEL, {
      messages: [{ role: 'user', content: 'hi' }],
      onChunk: vi.fn(),
    })
    expect(result.id).toBe('r')
    expect(result.usage).toMatchObject({ totalTokens: 2 })
  })

  it('reassembles an SSE event split across two reader chunks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        streamResponse([
          'data: {"type":"response.output_te',
          'xt.delta","delta":"yo"}\n\n',
        ]),
      ),
    )
    const onChunk = vi.fn()
    const result = await streamCodexResponses(connection(), MODEL, {
      messages: [{ role: 'user', content: 'hi' }],
      onChunk,
    })
    expect(onChunk).toHaveBeenCalledWith('yo')
    expect(result.content).toBe('yo')
  })

  it('does not overwrite a captured usage with a later empty usage payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        streamResponse([
          'data: {"type":"response.completed","response":{"id":"r","usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5}}}\n\n',
          // ChatGPT's backend occasionally emits a second completion event
          // with an empty usage object; that must not clobber the real one.
          'data: {"type":"response.done","response":{"id":"r","usage":{}}}\n\n',
        ]),
      ),
    )
    const result = await streamCodexResponses(connection(), MODEL, {
      messages: [{ role: 'user', content: 'hi' }],
      onChunk: vi.fn(),
    })
    expect(result.usage).toMatchObject({ totalTokens: 5 })
  })

  it('cancels the body reader when the caller aborts the signal', async () => {
    const controller = new AbortController()
    let cancelled = false
    const response = new Response(
      new ReadableStream({
        start() {
          // Hold the stream open without enqueuing — the reader's first
          // read() blocks until cancel() resolves it.
        },
        cancel() {
          cancelled = true
        },
      }),
      { status: 200 },
    )
    vi.stubGlobal('fetch', vi.fn(async () => response))

    const streamPromise = streamCodexResponses(connection(), MODEL, {
      messages: [{ role: 'user', content: 'hi' }],
      onChunk: vi.fn(),
      signal: controller.signal,
    })
    // Yield once so the implementation attaches the abort listener, then
    // fire abort; the listener must call reader.cancel().
    await Promise.resolve()
    controller.abort()

    await streamPromise
    expect(cancelled).toBe(true)
  })

  it('surfaces a useful error when the backend returns a non-JSON 4xx body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>Cloudflare blocked</html>', { status: 400 })),
    )

    await expect(
      streamCodexResponses(connection(), MODEL, {
        messages: [{ role: 'user', content: 'hi' }],
        onChunk: vi.fn(),
      }),
    ).rejects.toThrow(/OpenAI 400:.*Cloudflare/)
  })

  it('prefers the "detail" field when no error.message is present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ detail: 'unsupported model' }), { status: 400 }),
      ),
    )

    await expect(
      streamCodexResponses(connection(), MODEL, {
        messages: [{ role: 'user', content: 'hi' }],
        onChunk: vi.fn(),
      }),
    ).rejects.toThrow('unsupported model')
  })
})
