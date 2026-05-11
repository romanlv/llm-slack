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
      model: MODEL,
      systemPrompt: 'You are a critic.',
    })
    expect(created.displayName).toBe('Critic')
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
      createAgent({ displayName: '   ', model: MODEL }),
    ).rejects.toBeInstanceOf(AgentValidationError)

    const a = await createAgent({ displayName: 'Strategist', model: MODEL })
    await expect(
      updateAgent(a.id, { displayName: '' }),
    ).rejects.toBeInstanceOf(AgentValidationError)
  })

  it('orders by createdAt with strictly-monotonic tie-break under a frozen clock', async () => {
    await withFrozenClock(1_000, async (clock) => {
      const a = await createAgent({ displayName: 'First', model: MODEL })
      const b = await createAgent({ displayName: 'Second', model: MODEL })
      const c = await createAgent({ displayName: 'Third', model: MODEL })
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
    const agent = await createAgent({ displayName: 'Lead', model: MODEL })
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

  it('assertAgentExists returns the row when present and throws when missing', async () => {
    const agent = await createAgent({ displayName: 'Reviewer', model: MODEL })
    await expect(assertAgentExists(agent.id)).resolves.toMatchObject({ id: agent.id })
    await expect(assertAgentExists('ghost')).rejects.toThrow(/Agent "ghost" does not exist/)
  })
})
