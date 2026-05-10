import Dexie, { type EntityTable } from 'dexie'

import type {
  ChatMessage,
  ConversationThread,
  ParentChat,
  PinnedMessage,
  SavedMessage,
} from '@/features/chat/domain'
import type { ModelOverride, ProviderConnection } from '@/features/providers/entities'
import type { AppSettings } from '@/features/settings/settings-repository'

export class LlmSlackDatabase extends Dexie {
  parentChats!: EntityTable<ParentChat, 'id'>
  threads!: EntityTable<ConversationThread, 'id'>
  messages!: EntityTable<ChatMessage, 'id'>
  pinnedMessages!: EntityTable<PinnedMessage, 'id'>
  savedMessages!: EntityTable<SavedMessage, 'id'>
  providers!: EntityTable<ProviderConnection, 'id'>
  modelOverrides!: EntityTable<ModelOverride, 'id'>
  settings!: EntityTable<AppSettings, 'id'>

  constructor(name = 'llm-slack') {
    super(name)

    this.version(1).stores({
      parentChats: 'id, createdAt, updatedAt, archivedAt, starredAt',
      threads: 'id, rootMessageId, parentChatId, parentThreadId, updatedAt',
      messages:
        'id, conversationType, conversationId, parentChatId, createdAt, [conversationId+createdAt]',
      pinnedMessages:
        'id, parentChatId, conversationType, conversationId, messageId, pinnedAt, sortKey, [conversationId+sortKey], &[conversationId+messageId], [parentChatId+pinnedAt]',
      savedMessages:
        'id, createdAt, &messageId, parentChatId, [parentChatId+createdAt]',
      providers: 'id, kind, createdAt',
      modelOverrides: 'id, providerId, &[providerId+providerModelId]',
      settings: 'id',
    })
  }
}

export const db = new LlmSlackDatabase()
