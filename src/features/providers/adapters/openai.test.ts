import { beforeEach, describe, expect, it, vi } from 'vitest'

import { openaiAdapter } from './openai'
import type { ProviderConnection } from '../entities'
import type { ModelRef } from '../model-ref'

function streamResponse(chunks: string[]) {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk))
        }
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
    apiKey: 'sk-proj-test',
    metadata: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

const MODEL: ModelRef = {
  providerKind: 'openai',
  providerModelId: 'gpt-5',
}

describe('OpenAI provider adapter', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('streams chunks and returns usage', async () => {
    vi.setSystemTime(new Date('2026-05-08T12:00:00Z'))
    const fetchMock = vi.fn(async () =>
      streamResponse([
        'data: {"id":"chatcmpl_1","choices":[{"delta":{"content":"Hel"}}]}\n\n',
        'data: {"id":"chatcmpl_1","choices":[{"delta":{"content":"lo"}}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
        'data: [DONE]\n\n',
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)

    const onChunk = vi.fn()
    const onMessageId = vi.fn()
    const result = await openaiAdapter.streamChat(connection(), MODEL, {
      messages: [{ role: 'user', content: 'hi' }],
      onChunk,
      onMessageId,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-proj-test',
        }),
      }),
    )
    expect(onChunk).toHaveBeenNthCalledWith(1, 'Hel')
    expect(onChunk).toHaveBeenNthCalledWith(2, 'lo')
    expect(onMessageId).toHaveBeenCalledWith('chatcmpl_1')
    expect(result).toMatchObject({
      content: 'Hello',
      id: 'chatcmpl_1',
      usage: {
        provider: 'openai',
        promptTokens: 3,
        completionTokens: 2,
        totalTokens: 5,
      },
    })
  })

  it('routes OAuth JWT tokens through the Codex backend', async () => {
    function base64url(value: string) {
      return btoa(value).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
    }
    const header = base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))
    const payload = base64url(
      JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct_42' } }),
    )
    const sig = base64url('s')
    const jwt = `${header}.${payload}.${sig}`

    const fetchMock = vi.fn(async () =>
      streamResponse([
        'data: {"type":"response.output_text.delta","delta":"ok"}\n\n',
        'data: {"type":"response.completed","response":{"id":"resp_2"}}\n\n',
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)

    await openaiAdapter.streamChat(connection({ apiKey: jwt }), MODEL, {
      messages: [{ role: 'user', content: 'hi' }],
      onChunk: vi.fn(),
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/codex/responses',
      expect.objectContaining({
        headers: expect.objectContaining({
          'chatgpt-account-id': 'acct_42',
        }),
      }),
    )
  })

  it('keeps sk- API keys on the /v1/chat/completions path', async () => {
    const fetchMock = vi.fn(async () =>
      streamResponse([
        'data: {"id":"chatcmpl_z","choices":[{"delta":{"content":"x"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)

    await openaiAdapter.streamChat(connection({ apiKey: 'sk-proj-real-key' }), MODEL, {
      messages: [{ role: 'user', content: 'hi' }],
      onChunk: vi.fn(),
    })

    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
  })

  it('throws sanitized provider errors on non-2xx responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'Invalid api key' } }), { status: 401 }),
      ),
    )

    await expect(
      openaiAdapter.streamChat(connection({ apiKey: 'bad' }), MODEL, {
        messages: [{ role: 'user', content: 'hi' }],
        onChunk: vi.fn(),
      }),
    ).rejects.toThrow('Invalid api key')
  })
})
