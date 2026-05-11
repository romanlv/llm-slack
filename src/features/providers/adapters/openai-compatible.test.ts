import { beforeEach, describe, expect, it, vi } from 'vitest'

import { openaiCompatibleAdapter } from './openai-compatible'
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
    id: 'connection-custom',
    kind: 'openai-compatible',
    label: 'Ollama (laptop)',
    apiKey: '',
    baseUrl: 'http://localhost:11434/v1',
    metadata: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

const MODEL: ModelRef = {
  providerKind: 'openai-compatible',
  providerModelId: 'llama3.1:70b',
}

describe('OpenAI-compatible provider adapter', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('declares requiresApiKey: false so send-turn lets unauthenticated local endpoints through', () => {
    expect(openaiCompatibleAdapter.requiresApiKey).toBe(false)
  })

  it('hits the connection-supplied baseUrl and omits the Authorization header when no key is set', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      streamResponse([
        'data: {"id":"r1","choices":[{"delta":{"content":"hi"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)

    await openaiCompatibleAdapter.streamChat(connection(), MODEL, {
      messages: [{ role: 'user', content: 'hi' }],
      onChunk: vi.fn(),
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:11434/v1/chat/completions')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers).not.toHaveProperty('Authorization')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('includes the Authorization header when the user supplies a key for a hosted gateway', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      streamResponse(['data: [DONE]\n\n']),
    )
    vi.stubGlobal('fetch', fetchMock)

    await openaiCompatibleAdapter.streamChat(
      connection({
        apiKey: 'sk-fake-together',
        baseUrl: 'https://api.together.xyz/v1/',
      }),
      MODEL,
      { messages: [{ role: 'user', content: 'hi' }], onChunk: vi.fn() },
    )

    const [url, init] = fetchMock.mock.calls[0]
    // Trailing slash on baseUrl is tolerated.
    expect(url).toBe('https://api.together.xyz/v1/chat/completions')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-fake-together')
  })

  it('throws a clear error when the connection has no baseUrl', async () => {
    vi.stubGlobal('fetch', vi.fn())
    await expect(
      openaiCompatibleAdapter.streamChat(
        connection({ baseUrl: undefined }),
        MODEL,
        { messages: [{ role: 'user', content: 'hi' }], onChunk: vi.fn() },
      ),
    ).rejects.toThrow(/has no endpoint URL/i)
  })
})
