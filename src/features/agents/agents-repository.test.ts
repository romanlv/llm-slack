import { describe, expect, it } from 'vitest'

import {
  AgentValidationError,
  assertAgentExists,
  createAgent,
  deleteAgent,
  getAgent,
  listAgents,
  updateAgent,
} from '@/features/agents/agents-repository'
import { db } from '@/features/chat/database'
import { createParentChat } from '@/features/chat/repository'
import { withFrozenClock } from '@/test/clock'
import { makeModelRef } from '@/test/fixtures'

const MODEL = makeModelRef({ providerModelId: 'opus-test' })

describe('agents repository', () => {
  it('create + list + update + delete round-trip', async () => {
    const created = await createAgent({
      displayName: 'Critic',
      username: 'critic',
      model: MODEL,
      systemPrompt: 'You are a critic.',
    })
    expect(created.displayName).toBe('Critic')
    expect(created.username).toBe('critic')
    expect(created.systemPrompt).toBe('You are a critic.')

    const listed = await listAgents()
    expect(listed.map((a) => a.id)).toEqual([created.id])

    const updated = await updateAgent(created.id, { systemPrompt: 'Push back firmly.' })
    expect(updated.systemPrompt).toBe('Push back firmly.')
    expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)

    await deleteAgent(created.id)
    expect(await listAgents()).toHaveLength(0)
    expect(await getAgent(created.id)).toBeUndefined()
  })

  it('rejects empty display names on create and update', async () => {
    await expect(
      createAgent({ displayName: '   ', username: 'x', model: MODEL }),
    ).rejects.toBeInstanceOf(AgentValidationError)

    const a = await createAgent({ displayName: 'Strategist', username: 'strat', model: MODEL })
    await expect(
      updateAgent(a.id, { displayName: '' }),
    ).rejects.toBeInstanceOf(AgentValidationError)
  })

  it('rejects malformed usernames and enforces uniqueness', async () => {
    await expect(
      createAgent({ displayName: 'Bad', username: 'has spaces', model: MODEL }),
    ).rejects.toBeInstanceOf(AgentValidationError)
    await expect(
      createAgent({ displayName: 'Bad', username: '', model: MODEL }),
    ).rejects.toBeInstanceOf(AgentValidationError)

    await createAgent({ displayName: 'First', username: 'lead', model: MODEL })
    await expect(
      createAgent({ displayName: 'Second', username: 'Lead', model: MODEL }),
    ).rejects.toBeInstanceOf(AgentValidationError)

    const other = await createAgent({ displayName: 'Other', username: 'other', model: MODEL })
    await expect(
      updateAgent(other.id, { username: 'lead' }),
    ).rejects.toBeInstanceOf(AgentValidationError)
  })

  it('lowercases usernames on create and update', async () => {
    const a = await createAgent({ displayName: 'Mixed', username: 'MiXeD', model: MODEL })
    expect(a.username).toBe('mixed')
    const renamed = await updateAgent(a.id, { username: 'ReNamed' })
    expect(renamed.username).toBe('renamed')
  })

  it('orders by createdAt with strictly-monotonic tie-break under a frozen clock', async () => {
    await withFrozenClock(1_000, async (clock) => {
      const a = await createAgent({ displayName: 'First', username: 'first', model: MODEL })
      const b = await createAgent({ displayName: 'Second', username: 'second', model: MODEL })
      const c = await createAgent({ displayName: 'Third', username: 'third', model: MODEL })
      // Date.now() pinned at 1000 for all three calls; createdAt must still
      // be strictly monotonic so list() ordering is stable.
      expect(a.createdAt).toBe(1_000)
      expect(b.createdAt).toBe(1_001)
      expect(c.createdAt).toBe(1_002)
      clock.advance(0) // proves the clock didn't drift on us
    })

    const listed = await listAgents()
    expect(listed.map((a) => a.displayName)).toEqual(['First', 'Second', 'Third'])
  })

  it('orphans agent-DMs on delete (parentChats.agentId is cleared)', async () => {
    const agent = await createAgent({ displayName: 'Lead', username: 'lead', model: MODEL })
    const chat = await createParentChat({
      kind: 'dm',
      agentId: agent.id,
      title: 'agent-dm',
      model: MODEL,
    })
    expect(chat.agentId).toBe(agent.id)

    await deleteAgent(agent.id)

    const refreshed = await db.parentChats.get(chat.id)
    expect(refreshed?.agentId).toBeNull()
  })

  it('defaults chattiness to the agentDefaults value and accepts an explicit level', async () => {
    const defaulted = await createAgent({
      displayName: 'Default',
      username: 'default',
      model: MODEL,
    })
    expect(defaulted.chattiness).toBe(2)

    const explicit = await createAgent({
      displayName: 'Eager',
      username: 'eager',
      model: MODEL,
      chattiness: 5,
    })
    expect(explicit.chattiness).toBe(5)

    const updated = await updateAgent(explicit.id, { chattiness: 1 })
    expect(updated.chattiness).toBe(1)
  })

  it('assertAgentExists returns the row when present and throws when missing', async () => {
    const agent = await createAgent({ displayName: 'Reviewer', username: 'reviewer', model: MODEL })
    await expect(assertAgentExists(agent.id)).resolves.toMatchObject({ id: agent.id })
    await expect(assertAgentExists('ghost')).rejects.toThrow(/Agent "ghost" does not exist/)
  })
})
