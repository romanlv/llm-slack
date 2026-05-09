import Dexie, { type EntityTable } from 'dexie'

import type { ChatMessage, ConversationThread, ParentChat } from '@/features/chat/domain'
import type { AppSettings } from '@/features/settings/settings-repository'

class DeepchatDatabase extends Dexie {
  parentChats!: EntityTable<ParentChat, 'id'>
  threads!: EntityTable<ConversationThread, 'id'>
  messages!: EntityTable<ChatMessage, 'id'>
  settings!: EntityTable<AppSettings, 'id'>

  constructor() {
    super('deepchat-threaded')

    this.version(1).stores({
      parentChats: 'id, createdAt, updatedAt, archivedAt',
      threads: 'id, rootMessageId, parentChatId, parentThreadId, updatedAt',
      messages:
        'id, conversationType, conversationId, parentChatId, createdAt, [conversationId+createdAt]',
      settings: 'id',
    })
  }
}

export const db = new DeepchatDatabase()
