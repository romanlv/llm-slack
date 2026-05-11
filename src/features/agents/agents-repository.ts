import { db } from '@/features/chat/database'
import type { Agent } from '@/features/chat/domain'
import type { ModelRef } from '@/features/providers/model-ref'

export interface CreateAgentInput {
  displayName: string
  model: ModelRef
  systemPrompt?: string
}

export interface UpdateAgentInput {
  displayName?: string
  model?: ModelRef
  systemPrompt?: string
}

export class AgentValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentValidationError'
  }
}

export async function listAgents(): Promise<Agent[]> {
  return db.agents.orderBy('createdAt').toArray()
}

export async function getAgent(id: string): Promise<Agent | undefined> {
  return db.agents.get(id)
}

export async function assertAgentExists(id: string): Promise<Agent> {
  const agent = await db.agents.get(id)
  if (!agent) {
    throw new Error(`Agent "${id}" does not exist.`)
  }
  return agent
}

export async function createAgent(input: CreateAgentInput): Promise<Agent> {
  const displayName = input.displayName.trim()
  if (!displayName) {
    throw new AgentValidationError('Agent display name is required.')
  }
  // Tie-break monotonically per AGENTS.md so two creates within the same
  // millisecond still order deterministically by createdAt.
  return db.transaction('rw', db.agents, async () => {
    const latest = await db.agents.orderBy('createdAt').last()
    const now = Math.max(Date.now(), (latest?.createdAt ?? 0) + 1)
    const agent: Agent = {
      id: crypto.randomUUID(),
      displayName,
      model: input.model,
      systemPrompt: input.systemPrompt ?? '',
      createdAt: now,
      updatedAt: now,
    }
    await db.agents.add(agent)
    return agent
  })
}

export async function updateAgent(id: string, updates: UpdateAgentInput): Promise<Agent> {
  return db.transaction('rw', db.agents, async () => {
    const existing = await db.agents.get(id)
    if (!existing) {
      throw new Error(`Cannot update agent: id "${id}" not found.`)
    }
    const patch: Partial<Agent> = { updatedAt: Date.now() }
    if (updates.displayName !== undefined) {
      const trimmed = updates.displayName.trim()
      if (!trimmed) {
        throw new AgentValidationError('Agent display name is required.')
      }
      patch.displayName = trimmed
    }
    if (updates.model !== undefined) patch.model = updates.model
    if (updates.systemPrompt !== undefined) patch.systemPrompt = updates.systemPrompt
    await db.agents.update(id, patch)
    const next = await db.agents.get(id)
    if (!next) {
      throw new Error(`Agent "${id}" disappeared mid-update.`)
    }
    return next
  })
}

// Deleting an agent cascades: agent-DMs that referenced it become orphaned
// — their parentChats.agentId is set to null so the chat persists but the
// UI can render a "deleted agent" placeholder. Messages keep their
// agentSnapshot, so authorship rendering survives. Channel participation
// rows (added in U5) are cleaned up there.
export async function deleteAgent(id: string): Promise<void> {
  await db.transaction('rw', [db.agents, db.parentChats], async () => {
    await db.parentChats
      .where('agentId')
      .equals(id)
      .modify((row) => {
        row.agentId = null
      })
    await db.agents.delete(id)
  })
}
