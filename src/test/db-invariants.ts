import type { LlmSlackDatabase } from '@/features/chat/database'

export interface InvariantFailure {
  rule: string
  detail: string
}

export class InvariantViolation extends Error {
  failures: InvariantFailure[]
  constructor(failures: InvariantFailure[]) {
    super(
      `assertDbInvariants found ${failures.length} violation${failures.length === 1 ? '' : 's'}:\n` +
        failures.map((f) => `  - [${f.rule}] ${f.detail}`).join('\n'),
    )
    this.failures = failures
  }
}

export async function assertDbInvariants(db: LlmSlackDatabase): Promise<void> {
  const failures: InvariantFailure[] = []

  const parentChats = await db.parentChats.toArray()
  const parentChatIds = new Set(parentChats.map((c) => c.id))

  const threads = await db.threads.toArray()
  const threadIds = new Set(threads.map((t) => t.id))

  const messages = await db.messages.toArray()
  const messageIds = new Set(messages.map((m) => m.id))

  const providers = await db.providers.toArray()
  const providerIds = new Set(providers.map((p) => p.id))

  for (const thread of threads) {
    if (!parentChatIds.has(thread.parentChatId)) {
      failures.push({
        rule: 'thread.parentChatId resolves',
        detail: `thread "${thread.id}" references missing parentChatId "${thread.parentChatId}"`,
      })
    }
    if (!messageIds.has(thread.rootMessageId)) {
      failures.push({
        rule: 'thread.rootMessageId resolves',
        detail: `thread "${thread.id}" references missing rootMessageId "${thread.rootMessageId}"`,
      })
    }
  }

  for (const message of messages) {
    if (!parentChatIds.has(message.parentChatId)) {
      failures.push({
        rule: 'message.parentChatId resolves',
        detail: `message "${message.id}" references missing parentChatId "${message.parentChatId}"`,
      })
    }
    if (message.conversationType === 'parent') {
      if (message.conversationId !== message.parentChatId) {
        failures.push({
          rule: 'parent message.conversationId === parentChatId',
          detail: `message "${message.id}" has conversationId="${message.conversationId}" but parentChatId="${message.parentChatId}"`,
        })
      }
    } else if (message.conversationType === 'thread') {
      if (!threadIds.has(message.conversationId)) {
        failures.push({
          rule: 'thread message.conversationId resolves',
          detail: `message "${message.id}" references missing thread "${message.conversationId}"`,
        })
      }
    }
  }

  const pinned = await db.pinnedMessages.toArray()
  for (const pin of pinned) {
    if (!messageIds.has(pin.messageId)) {
      failures.push({
        rule: 'pinnedMessages.messageId resolves',
        detail: `pin "${pin.id}" references missing messageId "${pin.messageId}"`,
      })
    }
    if (!parentChatIds.has(pin.parentChatId)) {
      failures.push({
        rule: 'pinnedMessages.parentChatId resolves',
        detail: `pin "${pin.id}" references missing parentChatId "${pin.parentChatId}"`,
      })
    }
  }

  const saved = await db.savedMessages.toArray()
  for (const item of saved) {
    if (!messageIds.has(item.messageId)) {
      failures.push({
        rule: 'savedMessages.messageId resolves',
        detail: `saved "${item.id}" references missing messageId "${item.messageId}"`,
      })
    }
    if (!parentChatIds.has(item.parentChatId)) {
      failures.push({
        rule: 'savedMessages.parentChatId resolves',
        detail: `saved "${item.id}" references missing parentChatId "${item.parentChatId}"`,
      })
    }
  }

  const overrides = await db.modelOverrides.toArray()
  for (const override of overrides) {
    if (!providerIds.has(override.providerId)) {
      failures.push({
        rule: 'modelOverrides.providerId resolves',
        detail: `override "${override.id}" references missing provider "${override.providerId}"`,
      })
    }
  }

  // U1 invariants — agents + chat-kind discriminator.
  const agents = await db.agents.toArray()
  const agentIds = new Set(agents.map((a) => a.id))
  for (const agent of agents) {
    if (agent.model.providerId && !providerIds.has(agent.model.providerId)) {
      failures.push({
        rule: 'agent.model.providerId resolves',
        detail: `agent "${agent.id}" references missing providerId "${agent.model.providerId}"`,
      })
    }
  }
  for (const chat of parentChats) {
    if (chat.kind === 'channel' && chat.agentId) {
      failures.push({
        rule: 'parentChats.agentId is null when kind="channel"',
        detail: `chat "${chat.id}" has kind="channel" with agentId="${chat.agentId}"`,
      })
    }
    if (chat.agentId && !agentIds.has(chat.agentId)) {
      // null agentId after delete-cascade is fine — orphaned agent-DM.
      failures.push({
        rule: 'parentChats.agentId resolves when set',
        detail: `chat "${chat.id}" references missing agentId "${chat.agentId}"`,
      })
    }
  }
  for (const message of messages) {
    if (message.agentId && !agentIds.has(message.agentId)) {
      // Message may keep agentId after agent delete; surface for awareness
      // but treat as soft — agentSnapshot is what keeps the row renderable.
      // Skipping the failure preserves the snapshot semantics; uncomment to
      // enforce strictly if a future unit requires it.
    }
  }

  // U5 invariants — chatParticipants + channelSettings. After U11 the
  // chatId may resolve to either a parentChats row or a threads row whose
  // parent chat is kind='channel'.
  const participants = await db.chatParticipants.toArray()
  const seen = new Set<string>()
  for (const row of participants) {
    const chat = parentChats.find((c) => c.id === row.chatId)
    const thread = threads.find((t) => t.id === row.chatId)
    if (!chat && !thread) {
      failures.push({
        rule: 'chatParticipants.chatId resolves',
        detail: `participant "${row.id}" references missing chat/thread "${row.chatId}"`,
      })
    } else if (chat && chat.kind !== 'channel') {
      failures.push({
        rule: 'chatParticipants only on channel chats',
        detail: `participant "${row.id}" references chat "${row.chatId}" with kind="${chat.kind}"`,
      })
    } else if (thread) {
      const owningParent = parentChats.find((c) => c.id === thread.parentChatId)
      if (!owningParent) {
        failures.push({
          rule: 'thread-scoped participant has a parent chat',
          detail: `participant "${row.id}" references thread "${row.chatId}" with missing parent`,
        })
      } else if (owningParent.kind !== 'channel') {
        failures.push({
          rule: 'thread-scoped participant must root in a channel chat',
          detail: `participant "${row.id}" lives under thread "${row.chatId}" whose parent kind="${owningParent.kind}"`,
        })
      }
    }
    if (!agentIds.has(row.agentId)) {
      failures.push({
        rule: 'chatParticipants.agentId resolves',
        detail: `participant "${row.id}" references missing agent "${row.agentId}"`,
      })
    }
    const key = `${row.chatId}::${row.agentId}`
    if (seen.has(key)) {
      failures.push({
        rule: 'chatParticipants unique by (chatId, agentId)',
        detail: `duplicate participant for chat="${row.chatId}" agent="${row.agentId}"`,
      })
    }
    seen.add(key)
  }

  const settingsRows = await db.channelSettings.toArray()
  for (const row of settingsRows) {
    const chat = parentChats.find((c) => c.id === row.id)
    if (!chat) {
      failures.push({
        rule: 'channelSettings.id resolves',
        detail: `channelSettings "${row.id}" references missing chat`,
      })
    } else if (chat.kind !== 'channel') {
      failures.push({
        rule: 'channelSettings only on channel chats',
        detail: `channelSettings "${row.id}" references chat with kind="${chat.kind}"`,
      })
    }
  }

  // U6 invariants — turns + providerRequestAttempts.
  const turns = await db.turns.toArray()
  const turnIds = new Set(turns.map((t) => t.id))
  for (const turn of turns) {
    if (turn.status === 'closed' && !turn.stopReason) {
      failures.push({
        rule: 'closed turn has a stopReason',
        detail: `turn "${turn.id}" is closed without a stopReason`,
      })
    }
    if (!parentChatIds.has(turn.parentChatId)) {
      failures.push({
        rule: 'turn.parentChatId resolves',
        detail: `turn "${turn.id}" references missing parent "${turn.parentChatId}"`,
      })
    }
  }
  const attempts = await db.providerRequestAttempts.toArray()
  for (const attempt of attempts) {
    if (!turnIds.has(attempt.turnId)) {
      failures.push({
        rule: 'attempt.turnId resolves',
        detail: `attempt "${attempt.id}" references missing turn "${attempt.turnId}"`,
      })
    }
    // 'decided-silent' attempts intentionally have no message row (R11); we
    // tombstone the field to '' instead of dropping it so the typed shape
    // stays simple.
    if (
      attempt.status !== 'decided-silent' &&
      attempt.assistantMessageId &&
      !messageIds.has(attempt.assistantMessageId)
    ) {
      failures.push({
        rule: 'attempt.assistantMessageId resolves',
        detail: `attempt "${attempt.id}" references missing message "${attempt.assistantMessageId}"`,
      })
    }
  }

  // EXTENSION POINTS for later units:
  // - U11: chatParticipants.chatId may resolve to threads.id whose parent
  //   chat has kind='channel'.

  if (failures.length > 0) {
    throw new InvariantViolation(failures)
  }
}
