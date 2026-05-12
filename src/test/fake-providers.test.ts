import { describe, expect, it } from 'vitest'

import { SILENCE_SENTINEL } from '@/features/chat/decide-to-respond'
import type { ProviderConnection } from '@/features/providers/entities'
import type { ModelRef } from '@/features/providers/model-ref'

import {
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

const model = (id: string): ModelRef => ({ providerKind: 'openrouter', providerModelId: id })

describe('createFakeStreamChat', () => {
  it('routes to the script keyed by providerModelId and records the call', async () => {
    const fakes = installFakeProviders()
    const streamChat = createFakeStreamChat({
      scripts: { 'agent-a': () => ({ content: 'A wrote this' }) },
      fakes,
    })
    const chunks: string[] = []
    await streamChat(connection, model('agent-a'), {
      messages: [{ role: 'user', content: 'hi' }],
      onChunk: (c) => chunks.push(c),
    })
    expect(chunks).toEqual(['A wrote this'])
    expect(fakes.lastCall().userText).toBe('hi')
  })

  it('emits the silence sentinel when a script returns { silent: true }', async () => {
    const fakes = installFakeProviders()
    const streamChat = createFakeStreamChat({
      scripts: { m: () => ({ silent: true }) },
      fakes,
    })
    const result = await streamChat(connection, model('m'), {
      messages: [],
      onChunk: () => {},
    })
    expect(result.content).toBe(SILENCE_SENTINEL)
  })
})
