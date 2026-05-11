import { beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '@/features/chat/database'
import { runChannelTurn } from '@/features/chat/orchestrator'
import { sendParentChatTurn } from '@/features/chat/send-turn'
import { createAgent } from '@/features/agents/agents-repository'
import { openrouterAdapter } from '@/features/providers/adapters/openrouter'
import { createProvider } from '@/features/providers/providers-repository'
import { createFakeStreamChat, installFakeProviders } from '@/test/fake-providers'
import { seedChannel } from '@/test/fixtures'
import { assertDbInvariants } from '@/test/db-invariants'
import {
  addChannelParticipant,
  appendUserMessage,
  setChannelSettings,
} from '@/features/chat/repository'

vi.mock('@/features/providers/adapters/openrouter', async (importActual) => {
  const actual = await importActual<typeof import('@/features/providers/adapters/openrouter')>()
  return {
    ...actual,
    openrouterAdapter: { ...actual.openrouterAdapter, streamChat: vi.fn() },
  }
})

const mockedStream = vi.mocked(openrouterAdapter.streamChat)

beforeEach(async () => {
  mockedStream.mockReset()
  await createProvider({ kind: 'openrouter', label: 'OR', apiKey: 'k' })
})

async function seedDuoChannel() {
  const a = await createAgent({
    displayName: 'A',
    model: { providerKind: 'openrouter', providerModelId: 'model-a' },
    systemPrompt: 'A prompt',
  })
  const b = await createAgent({
    displayName: 'B',
    model: { providerKind: 'openrouter', providerModelId: 'model-b' },
    systemPrompt: 'B prompt',
  })
  const channel = await seedChannel({
    title: 'launch',
    participants: [{ agent: a }, { agent: b }],
  })
  return { a, b, channel }
}

describe('orchestrator: runChannelTurn', () => {
  it('fan-out: each auto-decide candidate is invoked and a responder persists a message', async () => {
    const { a, b, channel } = await seedDuoChannel()

    const fakes = installFakeProviders()
    mockedStream.mockImplementation(
      createFakeStreamChat({
        fakes,
        scripts: {
          'model-a': () => ({ content: 'A says hi' }),
          'model-b': () => ({ silent: true }),
        },
      }),
    )

    const user = await appendUserMessage({
      conversationType: 'parent',
      conversationId: channel.id,
      parentChatId: channel.id,
      prompt: 'hello team',
      model: undefined,
    })

    await runChannelTurn({ chatId: channel.id, userMessageId: user.id })

    // Step 0 fans out to A and B (=2 calls). A speaks; step 1 re-offers to B
    // alone (A excluded by no-self-reply), so total ends up at 3 — but only
    // one message gets persisted because B stayed silent throughout.
    expect(fakes.calls.length).toBeGreaterThanOrEqual(2)
    const assistants = (await db.messages.toArray()).filter((m) => m.role === 'assistant')
    expect(assistants).toHaveLength(1)
    expect(assistants[0].content).toBe('A says hi')
    expect(assistants[0].agentId).toBe(a.id)

    const turns = await db.turns.toArray()
    expect(turns).toHaveLength(1)
    // No new event from B, but A responded — next loop has B as candidate
    // (A excluded as last speaker). B is silent again → no-trigger after
    // step 2 since the new event from A doesn't change B's mind.
    expect(['complete', 'no-trigger']).toContain(turns[0].stopReason)
    void b
    await assertDbInvariants(db)
  })

  it('no-trigger when every candidate stays silent', async () => {
    const { channel } = await seedDuoChannel()
    const fakes = installFakeProviders()
    mockedStream.mockImplementation(
      createFakeStreamChat({ fakes, scripts: { default: () => ({ silent: true }) } }),
    )

    const user = await appendUserMessage({
      conversationType: 'parent',
      conversationId: channel.id,
      parentChatId: channel.id,
      prompt: 'silence test',
      model: undefined,
    })

    await runChannelTurn({ chatId: channel.id, userMessageId: user.id })

    const assistants = (await db.messages.toArray()).filter((m) => m.role === 'assistant')
    expect(assistants).toHaveLength(0)
    const turns = await db.turns.toArray()
    expect(turns[0].stopReason).toBe('no-trigger')
    const attempts = await db.providerRequestAttempts.toArray()
    expect(attempts.every((a) => a.status === 'decided-silent')).toBe(true)
  })

  it('cap-hit when chained sub-turns exceed maxChainedSubTurns', async () => {
    const { channel } = await seedDuoChannel()
    await setChannelSettings(channel.id, { maxChainedSubTurns: 0 })

    const fakes = installFakeProviders()
    mockedStream.mockImplementation(
      createFakeStreamChat({
        fakes,
        scripts: { default: () => ({ content: 'reply' }) },
      }),
    )

    const user = await appendUserMessage({
      conversationType: 'parent',
      conversationId: channel.id,
      parentChatId: channel.id,
      prompt: 'go',
      model: undefined,
    })

    await runChannelTurn({ chatId: channel.id, userMessageId: user.id })

    const turns = await db.turns.toArray()
    expect(turns[0].stopReason).toBe('cap-hit')
  })

  it('mention-only agent fires when @-mentioned and stays silent otherwise', async () => {
    const a = await createAgent({
      displayName: 'A',
      model: { providerKind: 'openrouter', providerModelId: 'model-a' },
      systemPrompt: '',
    })
    const expert = await createAgent({
      displayName: 'Expert',
      model: { providerKind: 'openrouter', providerModelId: 'model-expert' },
      systemPrompt: '',
    })
    const channel = await seedChannel({ title: 'q' })
    await addChannelParticipant({ chatId: channel.id, agentId: a.id, mode: 'auto-decide' })
    await addChannelParticipant({ chatId: channel.id, agentId: expert.id, mode: 'mention-only' })

    const fakes = installFakeProviders()
    mockedStream.mockImplementation(
      createFakeStreamChat({
        fakes,
        scripts: {
          'model-a': () => ({ silent: true }),
          'model-expert': () => ({ content: 'expert answer' }),
        },
      }),
    )

    const user = await appendUserMessage({
      conversationType: 'parent',
      conversationId: channel.id,
      parentChatId: channel.id,
      prompt: 'hey @Expert what do you think?',
      model: undefined,
    })

    await runChannelTurn({ chatId: channel.id, userMessageId: user.id })

    expect(fakes.callsFor((c) => c.model.providerModelId === 'model-expert')).toHaveLength(1)
    const assistants = (await db.messages.toArray()).filter((m) => m.role === 'assistant')
    expect(assistants).toHaveLength(1)
    expect(assistants[0].content).toBe('expert answer')
    expect(assistants[0].agentId).toBe(expert.id)
  })

  it('no-self-reply: an agent that just spoke is excluded from the next step', async () => {
    const a = await createAgent({
      displayName: 'A',
      model: { providerKind: 'openrouter', providerModelId: 'model-a' },
      systemPrompt: '',
    })
    const b = await createAgent({
      displayName: 'B',
      model: { providerKind: 'openrouter', providerModelId: 'model-b' },
      systemPrompt: '',
    })
    const channel = await seedChannel({
      title: 'q',
      participants: [{ agent: a }, { agent: b }],
      settings: { maxChainedSubTurns: 3 },
    })

    const fakes = installFakeProviders()
    // A speaks first; then on the next step only B is a candidate (A excluded).
    // Both stay silent on every subsequent step so the turn terminates cleanly.
    let aCallCount = 0
    let bCallCount = 0
    mockedStream.mockImplementation(
      createFakeStreamChat({
        fakes,
        scripts: {
          'model-a': () => {
            aCallCount += 1
            return aCallCount === 1 ? { content: 'A first' } : { silent: true }
          },
          'model-b': () => {
            bCallCount += 1
            return { silent: true }
          },
        },
      }),
    )

    const user = await appendUserMessage({
      conversationType: 'parent',
      conversationId: channel.id,
      parentChatId: channel.id,
      prompt: 'go',
      model: undefined,
    })

    await runChannelTurn({ chatId: channel.id, userMessageId: user.id })

    // After A speaks at step 0, step 1's candidates must NOT include A.
    // Total A invocations == 1 (just step 0); B invocations >= 1 (step 0
    // and step 1).
    expect(aCallCount).toBe(1)
    expect(bCallCount).toBeGreaterThanOrEqual(1)
  })

  it('runs through send-turn dispatch when called via sendParentChatTurn', async () => {
    const { channel } = await seedDuoChannel()
    mockedStream.mockResolvedValue({ content: 'ok', id: 'req' })

    await sendParentChatTurn(channel.id, 'kick off')

    const messages = await db.messages.toArray()
    const user = messages.find((m) => m.role === 'user')
    expect(user?.content).toBe('kick off')
    expect(await db.turns.count()).toBe(1)
  })
})
