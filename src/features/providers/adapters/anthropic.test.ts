import { beforeEach, describe, expect, it, vi } from 'vitest'

import { anthropicAdapter } from './anthropic'
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
    id: 'connection-claude',
    kind: 'anthropic',
    label: 'Claude',
    apiKey: 'sk-ant-api03-test',
    metadata: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

const MODEL: ModelRef = {
  providerKind: 'anthropic',
  providerModelId: 'claude-sonnet-4-6',
}

describe('Anthropic provider adapter', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('streams text deltas, returns request id and usage', async () => {
    vi.setSystemTime(new Date('2026-05-08T12:00:00Z'))
    const fetchMock = vi.fn(async () =>
      streamResponse([
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_42","usage":{"input_tokens":7,"cache_read_input_tokens":2}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":4}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)

    const onChunk = vi.fn()
    const onMessageId = vi.fn()
    const result = await anthropicAdapter.streamChat(connection(), MODEL, {
      messages: [
        { role: 'system', content: 'You are concise.' },
        { role: 'user', content: 'hello' },
      ],
      onChunk,
      onMessageId,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-api-key': 'sk-ant-api03-test',
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        }),
      }),
    )
    const body = JSON.parse(((fetchMock.mock.calls as unknown as [string, RequestInit][])[0][1]).body as string)
    expect(body.system).toBe('You are concise.')
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }])
    expect(body.model).toBe('claude-sonnet-4-6')
    expect(body.stream).toBe(true)

    expect(onMessageId).toHaveBeenCalledWith('msg_42')
    expect(onChunk).toHaveBeenNthCalledWith(1, 'Hel')
    expect(onChunk).toHaveBeenNthCalledWith(2, 'lo')
    expect(result).toMatchObject({
      content: 'Hello',
      id: 'msg_42',
      usage: {
        provider: 'anthropic',
        promptTokens: 7,
        completionTokens: 4,
        totalTokens: 11,
        cachedTokens: 2,
      },
    })
  })

  it('uses Bearer auth for OAuth-prefixed tokens', async () => {
    const fetchMock = vi.fn(async () =>
      streamResponse(['event: message_stop\ndata: {"type":"message_stop"}\n\n']),
    )
    vi.stubGlobal('fetch', fetchMock)

    await anthropicAdapter.streamChat(
      connection({ apiKey: 'sk-ant-oat01-abc' }),
      MODEL,
      { messages: [{ role: 'user', content: 'hi' }], onChunk: vi.fn() },
    )

    const headers = ((fetchMock.mock.calls as unknown as [string, RequestInit][])[0][1]).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-ant-oat01-abc')
    expect(headers['x-api-key']).toBeUndefined()
  })

  it('surfaces sanitized error messages from failed responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'invalid key' } }), { status: 401 }),
      ),
    )

    await expect(
      anthropicAdapter.streamChat(connection({ apiKey: 'bad' }), MODEL, {
        messages: [{ role: 'user', content: 'hi' }],
        onChunk: vi.fn(),
      }),
    ).rejects.toThrow('invalid key')
  })
})
