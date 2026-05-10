import { beforeEach, describe, expect, it, vi } from 'vitest'

import { sendOpenRouterChat } from './openrouter'

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

describe('OpenRouter provider adapter', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('parses streamed chunks, request ids, and usage from SSE frames', async () => {
    vi.setSystemTime(new Date('2026-05-08T12:00:00Z'))
    const fetchMock = vi.fn(async () =>
      streamResponse([
        'data: {"id":"req_123","choices":[{"delta":{"content":"Hel"}}]}\n',
        '\ndata: {"choices":[{"delta":{"content":[{"text":"lo"}]}}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5,"prompt_tokens_details":{"cached_tokens":1},"completion_tokens_details":{"reasoning_tokens":4},"cost":0.0001}}\n\n',
        'data: [DONE]\n\n',
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)

    const onChunk = vi.fn()
    const onMessageId = vi.fn()
    const result = await sendOpenRouterChat({
      apiKey: 'api-key',
      model: 'model-a',
      messages: [{ role: 'user', content: 'hello' }],
      siteName: 'llm-slack',
      siteUrl: 'https://example.test',
      onChunk,
      onMessageId,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer api-key',
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://example.test',
          'X-Title': 'llm-slack',
        }),
        body: JSON.stringify({
          model: 'model-a',
          messages: [{ role: 'user', content: 'hello' }],
          stream: true,
        }),
      }),
    )
    expect(onMessageId).toHaveBeenCalledWith('req_123')
    expect(onChunk).toHaveBeenNthCalledWith(1, 'Hel')
    expect(onChunk).toHaveBeenNthCalledWith(2, 'lo')
    expect(result).toMatchObject({
      content: 'Hello',
      id: 'req_123',
      usage: {
        provider: 'openrouter',
        promptTokens: 3,
        completionTokens: 2,
        totalTokens: 5,
        cachedTokens: 1,
        reasoningTokens: 4,
        costCredits: 0.0001,
        recordedAt: Date.parse('2026-05-08T12:00:00Z'),
      },
    })
  })

  it('uses sanitized provider error messages from failed responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Bad API key' } }), { status: 401 })),
    )

    await expect(
      sendOpenRouterChat({
        apiKey: 'bad-key',
        model: 'model-a',
        messages: [{ role: 'user', content: 'hello' }],
        onChunk: vi.fn(),
      }),
    ).rejects.toThrow('Bad API key')
  })
})
