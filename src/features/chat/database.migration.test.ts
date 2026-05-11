import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

import { db, LlmSlackDatabase } from './database'

const TEST_DB_NAME = 'llm-slack-migration-test'

async function withV4Db(seed: (legacy: Dexie) => Promise<void>) {
  const legacy = new Dexie(TEST_DB_NAME)
  legacy.version(1).stores({
    parentChats: 'id, createdAt, updatedAt, archivedAt',
    threads: 'id, rootMessageId, parentChatId, parentThreadId, updatedAt',
    messages:
      'id, conversationType, conversationId, parentChatId, createdAt, [conversationId+createdAt]',
    settings: 'id',
  })
  legacy.version(2).stores({
    parentChats: 'id, createdAt, updatedAt, archivedAt',
    threads: 'id, rootMessageId, parentChatId, parentThreadId, updatedAt',
    messages:
      'id, conversationType, conversationId, parentChatId, createdAt, [conversationId+createdAt]',
    pinnedMessages:
      'id, parentChatId, conversationType, conversationId, messageId, pinnedAt, sortKey, [conversationId+sortKey], &[conversationId+messageId], [parentChatId+pinnedAt]',
    settings: 'id',
  })
  legacy.version(3).stores({
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
  legacy.version(4).stores({
    parentChats: 'id, createdAt, updatedAt, archivedAt, starredAt',
    threads: 'id, rootMessageId, parentChatId, parentThreadId, updatedAt',
    messages:
      'id, conversationType, conversationId, parentChatId, createdAt, [conversationId+createdAt]',
    pinnedMessages:
      'id, parentChatId, conversationType, conversationId, messageId, pinnedAt, sortKey, [conversationId+sortKey], &[conversationId+messageId], [parentChatId+pinnedAt]',
    savedMessages:
      'id, createdAt, &messageId, parentChatId, [parentChatId+createdAt]',
    settings: 'id',
  })

  await legacy.open()
  try {
    await seed(legacy)
  } finally {
    legacy.close()
  }
}

afterEach(async () => {
  await Dexie.delete(TEST_DB_NAME)
})

describe('v5 migration', () => {
  it('seeds an openrouter provider from legacy settings and rewrites string model fields into ModelRef', async () => {
    await withV4Db(async (legacy) => {
      await legacy.table('settings').put({
        id: 'app',
        userName: 'Tester',
        defaultModel: 'openai/gpt-4o-mini',
        theme: 'aubergine',
        openRouterApiKey: 'sk-or-test',
        siteUrl: 'https://example.test',
        siteName: 'llm-slack',
      })
      await legacy.table('parentChats').put({
        id: 'parent-1',
        title: 'Hello',
        model: 'openai/gpt-4o-mini',
        createdAt: 1,
        updatedAt: 1,
        draft: '',
        lastActivityPreview: '',
      })
      await legacy.table('messages').put({
        id: 'msg-1',
        conversationType: 'parent',
        conversationId: 'parent-1',
        parentChatId: 'parent-1',
        role: 'user',
        content: 'hi',
        createdAt: 1,
        status: 'complete',
        directReplyCount: 0,
        model: 'openai/gpt-4o-mini',
      })
    })

    const upgraded = new LlmSlackDatabase(TEST_DB_NAME)
    await upgraded.open()
    try {
      const providers = await upgraded.providers.toArray()
      expect(providers).toHaveLength(1)
      const provider = providers[0]
      expect(provider.kind).toBe('openrouter')
      expect(provider.apiKey).toBe('sk-or-test')
      expect(provider.metadata).toEqual({
        siteUrl: 'https://example.test',
        siteName: 'llm-slack',
      })

      const settings = await upgraded.settings.get('app')
      expect(settings?.defaultModel).toEqual({
        providerId: provider.id,
        providerKind: 'openrouter',
        providerModelId: 'openai/gpt-4o-mini',
      })
      expect((settings as unknown as Record<string, unknown>).openRouterApiKey).toBeUndefined()
      expect((settings as unknown as Record<string, unknown>).siteUrl).toBeUndefined()

      const parent = await upgraded.parentChats.get('parent-1')
      expect(parent?.model).toEqual({
        providerKind: 'openrouter',
        providerModelId: 'openai/gpt-4o-mini',
        providerId: provider.id,
      })

      const message = await upgraded.messages.get('msg-1')
      expect(message?.model).toEqual({
        providerKind: 'openrouter',
        providerModelId: 'openai/gpt-4o-mini',
        providerId: provider.id,
      })
    } finally {
      upgraded.close()
    }
  })

  it('leaves provider table empty when legacy settings has no api key', async () => {
    await withV4Db(async (legacy) => {
      await legacy.table('settings').put({
        id: 'app',
        userName: 'Tester',
        defaultModel: null,
        theme: 'aubergine',
      })
    })

    const upgraded = new LlmSlackDatabase(TEST_DB_NAME)
    await upgraded.open()
    try {
      const providers = await upgraded.providers.toArray()
      expect(providers).toHaveLength(0)
      const settings = await upgraded.settings.get('app')
      expect(settings?.defaultModel).toBeNull()
    } finally {
      upgraded.close()
    }
  })
})

describe('module singleton db', () => {
  it('opens cleanly on a fresh IDB (no legacy rows)', async () => {
    await db.open()
    expect(db.verno).toBeGreaterThanOrEqual(5)
  })
})
