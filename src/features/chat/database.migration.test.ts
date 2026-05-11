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

async function withV5Db(seed: (legacy: Dexie) => Promise<void>) {
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
  legacy.version(5).stores({
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
  await legacy.open()
  try {
    await seed(legacy)
  } finally {
    legacy.close()
  }
}

describe('v6 migration (multi-agent foundation)', () => {
  it('backfills parentChats.kind to "dm" on legacy rows and leaves existing data intact', async () => {
    await withV5Db(async (legacy) => {
      await legacy.table('parentChats').put({
        id: 'parent-legacy',
        title: 'Legacy chat',
        model: { providerKind: 'openrouter', providerModelId: 'm' },
        createdAt: 1,
        updatedAt: 1,
        draft: '',
        lastActivityPreview: '',
      })
      await legacy.table('messages').put({
        id: 'msg-legacy',
        conversationType: 'parent',
        conversationId: 'parent-legacy',
        parentChatId: 'parent-legacy',
        role: 'user',
        content: 'hi',
        createdAt: 1,
        status: 'complete',
        directReplyCount: 0,
      })
    })

    const upgraded = new LlmSlackDatabase(TEST_DB_NAME)
    await upgraded.open()
    try {
      expect(upgraded.verno).toBeGreaterThanOrEqual(6)

      const parent = await upgraded.parentChats.get('parent-legacy')
      expect(parent?.kind).toBe('dm')
      expect(parent?.agentId).toBeUndefined()
      // Message left intact.
      const message = await upgraded.messages.get('msg-legacy')
      expect(message?.content).toBe('hi')

      // The agents store exists and starts empty.
      expect(await upgraded.agents.count()).toBe(0)
    } finally {
      upgraded.close()
    }
  })

  it('does not overwrite a kind that was already set (re-run safety)', async () => {
    await withV5Db(async (legacy) => {
      await legacy.table('parentChats').put({
        id: 'p',
        title: 'already-set',
        model: null,
        // Pretend a prior upgrade tagged this row already.
        kind: 'channel',
        createdAt: 1,
        updatedAt: 1,
        draft: '',
        lastActivityPreview: '',
      })
    })

    const upgraded = new LlmSlackDatabase(TEST_DB_NAME)
    await upgraded.open()
    try {
      const parent = await upgraded.parentChats.get('p')
      expect(parent?.kind).toBe('channel')
    } finally {
      upgraded.close()
    }
  })
})

async function withV6Db(seed: (legacy: Dexie) => Promise<void>) {
  // Bring the legacy DB to v6, mirroring every prior version inline so the
  // upgrade chain doesn't drift away from production.
  const legacy = new Dexie(TEST_DB_NAME)
  legacy.version(1).stores({
    parentChats: 'id, createdAt, updatedAt, archivedAt',
    threads: 'id, rootMessageId, parentChatId, parentThreadId, updatedAt',
    messages:
      'id, conversationType, conversationId, parentChatId, createdAt, [conversationId+createdAt]',
    settings: 'id',
  })
  legacy.version(2).stores({
    pinnedMessages:
      'id, parentChatId, conversationType, conversationId, messageId, pinnedAt, sortKey, [conversationId+sortKey], &[conversationId+messageId], [parentChatId+pinnedAt]',
  })
  legacy.version(3).stores({
    savedMessages: 'id, createdAt, &messageId, parentChatId, [parentChatId+createdAt]',
  })
  legacy.version(4).stores({
    parentChats: 'id, createdAt, updatedAt, archivedAt, starredAt',
  })
  legacy.version(5).stores({
    providers: 'id, kind, createdAt',
    modelOverrides: 'id, providerId, &[providerId+providerModelId]',
  })
  legacy.version(6).stores({
    parentChats: 'id, createdAt, updatedAt, archivedAt, starredAt, kind, agentId',
    agents: 'id, createdAt, updatedAt',
  })
  await legacy.open()
  try {
    await seed(legacy)
  } finally {
    legacy.close()
  }
}

describe('v7 migration (channel persistence)', () => {
  it('keeps existing data readable and the new channel tables start empty', async () => {
    await withV6Db(async (legacy) => {
      await legacy.table('parentChats').put({
        id: 'p',
        title: 'dm',
        model: { providerKind: 'openrouter', providerModelId: 'm' },
        kind: 'dm',
        createdAt: 1,
        updatedAt: 1,
        draft: '',
        lastActivityPreview: '',
      })
      await legacy.table('agents').put({
        id: 'a',
        displayName: 'Critic',
        model: { providerKind: 'openrouter', providerModelId: 'm' },
        systemPrompt: '',
        createdAt: 1,
        updatedAt: 1,
      })
    })

    const upgraded = new LlmSlackDatabase(TEST_DB_NAME)
    await upgraded.open()
    try {
      expect(upgraded.verno).toBeGreaterThanOrEqual(7)
      expect(await upgraded.parentChats.count()).toBe(1)
      expect(await upgraded.agents.count()).toBe(1)
      expect(await upgraded.chatParticipants.count()).toBe(0)
      expect(await upgraded.channelSettings.count()).toBe(0)
    } finally {
      upgraded.close()
    }
  })
})

async function withV7Db(seed: (legacy: Dexie) => Promise<void>) {
  const legacy = new Dexie(TEST_DB_NAME)
  legacy.version(1).stores({
    parentChats: 'id, createdAt, updatedAt, archivedAt',
    threads: 'id, rootMessageId, parentChatId, parentThreadId, updatedAt',
    messages:
      'id, conversationType, conversationId, parentChatId, createdAt, [conversationId+createdAt]',
    settings: 'id',
  })
  legacy.version(2).stores({
    pinnedMessages:
      'id, parentChatId, conversationType, conversationId, messageId, pinnedAt, sortKey, [conversationId+sortKey], &[conversationId+messageId], [parentChatId+pinnedAt]',
  })
  legacy.version(3).stores({
    savedMessages: 'id, createdAt, &messageId, parentChatId, [parentChatId+createdAt]',
  })
  legacy.version(4).stores({
    parentChats: 'id, createdAt, updatedAt, archivedAt, starredAt',
  })
  legacy.version(5).stores({
    providers: 'id, kind, createdAt',
    modelOverrides: 'id, providerId, &[providerId+providerModelId]',
  })
  legacy.version(6).stores({
    parentChats: 'id, createdAt, updatedAt, archivedAt, starredAt, kind, agentId',
    agents: 'id, createdAt, updatedAt',
  })
  legacy.version(7).stores({
    chatParticipants: 'id, chatId, agentId, [chatId+sortKey], &[chatId+agentId]',
    channelSettings: 'id',
  })
  await legacy.open()
  try {
    await seed(legacy)
  } finally {
    legacy.close()
  }
}

describe('v8 migration (turn lifecycle)', () => {
  it('adds turns + providerRequestAttempts as empty tables; existing data intact', async () => {
    await withV7Db(async (legacy) => {
      await legacy.table('parentChats').put({
        id: 'p',
        title: 'dm',
        model: { providerKind: 'openrouter', providerModelId: 'm' },
        kind: 'dm',
        createdAt: 1,
        updatedAt: 1,
        draft: '',
        lastActivityPreview: '',
      })
    })

    const upgraded = new LlmSlackDatabase(TEST_DB_NAME)
    await upgraded.open()
    try {
      expect(upgraded.verno).toBeGreaterThanOrEqual(8)
      expect(await upgraded.parentChats.count()).toBe(1)
      expect(await upgraded.turns.count()).toBe(0)
      expect(await upgraded.providerRequestAttempts.count()).toBe(0)
    } finally {
      upgraded.close()
    }
  })
})

describe('v9 migration (thread participant snapshot)', () => {
  it('keeps existing chatParticipants intact and the store remains usable with thread-scoped ids', async () => {
    // Boot a v8 DB with a channel + participants, then upgrade. v9 does
    // not transform any rows; it documents that chatParticipants.chatId
    // is now allowed to point to threads.id.
    const legacy = new Dexie(TEST_DB_NAME)
    legacy.version(8).stores({
      parentChats: 'id, createdAt, updatedAt, archivedAt, starredAt, kind, agentId',
      threads: 'id, rootMessageId, parentChatId, parentThreadId, updatedAt',
      messages:
        'id, conversationType, conversationId, parentChatId, createdAt, [conversationId+createdAt]',
      pinnedMessages:
        'id, parentChatId, conversationType, conversationId, messageId, pinnedAt, sortKey, [conversationId+sortKey], &[conversationId+messageId], [parentChatId+pinnedAt]',
      savedMessages: 'id, createdAt, &messageId, parentChatId, [parentChatId+createdAt]',
      providers: 'id, kind, createdAt',
      modelOverrides: 'id, providerId, &[providerId+providerModelId]',
      agents: 'id, createdAt, updatedAt',
      chatParticipants: 'id, chatId, agentId, [chatId+sortKey], &[chatId+agentId]',
      channelSettings: 'id',
      turns: 'id, parentChatId, conversationId, status, [conversationId+createdAt]',
      providerRequestAttempts:
        'id, turnId, assistantMessageId, agentId, [turnId+attemptNumber]',
      settings: 'id',
    })
    await legacy.open()
    try {
      await legacy.table('parentChats').put({
        id: 'channel',
        title: 'c',
        model: null,
        kind: 'channel',
        agentId: null,
        createdAt: 1,
        updatedAt: 1,
        draft: '',
        lastActivityPreview: '',
      })
      await legacy.table('agents').put({
        id: 'agent',
        displayName: 'A',
        model: { providerKind: 'openrouter', providerModelId: 'm' },
        systemPrompt: '',
        createdAt: 1,
        updatedAt: 1,
      })
      await legacy.table('chatParticipants').put({
        id: 'p',
        chatId: 'channel',
        agentId: 'agent',
        mode: 'auto-decide',
        sortKey: 1,
        createdAt: 1,
      })
    } finally {
      legacy.close()
    }

    const upgraded = new LlmSlackDatabase(TEST_DB_NAME)
    await upgraded.open()
    try {
      expect(upgraded.verno).toBeGreaterThanOrEqual(9)
      const rows = await upgraded.chatParticipants.toArray()
      expect(rows).toHaveLength(1)
    } finally {
      upgraded.close()
    }
  })
})

describe('module singleton db', () => {
  it('opens cleanly on a fresh IDB (no legacy rows)', async () => {
    await db.open()
    expect(db.verno).toBeGreaterThanOrEqual(9)
  })
})
