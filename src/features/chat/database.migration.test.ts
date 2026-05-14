import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

import { db, LlmSlackDatabase } from './database'

const TEST_DB_NAME = 'llm-slack-migration-test'

// Canonical legacy schema chain, declared once. Each entry is the cumulative
// store map at that version — tests pick a target version and we apply v1..N
// in order so we only have to maintain the production chain in one place.
const LEGACY_SCHEMA_CHAIN: Array<Record<string, string>> = [
  // v1
  {
    parentChats: 'id, createdAt, updatedAt, archivedAt',
    threads: 'id, rootMessageId, parentChatId, parentThreadId, updatedAt',
    messages:
      'id, conversationType, conversationId, parentChatId, createdAt, [conversationId+createdAt]',
    settings: 'id',
  },
  // v2 — pinnedMessages
  {
    parentChats: 'id, createdAt, updatedAt, archivedAt',
    threads: 'id, rootMessageId, parentChatId, parentThreadId, updatedAt',
    messages:
      'id, conversationType, conversationId, parentChatId, createdAt, [conversationId+createdAt]',
    pinnedMessages:
      'id, parentChatId, conversationType, conversationId, messageId, pinnedAt, sortKey, [conversationId+sortKey], &[conversationId+messageId], [parentChatId+pinnedAt]',
    settings: 'id',
  },
  // v3 — savedMessages
  {
    parentChats: 'id, createdAt, updatedAt, archivedAt',
    threads: 'id, rootMessageId, parentChatId, parentThreadId, updatedAt',
    messages:
      'id, conversationType, conversationId, parentChatId, createdAt, [conversationId+createdAt]',
    pinnedMessages:
      'id, parentChatId, conversationType, conversationId, messageId, pinnedAt, sortKey, [conversationId+sortKey], &[conversationId+messageId], [parentChatId+pinnedAt]',
    savedMessages: 'id, createdAt, &messageId, parentChatId, [parentChatId+createdAt]',
    settings: 'id',
  },
  // v4 — starredAt index on parentChats
  {
    parentChats: 'id, createdAt, updatedAt, archivedAt, starredAt',
    threads: 'id, rootMessageId, parentChatId, parentThreadId, updatedAt',
    messages:
      'id, conversationType, conversationId, parentChatId, createdAt, [conversationId+createdAt]',
    pinnedMessages:
      'id, parentChatId, conversationType, conversationId, messageId, pinnedAt, sortKey, [conversationId+sortKey], &[conversationId+messageId], [parentChatId+pinnedAt]',
    savedMessages: 'id, createdAt, &messageId, parentChatId, [parentChatId+createdAt]',
    settings: 'id',
  },
  // v5 — providers + modelOverrides (last version that shipped on main)
  {
    parentChats: 'id, createdAt, updatedAt, archivedAt, starredAt',
    threads: 'id, rootMessageId, parentChatId, parentThreadId, updatedAt',
    messages:
      'id, conversationType, conversationId, parentChatId, createdAt, [conversationId+createdAt]',
    pinnedMessages:
      'id, parentChatId, conversationType, conversationId, messageId, pinnedAt, sortKey, [conversationId+sortKey], &[conversationId+messageId], [parentChatId+pinnedAt]',
    savedMessages: 'id, createdAt, &messageId, parentChatId, [parentChatId+createdAt]',
    providers: 'id, kind, createdAt',
    modelOverrides: 'id, providerId, &[providerId+providerModelId]',
    settings: 'id',
  },
]

async function seedLegacyAt(
  targetVersion: number,
  seed: (legacy: Dexie) => Promise<void>,
  dbName: string = TEST_DB_NAME,
) {
  if (targetVersion < 1 || targetVersion > LEGACY_SCHEMA_CHAIN.length) {
    throw new Error(`No legacy schema for version ${targetVersion}`)
  }
  const legacy = new Dexie(dbName)
  for (let i = 0; i < targetVersion; i += 1) {
    legacy.version(i + 1).stores(LEGACY_SCHEMA_CHAIN[i]!)
  }
  await legacy.open()
  try {
    await seed(legacy)
  } finally {
    legacy.close()
  }
}

async function openUpgraded(dbName: string = TEST_DB_NAME) {
  const upgraded = new LlmSlackDatabase(dbName)
  await upgraded.open()
  return upgraded
}

afterEach(async () => {
  await Dexie.delete(TEST_DB_NAME)
})

describe('schema migrations', () => {
  it('v1 → current: parentChats + messages preserved, new stores accessible', async () => {
    await seedLegacyAt(1, async (legacy) => {
      await legacy.table('parentChats').add({
        id: 'parent-1',
        title: 'Hello',
        model: { providerKind: 'openrouter', providerModelId: 'm' },
        createdAt: 1,
        updatedAt: 1,
        draft: '',
        lastActivityPreview: '',
      })
      await legacy.table('messages').add({
        id: 'p1',
        conversationType: 'parent',
        conversationId: 'parent-1',
        parentChatId: 'parent-1',
        role: 'user',
        content: 'hi',
        createdAt: 1,
        status: 'complete',
        directReplyCount: 0,
      })
    })

    const upgraded = await openUpgraded()
    try {
      await expect(upgraded.parentChats.get('parent-1')).resolves.toBeDefined()
      await expect(upgraded.messages.get('p1')).resolves.toBeDefined()
      // New stores exist and accept writes.
      await upgraded.pinnedMessages.add({
        id: 'pin-1',
        parentChatId: 'parent-1',
        conversationType: 'parent',
        conversationId: 'parent-1',
        messageId: 'p1',
        pinnedAt: 10,
        sortKey: 10,
      })
      await upgraded.savedMessages.add({
        id: 'saved-1',
        parentChatId: 'parent-1',
        conversationType: 'parent',
        conversationId: 'parent-1',
        messageId: 'p1',
        createdAt: 11,
      })
      await expect(upgraded.pinnedMessages.count()).resolves.toBe(1)
      await expect(upgraded.savedMessages.count()).resolves.toBe(1)
    } finally {
      upgraded.close()
    }
  })

  it('v4 → v5: seeds provider from legacy settings and rewrites string model fields', async () => {
    await seedLegacyAt(4, async (legacy) => {
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

    const upgraded = await openUpgraded()
    try {
      const providers = await upgraded.providers.toArray()
      expect(providers).toHaveLength(1)
      const provider = providers[0]!
      expect(provider).toMatchObject({
        kind: 'openrouter',
        apiKey: 'sk-or-test',
        metadata: { siteUrl: 'https://example.test', siteName: 'llm-slack' },
      })

      const settings = await upgraded.settings.get('app')
      expect(settings?.defaultModel).toEqual({
        providerId: provider.id,
        providerKind: 'openrouter',
        providerModelId: 'openai/gpt-4o-mini',
      })
      // Legacy keys must be stripped.
      const settingsAsRecord = settings as unknown as Record<string, unknown>
      expect(settingsAsRecord.openRouterApiKey).toBeUndefined()
      expect(settingsAsRecord.siteUrl).toBeUndefined()

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

  it('v4 → v5: leaves provider table empty when no legacy api key was set', async () => {
    await seedLegacyAt(4, async (legacy) => {
      await legacy.table('settings').put({
        id: 'app',
        userName: 'Tester',
        defaultModel: null,
        theme: 'aubergine',
      })
    })

    const upgraded = await openUpgraded()
    try {
      expect(await upgraded.providers.count()).toBe(0)
      const settings = await upgraded.settings.get('app')
      expect(settings?.defaultModel).toBeNull()
    } finally {
      upgraded.close()
    }
  })

  it('v5 → v6: backfills parentChats.kind to "dm" and seeds the empty multi-agent stores', async () => {
    await seedLegacyAt(5, async (legacy) => {
      await legacy.table('parentChats').put({
        id: 'parent-legacy',
        title: 'Legacy chat',
        model: { providerKind: 'openrouter', providerModelId: 'm' },
        createdAt: 1,
        updatedAt: 1,
        draft: '',
        lastActivityPreview: '',
      })
    })

    const upgraded = await openUpgraded()
    try {
      expect(upgraded.verno).toBeGreaterThanOrEqual(6)
      const parent = await upgraded.parentChats.get('parent-legacy')
      expect(parent?.kind).toBe('dm')
      expect(parent?.agentId).toBeUndefined()
      expect(await upgraded.agents.count()).toBe(0)
      expect(await upgraded.chatParticipants.count()).toBe(0)
      expect(await upgraded.channelSettings.count()).toBe(0)
      expect(await upgraded.turns.count()).toBe(0)
      expect(await upgraded.providerRequestAttempts.count()).toBe(0)
    } finally {
      upgraded.close()
    }
  })

  it('v5 → v6: does not overwrite an already-set kind (re-run safety)', async () => {
    await seedLegacyAt(5, async (legacy) => {
      await legacy.table('parentChats').put({
        id: 'p',
        title: 'already-set',
        model: null,
        kind: 'channel',
        createdAt: 1,
        updatedAt: 1,
        draft: '',
        lastActivityPreview: '',
      })
    })

    const upgraded = await openUpgraded()
    try {
      const parent = await upgraded.parentChats.get('p')
      expect(parent?.kind).toBe('channel')
    } finally {
      upgraded.close()
    }
  })

  it('module singleton db opens cleanly on a fresh IDB', async () => {
    await db.open()
    expect(db.verno).toBeGreaterThanOrEqual(6)
  })
})
