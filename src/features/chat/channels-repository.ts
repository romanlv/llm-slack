import Dexie from 'dexie'

import { db } from '@/features/chat/database'
import { channelDefaults, newParticipantMode } from '@/features/chat/defaults'
import {
  type ChannelParticipant,
  type ChannelSettings,
  type ParentChat,
  type ParticipationMode,
} from '@/features/chat/domain'

// Channel-host repository: parentChats.kind='channel' rows and (via R17/U11)
// any threads.id whose parent chat is a channel. Keeps the channel-shape
// invariants (R6/R7) enforceable in one place so the orchestrator and the
// settings UI agree.

export interface CreateChannelParticipantInput {
  agentId: string
  mode?: ParticipationMode
}

export interface CreateChannelInput {
  title: string
  participants?: CreateChannelParticipantInput[]
}

// Atomic channel creation: parentChats row + chatParticipants rows + a
// channelSettings row populated with app-level defaults, all in one
// transaction. The Channel tab in the new-chat modal goes through this so
// the user never sees a partial channel (chat without participants, or
// participants without settings).
export async function createChannel(input: CreateChannelInput): Promise<ParentChat> {
  const title = input.title.trim()
  if (!title) {
    throw new Error('Channel title is required.')
  }
  const participants = input.participants ?? []
  const seenAgentIds = new Set<string>()
  for (const participant of participants) {
    if (seenAgentIds.has(participant.agentId)) {
      throw new Error(
        `Agent "${participant.agentId}" cannot be a channel participant twice.`,
      )
    }
    seenAgentIds.add(participant.agentId)
  }

  return db.transaction(
    'rw',
    [db.parentChats, db.chatParticipants, db.channelSettings, db.agents],
    async () => {
      for (const participant of participants) {
        const agent = await db.agents.get(participant.agentId)
        if (!agent) {
          throw new Error(
            `Cannot create channel: agent "${participant.agentId}" does not exist.`,
          )
        }
      }

      const now = Date.now()
      const chat: ParentChat = {
        id: crypto.randomUUID(),
        title,
        model: null,
        kind: 'channel',
        createdAt: now,
        updatedAt: now,
        draft: '',
        lastActivityPreview: 'Start the conversation.',
      }
      await db.parentChats.add(chat)

      const settings: ChannelSettings = {
        id: chat.id,
        ...channelDefaults,
        createdAt: now,
        updatedAt: now,
      }
      await db.channelSettings.put(settings)

      // Strictly-monotonic sortKey so listing order is stable even when
      // several adds share a millisecond.
      const baseSortKey = Math.max(now, 0)
      const rows: ChannelParticipant[] = participants.map((participant, index) => ({
        id: crypto.randomUUID(),
        chatId: chat.id,
        agentId: participant.agentId,
        mode: participant.mode ?? newParticipantMode,
        sortKey: baseSortKey + index,
        createdAt: now,
      }))
      if (rows.length > 0) {
        await db.chatParticipants.bulkAdd(rows)
      }

      return chat
    },
  )
}

// A "channel target" is either a parent channel chat or a thread whose
// parent chat is kind='channel' (R17/U11). Both are valid hosts for
// chatParticipants. Throws if the id resolves to neither, or to a non-channel.
export async function assertChannelChat(chatId: string) {
  const chat = await db.parentChats.get(chatId)
  if (chat) {
    if (chat.kind !== 'channel') {
      throw new Error(`Chat "${chatId}" is not a channel (kind="${chat.kind}").`)
    }
    if (chat.agentId) {
      throw new Error(
        `Chat "${chatId}" has kind="channel" but also agentId="${chat.agentId}". Invariant violation.`,
      )
    }
    return chat
  }
  const thread = await db.threads.get(chatId)
  if (thread) {
    const parent = await db.parentChats.get(thread.parentChatId)
    if (!parent || parent.kind !== 'channel') {
      throw new Error(
        `Thread "${chatId}" is not under a channel; channel ops are not allowed here.`,
      )
    }
    return parent
  }
  throw new Error(`Channel target "${chatId}" does not exist.`)
}

export async function listChannelParticipants(chatId: string): Promise<ChannelParticipant[]> {
  return db.chatParticipants
    .where('[chatId+sortKey]')
    .between([chatId, Dexie.minKey], [chatId, Dexie.maxKey])
    .toArray()
}

export interface AddParticipantInput {
  chatId: string
  agentId: string
  mode?: ParticipationMode
}

export async function addChannelParticipant(
  input: AddParticipantInput,
): Promise<ChannelParticipant> {
  return db.transaction(
    'rw',
    [db.chatParticipants, db.parentChats, db.agents],
    async () => {
      await assertChannelChat(input.chatId)
      const agent = await db.agents.get(input.agentId)
      if (!agent) {
        throw new Error(`Agent "${input.agentId}" does not exist.`)
      }
      const existing = await db.chatParticipants
        .where('[chatId+agentId]')
        .equals([input.chatId, input.agentId])
        .first()
      if (existing) {
        throw new Error(
          `Agent "${input.agentId}" is already a participant in channel "${input.chatId}".`,
        )
      }
      const now = Date.now()
      const latest = await db.chatParticipants
        .where('[chatId+sortKey]')
        .between([input.chatId, Dexie.minKey], [input.chatId, Dexie.maxKey])
        .reverse()
        .first()
      const sortKey = Math.max(now, (latest?.sortKey ?? 0) + 1)
      const mode = input.mode ?? newParticipantMode
      const row: ChannelParticipant = {
        id: crypto.randomUUID(),
        chatId: input.chatId,
        agentId: input.agentId,
        mode,
        sortKey,
        createdAt: now,
      }
      await db.chatParticipants.add(row)
      return row
    },
  )
}

export async function removeChannelParticipant(
  chatId: string,
  agentId: string,
): Promise<void> {
  const row = await db.chatParticipants
    .where('[chatId+agentId]')
    .equals([chatId, agentId])
    .first()
  if (row) {
    await db.chatParticipants.delete(row.id)
  }
}

export async function setChannelParticipantMode(
  chatId: string,
  agentId: string,
  mode: ParticipationMode,
): Promise<void> {
  const row = await db.chatParticipants
    .where('[chatId+agentId]')
    .equals([chatId, agentId])
    .first()
  if (!row) {
    throw new Error(`Agent "${agentId}" is not a participant in channel "${chatId}".`)
  }
  await db.chatParticipants.update(row.id, { mode })
}

export async function getChannelSettings(
  chatId: string,
): Promise<ChannelSettings | undefined> {
  return db.channelSettings.get(chatId)
}

export async function setChannelSettings(
  chatId: string,
  updates: Partial<Omit<ChannelSettings, 'id' | 'createdAt' | 'updatedAt'>>,
): Promise<ChannelSettings> {
  return db.transaction('rw', [db.channelSettings, db.parentChats], async () => {
    await assertChannelChat(chatId)
    const existing = await db.channelSettings.get(chatId)
    const now = Date.now()
    const next: ChannelSettings = existing
      ? { ...existing, ...updates, updatedAt: now }
      : {
          id: chatId,
          ...channelDefaults,
          ...updates,
          createdAt: now,
          updatedAt: now,
        }
    await db.channelSettings.put(next)
    return next
  })
}
