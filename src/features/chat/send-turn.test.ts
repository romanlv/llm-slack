import { beforeEach, describe, expect, it, vi } from 'vitest'

import { archiveParentChat, createParentChat, db, getOrCreateThreadForMessage } from './repository'
import { sendParentChatTurn, sendThreadTurn } from './send-turn'
import { createAgent } from '@/features/agents/agents-repository'
import { openrouterAdapter } from '@/features/providers/adapters/openrouter'
import { openaiCompatibleAdapter } from '@/features/providers/adapters/openai-compatible'
import { createProvider } from '@/features/providers/providers-repository'
import type { ModelRef } from '@/features/providers/model-ref'

vi.mock('@/features/providers/adapters/openrouter', async (importActual) => {
  const actual = await importActual<typeof import('@/features/providers/adapters/openrouter')>()
  return {
    ...actual,
    openrouterAdapter: {
      ...actual.openrouterAdapter,
      streamChat: vi.fn(),
    },
  }
})

vi.mock('@/features/providers/adapters/openai-compatible', async (importActual) => {
  const actual =
    await importActual<typeof import('@/features/providers/adapters/openai-compatible')>()
  return {
    ...actual,
    openaiCompatibleAdapter: {
      ...actual.openaiCompatibleAdapter,
      streamChat: vi.fn(),
    },
  }
})

const mockedStreamChat = vi.mocked(openrouterAdapter.streamChat)
const mockedOpenaiCompatStream = vi.mocked(openaiCompatibleAdapter.streamChat)

const MODEL_A: ModelRef = {
  providerKind: 'openrouter',
  providerModelId: 'model-a',
}

async function seedOpenRouterProvider() {
  await createProvider({ kind: 'openrouter', label: 'OpenRouter', apiKey: 'key' })
}

beforeEach(async () => {
  mockedStreamChat.mockReset()
  mockedOpenaiCompatStream.mockReset()
  await db.providers.clear()
  await db.modelOverrides.clear()
})

describe('send turn lifecycle', () => {
  it('prevents sends in archived parent chats before persisting messages', async () => {
    const parentChat = await createParentChat({ title: 'Archived', model: MODEL_A })
    await seedOpenRouterProvider()
    await archiveParentChat(parentChat.id)

    await expect(sendParentChatTurn(parentChat.id, 'hello')).rejects.toThrow(
      'Archived conversations cannot accept new sends.',
    )

    expect(mockedStreamChat).not.toHaveBeenCalled()
    await expect(db.messages.count()).resolves.toBe(0)
  })

  it('prevents sends in threads owned by archived parent chats', async () => {
    const parentChat = await createParentChat({ title: 'Archived', model: MODEL_A })
    const rootMessageId = crypto.randomUUID()
    await db.messages.add({
      id: rootMessageId,
      conversationType: 'parent',
      conversationId: parentChat.id,
      parentChatId: parentChat.id,
      role: 'user',
      content: 'root',
      createdAt: Date.now(),
      status: 'complete',
      directReplyCount: 0,
      model: parentChat.model ?? undefined,
    })
    const thread = await getOrCreateThreadForMessage(rootMessageId)
    await seedOpenRouterProvider()
    await archiveParentChat(parentChat.id)

    await expect(sendThreadTurn(thread.id, 'hello')).rejects.toThrow(
      'Archived conversations cannot accept new sends.',
    )

    expect(mockedStreamChat).not.toHaveBeenCalled()
    await expect(db.messages.where('conversationId').equals(thread.id).count()).resolves.toBe(0)
  })

  it('persists a failed parent send with a user message and errored assistant message', async () => {
    mockedStreamChat.mockRejectedValueOnce(new Error('rate limited'))
    const parentChat = await createParentChat({ title: 'Untitled chat', model: MODEL_A })
    await seedOpenRouterProvider()

    await expect(sendParentChatTurn(parentChat.id, '  Explain testing  ')).rejects.toThrow(
      'rate limited',
    )

    const messages = await db.messages
      .where('[conversationId+createdAt]')
      .between([parentChat.id, 0], [parentChat.id, Number.MAX_SAFE_INTEGER])
      .sortBy('createdAt')

    const userMessage = messages.find((message) => message.role === 'user')
    const assistantMessage = messages.find((message) => message.role === 'assistant')

    expect(messages).toHaveLength(2)
    expect(userMessage).toMatchObject({
      role: 'user',
      content: 'Explain testing',
      status: 'complete',
    })
    expect(userMessage?.model?.providerModelId).toBe('model-a')
    expect(assistantMessage).toMatchObject({
      role: 'assistant',
      content: 'Request failed: rate limited',
      status: 'error',
      error: 'rate limited',
    })
    expect(assistantMessage?.model?.providerModelId).toBe('model-a')
    await expect(db.parentChats.get(parentChat.id)).resolves.toMatchObject({
      draft: '',
      title: 'Explain testing',
      lastActivityPreview: 'Request failed: rate limited',
    })
  })

  it('rejects an openrouter send with /no API key set/ when the connection has no key', async () => {
    const parentChat = await createParentChat({ title: 'No-key', model: MODEL_A })
    await createProvider({ kind: 'openrouter', label: 'OpenRouter', apiKey: '' })

    await expect(sendParentChatTurn(parentChat.id, 'hi')).rejects.toThrow(/no API key set/i)
    expect(mockedStreamChat).not.toHaveBeenCalled()
  })

  it('agent-DM prepends the system prompt and routes through the agent model + snapshot', async () => {
    mockedStreamChat.mockResolvedValueOnce({ content: 'critic reply', id: 'req-agent' })

    const agent = await createAgent({
      displayName: 'Critic',
      model: { providerKind: 'openrouter', providerModelId: 'agent-model' },
      systemPrompt: 'You are a critic. Push back.',
    })
    const parentChat = await createParentChat({
      kind: 'dm',
      agentId: agent.id,
      title: 'DM with critic',
      model: agent.model,
    })
    await seedOpenRouterProvider()

    await sendParentChatTurn(parentChat.id, 'is this a good idea?')

    expect(mockedStreamChat).toHaveBeenCalledTimes(1)
    const [, modelArg, inputArg] = mockedStreamChat.mock.calls[0]
    expect(modelArg.providerModelId).toBe('agent-model')
    // The first transport message must be the agent's system prompt.
    expect(inputArg.messages[0]).toEqual({
      role: 'system',
      content: 'You are a critic. Push back.',
    })
    expect(inputArg.messages.at(-1)).toMatchObject({
      role: 'user',
      content: 'is this a good idea?',
    })

    const assistant = await db.messages
      .where({ conversationId: parentChat.id })
      .filter((m) => m.role === 'assistant')
      .first()
    expect(assistant?.agentId).toBe(agent.id)
    expect(assistant?.agentSnapshot).toEqual({
      displayName: 'Critic',
      model: expect.objectContaining({ providerModelId: 'agent-model' }),
    })
  })

  it('model-DM transport carries no system prefix (AE7 byte-for-byte parity)', async () => {
    mockedStreamChat.mockResolvedValueOnce({ content: 'ok', id: 'r' })
    const parentChat = await createParentChat({ title: 'plain dm', model: MODEL_A })
    await seedOpenRouterProvider()

    await sendParentChatTurn(parentChat.id, 'hi')

    const [, , inputArg] = mockedStreamChat.mock.calls[0]
    expect(inputArg.messages.every((m: { role: string }) => m.role !== 'system')).toBe(true)

    const assistant = await db.messages
      .where({ conversationId: parentChat.id })
      .filter((m) => m.role === 'assistant')
      .first()
    expect(assistant?.agentId).toBeUndefined()
    expect(assistant?.agentSnapshot).toBeUndefined()
  })

  it('omits the system prefix when the agent has an empty system prompt', async () => {
    mockedStreamChat.mockResolvedValueOnce({ content: 'reply', id: 'r' })
    const agent = await createAgent({
      displayName: 'Empty',
      model: { providerKind: 'openrouter', providerModelId: 'agent-model-2' },
      systemPrompt: '   ',
    })
    const parentChat = await createParentChat({
      kind: 'dm',
      agentId: agent.id,
      title: 'silent prompt',
      model: agent.model,
    })
    await seedOpenRouterProvider()

    await sendParentChatTurn(parentChat.id, 'hi')

    const [, , inputArg] = mockedStreamChat.mock.calls[0]
    expect(inputArg.messages.every((m: { role: string }) => m.role !== 'system')).toBe(true)
  })

  it('refuses to send when the agent-DM references a deleted agent (orphan)', async () => {
    const agent = await createAgent({
      displayName: 'Will be deleted',
      model: { providerKind: 'openrouter', providerModelId: 'm' },
    })
    const parentChat = await createParentChat({
      kind: 'dm',
      agentId: agent.id,
      title: 'orphan',
      model: agent.model,
    })
    await seedOpenRouterProvider()

    // Orphan the chat — agent definition is gone, parentChat.agentId remains
    // (the agents-repository delete cascade clears it, but we simulate the
    // pre-cascade state by deleting directly to verify the runtime guard).
    await db.agents.delete(agent.id)

    await expect(sendParentChatTurn(parentChat.id, 'still there?')).rejects.toThrow(/orphaned/)
    expect(mockedStreamChat).not.toHaveBeenCalled()
  })

  it('records a turn + attempt for a successful model-DM send and closes with stopReason=complete', async () => {
    mockedStreamChat.mockResolvedValueOnce({ content: 'ok', id: 'req' })
    const parentChat = await createParentChat({ title: 'lifecycle', model: MODEL_A })
    await seedOpenRouterProvider()

    await sendParentChatTurn(parentChat.id, 'hi')

    const turns = await db.turns.toArray()
    expect(turns).toHaveLength(1)
    expect(turns[0].status).toBe('closed')
    expect(turns[0].stopReason).toBe('complete')

    const attempts = await db.providerRequestAttempts.toArray()
    expect(attempts).toHaveLength(1)
    expect(attempts[0].status).toBe('complete')
    expect(attempts[0].attemptNumber).toBe(1)
  })

  it('records turn.stopReason=error when the provider errors', async () => {
    mockedStreamChat.mockRejectedValueOnce(new Error('boom'))
    const parentChat = await createParentChat({ title: 'err', model: MODEL_A })
    await seedOpenRouterProvider()

    await expect(sendParentChatTurn(parentChat.id, 'hi')).rejects.toThrow('boom')

    const turns = await db.turns.toArray()
    expect(turns[0].stopReason).toBe('error')
    const attempts = await db.providerRequestAttempts.toArray()
    expect(attempts[0].status).toBe('error')
    expect(attempts[0].errorCode).toBe('boom')
  })

  it('routes a send to openai-compatible with empty apiKey + baseUrl + metadata.modelId', async () => {
    mockedOpenaiCompatStream.mockResolvedValueOnce({ content: 'hello back', id: 'req-1' })
    const parentChat = await createParentChat({
      title: 'Local Ollama',
      model: {
        providerKind: 'openai-compatible',
        providerModelId: 'llama3.1:70b',
      },
    })
    await createProvider({
      kind: 'openai-compatible',
      label: 'Ollama',
      apiKey: '',
      baseUrl: 'http://localhost:11434/v1',
      metadata: { modelId: 'llama3.1:70b' },
    })

    await sendParentChatTurn(parentChat.id, 'hi local')

    expect(mockedOpenaiCompatStream).toHaveBeenCalled()
    const args = mockedOpenaiCompatStream.mock.calls[0]
    expect(args[0].apiKey).toBe('')
    expect(args[0].baseUrl).toBe('http://localhost:11434/v1')
    expect(args[1].providerModelId).toBe('llama3.1:70b')
  })
})
