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
| `turns` | One user request and assistant response lifecycle. | `id`, `parentChatId`, `conversationType`, `conversationId`, `status`, `userMessageId`, `assistantMessageId`, `retryOfTurnId`, `regeneratedFromTurnId`, `contextSnapshot`, `provider`, `model`, `createdAt`, `updatedAt`, `error` | `[conversationId+createdAt]`, `status`, `retryOfTurnId`, `regeneratedFromTurnId` |
| `providerRequestAttempts` | Individual provider calls for a turn. | `id`, `turnId`, `assistantMessageId`, `provider`, `model`, `status`, `attemptNumber`, `providerRequestId`, `startedAt`, `completedAt`, `errorCode`, `errorRetryable`, `usage` | `[turnId+attemptNumber]`, `status` |
| `settings` | App-wide local settings. | `id`, `userName`, `avatarDataUrl`, `openRouterApiKey`, `defaultModel`, `siteUrl`, `siteName`, `theme`, `onboardedAt` | none |

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

## Current vs Next

Already implemented:

- `parentChats`
- `threads`
- `messages`
- `pinnedMessages`
- `settings`

Likely next additions:

- `savedMessages` for the global saved collection
- `turns` and `providerRequestAttempts` for retry/regenerate
- `messageRevisions` before edit/delete needs frozen branch correctness
