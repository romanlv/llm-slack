# Database Schema

Compact draft of the local IndexedDB/Dexie entities and how they relate.

## Tables

Every table uses `id` as its primary key. The indexes column lists only
secondary indexes worth keeping for known query paths. `&` means unique.

| Table | Purpose | Key columns | Indexes |
| --- | --- | --- | --- |
| `parentChats` | Top-level chats shown in the sidebar. | `id`, `title`, `model`, `draft`, `createdAt`, `updatedAt`, `archivedAt`, `lastActivityPreview` | `updatedAt` |
| `threads` | Message-rooted branch conversations. | `id`, `parentChatId`, `parentThreadId`, `rootMessageId`, `rootRevisionId`, `depth`, `draft`, `model`, `createdAt`, `updatedAt` | `rootMessageId`, `[parentChatId+createdAt]`, `parentThreadId` |
| `messages` | Stable message rows rendered in parent chats and threads. | `id`, `parentChatId`, `conversationType`, `conversationId`, `role`, `content`, `status`, `createdAt`, `turnId`, `currentRevisionId`, `deletedAt`, `directReplyCount`, `model`, `providerRequestId`, `providerUsage`, `error` | `[conversationId+createdAt]`, `[parentChatId+createdAt]`, `status`, `turnId` |
| `savedMessages` | User-saved messages shown in a global/outside-chat collection. | `id`, `parentChatId`, `conversationType`, `conversationId`, `messageId`, `messageRevisionId`, `createdAt`, `note` | `createdAt`, `&messageId`, `[parentChatId+createdAt]` |
| `pinnedMessages` | Messages pinned inside a parent chat or thread. | `id`, `parentChatId`, `conversationType`, `conversationId`, `messageId`, `messageRevisionId`, `pinnedAt`, `sortKey`, `note` | `[conversationId+sortKey]`, `&[conversationId+messageId]`, `[parentChatId+pinnedAt]` |
| `messageRevisions` | Immutable message content versions for branch-safe edits/deletes. | `id`, `messageId`, `parentChatId`, `conversationType`, `conversationId`, `revisionNumber`, `content`, `contentFormat`, `createdAt`, `supersedesRevisionId` | `[messageId+revisionNumber]` |
| `turns` | One user request and assistant response lifecycle. | `id`, `parentChatId`, `conversationType`, `conversationId`, `status`, `userMessageId`, `assistantMessageId`, `retryOfTurnId`, `regeneratedFromTurnId`, `contextSnapshot`, `model`, `createdAt`, `updatedAt`, `error` | `[conversationId+createdAt]`, `status`, `retryOfTurnId`, `regeneratedFromTurnId` |
| `providerRequestAttempts` | Individual provider calls for a turn. | `id`, `turnId`, `assistantMessageId`, `model`, `status`, `attemptNumber`, `providerRequestId`, `startedAt`, `completedAt`, `errorCode`, `errorRetryable`, `usage` | `[turnId+attemptNumber]`, `status` |
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
| `modelOverrides.providerId` | `providers.id` | Cascade-delete with the provider. |
| `parentChats.model.providerId`, `threads.model.providerId`, `messages.model.providerId`, `turns.model.providerId`, `providerRequestAttempts.model.providerId`, `settings.defaultModel.providerId` | `providers.id` | Soft. Goes undefined when the provider is deleted; history still renders via the snapshotted `providerKind` + `providerModelId`. |

## Current vs Next

Already implemented:

- `parentChats`
- `threads`
- `messages`
- `pinnedMessages`
- `savedMessages`
- `settings`

Likely next additions:

- `providers` and `modelOverrides` for the multi-provider refactor (with
  matching rewrites of `model` columns into the embedded `ModelRef` shape)
- `turns` and `providerRequestAttempts` for retry/regenerate
- `messageRevisions` before edit/delete needs frozen branch correctness
