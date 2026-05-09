# Parent Chat + Thread PRD

## Summary

Deepchat is a browser-first LLM chat surface inspired by Slack conversation
threads.

The product has two distinct conversation layers:

- `Parent chat`: the top-level linear conversation.
- `Thread`: a message-rooted branch conversation that starts from a specific
  parent or thread message.

Threads are not separate top-level chats in the sidebar. Instead, they are
sub-conversations attached to messages inside a parent chat or another thread.

The app should feel like a real working chat tool:

- left sidebar shows parent chats only
- the main conversation view shows the selected parent chat
- when a thread is opened, the UI shows a Slack-like thread detail view
- on wide layouts, parent chat and active thread can be visible side by side
- on narrow layouts, the thread view can take over the conversation area

## Problem

Most LLM chat products are optimized around a single flat conversation. That
breaks down when a user wants to:

- keep a main line of discussion while exploring side paths
- ask follow-up questions on a specific model reply without polluting the parent
  chat
- continue a branch conversation independently
- preserve the context of the branching point
- manage multiple parent chats while still using message-level threads

## Product Goal

Build a browser-only LLM chat application where:

- parent chats are durable and easy to navigate
- message-rooted threads behave like Slack threads
- thread context is predictable
- the app works locally in the browser with user-provided provider credentials

## Users

### Primary users

- developers exploring variants of prompts or follow-up questions
- researchers who need a clean parent line of thought with side discussions
- privacy-sensitive users who want local-first browser storage

### Secondary users

- teams prototyping a serious threaded LLM UX before backend investment
- users evaluating browser-first LLM chat architectures

## Principles

1. Parent chat and thread are different objects and must not be conflated.
2. Threads are first-class message branches, not separate top-level chats.
3. Context inheritance must be deterministic.
4. Local persistence is the default.
5. The browser-only MVP should be useful without pretending to support every
   provider.

## Constraints

### Technical constraints

- MVP is browser-only.
- Parent chats, messages, threads, drafts, and settings persist locally in
  IndexedDB.
- Direct model access depends on provider CORS and browser-compatible auth.
- Some providers will not be usable without a backend.

### Product constraints

- Users may need to provide their own API keys.
- Browser-only mode is fine for local testing and power-user workflows.
- The app must not claim universal provider support.

## Non-goals

- shared multi-user collaboration in MVP
- cloud sync in MVP
- server-side auth flows in MVP
- organization admin controls in MVP
- universal support for every provider and auth method

## Core Concepts

### Parent chat

A parent chat is the L1 conversation unit shown in the sidebar.

A parent chat has:

- stable ID
- title
- ordered top-level message list
- per-chat model selection
- draft state
- timestamps
- archive state

### Thread

A thread is a branch conversation rooted at a specific message.

A thread has:

- stable ID
- root message ID
- parent chat ID
- optional parent thread ID
- ordered reply list
- draft state
- timestamps
- depth metadata

### Root message

The root message is the message from which a thread was opened. In the thread
detail view, this message is displayed at the top of the pane as the context
anchor.

### Thread depth

Threads are not artificially capped to one nesting level. A reply inside a
thread can itself have a thread. That deeper thread continues from the L2
conversation in the same Slack-like way.

## Context Rules

### Default inheritance rule

When a thread is created from message `B`, the thread inherits the full ancestor
conversation chain up to and including `B`.

Example:

- parent chat: `A -> B -> C -> D`
- thread created from `B`
- thread context starts with `A -> B`

The thread does **not** automatically include `C` or `D`.

### Frozen branch rule

Thread context is frozen at the branch point with respect to ancestor
inheritance.

- later messages added to the parent chat do not flow into an existing thread
- later messages added to a parent thread do not flow into a child thread unless
  they are already part of that child thread's own ancestor chain

### Future flexibility

In a future release, context inheritance may become configurable, but MVP uses
the frozen-branch rule only.

## Information Architecture

### Sidebar

The left sidebar shows parent chats only.

The sidebar does not list threads as peers of parent chats.

Each parent chat item may show:

- title
- last activity preview
- timestamp
- unread or activity indicators in the future

### Parent chat view

The parent chat view shows the selected parent chat's top-level timeline.

Messages in this view can show thread metadata:

- reply count
- affordance to open the thread
- last thread activity in a future version

### Thread view

The thread view shows:

1. the root message at the top
2. reply count or thread metadata
3. the ordered thread replies below
4. a dedicated composer at the bottom

This should visually resemble the Slack thread view you shared.

## Layout Behavior

### Wide layouts

When screen width allows it, the app should show:

- parent chat conversation
- active thread conversation

side by side.

### Narrow layouts

When screen width is limited, opening a thread can switch the conversation area
to a thread-only detail view.

The root message must still remain visible at the top of that thread view.

## User Experience

### Primary parent chat flow

1. User selects or creates a parent chat from the sidebar.
2. User sends messages in the parent chat timeline.
3. A parent message can receive thread replies.
4. Messages with thread replies show a reply count and an affordance to open the
   thread.
5. User opens the thread to continue the side conversation.

### Primary thread flow

1. User opens a thread from a specific message.
2. The thread pane shows the root message at the top.
3. The user sees all replies in that thread.
4. The user replies in the thread composer.
5. That reply continues the thread conversation only.
6. A message inside the thread can open a deeper thread.

## Main Features

### MVP features

1. Parent chat sidebar with create, rename, archive, restore, and reopen.
2. Parent chat message timeline.
3. Message-level threads rooted on specific messages.
4. Reply count and open-thread affordance on messages that have thread replies.
5. Slack-like thread detail pane with root message, thread replies, and thread
   composer.
6. Responsive side-by-side or thread-only layout depending on available width.
7. Frozen branch context inheritance.
8. Per-parent-chat model selection.
9. Browser-side provider configuration.
10. Local persistence for parent chats, threads, messages, drafts, and settings.
11. Streaming assistant responses where supported.

### Post-MVP features

1. Message actions (edit, delete, copy, retry, regenerate, save, pin) and
   markdown rendering. Tracked incrementally in `docs/features.md`.
2. Search across parent chats and threads, including a `⌘K` command palette
   and slash commands such as `/branch`.
3. Context inheritance settings.
4. Thread visual maps or breadcrumb navigation (the sidebar "branch map"
   affordance).
5. Attachments and multimodal messages.
6. Agent definitions (model + system prompt + tools) and multiple agents
   participating in a single conversation.
7. Backend proxy for secure keys and unsupported providers.
8. Cloud sync and collaboration.

## Functional Requirements

### Parent chats

- User can create a parent chat from the sidebar.
- User can rename a parent chat.
- User can archive and restore a parent chat.
- User can delete a parent chat after confirmation.
- Parent chat drafts persist locally.

### Parent messages

- User messages append to the active parent chat in order.
- Assistant responses append in order.
- A message may have zero or more direct thread replies.
- Messages with direct thread replies must display a reply count and a control to
  open the thread.

### Message actions

These actions are post-MVP and ship incrementally per `docs/features.md`. They
must respect the immutability rules in the architecture doc: messages referenced
by thread roots or context snapshots are immutable revisions, edits create new
revisions, and deletes prefer tombstones over hard removal.

- copy message text
- edit user messages (creates a new revision; the original revision is
  preserved for any thread that already inherits it)
- delete user or assistant messages (soft delete; root messages of existing
  threads produce an explicit unavailable state rather than disappearing)
- retry a failed assistant message
- regenerate an assistant reply (treated as a new attempt under the same turn)
- save (bookmark) a message into a per-user collection
- pin a message within its parent chat or thread
- markdown rendering for assistant and user message bodies

### Threads

- A thread is created from a specific root message.
- The thread pane must always show the root message at the top.
- Thread replies append in order below the root message.
- Thread replies belong to that thread conversation only.
- A thread reply may itself have a child thread.
- Thread drafts persist locally.

### Context handling

- Parent chat requests use the full visible ancestor conversation of the parent
  chat.
- Thread requests use the frozen ancestor chain up to the thread root plus the
  thread's own replies.
- Later parent-chat messages must not affect existing threads.
- Later parent-thread messages must not affect descendant threads outside their
  inherited branch.
- If the effective context becomes too large, the app must stop send and show a
  recoverable warning.

### Models and providers

- Each parent chat stores its current model selection.
- Each thread stores its own current model selection.
- A new thread inherits the effective model from its immediate parent
  conversation at creation time.
- Users may change the model for a parent chat or thread at any time; the new
  selection applies to subsequent turns only.
- Existing messages retain the model label that was used when they were sent.
- Provider credentials are stored locally in MVP.
- OpenRouter is the baseline browser integration path; additional providers
  must conform to the chat-provider contract defined in
  `src/features/providers/`.
- Default export must exclude API keys and secrets.

### Persistence

- Parent chats persist across refresh.
- Parent messages persist across refresh.
- Threads persist across refresh.
- Thread relationships persist across refresh.
- Drafts persist per parent chat and per thread.
- Import must not overwrite local data without confirmation.
- Export and import can ship immediately after the core threaded chat flow; they
  are not required for MVP.

### Search

- MVP ships without functional search. The sidebar `⌘K` input is a placeholder
  that does not query anything yet and will either be wired up or removed.
- Near-term, a sidebar title-substring filter over parent chats is the first
  search-shaped feature.
- Full search across parent chats and threads, plus a slash-command palette,
  is post-MVP.

### Error handling

- Provider failure shows a visible error state in the active conversation.
- Network failure never deletes local content.
- Unsupported browser-only provider paths are explained clearly.

## Browser-Only Architecture

### Required capabilities

- IndexedDB for local persistence
- client-side routing
- direct HTTP requests to supported providers
- browser streaming response parsing
- local credential storage

### Known limitations

- API keys are exposed to the client environment
- some providers require server-side auth or block browser requests
- browser storage quotas limit very large workspaces
- production abuse controls are weak without a backend

## Data Model

### Parent chat fields

- `id`
- `title`
- `model`
- `createdAt`
- `updatedAt`
- `archivedAt`
- `draft`
- `lastActivityPreview`

### Message fields

- `id`
- `conversationType` (`parent` or `thread`)
- `conversationId`
- `parentChatId`
- `parentThreadId`
- `rootMessageId`
- `role`
- `content`
- `createdAt`
- `status`
- `providerRequestId`
- `error`
- `directReplyCount`

### Thread fields

- `id`
- `parentChatId`
- `parentThreadId`
- `rootMessageId`
- `depth`
- `draft`
- `createdAt`
- `updatedAt`

## Success Metrics

### Product metrics

- parent chat creation and reopen flows succeed without data loss
- thread open flow reliably shows root message and replies
- users can distinguish parent chat versus thread context without onboarding
- p95 parent-chat switch time is under 150 ms on a representative local dataset
- message reply count affordances correctly open the intended thread

### MVP success definition

The MVP is successful if a user can:

1. configure a supported provider in-browser
2. run a parent chat
3. open a thread from a specific message
4. continue a side conversation in that thread
5. reopen the same parent chat and thread later with local data preserved

## Risks

1. The terms `chat`, `parent chat`, `message`, and `thread` can easily be
   implemented incorrectly if not kept distinct.
2. Thread depth increases UI and data-model complexity.
3. Browser-only provider support is uneven.
4. Context growth across deep branches can exceed model limits.
5. If thread affordances are weak, users may not discover or trust the feature.

## Deferred Decisions

1. Deep nested threads should use a compact breadcrumb showing the ancestor
   thread chain by root-message excerpt. This is not required for MVP polish,
   but it is the default direction for post-MVP navigation.
2. Parent chat search should eventually include thread hit counts and optionally
   surface matching thread snippets, but that enhancement is explicitly post-MVP.
3. Agents (model + system prompt + tools) and multi-agent conversations will
   reframe what "the assistant" means in a thread. When this lands, message
   authorship, turn ownership, and per-message agent identity must be added to
   the data model, and thread inheritance must define how agent changes
   propagate. Out of scope until the single-assistant flow is solid.

## Recommended MVP Cut

Ship the first usable version with:

- parent chat sidebar
- parent chat timeline
- message reply count and open-thread affordance
- thread pane with root message and replies
- frozen branch context rule
- local persistence
- browser-based provider execution for supported APIs
- draft persistence
- clear unsupported-provider messaging

Defer if schedule is tight:

- deep-thread breadcrumb polish
- export/import
- full thread search
- attachments
- collaboration
- sync
