# Database Schema

Compact draft of the local IndexedDB/Dexie entities and how they relate.

## Tables

Every table uses `id` as its primary key. The indexes column lists only
secondary indexes worth keeping for known query paths. `&` means unique.

| Table | Purpose | Key columns | Indexes |
| --- | --- | --- | --- |
| `parentChats` | Top-level chats shown in the sidebar. | `id`, `title`, `model`, `kind`, `agentId?`, `draft`, `createdAt`, `updatedAt`, `archivedAt`, `starredAt`, `lastActivityPreview` | `updatedAt`, `agentId`, `kind` |
| `agents` | User-defined reusable agents (display name + model + system prompt). | `id`, `displayName`, `model`, `systemPrompt`, `createdAt`, `updatedAt` | `createdAt` |
| `chatParticipants` | Per-channel-per-agent participation row. `chatId` may be a `parentChats.id` (kind=channel) or a `threads.id` whose parent is a channel. | `id`, `chatId`, `agentId`, `mode`, `sortKey`, `createdAt` | `[chatId+sortKey]`, `&[chatId+agentId]`, `agentId` |
| `channelSettings` | Per-channel orchestration settings. `id` equals the channel's `parentChats.id` (1:1). | `id`, `maxChainedSubTurns`, `maxMessagesPerAgentPerInput`, `tokenBudgetPerInput`, `defaultParticipationMode`, `allowAgentThreading`, `createdAt`, `updatedAt` | none |
| `threads` | Message-rooted branch conversations. | `id`, `parentChatId`, `parentThreadId`, `rootMessageId`, `rootRevisionId`, `depth`, `draft`, `model`, `createdAt`, `updatedAt` | `rootMessageId`, `[parentChatId+createdAt]`, `parentThreadId` |
| `messages` | Stable message rows rendered in parent chats and threads. | `id`, `parentChatId`, `conversationType`, `conversationId`, `role`, `content`, `status`, `createdAt`, `turnId`, `currentRevisionId`, `deletedAt`, `directReplyCount`, `model`, `agentId?`, `agentSnapshot?`, `providerRequestId`, `providerUsage`, `error` | `[conversationId+createdAt]`, `[parentChatId+createdAt]`, `status`, `turnId` |
| `savedMessages` | User-saved messages shown in a global/outside-chat collection. | `id`, `parentChatId`, `conversationType`, `conversationId`, `messageId`, `messageRevisionId`, `createdAt`, `note` | `createdAt`, `&messageId`, `[parentChatId+createdAt]` |
| `pinnedMessages` | Messages pinned inside a parent chat or thread. | `id`, `parentChatId`, `conversationType`, `conversationId`, `messageId`, `messageRevisionId`, `pinnedAt`, `sortKey`, `note` | `[conversationId+sortKey]`, `&[conversationId+messageId]`, `[parentChatId+pinnedAt]` |
| `messageRevisions` | Immutable message content versions for branch-safe edits/deletes. | `id`, `messageId`, `parentChatId`, `conversationType`, `conversationId`, `revisionNumber`, `content`, `contentFormat`, `createdAt`, `supersedesRevisionId` | `[messageId+revisionNumber]` |
| `turns` | One user request and the resulting fan-out lifecycle (DM = one attempt, channel = N). | `id`, `parentChatId`, `conversationType`, `conversationId`, `status`, `stopReason?`, `userMessageId`, `assistantMessageId`, `retryOfTurnId`, `regeneratedFromTurnId`, `contextSnapshot`, `model`, `createdAt`, `updatedAt`, `error` | `parentChatId`, `[conversationId+createdAt]`, `status`, `retryOfTurnId`, `regeneratedFromTurnId` |
| `providerRequestAttempts` | One provider call inside a turn (a channel turn can have many; an agent-DM has one per agent). | `id`, `turnId`, `assistantMessageId`, `agentId?`, `model`, `status`, `attemptNumber`, `providerRequestId`, `startedAt`, `completedAt`, `errorCode`, `errorRetryable`, `usage` | `[turnId+attemptNumber]`, `status` |
| `providers` | User-configured provider connections (credentials, endpoints). | `id`, `kind`, `label`, `apiKey`, `baseUrl`, `metadata`, `createdAt`, `updatedAt` | `kind`, `createdAt` |
| `modelOverrides` | Per-model user decisions (enabled, display name, custom metadata). Sparse — row only exists when the user has touched the model. | `id`, `providerId`, `providerModelId`, `enabled`, `displayName`, `customMetadata`, `sortKey`, `createdAt`, `updatedAt` | `providerId`, `&[providerId+providerModelId]` |
| `settings` | App-wide local settings. | `id`, `userName`, `avatarDataUrl`, `defaultModel`, `theme`, `onboardedAt` | none |

## Embedded shapes

Used as columns inside other tables, not their own stores.

### `ModelRef`

A snapshot of which model produced or should produce a response.

| Field | Type | Notes |
| --- | --- | --- |
| `providerId` | string? | FK → `providers.id`. Soft — undefined when the connection has been deleted. |
| `providerKind` | `'openrouter' \| 'anthropic' \| 'openai' \| 'openai-compatible'` | Snapshot. Survives connection deletion so history can render "via OpenRouter". |
| `providerModelId` | string | Raw API id (`anthropic/claude-sonnet-4.5`, `gpt-4o`, …). Always renderable. |

Used by:
- `settings.defaultModel` (nullable)
- `parentChats.model`, `threads.model` (nullable; null means inherit
  `settings.defaultModel`)
- `messages.model`, `turns.model`, `providerRequestAttempts.model` (always
  populated for new rows; immutable history)

There is no `models` table. The catalog is computed synchronously in memory by
merging the bundled lists in code (per adapter) with rows in `modelOverrides`.
See `docs/providers-refactor.md`.

## Relationships

| From | To | Notes |
| --- | --- | --- |
| `threads.parentChatId` | `parentChats.id` | Every thread belongs to one parent chat. |
| `threads.parentThreadId` | `threads.id` | Nested threads point to their immediate parent thread. |
| `threads.rootMessageId` | `messages.id` | Thread root message. |
| `threads.rootRevisionId` | `messageRevisions.id` | Frozen root content used for branch-safe context. |
| `messages.parentChatId` | `parentChats.id` | All messages are owned by a parent chat. |
| `messages.conversationId` | `parentChats.id` or `threads.id` | Uses `parentChats.id` when `conversationType = "parent"`; uses `threads.id` when `conversationType = "thread"`. |
| `messages.turnId` | `turns.id` | The send lifecycle that produced the message. |
| `messages.currentRevisionId` | `messageRevisions.id` | Current visible message content. |
| `messageRevisions.messageId` | `messages.id` | One message can have many immutable revisions. |
| `savedMessages.messageId` | `messages.id` | Saved-message target for the global saved collection. |
| `savedMessages.messageRevisionId` | `messageRevisions.id` | Optional frozen saved revision. |
| `pinnedMessages.messageId` | `messages.id` | Pinned-message target inside one conversation. |
| `pinnedMessages.messageRevisionId` | `messageRevisions.id` | Optional frozen pinned revision. |
| `turns.parentChatId` | `parentChats.id` | Turn belongs to a parent chat. |
| `turns.userMessageId` | `messages.id` | User request message. |
| `turns.assistantMessageId` | `messages.id` | Assistant response message. |
| `turns.retryOfTurnId` | `turns.id` | Retry lineage. |
| `turns.regeneratedFromTurnId` | `turns.id` | Regeneration lineage. |
| `providerRequestAttempts.turnId` | `turns.id` | Attempts belong to one turn. |
| `providerRequestAttempts.assistantMessageId` | `messages.id` | Attempt writes into this assistant message. |
| `providerRequestAttempts.agentId` | `agents.id` | Null for model-DM attempts; set for agent-DM and channel attempts. Soft — agent deletion does not cascade through history. |
| `parentChats.agentId` | `agents.id` | Soft. Set on agent-DMs; null on model-DMs and channels. Invariant: must be null when `parentChats.kind='channel'`. Agent deletion sets dangling rows to null (orphan placeholder UI). |
| `chatParticipants.chatId` | `parentChats.id` or `threads.id` | Channel-only host. Parent chat must have `kind='channel'`; for threads, the underlying parent chat must be a channel. |
| `chatParticipants.agentId` | `agents.id` | Hard reference — `addChannelParticipant` asserts existence. Orphans surface in the UI as "removed from library." |
| `channelSettings.id` | `parentChats.id` | 1:1 with the channel chat. Auto-created by `createChannel`. |
| `messages.agentId` | `agents.id` | Null on model-DM messages. Paired with `agentSnapshot` so history renders even when the agent definition is later deleted. |
| `modelOverrides.providerId` | `providers.id` | Cascade-delete with the provider. |
| `agents.model.providerId` | `providers.id` | Soft. Same `ModelRef` snapshot pattern. Provider deletion may leave `providerId` undefined but the agent stays usable via the snapshotted kind/model id. |
| `parentChats.model.providerId`, `threads.model.providerId`, `messages.model.providerId`, `turns.model.providerId`, `providerRequestAttempts.model.providerId`, `settings.defaultModel.providerId` | `providers.id` | Soft. Goes undefined when the provider is deleted; history still renders via the snapshotted `providerKind` + `providerModelId`. |

## Channel-only invariants

These are enforced at write time in `repository.ts` / `turn-lifecycle.ts`
(Dexie does not check foreign keys or row predicates):

- `parentChats.kind='channel'` ⇒ `parentChats.agentId` must be null.
- `parentChats.kind='dm'` may have `agentId` set (agent-DM) or null (model-DM).
- `chatParticipants` rows only exist for channel hosts (parent chat with
  `kind='channel'` or a thread under one).
- `(chatParticipants.chatId, agentId)` is unique — no agent appears twice
  in the same channel.
- `chatParticipants.sortKey` is strictly monotonic per `chatId` (same
  same-millisecond tie-break pattern as `pinnedMessages.sortKey`).
- Thread of a channel snapshots the parent channel's participants at
  thread creation; subsequent adds/removes on the parent do not affect
  the thread (frozen-branch rule extended to participants — R17).
- Every closed `turns` row has a non-null `stopReason` in
  `{complete, no-trigger, cap-hit, user-interrupt, error}`.
- A `providerRequestAttempts.assistantMessageId === ''` is a tombstone
  for the `decided-silent` outcome — the orchestrator never wrote a
  message row for that attempt.

## Current vs Next

Already implemented:

- `parentChats` (kind discriminator + optional `agentId`)
- `threads`
- `messages` (with optional `agentId` + `agentSnapshot`)
- `pinnedMessages`
- `savedMessages`
- `settings`
- `providers` and `modelOverrides` (provider refactor — see
  `docs/providers-refactor.md`)
- `turns` and `providerRequestAttempts` (turn lifecycle + fan-out — U6)
- `agents`, `chatParticipants`, `channelSettings` (multi-agent foundation
  — U1/U5/U11)

Likely next additions:

- `messageRevisions` before edit/delete needs frozen branch correctness
