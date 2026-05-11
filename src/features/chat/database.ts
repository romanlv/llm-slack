import Dexie, { type EntityTable } from 'dexie'

import type {
  Agent,
  ChannelParticipant,
  ChannelSettings,
  ChatMessage,
  ConversationThread,
  ParentChat,
  PinnedMessage,
  ProviderRequestAttempt,
  SavedMessage,
  Turn,
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
  agents!: EntityTable<Agent, 'id'>
  chatParticipants!: EntityTable<ChannelParticipant, 'id'>
  channelSettings!: EntityTable<ChannelSettings, 'id'>
  turns!: EntityTable<Turn, 'id'>
  providerRequestAttempts!: EntityTable<ProviderRequestAttempt, 'id'>
  settings!: EntityTable<AppSettings, 'id'>

  constructor(name = 'llm-slack') {
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

    this.version(4).stores({
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

    // v5: add providers + modelOverrides stores; rewrite legacy string
    // `.model` fields on parentChats/threads/messages/settings into
    // ModelRef shape; promote any legacy `settings.openRouterApiKey` (and
    // siteUrl/siteName metadata) into a seeded `providers` row. The upgrade
    // is idempotent so a re-run on the same DB is a no-op.
    this.version(5)
      .stores({
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
      .upgrade(async (tx) => {
        const settingsTable = tx.table('settings')
        const providersTable = tx.table('providers')
        const parentChatsTable = tx.table('parentChats')
        const threadsTable = tx.table('threads')
        const messagesTable = tx.table('messages')

        const legacySettings = (await settingsTable.get('app')) as
          | (Record<string, unknown> & {
              openRouterApiKey?: unknown
              siteUrl?: unknown
              siteName?: unknown
              defaultModel?: unknown
            })
          | undefined

        const apiKey =
          typeof legacySettings?.openRouterApiKey === 'string'
            ? legacySettings.openRouterApiKey.trim()
            : ''
        const siteUrl =
          typeof legacySettings?.siteUrl === 'string' ? legacySettings.siteUrl : ''
        const siteName =
          typeof legacySettings?.siteName === 'string' ? legacySettings.siteName : ''

        let seededProviderId: string | undefined
        let seededProviderKind: 'openrouter' | undefined

        if (apiKey) {
          const existing = await providersTable
            .where('kind')
            .equals('openrouter')
            .first()
          if (existing) {
            seededProviderId = existing.id
            seededProviderKind = 'openrouter'
          } else {
            const now = Date.now()
            const metadata: Record<string, string> = {}
            if (siteUrl) metadata.siteUrl = siteUrl
            if (siteName) metadata.siteName = siteName
            const provider = {
              id: crypto.randomUUID(),
              kind: 'openrouter' as const,
              label: 'OpenRouter',
              apiKey,
              metadata,
              createdAt: now,
              updatedAt: now,
            }
            await providersTable.add(provider)
            seededProviderId = provider.id
            seededProviderKind = 'openrouter'
          }
        }

        const rewriteModel = (
          value: unknown,
        ): { providerKind: 'openrouter'; providerModelId: string; providerId?: string } | null => {
          if (typeof value === 'string') {
            const trimmed = value.trim()
            if (!trimmed) return null
            return {
              providerKind: 'openrouter',
              providerModelId: trimmed,
              ...(seededProviderId ? { providerId: seededProviderId } : {}),
            }
          }
          if (value && typeof value === 'object') {
            const obj = value as Record<string, unknown>
            if (typeof obj.providerModelId === 'string' && typeof obj.providerKind === 'string') {
              return value as never
            }
          }
          return null
        }

        await parentChatsTable.toCollection().modify((row: Record<string, unknown>) => {
          row.model = rewriteModel(row.model)
        })

        await threadsTable.toCollection().modify((row: Record<string, unknown>) => {
          row.model = rewriteModel(row.model)
        })

        await messagesTable.toCollection().modify((row: Record<string, unknown>) => {
          const rewritten = rewriteModel(row.model)
          if (rewritten) {
            row.model = rewritten
          } else {
            delete row.model
          }
        })

        if (legacySettings) {
          const next: Record<string, unknown> = { ...legacySettings }
          delete next.openRouterApiKey
          delete next.siteUrl
          delete next.siteName

          const rewrittenDefault = rewriteModel(legacySettings.defaultModel)
          next.defaultModel =
            rewrittenDefault && seededProviderId && seededProviderKind
              ? {
                  providerId: seededProviderId,
                  providerKind: seededProviderKind,
                  providerModelId: rewrittenDefault.providerModelId,
                }
              : rewrittenDefault ?? null

          await settingsTable.put(next)
        }
      })

    // v6: introduce the multi-agent foundation. Adds the agents store and
    // the chat-kind discriminator on parentChats. Legacy parentChats rows
    // are backfilled to kind='dm' (today's model-DM behavior). agentId
    // remains absent on every backfilled row; new agent-DMs created in U3
    // populate it. R1 invariant — kind='channel' implies agentId null — is
    // not yet enforceable since no channels can exist before U5.
    this.version(6)
      .stores({
        parentChats: 'id, createdAt, updatedAt, archivedAt, starredAt, kind, agentId',
        threads: 'id, rootMessageId, parentChatId, parentThreadId, updatedAt',
        messages:
          'id, conversationType, conversationId, parentChatId, createdAt, [conversationId+createdAt]',
        pinnedMessages:
          'id, parentChatId, conversationType, conversationId, messageId, pinnedAt, sortKey, [conversationId+sortKey], &[conversationId+messageId], [parentChatId+pinnedAt]',
        savedMessages:
          'id, createdAt, &messageId, parentChatId, [parentChatId+createdAt]',
        providers: 'id, kind, createdAt',
        modelOverrides: 'id, providerId, &[providerId+providerModelId]',
        agents: 'id, createdAt, updatedAt',
        settings: 'id',
      })
      .upgrade(async (tx) => {
        await tx
          .table('parentChats')
          .toCollection()
          .modify((row: Record<string, unknown>) => {
            if (row.kind === undefined) {
              row.kind = 'dm'
            }
          })
      })

    // v7: channel-shaped persistence. Empty tables only; no backfill needed
    // because no channel rows can exist yet. messages.agentId is already
    // declared at the type level (v6 schema) and stays unindexed in v0 — we
    // only query by conversationId, not by agentId.
    this.version(7)
      .stores({
        parentChats: 'id, createdAt, updatedAt, archivedAt, starredAt, kind, agentId',
        threads: 'id, rootMessageId, parentChatId, parentThreadId, updatedAt',
        messages:
          'id, conversationType, conversationId, parentChatId, createdAt, [conversationId+createdAt]',
        pinnedMessages:
          'id, parentChatId, conversationType, conversationId, messageId, pinnedAt, sortKey, [conversationId+sortKey], &[conversationId+messageId], [parentChatId+pinnedAt]',
        savedMessages:
          'id, createdAt, &messageId, parentChatId, [parentChatId+createdAt]',
        providers: 'id, kind, createdAt',
        modelOverrides: 'id, providerId, &[providerId+providerModelId]',
        agents: 'id, createdAt, updatedAt',
        chatParticipants:
          'id, chatId, agentId, [chatId+sortKey], &[chatId+agentId]',
        channelSettings: 'id',
        settings: 'id',
      })

    // v8: turn lifecycle. Adds turns + providerRequestAttempts so every
    // send has a place to record stop reason, per-agent ownership, and
    // (later) cancellation provenance. Empty tables — existing in-flight
    // 'streaming' rows are not migrated; recovery for them is tracked
    // separately (P0c.3).
    this.version(8)
      .stores({
        parentChats: 'id, createdAt, updatedAt, archivedAt, starredAt, kind, agentId',
        threads: 'id, rootMessageId, parentChatId, parentThreadId, updatedAt',
        messages:
          'id, conversationType, conversationId, parentChatId, createdAt, [conversationId+createdAt]',
        pinnedMessages:
          'id, parentChatId, conversationType, conversationId, messageId, pinnedAt, sortKey, [conversationId+sortKey], &[conversationId+messageId], [parentChatId+pinnedAt]',
        savedMessages:
          'id, createdAt, &messageId, parentChatId, [parentChatId+createdAt]',
        providers: 'id, kind, createdAt',
        modelOverrides: 'id, providerId, &[providerId+providerModelId]',
        agents: 'id, createdAt, updatedAt',
        chatParticipants:
          'id, chatId, agentId, [chatId+sortKey], &[chatId+agentId]',
        channelSettings: 'id',
        turns: 'id, parentChatId, conversationId, status, [conversationId+createdAt]',
        providerRequestAttempts:
          'id, turnId, assistantMessageId, agentId, [turnId+attemptNumber]',
        settings: 'id',
      })
  }
}

export const db = new LlmSlackDatabase()
