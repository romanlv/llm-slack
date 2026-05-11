import { describe, expect, it, vi } from 'vitest'

import type { ProviderConnection } from '@/features/providers/entities'
import type { ModelRef } from '@/features/providers/model-ref'

import {
  SILENCE_SENTINEL,
  createFakeStreamChat,
  installFakeProviders,
} from '@/test/fake-providers'

const connection: ProviderConnection = {
  id: 'p',
  kind: 'openrouter',
  label: 'OpenRouter',
  apiKey: 'k',
  metadata: {},
  createdAt: 0,
  updatedAt: 0,
}

function model(id: string): ModelRef {
  return { providerKind: 'openrouter', providerModelId: id }
}

describe('installFakeProviders + createFakeStreamChat', () => {
  it('routes calls to the script keyed by providerModelId and records them', async () => {
    const fakes = installFakeProviders()
    const streamChat = createFakeStreamChat({
      scripts: {
        'agent-a': () => ({ content: 'A wrote this', usage: undefined }),
        default: () => ({ content: 'fallback' }),
      },
      fakes,
    })

    const chunks: string[] = []
    await streamChat(connection, model('agent-a'), {
      messages: [{ role: 'user', content: 'hi' }],
      onChunk: (c) => chunks.push(c),
    })
    expect(chunks).toEqual(['A wrote this'])
    expect(fakes.calls).toHaveLength(1)
    expect(fakes.lastCall().userText).toBe('hi')
  })

  it('falls back to default when no exact match exists', async () => {
    const fakes = installFakeProviders()
    const streamChat = createFakeStreamChat({
      scripts: { default: () => ({ content: 'fb' }) },
      fakes,
    })
    const out = await streamChat(connection, model('unknown'), {
      messages: [{ role: 'user', content: 'x' }],
      onChunk: () => {},
    })
    expect(out.content).toBe('fb')
  })

  it('throws when no script and no default exist', async () => {
    const fakes = installFakeProviders()
    const streamChat = createFakeStreamChat({ scripts: {}, fakes })
    await expect(
      streamChat(connection, model('m'), {
        messages: [],
        onChunk: () => {},
      }),
    ).rejects.toThrow(/No fake script registered/)
  })

  it('emits SILENCE_SENTINEL when a script returns { silent: true }', async () => {
    const fakes = installFakeProviders()
    const streamChat = createFakeStreamChat({
      scripts: { m: () => ({ silent: true }) },
      fakes,
    })
    const chunks: string[] = []
    const result = await streamChat(connection, model('m'), {
      messages: [],
      onChunk: (c) => chunks.push(c),
    })
    expect(chunks).toEqual([SILENCE_SENTINEL])
    expect(result.content).toBe(SILENCE_SENTINEL)
  })

  it('throws when the script returns an error envelope', async () => {
    const fakes = installFakeProviders()
    const streamChat = createFakeStreamChat({
      scripts: { m: () => ({ error: new Error('rate-limited') }) },
      fakes,
    })
    await expect(
      streamChat(connection, model('m'), { messages: [], onChunk: vi.fn() }),
    ).rejects.toThrow('rate-limited')
  })

  it('aborts if the caller-supplied signal fires before the script', async () => {
    const fakes = installFakeProviders()
    const streamChat = createFakeStreamChat({
      scripts: { m: () => ({ content: 'should-not-run' }) },
      fakes,
    })
    const controller = new AbortController()
    controller.abort()
    await expect(
      streamChat(connection, model('m'), {
        messages: [],
        onChunk: () => {},
        signal: controller.signal,
      }),
    ).rejects.toThrow(/Aborted/)
  })

  it('extracts systemPrompt from messages on the recorded call', async () => {
    const fakes = installFakeProviders()
    const streamChat = createFakeStreamChat({
      scripts: { m: () => ({ content: 'ok' }) },
      fakes,
    })
    await streamChat(connection, model('m'), {
      messages: [
        { role: 'system', content: 'you are helpful' },
        { role: 'user', content: 'hello' },
      ],
      onChunk: () => {},
    })
    expect(fakes.lastCall().systemPrompt).toBe('you are helpful')
  })
})
