import { db } from '@/features/chat/database'
import type { Agent } from '@/features/chat/domain'
import type { ModelRef } from '@/features/providers/model-ref'

export interface CreateAgentInput {
  displayName: string
  // Optional on create — when omitted, the repository derives a slug
  // from the display name and appends a `-2`, `-3`, … suffix as needed
  // to keep the @-handle unique.
  username?: string
  model: ModelRef
  systemPrompt?: string
}

export interface UpdateAgentInput {
  displayName?: string
  username?: string
  model?: ModelRef
  systemPrompt?: string
}

export class AgentValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentValidationError'
  }
}

// Username rules: lowercase letters, digits, dash, underscore; 1–32 chars.
// Kept narrow on purpose — @mentions need to be unambiguous against
// surrounding punctuation, and the autocomplete query is a simple prefix.
const USERNAME_PATTERN = /^[a-z0-9_-]{1,32}$/

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase()
}

// Derive a sensible default from a display name. Used by the editor to
// pre-fill the field and by the v9 migration to backfill legacy rows.
// Collapses anything outside [a-z0-9] to `-`, trims dashes from the ends,
// caps length, and falls back to "agent" if nothing usable remains.
export function suggestUsernameFromDisplayName(displayName: string): string {
  const slug = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return slug || 'agent'
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
  // Caller-supplied username is validated strictly; an omitted one falls
  // back to a derived-and-deduped slug inside the transaction (so two
  // simultaneous creates with the same display name don't collide).
  const explicitUsername =
    input.username !== undefined ? normalizeUsername(input.username) : null
  if (explicitUsername !== null && !USERNAME_PATTERN.test(explicitUsername)) {
    throw new AgentValidationError(USERNAME_FORMAT_MESSAGE)
  }
  // Tie-break monotonically per AGENTS.md so two creates within the same
  // millisecond still order deterministically by createdAt.
  return db.transaction('rw', db.agents, async () => {
    const username =
      explicitUsername ?? (await pickUniqueDerivedUsername(displayName))
    if (explicitUsername !== null) {
      const taken = await db.agents.where('username').equals(username).first()
      if (taken) {
        throw new AgentValidationError(`Username "@${username}" is already taken.`)
      }
    }
    const latest = await db.agents.orderBy('createdAt').last()
    const now = Math.max(Date.now(), (latest?.createdAt ?? 0) + 1)
    const agent: Agent = {
      id: crypto.randomUUID(),
      displayName,
      username,
      model: input.model,
      systemPrompt: input.systemPrompt ?? '',
      createdAt: now,
      updatedAt: now,
    }
    await db.agents.add(agent)
    return agent
  })
}

const USERNAME_FORMAT_MESSAGE =
  'Username must be 1–32 characters of lowercase letters, digits, dashes, or underscores.'

async function pickUniqueDerivedUsername(displayName: string): Promise<string> {
  const base = suggestUsernameFromDisplayName(displayName)
  let candidate = base
  let counter = 2
  // The agents store is small in practice and the loop terminates after
  // the first gap, so a sequential probe is fine.
  while (await db.agents.where('username').equals(candidate).first()) {
    candidate = `${base}-${counter}`
    counter += 1
  }
  return candidate
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
    if (updates.username !== undefined) {
      const username = normalizeUsername(updates.username)
      if (!USERNAME_PATTERN.test(username)) {
        throw new AgentValidationError(USERNAME_FORMAT_MESSAGE)
      }
      if (username !== existing.username) {
        const taken = await db.agents.where('username').equals(username).first()
        if (taken) {
          throw new AgentValidationError(`Username "@${username}" is already taken.`)
        }
      }
      patch.username = username
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
