import Dexie, { type EntityTable } from 'dexie'

import type {
  ChatMessage,
  ConversationThread,
  ParentChat,
  PinnedMessage,
  SavedMessage,
} from '@/features/chat/domain'
import type { AppSettings } from '@/features/settings/settings-repository'

export class DeepchatDatabase extends Dexie {
  parentChats!: EntityTable<ParentChat, 'id'>
  threads!: EntityTable<ConversationThread, 'id'>
  messages!: EntityTable<ChatMessage, 'id'>
  pinnedMessages!: EntityTable<PinnedMessage, 'id'>
  savedMessages!: EntityTable<SavedMessage, 'id'>
  settings!: EntityTable<AppSettings, 'id'>

  constructor(name = 'deepchat-threaded') {
    super(name)

    this.version(1).stores({
      parentChats: 'id, createdAt, updatedAt, archivedAt',
      threads: 'id, rootMessageId, parentChatId, parentThreadId, updatedAt',
      messages:
        'id, conversationType, conversationId, parentChatId, createdAt, [conversationId+createdAt]',
      settings: 'id',
    })

    this.version(2).stores({
      parentChats: 'id, createdAt, updatedAt, archivedAt',
      threads: 'id, rootMessageId, parentChatId, parentThreadId, updatedAt',
      messages:
        'id, conversationType, conversationId, parentChatId, createdAt, [conversationId+createdAt]',
      pinnedMessages:
        'id, parentChatId, conversationType, conversationId, messageId, pinnedAt, sortKey, [conversationId+sortKey], &[conversationId+messageId], [parentChatId+pinnedAt]',
      settings: 'id',
    })

    this.version(3).stores({
      parentChats: 'id, createdAt, updatedAt, archivedAt',
      threads: 'id, rootMessageId, parentChatId, parentThreadId, updatedAt',
      messages:
        'id, conversationType, conversationId, parentChatId, createdAt, [conversationId+createdAt]',
      pinnedMessages:
        'id, parentChatId, conversationType, conversationId, messageId, pinnedAt, sortKey, [conversationId+sortKey], &[conversationId+messageId], [parentChatId+pinnedAt]',
      savedMessages:
        'id, createdAt, &messageId, parentChatId, [parentChatId+createdAt]',
      settings: 'id',
    })
  }
}

export const db = new DeepchatDatabase()
