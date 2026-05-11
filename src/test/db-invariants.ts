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

  // EXTENSION POINTS for later units:
  // - U1: agents.model.providerId resolves; kind='channel' implies agentId=null;
  //   kind='dm' allows agentId set; messages.agentId resolves when set.
  // - U5: chatParticipants.chatId resolves to a kind='channel' parent (or, post-U11,
  //   a thread whose parent is kind='channel'); chatParticipants.agentId resolves;
  //   (chatId, agentId) is unique; no chatParticipants on kind='dm' chats.
  // - U6: every closed turn has a stopReason; every attempt belongs to a turn.

  if (failures.length > 0) {
    throw new InvariantViolation(failures)
  }
}
