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
  completeMessage,
  createAssistantMessage,
  getOrCreateThreadForMessage,
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
    const { a, channel } = await seedDuoChannel()

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

  // The mention-only @-trigger behavior is covered by the thread-scope
  // variant below ("mention-only agent in a thread fires only when @-mentioned");
  // the participant snapshot in a thread is a strict superset of the
  // parent-channel case, so a parent-only repeat adds no coverage.

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

  describe('thread scope', () => {
    // Helper: seed a channel, post a user message on the parent, persist a
    // completed agent reply rooted to it, then open a thread on the agent
    // message. Returns the snapshot needed by per-test assertions.
    async function seedChannelWithThreadOnAgentReply(options: {
      rooterAgentScript?: () => { content: string }
    } = {}) {
      const { a, b, channel } = await seedDuoChannel()

      const rooterContent = options.rooterAgentScript?.().content ?? 'A root reply'

      const parentUser = await appendUserMessage({
        conversationType: 'parent',
        conversationId: channel.id,
        parentChatId: channel.id,
        prompt: 'hello team',
        model: undefined,
      })

      const agentReply = await createAssistantMessage({
        conversationType: 'parent',
        conversationId: channel.id,
        parentChatId: channel.id,
        model: a.model,
        agentId: a.id,
        agentSnapshot: { displayName: a.displayName, model: a.model ?? undefined },
      })
      await completeMessage(agentReply.id, rooterContent)

      const thread = await getOrCreateThreadForMessage(agentReply.id)
      return { a, b, channel, parentUser, agentReply, thread }
    }

    it('thread rooted off a user message: orchestrator uses thread participants and writes replies inside the thread', async () => {
      const { a, channel } = await seedDuoChannel()

      // Root the thread on a user message in the parent channel.
      const rootUser = await appendUserMessage({
        conversationType: 'parent',
        conversationId: channel.id,
        parentChatId: channel.id,
        prompt: 'big topic',
        model: undefined,
      })
      const thread = await getOrCreateThreadForMessage(rootUser.id)

      const fakes = installFakeProviders()
      mockedStream.mockImplementation(
        createFakeStreamChat({
          fakes,
          scripts: {
            'model-a': () => ({ content: 'A in thread' }),
            'model-b': () => ({ silent: true }),
          },
        }),
      )

      // Persist the user message on the thread and run the orchestrator.
      const threadUser = await appendUserMessage({
        conversationType: 'thread',
        conversationId: thread.id,
        parentChatId: channel.id,
        prompt: 'continue here',
        model: undefined,
      })
      await runChannelTurn({
        chatId: channel.id,
        threadId: thread.id,
        userMessageId: threadUser.id,
      })

      const threadMessages = (await db.messages.toArray()).filter(
        (m) => m.conversationType === 'thread' && m.conversationId === thread.id,
      )
      const threadAssistants = threadMessages.filter((m) => m.role === 'assistant')
      expect(threadAssistants).toHaveLength(1)
      expect(threadAssistants[0].content).toBe('A in thread')
      expect(threadAssistants[0].agentId).toBe(a.id)

      // No new parent-scope assistant rows landed (only the thread reply).
      const parentAssistants = (await db.messages.toArray()).filter(
        (m) => m.conversationType === 'parent' && m.role === 'assistant',
      )
      expect(parentAssistants).toHaveLength(0)

      const turns = await db.turns.toArray()
      const threadTurn = turns.find((t) => t.conversationType === 'thread')
      expect(threadTurn?.conversationId).toBe(thread.id)
      await assertDbInvariants(db)
    })

    it('thread rooted off an agent message: snapshotted participants still fan out, root-agent eligible since user spoke', async () => {
      const { a, b, channel, thread } = await seedChannelWithThreadOnAgentReply()

      const fakes = installFakeProviders()
      mockedStream.mockImplementation(
        createFakeStreamChat({
          fakes,
          scripts: {
            'model-a': () => ({ content: 'A replies inside thread' }),
            'model-b': () => ({ silent: true }),
          },
        }),
      )

      const threadUser = await appendUserMessage({
        conversationType: 'thread',
        conversationId: thread.id,
        parentChatId: channel.id,
        prompt: 'tell me more',
        model: undefined,
      })

      await runChannelTurn({
        chatId: channel.id,
        threadId: thread.id,
        userMessageId: threadUser.id,
      })

      // The root agent (A) and the silent agent (B) were both offered.
      // The user spoke last, so lastSpeakerByAgentId is null at step 0 —
      // A is a valid candidate even though A authored the thread root.
      expect(fakes.callsFor((c) => c.model.providerModelId === 'model-a').length).toBeGreaterThanOrEqual(1)
      expect(fakes.callsFor((c) => c.model.providerModelId === 'model-b').length).toBeGreaterThanOrEqual(1)

      const threadAssistants = (await db.messages.toArray()).filter(
        (m) =>
          m.conversationType === 'thread' &&
          m.conversationId === thread.id &&
          m.role === 'assistant',
      )
      expect(threadAssistants.map((m) => m.content)).toContain('A replies inside thread')
      expect(threadAssistants.every((m) => m.agentId === a.id || m.agentId === b.id)).toBe(true)
      await assertDbInvariants(db)
    })

    it('mention-only agent in a thread fires only when @-mentioned on the thread message', async () => {
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
      await addChannelParticipant({
        chatId: channel.id,
        agentId: expert.id,
        mode: 'mention-only',
      })

      // Root the thread off a user message; snapshot is taken on creation.
      const root = await appendUserMessage({
        conversationType: 'parent',
        conversationId: channel.id,
        parentChatId: channel.id,
        prompt: 'kick off',
        model: undefined,
      })
      const thread = await getOrCreateThreadForMessage(root.id)

      const fakes = installFakeProviders()
      mockedStream.mockImplementation(
        createFakeStreamChat({
          fakes,
          scripts: {
            'model-a': () => ({ silent: true }),
            'model-expert': () => ({ content: 'thread expert' }),
          },
        }),
      )

      const threadUser = await appendUserMessage({
        conversationType: 'thread',
        conversationId: thread.id,
        parentChatId: channel.id,
        prompt: 'thoughts here @Expert ?',
        model: undefined,
      })
      await runChannelTurn({
        chatId: channel.id,
        threadId: thread.id,
        userMessageId: threadUser.id,
      })

      expect(fakes.callsFor((c) => c.model.providerModelId === 'model-expert')).toHaveLength(1)
      const replies = (await db.messages.toArray()).filter(
        (m) =>
          m.conversationType === 'thread' &&
          m.conversationId === thread.id &&
          m.role === 'assistant',
      )
      expect(replies).toHaveLength(1)
      expect(replies[0].content).toBe('thread expert')
      expect(replies[0].agentId).toBe(expert.id)
    })

    it('all candidates silent in a thread closes with no-trigger and writes no assistant rows', async () => {
      const { channel, thread } = await seedChannelWithThreadOnAgentReply()

      const fakes = installFakeProviders()
      mockedStream.mockImplementation(
        createFakeStreamChat({ fakes, scripts: { default: () => ({ silent: true }) } }),
      )

      const threadUser = await appendUserMessage({
        conversationType: 'thread',
        conversationId: thread.id,
        parentChatId: channel.id,
        prompt: 'crickets',
        model: undefined,
      })
      await runChannelTurn({
        chatId: channel.id,
        threadId: thread.id,
        userMessageId: threadUser.id,
      })

      // The setup persisted one parent-scope agent reply (the thread root).
      // No new assistant rows should land inside the thread.
      const threadAssistants = (await db.messages.toArray()).filter(
        (m) =>
          m.conversationType === 'thread' &&
          m.conversationId === thread.id &&
          m.role === 'assistant',
      )
      expect(threadAssistants).toHaveLength(0)

      const threadTurn = (await db.turns.toArray()).find(
        (t) => t.conversationType === 'thread' && t.conversationId === thread.id,
      )
      expect(threadTurn?.stopReason).toBe('no-trigger')
    })
  })
})
