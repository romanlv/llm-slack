# Architecture Guide

This document defines the desired architecture for llm-slack and the engineering
practices that should guide future feature work. It is intentionally practical:
when a new feature conflicts with this guide, either adjust the feature design or
update this document with the new decision and rationale.

## Current Shape

llm-slack is a browser-first React application with local IndexedDB persistence
and direct provider calls from the browser (multi-provider via adapters).

The current codebase is small and understandable:

- `src/router.tsx` defines the route tree.
- `src/app/app-shell.tsx` is a thin root layout; `src/app/chat-shell.tsx`
  owns the chat sidebar (with a dedicated Channels section above Recent).
- `src/pages/` contains route adapters.
- `src/features/chat/` contains the parent-chat, thread, channel, and
  turn-lifecycle experience. Keep this name, but keep its ownership narrow:
  conversation state, messages, threads, branch context, channel
  orchestration, and turn submission. App shell, provider adapters, and
  settings belong elsewhere.
- `src/features/agents/` contains the agents library (definition CRUD,
  AgentDot identity rendering, editor UI). Agents are reusable across
  agent-DMs and channels.
- `src/features/providers/` contains the provider contract, multi-provider
  adapters, and model metadata.
- `src/features/settings/` contains settings persistence and settings page
  content (including the agents library entry under the AI nav group).

This is a good MVP shape, but several boundaries are too loose for sustained
feature work. The main architectural goal is to keep product behavior explicit
while preventing UI, persistence, and provider transport from becoming coupled.

## Browser-Side Provider Security Boundary

Direct OpenRouter calls are an MVP and local-first constraint. User API keys are
available to browser JavaScript and may be exposed by XSS, malicious extensions,
compromised dependencies, shared devices, or local browser profile access.

This architecture is not production-ready for hosted multi-user deployment until
provider calls move behind a backend proxy with server-side key handling, rate
limiting, abuse controls, request logging, and response/error sanitization.

## How To Use This Document

Use this document as a guardrail for feature planning and code review.

- When touching conversation behavior, check the domain invariants first.
- When adding persistence fields, decide whether migration and repair behavior
  are needed.
- When adding provider behavior, keep provider-specific payloads out of chat UI
  and app services.
- When changing UI, avoid moving storage or provider details into components.
- When a feature intentionally violates this guide, update the guide in the
  same change with the reason.

This document should not block small fixes. It should block new large features
that deepen the current coupling without a clear reason.

## Architectural Principles

1. Conversation behavior is domain behavior.
   Thread inheritance, frozen branch semantics, reply counts, message statuses,
   retries, and deletion rules should live outside React components.

2. UI components should not know storage details.
   Components may consume hooks and command functions, but should avoid direct
   Dexie queries unless they are low-level feature data hooks.

3. Provider transport is replaceable.
   OpenRouter is the first provider, not the application boundary. Runtime code
   should depend on a small chat-provider interface.

4. Local-first persistence is a product constraint, not an implementation leak.
   IndexedDB can remain the source of truth for the browser-only MVP, but schema
   design should still support migrations, recovery, export/import, and later
   backend sync.

5. Streaming is a state machine.
   Sending a turn should have explicit states and recovery behavior, not only a
   long async function that mutates rows opportunistically.

6. Derived data must have an owner.
   If data such as reply counts, previews, or last activity is stored, one
   service should own how it is recalculated and when it is updated.

7. Tests should protect conversation semantics first.
   Branching, context inheritance, streaming failure, and persistence migration
   behavior are more important to test than visual details.

## Desired Module Boundaries

The target architecture should move toward flatter boundaries. Avoid creating
deep folders until there are enough files and independent responsibilities to
justify them.

Target directory shape:

```text
src/
  app/
  components/ui/
  features/
    chat/
      components/
      hooks/
      database.ts
      domain.ts
      repository.ts
      service.ts
      send-turn.ts
    providers/
      provider-contract.ts
      openrouter.ts
      openrouter-models.ts
    settings/
      settings-page-content.tsx
      settings-repository.ts
  pages/
```

This tree is a direction, not a requirement for a single large refactor. Do not
create directories for one file. Split `domain/`, `data/`, or `services/`
subdirectories only when the flat files become hard to navigate.

### Domain

Suggested location: `src/features/chat/domain.ts`

Owns pure types and behavior:

- conversation and message type definitions
- parent/thread invariants
- branch context rules
- message status transitions
- title and preview derivation
- model selection inheritance rules
- validation of user commands that affect conversation state

Domain code should be mostly pure functions and easy to unit test without Dexie,
React, or network calls. If this file grows too large, split by behavior first,
for example `context-assembly.ts` or `message-status.ts`, not by abstract layer
names.

### Persistence

Suggested location: `src/features/chat/repository.ts`

Owns IndexedDB access:

- Dexie database schema and migrations
- repository functions for parent chats, threads, messages, and settings
- query helpers used by React hooks
- transaction wrappers for multi-row writes
- migration tests and data repair helpers

React components should not construct Dexie compound-index queries directly.
Expose named queries such as `listParentMessages(chatId)` or
`getThreadMessages(threadId)` instead.

### Application Services

Suggested locations:

- `src/features/chat/service.ts`
- `src/features/chat/send-turn.ts`

Owns workflows that coordinate domain, persistence, and providers:

- create parent chat
- open or create thread for message
- send parent chat turn
- send thread turn
- retry failed assistant message
- delete/archive/restore flows
- recompute materialized conversation summaries

Services should be the only place that performs multi-step mutations affecting
conversation integrity. Keep `send-turn.ts` separate because streaming,
cancellation, retries, and provider attempts are operationally different from
ordinary conversation CRUD.

### Runtime Providers

Suggested location: `src/features/providers/`

Owns external model-provider integration:

- provider interface
- OpenRouter adapter
- stream parsing
- usage normalization
- provider error normalization
- request cancellation

The chat runtime should call a provider interface such as
`streamChatCompletion(input)`. Prefer an async event stream with normalized event
types such as `requestId`, `chunk`, `usage`, `done`, and `error`.

Provider errors should include a normalized `code` from a closed set (`auth`,
`rate_limit`, `context_too_long`, `model_unavailable`, `content_filtered`,
`network`, `aborted`, `parse_error`, `provider_error`), a `retryable` flag,
`httpStatus` when available, diagnostic details for logs, and sanitized
user-facing text. Adding a new code requires updating this list. The app should
not depend directly on OpenRouter request or stream payload shapes.

### UI

Suggested locations:

- `src/features/chat/components/`
- `src/features/chat/hooks/`
- `src/components/ui/`

Frontend contract:

- Route pages may read route params, handle route-level missing states, and
  render feature containers. They should not own business workflows.
- Containers may call feature hooks, wire service command callbacks, and map
  domain/service errors to UI states.
- Presentational components should accept props, emit events, and avoid Dexie
  imports, provider imports, route access, and business invariants.
- Shared UI primitives should own visual behavior only. They should not contain
  chat domain logic.

Hooks should be split by responsibility:

- `useChatQuery*`: live persistence subscriptions only.
- `useChatCommands*`: stable command callbacks into services.
- `useChatViewModel*`: derived display state from query results.
- `useComposerState`: local input and draft behavior only.

Hooks should not both query persistence and perform multi-row mutations unless
they are explicitly feature-container hooks.

The current `ParentChatWorkspace` should eventually be split into components
such as `ParentTimeline`, `ThreadPane`, `ConversationComposer`, `MessageBlock`,
`LineageBar`, and `useConversationMessages`.

## Conversation Kinds

A `parentChats` row carries a `kind: 'dm' | 'channel'` discriminator. There
is one conversation primitive, three shapes:

- **Model DM** (`kind='dm'`, `agentId=null`): today's default. One model,
  picked in the composer. AE7 byte-for-byte parity is enforced — sending
  in a model-DM produces the same transport payload that the pre-channel
  code did.
- **Agent DM** (`kind='dm'`, `agentId` set): 1:1 chat with a reusable
  agent. The agent's `systemPrompt` is prepended as a `{role:'system'}`
  message; the agent's `model` overrides the chat-level model.
- **Channel** (`kind='channel'`, `agentId=null`): a room with a roster of
  agents. The orchestrator drives bounded fan-out; each agent decides
  whether to respond via a sentinel-silence convention.

Invariants:

- `parentChats.agentId` must be null when `kind='channel'`.
- `chatParticipants` rows are only allowed on channel hosts (a channel
  parent chat or a thread under one).
- A thread of a channel snapshots its participants at thread creation —
  frozen-branch rule extended to participants (R17). Adds and removes on
  the parent channel do not change an already-created thread's roster.
- Per-message agent identity is captured as an `agentSnapshot` (display
  name + model ref) so deleting the agent definition does not break
  history rendering.

## Channel Orchestration

The channel orchestrator (`src/features/chat/orchestrator.ts`) is the
single owner of a channel turn's lifecycle. It runs entirely behind the
same `Turn` + `providerRequestAttempt` tables used by DM sends, so all
existing repair, ownership, and cancellation rules apply to channels for
free.

Loop sketch:

```
runChannelTurn(chatId, userMessageId):
  turn = openTurn(...)
  loop until stop:
    if turn was closed externally → return       (user-interrupt early-bail)
    candidates = selectCandidates(...)
    if no candidates → closeTurn(no-trigger); return
    if step over cap → closeTurn(cap-hit); return
    fanOut = Promise.allSettled(runOneAttempt(c) for c in candidates)
    if no message produced → closeTurn(no-trigger|error); return
  closeTurn(complete)
```

- **Candidate selection (R10).** Auto-decide agents that did not just
  speak; plus mention-only agents named in the latest event (parser is
  `src/features/chat/mentions.ts`, case-insensitive longest match).
- **Decide-to-respond (R11).** Each auto-decide candidate gets a single
  provider call. A sentinel-silence convention (parsed by
  `src/features/chat/decide-to-respond.ts`) means the orchestrator can
  decide "yes/no" + "where" + content in one round-trip. Empty or
  whitespace-only responses are treated as silence.
- **Stop reasons.** Every closed turn carries one of `complete |
  no-trigger | cap-hit | user-interrupt | error`. Stop reasons map to
  attempt-level statuses via `attemptStatusFor` in `turn-lifecycle.ts`.
- **Caps (R14).** `maxChainedSubTurns`, `maxMessagesPerAgentPerInput`,
  and `tokenBudgetPerInput` are enforced at the orchestrator boundary,
  not inside individual attempts. Token-budget aggregation is the
  open follow-up (see `docs/tasks.md` "multi-agent follow-ups").
- **User interrupt.** `interruptActiveTurn(parentChatId)` closes the
  turn with `user-interrupt` and aborts any registered stream
  controller. The orchestrator's loop guard observes the closed turn at
  the top of the next iteration and bails before launching another
  step. Per-call `attemptStillCurrent` checks gate writes inside each
  attempt so already-in-flight chunks never overwrite a cancelled
  message.
- **Materialized summaries.** `closeTurn` is the single writer for
  `ParentChat.updatedAt` and `lastActivityPreview` after a channel
  turn — fan-out attempts do not bump those fields independently.

## Data Model Guidelines

Parent chats and threads are different objects and should remain separate.
Threads are message-rooted branches, not top-level chats.

Required invariants:

- A parent chat owns top-level messages and all threads rooted under it.
- A thread has exactly one root message.
- A thread root message must belong to the same parent chat.
- A child thread inherits from the parent thread up to the child root message.
- Existing thread context must not change because later ancestor messages were
  added.
- A thread's inherited context is fixed to immutable message revisions or a
  context snapshot captured when the thread is created. Later ancestor appends,
  edits, deletes, regenerations, or model changes must not change that inherited
  context.
- Every message's `parentChatId` must match the parent chat that owns its
  conversation.
- Every `parentThreadId` must point to a thread in the same parent chat.
- `rootMessageId` should be unique per thread unless multiple threads per root
  are intentionally supported.
- Archived parent chats should not accept new sends unless explicitly restored.
- Deleting a parent chat must delete all owned threads and messages in one
  transaction.

### Materialized Summary Ownership

Materialized fields are allowed, but each one must have a named writer,
rebuilder, and repair strategy. Current or likely materialized fields include
`ParentChat.title`, `ParentChat.updatedAt`, `ParentChat.lastActivityPreview`,
`ParentChat.starredAt`, `ConversationThread.updatedAt`,
`ChatMessage.directReplyCount`, and persisted parent/thread drafts.

`ParentChat.starredAt` records when a chat was last starred. Writers:
`starParentChat`/`unstarParentChat`/`toggleStarParentChat`. Lifecycle: starring
does not bump `updatedAt` (so Recent ordering is stable when a user stars a
chat); archiving clears `starredAt` so archived chats do not linger in the
Starred section. There is no rebuilder — the field is user-driven and has no
derived source to recompute from.

`directReplyCount` counts direct messages in the thread rooted at this message,
excluding nested descendant threads. Changing this definition requires updating
this document and the tests first.

### Ordering Keys

Persisted fields used to order rows (for example `PinnedMessage.sortKey`, future
turn sequence numbers, draft revision counters) must be strictly monotonic
within their grouping scope. `Date.now()` alone is not sufficient: two writes
in the same millisecond produce identical keys, and Dexie's `sortBy` leaves
their relative order undefined.

When writing an ordering key, the writer should read the current max for the
scope inside the same transaction and use `Math.max(Date.now(), maxExisting +
1)`. The collision case must have a regression test that pins two rows under a
mocked clock returning a constant value.

### Migrations And Repair

Every persisted shape change requires a Dexie version bump, an `upgrade()`
backfill path when existing data can be migrated, a migration test from the
prior schema or fixture, and a repair strategy for orphaned rows or invalid
materialized summaries.

Dexie does not enforce foreign keys. Repositories and services must validate
`parentChatId`, `conversationId`, `rootMessageId`, `parentThreadId`, depth, and
same-parent ownership before writing rows.

### Edit And Delete Semantics

Before adding edit, delete, regenerate, or retry features, define message
revision behavior.

Decision: messages referenced by thread roots or context snapshots are immutable
revisions; prefer tombstones/redactions over hard deletes; edits create new
revisions and preserve the original revision for existing threads; root-message
deletion produces an explicit unavailable state.

## Streaming And Turn Lifecycle

Sending a message is represented as an explicit lifecycle in
`src/features/chat/turn-lifecycle.ts` plus `send-turn.ts` (DM dispatcher)
and `orchestrator.ts` (channel dispatcher):

1. Validate input and conversation state.
2. Persist the user message.
3. `openTurn` (always — DM creates a one-attempt turn, channel fans out).
4. `openAttempt(turnId, agentId?, modelRef, assistantMessageId)` returns
   a `{ attempt, controller }` pair. The provider call uses
   `controller.signal`.
5. Append streamed chunks to the assistant message.
6. Persist provider request id and usage as they arrive.
7. `completeAttempt | failAttempt | cancelAttempt | markAttemptDecidedSilent`
   when the call ends.
8. `closeTurn(turnId, stopReason)` is the single writer for `status='closed'`
   and the channel's materialized summary fields.

All stream callbacks verify `attemptStillCurrent(attemptId)` before
writing chunks, request ids, usage, or final status. This prevents stale
chunks from an old stream from mutating a newer assistant message — and
makes user-interrupt safe under channel fan-out where many attempts run
in parallel.

Stop-reason taxonomy (recorded on the closing `turns` row):

- `complete` — loop terminated naturally (DM finished, or every channel
  candidate has had its say within the caps).
- `no-trigger` — a channel step produced no messages (every candidate
  was silent, or there were no candidates to begin with).
- `cap-hit` — `maxChainedSubTurns`, `maxMessagesPerAgentPerInput`, or
  the planned token-budget cap stopped the loop.
- `user-interrupt` — UI Cancel button (or another caller of
  `interruptActiveTurn`) closed the turn.
- `error` — DM provider call threw, or every fan-out attempt in a
  channel step errored.

Cancellation flow (DM and channel):

- `interruptActiveTurn(parentChatId)` in `turn-lifecycle.ts` is the
  single repo entry point.
- `abortStreamsForConversation(conversationId)` aborts the DM
  `AbortController` registered in `stream-controllers.ts` — the
  send-turn `catch` then closes the turn with `user-interrupt`.
- For channels (which do not register a controller), `closeTurn` is
  called directly. The orchestrator's loop guard observes the closed
  turn and bails on the next iteration.

Still open:

- On startup, find stale `streaming` messages, preserve partial content,
  mark them `error` or `cancelled`, clear conversation locks, and avoid
  auto-resuming unless the provider supports durable continuation
  (P0c.3).
- Prevent concurrent sends in the same conversation unless explicitly
  supported.
- Separate user-visible provider errors from internal diagnostic details.
- Preserve retry metadata in the turns/attempt rows: provider, model,
  params, context snapshot or message revisions, user/assistant message
  ids, provider request id, error code, retryable flag, attempt number,
  retry-of id, timestamps, and usage/cost already received.

## Provider Abstraction

OpenRouter-specific code should stay behind an adapter. The app-facing provider
contract should use application types, not OpenRouter payload shapes.

The adapter should own HTTP headers, stream parsing, request ids, usage
normalization, provider-specific errors, model list source/refresh strategy, raw
usage retention policy, and units for cost/token usage.

The application should own which messages are sent, when the request is allowed,
how chunks are persisted, and how failures affect conversation state.

Missing usage should be represented explicitly rather than overloaded as zero.
Partial usage is allowed during streaming only if the provider adapter marks it
as partial.

## UI Guidelines

Feature UI should remain dense, work-focused, and closer to a working tool than
a marketing page.

Best practices:

- Keep route pages thin.
- Keep sidebar, parent timeline, and thread pane independently testable.
- Avoid direct persistence queries in presentational components.
- Keep optimistic and loading states explicit.
- Use shared UI primitives for repeated controls.
- Avoid fake counts or placeholder controls in production paths unless clearly
  marked as disabled or wired to real data.
- Prefer accessible names, keyboard behavior, and focus management for message
  actions, dialogs, and composers.

Mobile thread layout:

- Opening a thread should navigate to a thread-focused view with visible
  root-message context.
- Back should return to the parent timeline position that opened the thread when
  practical.
- Thread composer state should not overwrite parent composer drafts.
- Missing or deleted root messages need an explicit unavailable state.
- Focus should move to the thread heading or composer when opened and return to
  the originating message action when closed.

Accessibility expectations: icon-only actions need accessible names, message
action menus must be keyboard reachable, composer shortcuts must not trap normal
text entry, streaming updates should be understandable to screen readers without
becoming noisy, dialogs/popovers need focus management, and non-essential
animation should respect reduced-motion preferences.

## Testing Strategy

Add tests before major new feature work. The first valuable tests are not broad
snapshot tests; they are focused behavior tests.

Priority coverage:

- conversation semantics: parent creation, thread creation from parent/thread
  messages, frozen inheritance, archived send prevention, and cascade delete
- runtime behavior: failed sends, streaming chunks, stale streaming recovery,
  retry metadata, and OpenRouter stream parsing
- UI behavior: mobile thread view, keyboard sends, disabled composers, focus
  movement, and empty/error/archived/missing-data states

Recommended tools and rules:

- Use Vitest for domain, service, and provider tests.
- Keep tests colocated next to the files they verify, using `*.test.ts` or
  `*.test.tsx`.
- Use fake IndexedDB for persistence tests.
- Use React Testing Library for component behavior that cannot be tested as pure
  domain logic. Prefer accessibility-oriented queries and user events over
  snapshots.
- Use Playwright only for high-value end-to-end flows.
- Provider tests must use fixtures or fakes and must not hit OpenRouter.
- Domain tests should use injected clocks and id factories.
- Refactors that move behavior must land with characterization tests for the
  current behavior first.

Clock and id mocking rules:

- When a test needs `Date.now()` to return different values across several
  operations, use a single `vi.spyOn(Date, 'now')` and call `mockReturnValue`
  between awaits to step the value forward. Do not chain
  `mockReturnValueOnce(...)` to queue successive values — any incidental
  `Date.now()` call inside Dexie transactions, library hooks, or test
  scaffolding silently consumes a slot, shifts the queue, and produces an
  order-dependent flake that only reproduces in the full suite.
- Tests that depend on the relative order of rows produced by timestamped
  fields must also cover the same-timestamp tie-break, not only the
  happy-path "two writes one millisecond apart" case.

## Improvement Backlog

Items are ordered within each tier; do the lower numbers first.

### P0a: Semantic Safety

- [x] P0a.1 Add characterization tests for branch context, nested threads, cascade
  delete, send lifecycle, and provider stream parsing.
- [ ] P0a.2 Document browser-side API key risk and define the backend-proxy
  threshold before any public or multi-user deployment.

### P0b: Domain And Persistence Boundaries

- [x] P0b.1 Create `features/chat/domain.ts` for pure context assembly,
  lineage, and message-summary logic currently mixed into `db.ts`.
- [x] P0b.2 Create `features/chat/database.ts` and
  `features/chat/repository.ts` with named Dexie queries
  and writes while keeping the schema stable.
- [x] P0b.3 Move settings UI and repository code into `features/settings/`.
- [ ] P0b.4 Define ownership for materialized summaries and repair paths.

### P0c: Runtime And Provider Boundaries

- [x] P0c.1 Add `features/providers/provider-contract.ts` and make OpenRouter one
  implementation.
- [x] P0c.2 Move send-turn workflows into `features/chat/send-turn.ts`.
- [ ] P0c.3 Add request cancellation, request-attempt ownership, and stale
  streaming recovery.
- [ ] P0c.4 Preserve retry metadata in a form that can support future retry UI.

### P0d: UI Decomposition

- [ ] P0d.1 Move `ParentChatWorkspace` toward `features/chat/components/` and
  split it into smaller components only where the boundary is useful.
- [ ] P0d.2 Add frontend behavior tests for mobile thread layout, focus, keyboard
  sends, disabled composers, and missing/error states. Initial RTL coverage
  exists for `ParentChatWorkspace`; mobile layout and focus behavior still need
  explicit tests.

### P1: Before Edit/Delete/Retry Features

- [ ] P1.1 Persist branch context snapshots or immutable message revisions.
- [ ] P1.2 Add a real turn or request record to support retries and diagnostics.
- [ ] P1.3 Centralize materialized summary updates for reply counts, previews,
  and last activity.
- [ ] P1.4 Add transaction-backed delete and repair flows for orphaned
  threads/messages.
- [ ] P1.5 Add route-level handling for missing parent chats and missing threads.
- [ ] P1.6 Define edit/delete/regenerate semantics before exposing those actions.

### P2: Before Sync Or Multi-Device Features

- [ ] P2.1 Define stable export/import format.
- [ ] P2.2 Add durable schema migrations with tests.
- [ ] P2.3 Separate local ids from any future server ids.
- [ ] P2.4 Add conflict-resolution rules for messages, threads, drafts, and
  settings.
- [ ] P2.5 Add tombstones, revision clocks, operation history, and hard-delete
  rules.
- [ ] P2.6 Treat `updatedAt` as non-authoritative for conflict resolution unless
  a stronger clock exists.
- [ ] P2.7 Revisit API key storage and provider proxy requirements for the chosen
  deployment model.

## Definition Of Done For New Features

A feature is architecture-ready when:

- the feature plan names affected invariants, persistent fields, tests, failure
  states, and manual verification
- domain behavior is tested without React where possible
- new hooks or components do not query Dexie directly unless they are explicitly
  data hooks
- new persistent fields document owner, migration behavior, and repair behavior
- multi-row writes are transactional or explicitly safe without transactions
- provider-specific code stays inside provider adapters
- new async workflows document stale/interrupted-state recovery
- UI components do not duplicate business rules
- error, loading, empty, archived, and missing-data states are handled
- lint and typecheck pass

## Review Checklist

Use this short checklist during PR review:

- Does this change make a React component responsible for domain rules?
- Does it add or update persisted data without migration and repair behavior?
- Can a failed, interrupted, or stale provider request leave inconsistent rows?
- Are materialized fields updated by one clear owner and rebuilder?
- Is the behavior covered by a test at the lowest reasonable level?
- Are data hooks separated from command hooks?
- Can presentational components render with mock props?
- Are mobile navigation, focus behavior, and icon-only accessible names covered?

## Current Guardrails

At the time this document was created, the project had:

- TypeScript typechecking via `pnpm typecheck`
- ESLint via `pnpm lint`
- Vitest via `pnpm test`, with fake IndexedDB for persistence tests
- React Testing Library for colocated component behavior tests
- direct Dexie usage from both library and UI code
- direct OpenRouter dependency from chat runtime

The next major architecture milestone is to expand tests around stale streaming,
retry metadata, migrations, and UI behavior, then continue refactoring
boundaries with those tests in place.
