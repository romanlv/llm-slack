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
