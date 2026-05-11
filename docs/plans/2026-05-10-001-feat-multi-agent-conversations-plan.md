---
title: Multi-agent conversations foundation
type: feat
status: active
date: 2026-05-10
origin: docs/brainstorms/multi-agent-conversations-requirements.md
---

# Multi-agent conversations foundation

## Summary

Land the data, lifecycle, and UI primitives that let `llm-slack` host both today's model-DM and two new shapes (agent-DM and multi-agent channel) on one extended `parentChats` row. The work ships in five phases: agent-DM first (smallest end-to-end value), then channel infrastructure (schema + per-attempt send lifecycle), then orchestrator + mention parsing, then channel UI, then thread inheritance and doc updates.

## Execution status (as of 2026-05-10)

Branch: `feat/multi-agent-foundation`. Test suite: 245 passing across 32 files; typecheck clean.

| Unit | Status | Commit | Notes |
|------|--------|--------|-------|
| U14 — Test infra helpers | ✅ Done | `3ed4b00` | All five helpers landed. Agent/channel scenario builders ship progressively at U1/U5 (their schemas didn't exist yet at U14). |
| U1 — Schema v6 + agents | ✅ Done | `493c0d9` | Plan said "v2"; actual is **v6** (DB was already at v5). Schema progression is now v6→v9 across U1/U5/U6/U11. |
| U8 — Mention parser | ✅ Done | `d078f28` | — |
| U3 — Agent-DM send-turn | ✅ Done | `d2e3fb8` | AE7 byte-parity verified by an explicit transport-snapshot test. |
| U5 — Schema v7 + channel persistence | ✅ Done | `c5ad456` | Plan "v3" → actual **v7**. |
| U6 — Schema v8 + turn lifecycle | ✅ Done | `d9bc4fb` | Plan "v4" → actual **v8**. `provider-contract.signal` was already in place from commit `c89ba94`; only the lifecycle layer was added. |
| U7 — Orchestrator | ✅ Done with three deferrals (see below) | `6de596e` | Core fan-out, decide-to-respond, caps, stop reasons all land. |
| U11 — Schema v9 + thread participant snapshot | ✅ Done | `20390e1` | Plan "v5" → actual **v9**. Schema bump is logical only (`chatParticipants.chatId` already accepted any id). |
| U2 — Agents library page | ✅ Done | `af5f8a5` | First Phase-2 unit. Adds `AgentDot`, `AgentEditor`, `AgentsPageContent`, `/settings/agents` route, AI-nav entry. |
| U4 — New-chat modal | ✅ Done | `25ec0c2` | 3-tab modal (Model / Agent / Channel placeholder). Wired into `chat-shell` "New chat" + `home-page` "Start a conversation". |
| U9 — Channel creation flow | ✅ Done | _pending commit_ | Adds `createChannel` atomic repo helper (chat + settings + participants in one transaction). Channel tab now shows the name input + agent multi-select + per-agent mode picker (auto-decide / mention-only). |
| U10 — Channel UI | ⏳ Not started | — | — |
| U13 — Sidebar restructure | ⏳ Not started | — | — |
| U12 — Docs update | ⏳ Not started | — | Land after all UI is in. |

### Deferrals inside completed Phase 1

These were called out in U7's commit message and are not silent gaps. Each lands naturally as a small follow-up rather than blocking Phase 2.

1. **R13a thread response location.** The orchestrator parses `respondIn: 'thread'` from agent responses but persists every reply on the main timeline in v0. The thread-write path pairs naturally with the "orchestrator-inside-thread" step that U11's participant snapshot already sets up.
2. **Token-budget cap (R14c).** Per-agent and chained-sub-turn caps are wired; the token budget would require aggregating `providerRequestAttempts.usage` at step boundaries.
3. **Channel user-interrupt UI.** The DM cancel path runs through the new lifecycle (U6); the channel cancel wiring waits for U10's Cancel button.

### Continuation pointer

Phase 2 is in flight. Next-session entry point:

- **U2, U4, and U9 are shipped.** Continue with **U10** (Channel UI — agent identity rendering, participants panel, channel-settings panel, kind badge, Cancel button; see [§Implementation Units](#implementation-units)).
- All Phase-1 invariants are exercised by `assertDbInvariants` — call it at the end of any new integration test to catch cross-table regressions for free.
- Design references at `docs/design/2026-05-10-multi-agent-conversations/direction-b-agents.jsx` are the primary UI source for U2/U4/U9/U10. See the [Design References](#design-references) section.
- `pnpm test` and `pnpm typecheck` are the green-bar gate; the husky pre-commit hook enforces both.

---

## Problem Frame

Today's chat is single-assistant; the data model and turn lifecycle assume one author per turn. Origin doc establishes the product: keep model-DM intact, add agent-DM and channel shapes, agents decide whether to respond (Slack channel of humans), all bounded by per-channel settings. The implementation challenge is to do this *additively* on top of `parentChats`, `messages`, `send-turn.ts` without forking the DM path or breaking AE7 ("DM identical to today").

See origin: `docs/brainstorms/multi-agent-conversations-requirements.md`.

UI direction has been explored as static React mockups at `docs/design/2026-05-10-multi-agent-conversations/`. Phase 2 (UI units U2, U4, U9, U10, U13) implements those mockups; see [Design References](#design-references) below for per-unit mapping and divergence notes.

---

## Requirements

Carries forward all 18 origin requirements; no plan-local requirements added.

- R1-R2 (chat kind, no v0 promotion)
- R3-R5 (agent definitions: id, display name, model, system prompt; reusable; extensible)
- R6-R7 (channel participation set; per-chat-per-agent participation mode)
- R8-R9 (message authorship; identity rendered in channels)
- R10-R13 (turn orchestration: candidates, decide-to-respond owned by agent, no self-reply, mention parsing)
- R13a (agent chooses main vs. thread when channel allows)
- R14-R16 (channel settings: caps + default mode + `allowAgentThreading`; stop reasons; user-interrupt)
- R17-R18 (thread inheritance of kind/participants/modes; per-agent provider routing)

**Origin actors:** A1 (User), A2 (Agent)
**Origin flows:** F1 (auto-decide fan-out), F2 (chained sub-turn capped), F3 (DM send unchanged), F4 (user interrupts)
**Origin acceptance examples:** AE1 (covers R7, R10, R11), AE2 (covers R11, R15), AE3 (covers R12), AE4 (covers R14, R15), AE5 (covers R16), AE6 (covers R17), AE7 (covers R1, R10), AE8 (covers R13a, R14), AE9 (covers R13a)

---

## Scope Boundaries

### Deferred for later

Carried from origin (`docs/brainstorms/multi-agent-conversations-requirements.md`), consolidated lightly for clarity:

- Agent memories and agent tools.
- Pluggable orchestration strategies / swappable scheduler (Approach B from the brainstorm).
- Participation modes beyond auto-decide and mention-only (regex, keyword, conditional).
- Per-agent (rather than per-turn) cost metering.
- Streaming-UX refinements specific to many in-flight agents.
- Agent-library UX beyond minimal add/remove (search, tagging, sharing, import/export).
- Promoting a DM to a channel, carrying DM context into a new channel, and demoting a channel back to a DM.

### Outside this product's identity

Carried from origin:

- A blunt "always respond" mode in *channels* — contradicts the human-Slack model. Always-respond is the correct DM behavior and is expressed via the `dm` kind.
- Background or scheduled agents acting without a user-initiated turn.
- Agent-to-agent communication outside the visible chat surface.
- Hierarchical team / manager-worker abstractions.
- An agent marketplace or community sharing surface.

### Deferred to Follow-Up Work

- Background recovery for stale `streaming` rows on app start (currently absent for DMs; introducing it inside this plan would balloon U6's scope). Tracked under existing architecture P0c.3.

---

## Context & Research

### Relevant Code and Patterns

- `src/features/chat/database.ts` — Dexie schema, currently v1 (no upgrades exist yet; this plan ships the first real `upgrade()`).
- `src/features/chat/domain.ts` — pure types and helpers (no Dexie). Add `kind`, agent identity types here.
- `src/features/chat/repository.ts` — single source of Dexie reads/writes. Multi-row writes use `db.transaction('rw', [...], async () => {...})`. `assertMessageConversationIsValid` is the FK-substitute pattern.
- `src/features/chat/send-turn.ts` — separated entry points `sendParentChatTurn` / `sendThreadTurn` with shared `resolveSendTarget`. No `AbortController`, no attempt-id, no turns/attempts persistence today (P0c.3 / P0c.4 still open).
- `src/features/providers/provider-contract.ts` — `ProviderAdapter.streamChat(connection, model, input)`. `StreamChatInput.messages` is the entire transport payload; system prompts go through as a `{role: 'system'}` prefix message (no contract change needed).
- `src/features/providers/model-ref.ts` + `src/features/providers/models-catalog.ts` — `ModelRef` snapshot + `resolveForSend(ref, {settingsDefault})` is the per-call resolution path. Reuse verbatim per agent.
- `src/features/settings/settings-shell.tsx`, `src/features/settings/provider-definitions.ts`, `src/features/settings/settings-repository.ts` — pattern for a definitions-style settings page (list rows, Add/Edit/Disconnect, NAV_GROUPS).
- `src/features/chat/components/parent-chat-workspace.tsx` (1610 lines) — message rendering. `Avatar` + `authorLabel` are the natural extension points for agent identity; layout is Slack-style rows (no opposing alignment) which already accommodates per-row author identity cleanly.
- `src/router.tsx` — flat route tree under `AppShell`. New `/settings/agents` slots into `_settings-shell` pathless layout. Chat URL stays `/chat/$chatId` (kind discriminator on the row, not the URL).
- `src/test/setup.ts` — wires `fake-indexeddb`; resets `db` before each test. New tables exercise it without setup changes.

### Institutional Learnings

This repo has no `docs/solutions/` knowledge base yet. Binding learnings live in `AGENTS.md` (= `CLAUDE.md`) and `docs/architecture.md`. This plan ships v2 → v5 of the Dexie schema; each version needs its own migration test from the prior version's fixture.

- **Strictly-monotonic ordering keys per scope** (`docs/architecture.md` §"Ordering Keys"). Origin: commit `521c516`. Applies to any new sequence numbers in this plan (chained-sub-turn step index, fan-out step counter, `chatParticipants.sortKey`). Pattern: read max in same transaction, use `Math.max(Date.now(), maxExisting + 1)`. Add same-millisecond regression test under a clock locked to a constant.
- **`Date.now()` mock convention** (`AGENTS.md` lines 31-34, `docs/architecture.md` §"Clock and id mocking rules"). Use a single `vi.spyOn(Date, 'now')` and call `mockReturnValue` between awaits; never chain `mockReturnValueOnce`. Critical for orchestrator tests where Dexie transactions consume slots.
- **Streaming as state machine with attempt ownership** (`docs/architecture.md` §"Streaming And Turn Lifecycle"). Today's `send-turn.ts` does not enforce this. With fan-out (multiple concurrent streams + user-interrupt), per-call `requestAttemptId` checks + `AbortController` are mandatory.
- **Migrations + repair** (`docs/architecture.md` §"Migrations And Repair"). Every persisted shape change → version bump + `upgrade()` + migration test from prior fixture + repair strategy. This plan ships v2 → v5; each version needs its own migration test.
- **Materialized summaries need a named writer + rebuilder** (`docs/architecture.md` §"Materialized Summary Ownership"). Channel turns affect `ParentChat.updatedAt`, `ParentChat.lastActivityPreview`, `directReplyCount`. Single writer = orchestrator at turn close, not each fan-out write.
- **Provider-deletion cascade** (`docs/providers-refactor.md`). Today iterates `settings`, `parentChats`, `threads`, `messages`, `turns`, `providerRequestAttempts`. Add `agents.model` to the cascade.

### External References

None used. Internal patterns are sufficient; no security/payments/external-API surface.

---

## Key Technical Decisions

- **One conversation primitive, two kinds.** Extend `parentChats` with `kind: 'dm' | 'channel'` discriminator and an optional `agentId`. No new "channel" entity. (See origin Key Decisions.)
- **System prompts ride as `{role: 'system'}` prefix messages.** No `ProviderAdapter` contract change. Aligns with how OpenAI/Anthropic/OpenRouter all accept system content; `messageToTransport` already preserves system rows. Avoids a contract version bump.
- **Decide-to-respond is implemented as a single call with a sentinel-silence response convention** (resolves origin's "pre-call vs single call" deferred question). Rationale: latency is the limiting UX axis in a Slack-style channel; doubling latency on every "yes" response would make even quiet chats feel sluggish. The sentinel convention is a structured response prefix the orchestrator parses (`{respond: false}` or an empty response) and treats as silence — agents that fail to follow the convention default to "respond." Cost-watchers can add a pre-call later as a settings-driven optimization.
- **Agent response location (main vs. thread) is part of the agent's decision when the channel allows it (R13a, R14e).** The decide-to-respond response envelope is extended to `{respond: true | false, respondIn?: 'main' | 'thread', content?: string}`. When `allowAgentThreading=true` on the channel, the orchestrator honors `respondIn`; opens (or reuses) a thread on the triggering event's message when `'thread'`, and persists the reply there. When `allowAgentThreading=false`, or when the response omits `respondIn`, or when the agent is already inside a thread, the reply lands in the same conversation as the triggering event. Threading is one-way from main in v0 — agents inside a thread cannot escalate back to main (no "also send to channel" affordance).
- **Promote `turns` and `providerRequestAttempts` tables now, not later.** Origin requires per-turn stop reasons (R15/R16) and per-agent attempts (R18). Without these tables, fan-out has no place to record cap-hit / no-trigger / user-interrupt and no per-attempt id for stream-callback ownership checks. `docs/db-schema.md` already drafts both shapes; this plan promotes them from "Likely next additions" to live.
- **Per-call `requestAttemptId` ownership check before any persistence write.** Today's `send-turn.ts` does `void updateMessage(...)` inside `onChunk`. With concurrent fan-out and user-interrupt, every chunk callback must verify the attempt is still current before writing. Refactored at U6 (before orchestrator lands at U7).
- **Channel participants snapshot at thread creation (R17).** Threads created from a channel message store the participant set at creation time, not look it up live. Frozen-branch rule extends naturally — what's frozen is now `(messages + participants)`.
- **Materialized summaries written by the orchestrator at turn close.** Each fan-out agent does NOT bump `ParentChat.updatedAt` / `lastActivityPreview` independently. The orchestrator owns turn-close and writes the summary once.
- **Agent definition library lives under settings** (`/settings/agents`). Mirrors the providers pattern: list rows with Add/Edit/Delete, no separate top-level surface in v0.
- **Single `New chat` modal with three tabs** (Model / Agent / Channel) replaces the current direct-to-chat "New" button. Default tab = Model preserves today's UX (one click to start a chat).
- **Mention syntax = display name only, case-insensitive.** Renames don't rewrite existing message bodies. Stale mentions stop firing on rename — accepted for v0.
- **Channels get a dedicated sidebar section, Slack-style.** A separate "Channels" group sits alongside the existing DM-equivalent listings (Saved, Starred, Recent) — channels do not appear in the flat Recent list. Within the DM-equivalent surface, model-DMs and agent-DMs share the same section (both 1:1 conversations); a small inline marker distinguishes them within rows. Sidebar restructure is U13.
- **Backend logic ships fully unit-tested before any UI wiring.** Implementation units are presented in two distinct phases. Phase 1 (backend) lands U14 → U1 → U3 → U5 → U6 → U8 → U7 → U11, each with its full test suite green. Phase 2 (UI) — U2, U4, U9, U10, U13 — does not start until Phase 1's last unit lands. U12 (docs) is last. The agent treats Phase 1's green test suite as the gate for Phase 2.
- **Test infrastructure is a first-class unit (U14), shipped before any other code.** Five helpers — scenario builders, a centralized provider fake harness, a `assertDbInvariants` postcondition checker, a deterministic clock/id factory, and a DB state pretty-printer — are landed up front so every subsequent backend unit can consume them. This makes the agent's iteration loop materially faster (tests setup in 2-3 lines, failures self-diagnose with DB state dumps) and keeps Phase 1's test bar high without becoming costly to write.

---

## Open Questions

### Resolved During Planning

- *Decide-to-respond implementation shape* (origin Deferred-to-Planning): single call with sentinel-silence. See Key Technical Decisions.
- *Mention syntax* (origin Resolve-Before-Planning): display name, case-insensitive. See Key Technical Decisions.
- *New-chat entry point UI* (origin Resolve-Before-Planning): one modal with three tabs.
- *Persistence shape of chained sub-turns* (origin Deferred-to-Planning): one `turns` row per fan-out cascade rooted at a user input; per-agent attempts go into `providerRequestAttempts`. Stop reason recorded on the `turns` row at close.
- *How participation behavior is surfaced in the system prompt UI* (origin Deferred-to-Planning): free-text the user writes (a single "System prompt" textarea in the agent editor). The orchestrator does not append a structured field in v0 — agents that don't write good prompts won't decide well, and that's the experimentation surface origin's Success Criteria explicitly target.

### Deferred to Implementation

- Default values for the three channel safety caps (suggested starting points in origin: 2-3 chained sub-turns, 2 messages per agent per user input, model-dependent token budget). Tune via experimentation after first end-to-end channel works.
- Whether parallel fan-out uses `Promise.all` over provider streams or sequential-with-streaming-UI tricks. Decide in U7 once the streaming UX shape becomes concrete.
- Exact UI for "an agent is deciding" / "an agent declined" — likely no UI noise for declines, ephemeral hint for "deciding." Decide in U10 once the renderer is hands-on.
- Thread participation: stored as a copy at creation vs. delta layered over parent. Decide in U11 — copy is the obvious default; revisit if storage cost matters.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

### Turn lifecycle, fan-out edition

```
sendUserMessage(chatId, prompt)
  └─> openTurn(chatId, userMessageId)             // turns row created, status='active'
       │
       ├─ DM (kind='dm')
       │   └─> sendOneAttempt(turn, participant)  // existing send-turn flow, now wrapped in attempt
       │       └─> closeTurn(stopReason='complete')
       │
       └─ Channel (kind='channel')
           └─> orchestrate(turn)
               loop until stop:
                 candidates = listCandidates(turn, channelParticipants, lastEvent)
                 if candidates is empty:
                   closeTurn(stopReason='no-trigger'); return
                 if capExceeded(turn, channelSettings):
                   closeTurn(stopReason='cap-hit'); return
                 if userInterrupted(turn):
                   closeTurn(stopReason='user-interrupt'); return
                 fanOutStep:
                   for each candidate (parallel):
                     attempt = openAttempt(turn, candidate)
                     stream = providerCall(candidate.model, ctx, abortSignal=attempt.abort)
                     for chunk in stream:
                       if !attemptStillCurrent(attempt): break   // ownership check
                       persistChunk(attempt, chunk)
                     finalizeAttempt(attempt)
                   awaitAll
                 if no message produced this step:
                   closeTurn(stopReason='no-trigger'); return
```

### Decide-to-respond convention

The orchestrator prefixes the agent's transport messages with a `{role: 'system'}` instruction that names the channel context, the participating agents (display names), and the convention for declining. The agent's response is parsed: if the parsed content begins with the sentinel-silence marker (or the response is empty / whitespace-only), the orchestrator records the attempt as `decided-silent` and does NOT write a message row. Otherwise the response is treated as content.

The exact sentinel-silence syntax is implementation detail — likely `<silent>` or a JSON envelope — chosen at U7. The plan-level commitment: silence is a single-call convention, not a separate provider call.

### Schema progression

| Version | Adds | Migration |
|---------|------|-----------|
| v1 (current) | — | — |
| v2 | `parentChats.kind` (default `'dm'`), `parentChats.agentId` (nullable); `agents` table | Backfill `kind='dm'` on existing rows via `toCollection().modify(...)` (Dexie has no declarative defaults); no agent rows created retroactively |
| v3 | `chatParticipants` table; `channelSettings` table; `messages.agentId` (nullable) | No backfill; new tables empty; `messages.agentId` stays null on legacy rows |
| v4 | `turns` table; `providerRequestAttempts` table | No backfill; existing in-flight `streaming` messages are out of scope (already P0c.3) |
| v5 | `chatParticipants.chatId` semantics extended (parent or thread); enables thread participant snapshot | No backfill; new thread-scoped participant rows begin appearing at thread creation. U5's `assertChannelInvariants` updated to handle the dual-target chatId |

Each version ships with a migration test from the prior version's fixture.

---

## Implementation Units

**Phase 1 — Backend (lands fully unit-tested before any UI):** U14, U1, U3, U5, U6, U8, U7, U11
**Phase 2 — UI (only after Phase 1's last unit lands green):** U2, U4, U9, U10, U13
**Phase 3 — Docs:** U12

---

### U14. Test infrastructure helpers ✅ shipped (`3ed4b00`)

**Goal:** Land the test helpers every subsequent backend unit relies on, before any production code that uses them exists. This unit creates the helpers; later units consume them.

**Requirements:** Process — enables fast, reliable testing for U1-U11. Not tied to a single R-ID.

**Dependencies:** None.

**Files:**
- Create: `src/test/fixtures.ts` (scenario builders)
- Create: `src/test/fixtures.test.ts` (sanity checks for the builders themselves)
- Create: `src/test/fake-providers.ts` (centralized fake-provider harness)
- Create: `src/test/fake-providers.test.ts`
- Create: `src/test/db-invariants.ts` (`assertDbInvariants` postcondition checker)
- Create: `src/test/db-invariants.test.ts`
- Create: `src/test/clock.ts` (frozen-clock + deterministic id factory)
- Create: `src/test/clock.test.ts`
- Create: `src/test/dump-db.ts` (DB state pretty-printer)
- Modify: `src/test/setup.ts` (wire `dumpDb` into the global `afterEach` for failure diagnosis)

**Approach:**

Each helper is small, opinionated, and tested in isolation. Cumulatively they replace ~70-80% of the boilerplate that would otherwise live in each test file.

- **Scenario builders.** `seedAgent({ name, model?, systemPrompt? })`, `seedModelDm({ model? })`, `seedAgentDm({ agent })`, `seedChannel({ name?, participants: { agent, mode? }[] })`. Each returns the row(s) it created. Defaults sensible (real `ModelRef`, empty system prompt). Tests read like prose: "given a channel with these two agents…"
- **Centralized fake-provider harness.** `installFakeProviders({ scripts: Record<agentId | 'default', FakeScript> })` where `FakeScript` is a function `({ messages, model }) => StreamChatResult | 'silent' | Error`. Replaces ad-hoc `vi.mock('@/features/providers/adapters/openrouter')`. Records every call (which agent, what messages, what response) so tests can assert call shape. Handles the silence-sentinel convention by producing the right marker when a script returns `'silent'`.
- **`assertDbInvariants(db)`.** Walks all tables and asserts cross-table consistency: every `chatParticipants.chatId` resolves to a `parentChats.kind='channel'` (or a thread of one, once U11 lands); every `chatParticipants.agentId` resolves to an existing agent; no `kind='dm'` chat has `chatParticipants` rows; no closed turn lacks a recorded `stopReason`; no `messages.agentId` on a model-DM message; etc. Designed to be called at the end of any integration test. Each invariant is its own assertion so failures point at the specific rule.
- **Deterministic clock + id factory.** `withFrozenClock(timestamp, fn)` wraps a test body so `Date.now()` returns the given value (or a sequence advanced via a passed-in stepper). `withDeterministicIds(seed, fn)` similarly stabilizes any `crypto.randomUUID()`-style calls. Both rely on `vi.spyOn(...).mockReturnValue(...)` per the AGENTS.md convention (never `mockReturnValueOnce`). Compose: `withFrozenClock(t, () => withDeterministicIds(s, async () => { ... }))`.
- **DB state pretty-printer.** `dumpDb(db)` returns a string snapshot of all tables (compact JSON, sorted keys). The global `afterEach` in `src/test/setup.ts` catches test failures and prints the dump for the failing test only (using Vitest's task context). The agent sees the actual DB state in the failure output without rerunning.

**Execution note:** Test-first. Each helper's test file is written first; the helper is implemented to satisfy it. Bugs in test utilities propagate everywhere downstream, so the bar is higher than for regular code.

**Patterns to follow:**
- `src/test/setup.ts` for the test-setup extension point.
- `src/features/providers/openrouter.test.ts` / `adapters/anthropic.test.ts` for the existing fake-fetch pattern `fake-providers.ts` replaces.
- `src/features/chat/repository.ts` `assertMessageConversationIsValid` for invariant-assertion style.

**Test scenarios:**
- Happy path: `seedChannel({ name: 'test', participants: [{ agent: a, mode: 'auto-decide' }] })` returns a chat row with `kind='channel'` and one participant row; querying participants returns it.
- Happy path: `installFakeProviders({ scripts: { [agentA.id]: () => 'silent', [agentB.id]: () => ({ content: 'hi' }) } })` then a driven send produces zero messages for A and one for B; recorded calls show A was invoked with the expected message set.
- Happy path: `assertDbInvariants` passes on a freshly seeded clean DB; intentionally inserting an orphaned `chatParticipants` row makes it fail with a specific error naming the orphan.
- Happy path: `withFrozenClock(1000, () => { ... })` makes `Date.now()` return `1000` inside the callback, restores after.
- Edge case: scenario builder defaults are stable across runs (no `Date.now()` drift in fixture timestamps when called inside `withFrozenClock`).
- Edge case: `assertDbInvariants` fails specifically on a `kind='channel'` row with `agentId` set (R1 invariant violation) with an error that names the row id.
- Edge case: `dumpDb` output is deterministic for the same DB state (sorted keys, fixed serializer).
- Integration: a sample test using all five helpers together — seed a channel, install fakes, run a stub turn, dump on failure, assert invariants — finishes in under 20 lines.

**Verification:**
- All five helpers exist, tested, and usable. No production code uses them yet — subsequent units will. The pre-existing test suite still passes after `src/test/setup.ts` changes.

---

### U1. Schema v2: kind discriminator + agents table ✅ shipped as **v6** (`493c0d9`)

**Goal:** Land the smallest possible schema change that introduces the chat kind concept and the agents library, without touching any UI or send flow yet.

**Requirements:** R1, R3, R4, R5

**Dependencies:** U14

**Files:**
- Modify: `src/features/chat/database.ts` (Dexie v2 + upgrade)
- Modify: `src/features/chat/domain.ts` (add `ChatKind`, `Agent`, extend `ParentChat` with `kind` + `agentId`)
- Create: `src/features/agents/agents-repository.ts` (CRUD: list, create, update, delete)
- Create: `src/features/agents/agents-repository.test.ts`
- Modify: `src/features/chat/repository.test.ts` (assertions that legacy chats migrate to kind='dm', agentId=null)
- Create: `src/features/chat/migrations.test.ts` (v1→v2 migration test from a hand-built v1 fixture)

**Approach:**
- `parentChats.kind` defaults to `'dm'` for legacy rows via the v2 `upgrade()` block.
- `parentChats.agentId` is nullable; null in model-DMs and channels, set only in agent-DMs.
- `agents` table fields: `id`, `displayName`, `model: ModelRef`, `systemPrompt`, `createdAt`, `updatedAt`. Future-proofing for memories/tools per R5: leave room in the type but don't add columns now (Dexie tolerates extra row fields without schema changes).
- Add `agents` to the provider-deletion cascade in the providers repository (the existing cascade lives in `src/features/providers/providers-repository.ts`).

**Patterns to follow:**
- `src/features/providers/providers-repository.ts` for repository CRUD shape and provider-deletion cascade.
- `src/features/chat/repository.ts` `assertMessageConversationIsValid` for FK-substitute validation. Add `assertAgentExists` analog in agents-repository.

**Test scenarios:**
- Happy path: create an agent → list returns it; update the system prompt → next read reflects it; delete → list excludes it.
- Edge case: agent with empty display name is rejected (validation lives in repository, mirrors providers).
- Edge case: deleting an agent referenced by `parentChats.agentId` — current decision: cascade to null (the agent-DM becomes orphaned, renders with a "deleted agent" placeholder; promotion not allowed). Add test for the cascade behavior.
- Migration: v1 fixture (parent chat + thread + messages, no kind) → upgrade → kind='dm', agentId=null, messages untouched, thread untouched, downstream `getParentConversation` returns identical shape to pre-migration.
- Edge case: same-timestamp tie-break for `agents.createdAt` ordering (use the strictly-monotonic pattern; pin clock under a constant value across two creates).

**Verification:**
- `pnpm typecheck` clean. `pnpm test` green. Existing chat suite continues to pass without modification (besides the new migration test). No agent UI exists yet — agents can only be created via repository in tests.

---

### U2. Agents library settings page ✅ shipped

**Goal:** Give the user a UI to define and manage agents.

**Requirements:** R1 (UI surface for agents), R3, R4

**Dependencies:** Phase 1 complete (specifically U1 for the repository; U2 is the first UI unit and depends on the entire backend phase being green).

**Files:**
- Create: `src/features/agents/agents-page-content.tsx` (list + add/edit dialog)
- Create: `src/features/agents/agents-page-content.test.tsx`
- Create: `src/features/agents/agent-editor.tsx` (display name, model picker reused from `src/features/model-selection/`, system prompt textarea)
- Modify: `src/features/settings/settings-shell.tsx` (add "Agents" entry to the AI nav group)
- Modify: `src/router.tsx` (add `/settings/agents` child route under `_settings-shell`)
- Create: `src/pages/settings-agents-page.tsx` (route adapter)

**Approach:**
- Mirror `src/features/settings/settings-page-content.tsx` and `openrouter-settings-page-content.tsx` shape: list of rows, "Add agent" CTA, per-row edit/delete.
- Model picker: reuse `src/features/model-selection/` components. The picker writes a `ModelRef` directly onto the agent.
- System prompt: free-text `<textarea>`. No structured fields. No prompt templates.
- Empty state: copy that points at "create your first agent" plus a brief one-liner explaining that agents are reusable across chats.

**Design reference:** `docs/design/2026-05-10-multi-agent-conversations/direction-b-agents.jsx`
- Agent **editor / create flow**: `CreateAgentModal` (≈ line 1438). Borrow field order (name, model, system prompt) and the persona-row visual treatment.
- Agent **row shape** (for the workspace-level list): `SettingsAgentsTab` rows (≈ line 1001) — name + handle + model chip + per-row edit/remove. Strip the channel-scoped columns ("Speaks when", "7d msgs · spend", "in N channels", "memory notes") — those belong to channel participants (U10) or are deferred features (memory, cost metering).
- Avatar/glyph treatment: `AgentDot` (≈ line 433) — stable hash → palette index, glyph fallback. Matches U10's "stable colored marker."

**Divergences from design:**
- The design's mock surfaces `tools`, `memory`, `msgs7d`, `spend7d` per agent. All four are deferred (per Scope Boundaries). The v0 agent definition is just `displayName + model + systemPrompt`.
- The design's `SettingsAgentsTab` is *channel-scoped*; this unit's surface is the *workspace-level* agent library at `/settings/agents`. Same row visual treatment, different scope and CRUD target.

**Patterns to follow:**
- `src/features/settings/openrouter-settings-page-content.tsx` for an existing settings sub-page with editable rows and validation.
- `src/features/chat/components/parent-chat-workspace.tsx` `MessageEditor` for inline-edit pattern (or use a modal — pick what fits the page best).

**Test scenarios:**
- Happy path: open `/settings/agents` empty → click "Add agent" → fill name + system prompt + pick model → save → row appears in list. (Covers F1-style add.)
- Happy path: edit an existing agent's display name → save → list reflects update.
- Edge case: trying to save with empty name shows a validation error.
- Error path: delete an agent that's the participant of an agent-DM — confirm dialog explains the consequence; on confirm, the agent-DM goes orphaned per U1's cascade decision.
- Integration: navigation from settings sidebar to `/settings/agents` and back, via memory-routed test pattern (see `src/features/settings/openrouter-settings-page-content.test.tsx`).

**Verification:**
- User can define agents end-to-end via UI. Existing settings pages (providers, profile, preferences) continue to render unchanged.

---

### U3. Agent-DM send-turn integration ✅ shipped (`d2e3fb8`)

**Goal:** A user can chat 1:1 with an agent (agent-DM). Today's send-turn flow is reused; the only change is that the agent's system prompt is prepended.

**Requirements:** R1 (agent-DM), R8 (authorship snapshot), R10 (single participant always responds), R18 (per-agent model), AE7 (DM behavior unchanged)

**Dependencies:** U1, U14

**Files:**
- Modify: `src/features/chat/send-turn.ts` (resolve `parentChats.agentId` → agent record; if present, prepend `{role: 'system', content: agent.systemPrompt}` to transport messages; resolve agent's `model` instead of the chat's model)
- Modify: `src/features/chat/repository.ts` (add `findOrCreateAgentDm(agentId)`; extend assistant-message persistence to write `agentId` + `agentSnapshot` when set)
- Modify: `src/features/chat/domain.ts` (add `agentId` and `agentSnapshot` to `ChatMessage`)
- Modify: `src/features/chat/send-turn.test.ts` (cover agent-DM send + AE7 model-DM unchanged)
- Modify: `src/features/chat/repository.test.ts` (cover agent-DM creation + agent-bound message authorship)

**Approach:**
- `findOrCreateAgentDm(agentId)` is the agent-DM analog of today's `findOrCreateEmptyParentChat()`.
- When sending in a chat with `agentId` set: load the agent, resolve `agent.model` via `resolveForSend`, prepend the system prompt as a `{role: 'system'}` transport message.
- Snapshot agent identity onto each assistant message: store `agentId` + `agentSnapshot: {displayName, model: ModelRef}` so deletion of the agent definition leaves history renderable (mirrors `ModelRef` snapshot pattern).
- DM kind dispatch in `send-turn.ts`: if `parentChats.kind === 'channel'`, call orchestrator (introduced at U7). For `kind === 'dm'`, today's flow with the optional system prefix.

**Patterns to follow:**
- `src/features/providers/model-ref.ts` snapshot pattern — agent snapshot follows the same "soft id, durable rendering bits" rule.
- Existing `messageToTransport` filter for system messages — already preserves them.

**Test scenarios:**
- Covers AE7. Happy path (model-DM): send a message in a `kind='dm'` chat with `agentId=null` → exactly one assistant message produced; no system prefix sent; `agentId` on the assistant message is null. Asserts byte-for-byte parity with today's transport payload.
- Happy path (agent-DM): send a message in a `kind='dm'` chat with `agentId` set → exactly one assistant message produced; transport messages start with `{role:'system', content: agent.systemPrompt}`; assistant message persists `agentId` + snapshot of display name + model.
- Edge case: agent-DM where the referenced agent was deleted (orphaned per U1's cascade) → send is blocked with a clear error state on the chat (matches `archived` behavior pattern in current `send-turn.ts`).
- Edge case: agent's system prompt is empty string → no system prefix added (don't send empty system messages).
- Edge case: agent's `model` resolves with `substituted: true` (provider deleted) → assistant message persists the substituted model; UI surfaces the existing "switched to X" notice.

**Verification:**
- Model-DM behavior is byte-identical to before this plan (snapshot test on transport). Agent-DM produces a response shaped by the agent's system prompt.

---

### U4. New-chat picker (Model + Agent tabs) ✅ shipped

**Goal:** Replace the current direct-to-chat "New" button with a chooser modal. Channel tab is rendered but disabled in this unit; enabled at U9.

**Requirements:** R1 (entry to all three kinds), R6 implicitly (channel tab placeholder)

**Dependencies:** Phase 1 complete; specifically U2 (Agent tab needs the agents library UI) and U3 (agent-DM creation flow).

**Files:**
- Create: `src/features/chat/components/new-chat-modal.tsx` (3-tab modal: Model / Agent / Channel)
- Create: `src/features/chat/components/new-chat-modal.test.tsx`
- Modify: `src/app/app-shell.tsx` (replace `handleNewParentChat` direct creation with modal open; keep `findOrCreateEmptyParentChat` for the Model tab's confirm)
- Modify: `src/pages/home-page.tsx` (route the home CTA through the modal too)

**Approach:**
- Model tab: existing model picker, "Start" creates a model-DM via `findOrCreateEmptyParentChat()` and navigates.
- Agent tab: list agents (from U1's repository); selecting one creates an agent-DM via `findOrCreateAgentDm(agentId)` and navigates. Empty-state CTA points at `/settings/agents`.
- Channel tab: placeholder "Coming soon" message in this unit; wired up in U9.
- Keyboard: cmd/ctrl+enter to confirm; Esc to dismiss; tabs reachable by keyboard.

**Design reference:** `docs/design/2026-05-10-multi-agent-conversations/direction-b-agents.jsx`
- Channel tab (placeholder here, full in U9) follows `CreateChannelModal` (≈ line 1761) — single-field "Name" modal with `#` glyph + helper copy, Next button.
- Modal chrome (header, close button, footer bar with primary action) is consistent across `CreateChannelModal` and `CreateAgentModal`. Reuse the same primitive for all three tabs of the new-chat modal.

**Divergences from design:**
- The design has no explicit three-tab "New chat" modal — it shows separate `CreateChannel` and `CreateAgent` flows. This plan unifies them into one entry point with three tabs (Model / Agent / Channel) per the resolved open question in Key Technical Decisions. Borrow visual primitives, not the surface composition.

**Patterns to follow:**
- `src/components/ui/menu.tsx` and any existing modal/dialog primitive in the codebase. If none exist, reuse the inline-popover pattern from `parent-chat-workspace.tsx`'s message-actions menu.

**Test scenarios:**
- Happy path (Model): clicking "New" opens modal on Model tab; pick a model, confirm → modal closes and `/chat/$chatId` is reached. Asserts AE7's path through the new entry: today's UX must still be one logical action ("pick model, start").
- Happy path (Agent): switch to Agent tab; pick an agent; confirm → reaches an agent-DM with that agent.
- Edge case: empty agents library → Agent tab shows empty state with link to `/settings/agents`.
- Edge case: Channel tab is rendered but disabled with "Coming soon" copy in this unit.
- Integration: home-page CTA also routes through the same modal (no second entry point).

**Verification:**
- The "New" affordance is the single entry point. Today's "pick a model, start chatting" remains one tab + one action away.

---

### U5. Schema v3: chatParticipants, channelSettings, messages.agentId ✅ shipped as **v7** (`c5ad456`)

**Goal:** Land the channel-shaped persistence layer. No orchestration yet — just storage and queries.

**Requirements:** R6, R7, R8 (channel authorship), R14 (channel settings storage)

**Dependencies:** U1, U14

**Files:**
- Modify: `src/features/chat/database.ts` (Dexie v3 + upgrade)
- Modify: `src/features/chat/domain.ts` (add `ChannelParticipant`, `ParticipationMode`, `ChannelSettings`)
- Modify: `src/features/chat/repository.ts` (queries: `listChannelParticipants(chatId)`, `addParticipant(chatId, agentId, mode)`, `removeParticipant(chatId, agentId)`, `getChannelSettings(chatId)`, `setChannelSettings(chatId, settings)`)
- Modify: `src/features/chat/repository.test.ts` (CRUD + invariants)
- Modify: `src/features/chat/migrations.test.ts` (v2→v3 migration: legacy rows + v2-migrated rows continue to work; new tables start empty)

**Approach:**
- `chatParticipants` fields: `id`, `chatId` (FK to `parentChats.id`), `agentId` (FK to `agents.id`), `mode: 'auto-decide' | 'mention-only'`, `sortKey` (strictly monotonic per chat for ordering), `createdAt`. Index on `[chatId+sortKey]`.
- `channelSettings` fields: `id` (= `chatId`), `maxChainedSubTurns`, `maxMessagesPerAgentPerInput`, `tokenBudgetPerInput`, `defaultParticipationMode`, `allowAgentThreading` (boolean, default `true` — Slack-like behavior is the v0 default; channel owners can disable to force main-timeline-only). App-level defaults (in `settings.appChannelDefaults` or similar single-row pattern) overlay.
- `messages.agentId` nullable. Index unchanged (existing `[conversationId+createdAt]` still primary).
- Invariants enforced at write time (Dexie has no FKs):
  - `chatParticipants.chatId` must point to a `parentChats` row with `kind='channel'`.
  - `chatParticipants.agentId` must point to an existing agent.
  - Same `(chatId, agentId)` cannot exist twice in `chatParticipants`.
  - `parentChats.agentId` must be null when `kind='channel'`.
- `chatParticipants.sortKey` uses `Math.max(Date.now(), maxExistingSortKeyForChat + 1)` per the strictly-monotonic rule.

**Patterns to follow:**
- `src/features/chat/repository.ts` `pinMessage` for the strictly-monotonic sortKey pattern.
- `src/features/chat/repository.ts` `assertMessageConversationIsValid` for FK-substitute validation; add `assertChannelInvariants(chatId)`.

**Test scenarios:**
- Happy path: create a `kind='channel'` chat → add 2 agents as participants in `auto-decide` mode → `listChannelParticipants` returns them in sortKey order.
- Happy path: setChannelSettings then getChannelSettings round-trips.
- Edge case: same agent added twice → second add throws.
- Edge case: adding a participant to a `kind='dm'` chat → throws (channels only).
- Edge case: setting `parentChats.agentId` on a `kind='channel'` row → throws.
- Edge case: same-millisecond tie-break for two `addParticipant` calls (clock locked under a constant value); both rows persist with distinct sortKeys.
- Edge case: removing a participant → list excludes it but the participant's prior messages stay (preserved per R6).
- Migration: v2 fixture with legacy `kind='dm'` chats → upgrade → all chats still readable; new tables empty; `messages.agentId` stays null on existing rows.

**Verification:**
- Channel-side persistence is exercisable from tests but not yet from UI. DM behavior unchanged.

---

### U6. Schema v4: turns + providerRequestAttempts; refactor send-turn into proper lifecycle ✅ shipped as **v8** (`d9bc4fb`)

**Goal:** Promote `turns` and `providerRequestAttempts` from drafted in `docs/db-schema.md` to live tables, and refactor `send-turn.ts` to use them with `AbortController` + per-call `requestAttemptId` ownership checks. DM behavior is preserved bit-for-bit; the orchestrator at U7 builds on this lifecycle.

**Requirements:** R10, R15 (stop reasons), R16 (interrupt), R18 (per-attempt provider), AE7

**Dependencies:** U1, U3 (agent-DM uses the same lifecycle), U5 (channel persistence ready for U7 to consume but not used by this unit), U14

**Files:**
- Modify: `src/features/chat/database.ts` (Dexie v4 + upgrade — empty tables, no backfill)
- Modify: `src/features/chat/domain.ts` (add `Turn`, `ProviderRequestAttempt`, `TurnStatus`, `StopReason`)
- Create: `src/features/chat/turn-lifecycle.ts` (`openTurn`, `openAttempt`, `attemptStillCurrent`, `closeTurn` + helpers; reusable by both DM send and orchestrator)
- Create: `src/features/chat/turn-lifecycle.test.ts`
- Modify: `src/features/chat/send-turn.ts` (wrap existing flow in `openTurn`/`openAttempt`/`closeTurn`; add `AbortController`; gate every `onChunk`/`onMessageId` write behind `attemptStillCurrent`)
- Modify: `src/features/providers/provider-contract.ts` (add `signal?: AbortSignal` to `StreamChatInput`)
- Modify: `src/features/providers/adapters/*.ts` (each adapter passes `signal` to `fetch`)
- Modify: `src/features/providers/openrouter.test.ts`, `adapters/anthropic.test.ts`, `adapters/openai.test.ts` (cover signal abort)
- Modify: `src/features/chat/send-turn.test.ts` (cover stop reasons + interrupt for DM path)
- Modify: `src/features/chat/migrations.test.ts` (v3→v4 migration: existing chat/thread/message rows continue to be readable; new `turns` and `providerRequestAttempts` tables start empty; no in-flight `streaming` rows are corrupted)

**Approach:**
- `turns`: `id`, `parentChatId`, `conversationType`, `conversationId`, `status` (`'active' | 'closed'`), `userMessageId`, `stopReason` (set at close), `createdAt`, `updatedAt`. Indexed by `[conversationId+createdAt]` and `status`.
- `providerRequestAttempts`: `id`, `turnId`, `assistantMessageId`, `agentId?` (null for model-DM), `model: ModelRef`, `status` (`'pending' | 'streaming' | 'complete' | 'cancelled' | 'error' | 'decided-silent'`), `attemptNumber` (per turn), `providerRequestId?`, `startedAt`, `completedAt?`, `errorCode?`, `errorRetryable?`, `usage?`. Indexed by `[turnId+attemptNumber]`.
- Lifecycle helpers in `turn-lifecycle.ts`:
  - `openTurn(parentChatId, userMessageId)` → returns `Turn` with `status='active'`.
  - `openAttempt(turnId, agentId|null, modelRef, assistantMessageId)` → returns attempt + `AbortController`.
  - `attemptStillCurrent(attemptId)` → reads attempt status; returns true if still `'streaming'` or `'pending'`.
  - `closeTurn(turnId, stopReason)` → sets `status='closed'`, writes summary fields once (single writer: this function), aborts any still-pending attempts.
- DM dispatch in `send-turn.ts`: opens turn → opens single attempt → calls provider with abort signal → guards every chunk callback with `attemptStillCurrent` → closes turn with `stopReason='complete'` (or `'error'` / `'user-interrupt'`).
- User-interrupt propagation: a UI-level `cancelTurn(turnId)` calls `closeTurn(turnId, 'user-interrupt')` which aborts the controller; chunk callbacks see ownership lost and bail.
- Materialized summary writes (`updatedAt`, `lastActivityPreview`) move from inline writes inside the chunk loop to a single call inside `closeTurn`.

**Patterns to follow:**
- `src/features/chat/send-turn.ts` for current send shape — the lifecycle wraps it without rewriting the provider call mechanics.
- `docs/architecture.md` §"Streaming And Turn Lifecycle" — explicit numbered lifecycle this unit implements.
- `docs/db-schema.md` for the drafted `turns` and `providerRequestAttempts` shapes.

**Test scenarios:**
- Covers AE7. Happy path (model-DM through new lifecycle): byte-for-byte parity with pre-U6 behavior — same transport payload, same final assistant message content. Only diff is presence of a `turns` row + `providerRequestAttempts` row in the DB.
- Happy path (agent-DM): turn closes with `stopReason='complete'`; attempt records `agentId`.
- Covers AE5. Edge case: cancel mid-stream → `closeTurn(stopReason='user-interrupt')` aborts the fetch signal; partial assistant content already streamed remains visible; no further chunks land.
- Error path: provider throws mid-stream → attempt status `'error'` with `errorCode`; turn closes with `stopReason='error'`.
- Error path: a chunk arrives after `closeTurn` was called → `attemptStillCurrent` returns false; the chunk is dropped (no update to message row).
- Edge case: same-millisecond tie-break for two attempts within a turn (clock locked under constant) — `attemptNumber` ordering is stable.
- Provider tests: each adapter respects `signal.abort()` (the underlying fetch is cancelled).

**Verification:**
- All existing send tests pass after the refactor. New `turns` / `providerRequestAttempts` rows are written for every send. Cancellation works in DMs (UI hookup is U10 for the channel; DM cancel UI may follow if not already present).

---

### U7. Orchestrator: bounded fan-out, decide-to-respond, safety caps, stop reasons ✅ shipped (`6de596e`) — three small deferrals carry over (see Execution status)

**Goal:** The orchestrator that drives channel turns. Implements F1, F2, F4 from the origin doc.

**Requirements:** R10 (candidate selection — see sub-rule paragraph in origin), R11 (agent-owned decide), R12 (no self-reply), R13a (response location), R14 (caps + allowAgentThreading), R15 (stop reasons)

**Dependencies:** U5 (channel persistence), U6 (turn lifecycle), U8 (mention parser), U14

**Files:**
- Create: `src/features/chat/orchestrator.ts` (`runChannelTurn(chatId, userMessageId)` entry point + internals)
- Create: `src/features/chat/orchestrator.test.ts`
- Create: `src/features/chat/decide-to-respond.ts` (sentinel-silence parser + `{role:'system'}` instruction builder)
- Create: `src/features/chat/decide-to-respond.test.ts`
- Modify: `src/features/chat/send-turn.ts` (channel dispatch: `if kind==='channel' return orchestrator.runChannelTurn(...)`)

**Approach:**
- `runChannelTurn(chatId, userMessageId)`:
  - Open turn via `openTurn`.
  - Loop: identify candidates → cap check → fan-out step → re-evaluate.
  - Close turn with the first stop reason hit.
- Candidate selection (R10 sub-rule):
  - Auto-decide agents that did not just speak (excluded until at least one event from a different participant intervenes — track per-attempt "lastSpeakerByAgentId" in-memory across the loop, no persisted column).
  - Mention-only agents named in the latest event (parser from U8).
- Decide-to-respond (R11, R13a):
  - Each auto-decide candidate gets a single provider call. The transport prefix includes the channel context, the participant roster (display names), the silence convention, and — when `allowAgentThreading=true` and the agent is reading the main timeline — instructions on how to declare `respondIn: 'thread'`.
  - Response parsed into envelope `{respond, respondIn?, content?}`:
    - Silence sentinel / empty / `respond: false` → attempt status `'decided-silent'`, no message row.
    - Otherwise → attempt status `'complete'`. Target conversation resolved per R13a:
      - If `allowAgentThreading=true` and `respondIn='thread'` and the agent is responding to a main-timeline event → orchestrator opens (or reuses) a thread on the triggering message and persists the reply inside the thread.
      - Else (any other case) → reply persists in the same conversation as the triggering event.
    - Message row written with `agentId` + snapshot.
- Caps (R14):
  - `maxChainedSubTurns`: orchestrator counts loop iterations; on overshoot → `closeTurn(stopReason='cap-hit')`.
  - `maxMessagesPerAgentPerInput`: per-agent counter across the turn; agents at the cap are excluded from candidates.
  - `tokenBudgetPerInput`: aggregated from `providerRequestAttempts.usage`; on overshoot at step boundary → `closeTurn(stopReason='cap-hit')`.
- Stop reasons: `'complete'` (loop exhausted naturally), `'no-trigger'` (a step produced no messages), `'cap-hit'`, `'user-interrupt'`, `'error'`.
- Per-step parallelism: `Promise.allSettled` across candidate agents within one step. Ordering within the step is not guaranteed (R10).
- Self-reply rule (R12): in-memory tracking keeps an agent excluded for one event after it speaks; once any other participant produces an event, it becomes a candidate again.

**Execution note:** Test-first for orchestrator behavior. The orchestrator is the single highest-risk unit; characterization-style tests should pin every stop reason and the no-self-reply rule before rich behavior is added.

**Technical design:** *(See the High-Level Technical Design section above for the loop sketch — it lives at the plan level because it spans U6 + U7. The directional pseudo-code there is what this unit implements.)*

**Patterns to follow:**
- `src/features/chat/send-turn.ts` for provider-call shape, now driven per-candidate.
- `src/features/chat/turn-lifecycle.ts` (from U6) for attempt management.

**Test scenarios:**
- Covers AE1. Integration: 3 participants (auto-decide generalist, auto-decide specialist, mention-only). User asks a domain question without mention. Specialist returns content; generalist returns silence sentinel; mention-only never invoked. End state: 1 assistant message; turn `stopReason='complete'`; 3 attempts (specialist=`complete`, generalist=`decided-silent`, mention-only=not attempted).
- Covers AE2. Happy path: single auto-decide agent whose mocked provider returns silence sentinel → no message row; turn closes with `stopReason='no-trigger'`.
- Covers AE3. Integration: agents A and B, both auto-decide. Step 1: A responds to user. Step 2: only B is a candidate (A excluded). B responds to A. Step 3: A is a candidate again (B's message is an event from a different participant). Asserts the per-step exclusion rule precisely.
- Covers AE8. Integration: channel with `allowAgentThreading=true`, one auto-decide agent. User posts a question; agent responds with `{respond: true, respondIn: 'thread', content: '...'}`. The orchestrator creates a thread on the user message and persists the agent reply inside it. The main timeline has only the user message. `assertDbInvariants` passes.
- Covers AE9. Edge case: channel with `allowAgentThreading=false`. Agent returns `{respond: true, respondIn: 'thread', content: '...'}`. The orchestrator ignores `respondIn` and persists on the main timeline. No thread row is created.
- Edge case: agent already inside a thread declares `respondIn: 'main'`. The orchestrator ignores and persists in the thread (v0 no-escalation rule).
- Edge case: two agents in the same fan-out step both declare `respondIn: 'thread'` on the same triggering message. Only one thread is created; both replies land in it. Ordering within the step still not guaranteed (R10).
- Covers AE4. Edge case: chained-sub-turn cap = 1. After step 1, no further steps; turn closes `stopReason='cap-hit'`.
- Covers AE5. Edge case: user interrupts during fan-out → all in-flight attempts abort; turn closes `'user-interrupt'`; partial content from any agent that was streaming is preserved on its message row.
- Edge case: auto-decide cap=0 disables agent-to-agent chains entirely (only the initial fan-out step runs).
- Edge case: no candidates at all (e.g., all agents are mention-only and none mentioned) → `stopReason='no-trigger'` immediately.
- Edge case: an agent's provider call errors → that agent's attempt records `'error'`; other agents' attempts continue; the turn does not abort unless every attempt in the step errored.
- Edge case: same-millisecond clock — two parallel attempts within one step both write distinct `attemptNumber`s.
- Edge case: agent's response contains the silence sentinel mid-text (not at the start) → treated as content, not silence. Sentinel is start-anchored.
- Edge case: agent's response is an empty string or whitespace only → treated as silence equivalent.

**Verification:**
- Channel turns terminate under every stop reason. AE1-AE5 are demonstrably enforced by the test suite.

---

### U8. Mention parser ✅ shipped (`d078f28`)

**Goal:** Parse `@<display-name>` mentions out of message bodies so the orchestrator can identify mention-only agent firings.

**Requirements:** R12 (mention-only firing), R13 (display name preceded by `@`)

**Dependencies:** U14. (U8 ships before U7 in Phase 1 so the orchestrator consumes an already-tested parser; the wiring into orchestrator happens in U7.)

**Files:**
- Create: `src/features/chat/mentions.ts` (`parseMentions(text, candidates: {id, displayName}[]) → matchedAgentIds`)
- Create: `src/features/chat/mentions.test.ts`

(U7 modifies `src/features/chat/orchestrator.ts` to call `parseMentions` — that wiring is part of U7, not U8.)

**Approach:**
- Case-insensitive match against display names.
- Greedy longest-match (prefer "Senior Reviewer" over "Senior" if both exist).
- Mentions inside fenced code blocks and inline code are ignored (cheap heuristic in v0; refined parser deferred per origin's `[Needs research]` question).
- Mentions inside markdown links and quoted blocks: matched in v0 (false positives accepted; tracked as a future polish).
- Email-shaped tokens (`@` followed by a word that has a `.` before whitespace) are ignored.

**Patterns to follow:**
- `src/features/chat/components/message-markdown.test.tsx` for the markdown processing patterns to mirror or test against.

**Test scenarios:**
- Happy path: "@Critic what do you think?" with a candidate named `Critic` → matches.
- Edge case: case-insensitive — `@critic` matches `Critic`.
- Edge case: greedy longest-match — `@Senior Reviewer` matches `Senior Reviewer` agent in preference to a separate `Senior` agent.
- Edge case: code fence — text inside ``` ``` is excluded.
- Edge case: inline code — `` `@critic` `` is excluded.
- Edge case: email — `please ping @user@example.com` does not match a `user` agent.
- Edge case: no candidates → empty result.
- Edge case: trailing punctuation — `@Critic, please...` matches `Critic`.

**Verification:**
- Unit-tested in isolation; integration verified through orchestrator tests (U7's AE3 already exercises a mention).

---

### U9. New-chat picker: enable Channel tab + channel creation flow ✅ shipped

**Goal:** Wire the Channel tab in U4's modal to a real channel-creation flow.

**Requirements:** R1 (channel kind), R6 (initial participant set), R7 (initial mode), R14 (settings defaults applied)

**Dependencies:** U2, U4, U5

**Files:**
- Modify: `src/features/chat/components/new-chat-modal.tsx` (Channel tab: name input + agent multi-select + per-agent mode picker, defaulted from app-level `defaultParticipationMode`)
- Modify: `src/features/chat/components/new-chat-modal.test.tsx`
- Modify: `src/features/chat/repository.ts` (add `createChannel({ title, participants })` that creates the chat row with `kind='channel'`, the `chatParticipants` rows, and the per-channel `channelSettings` row populated with app-level defaults — all in one transaction)

**Approach:**
- Channel tab UI: title input + "Add agent" button that opens a per-agent picker (display name + mode default = app-level default + override switch).
- "Create channel" creates the chat, participants, and settings in one Dexie transaction; navigates to `/chat/$chatId` with the channel UI from U10 already rendering.
- The picker reuses U2's agents library; if no agents exist, the tab shows the same empty state pointing at `/settings/agents`.

**Design reference:** `docs/design/2026-05-10-multi-agent-conversations/direction-b-agents.jsx`
- `CreateChannelModal` (≈ line 1761) for the name-only first step.
- `SettingsAgentsTab` (≈ line 1001) for the "add agents" follow-on UI — specifically the "+ ADD FROM WORKSPACE" / "+ NEW PERSONA" pair of CTAs and the agent-row visual.

**Divergences from design:**
- The design uses a two-step flow (create channel by name → land in channel settings → add agents there). The plan creates participants in the same modal in one transaction. Pick the design's two-step flow if it simplifies the UI: name-only modal → navigate to new channel → channel settings opens automatically with the Agents tab focused. This shortens U9's surface and matches the mocks more faithfully. The Dexie-transactional create still applies; only the visual flow differs.

**Patterns to follow:**
- `src/features/chat/repository.ts` `findOrCreateEmptyParentChat` for the chat-creation pattern.
- `db.transaction('rw', [...], async () => {...})` for the multi-row write.

**Test scenarios:**
- Happy path: open modal → Channel tab → enter title → add 2 agents (auto-decide each) → create → navigates to channel; `chatParticipants` has 2 rows; `channelSettings` has app-level defaults.
- Edge case: no agents in library → Channel tab shows empty state with link to `/settings/agents`.
- Edge case: try to create channel with 0 participants — allowed per R6; channel exists but no agent will respond until participants are added. (UI surfaces this as "Add at least one agent to start" but does not block creation.)
- Integration: created channel shows up in the sidebar with a kind badge (badge added in U10).

**Verification:**
- A user can create a channel through the UI end-to-end. Channels coexist with model-DMs and agent-DMs in the sidebar without visual confusion.

---

### U10. Channel UI: agent identity, participant panel, channel settings, kind badge, cancel ⏳ not started

**Goal:** All the UI affordances a channel needs to be usable: per-message agent identity, an in-channel participant panel, a channel settings panel, sidebar kind badges, and a Cancel button on running turns.

**Requirements:** R8 (authorship snapshot rendering), R9 (channel renders agent identity), R6 (manage participants), R14 (channel settings UI), R16 (interrupt UI surface)

**Dependencies:** U6 (turn lifecycle drives cancel), U7 (orchestrator drives running turns), U9 (channel exists)

**Files:**
- Modify: `src/features/chat/components/parent-chat-workspace.tsx` (extend `Avatar` and `authorLabel` to render agent identity from `message.agentSnapshot` or live agent record; add Cancel button while a turn is `'active'`)
- Modify: `src/features/chat/components/parent-chat-workspace.test.tsx`
- Create: `src/features/chat/components/channel-participants-panel.tsx`
- Create: `src/features/chat/components/channel-participants-panel.test.tsx`
- Create: `src/features/chat/components/channel-settings-panel.tsx`
- Create: `src/features/chat/components/channel-settings-panel.test.tsx`
- Modify: `src/app/app-shell.tsx` (sidebar row: within the DM-equivalent listings, render a small inline marker that distinguishes model-DM vs agent-DM. The structural Channels section is added in U13 and is not part of this unit.)

**Approach:**
- Agent identity rendering:
  - In channels and agent-DMs, `Avatar` shows a colored marker derived from the agent's id (stable hash → palette index); `authorLabel` shows the agent display name. Snapshot fields on `messages` are the source of truth (handles deleted agents).
  - In model-DMs, current behavior unchanged (avatar = `~` glyph, label = `modelShortName`).
- Participants panel: reachable from the channel header. Lists participating agents with their mode; supports add/remove and per-agent mode change. Add reuses U2's picker.
- Settings panel: caps, default mode for new participants, `allowAgentThreading` toggle. Live-edits the `channelSettings` row; revert and confirm patterns mirror provider settings.
- Cancel: while a `Turn` is `status='active'` for this conversation, render a Cancel button that calls `cancelTurn(turnId)` (lives in U6). Hide otherwise.
- Sidebar marker (DM-internal): small inline glyph distinguishing model-DM (today's "~") from agent-DM (agent's colored marker, scaled down) within the same DM-equivalent rows. Channels are surfaced via a dedicated section added in U13, not via a kind badge in mixed lists.
- Decide-status hint: optional, lightweight ephemeral indicator for "agent X is deciding" — start without it, add only if the UX feels worse without (deferred to post-implementation polish).

**Design reference:** `docs/design/2026-05-10-multi-agent-conversations/direction-b-agents.jsx`
- Channel workspace shell + composer + message stream: `MultiAgentChannel` (≈ line 881) and its inner pieces.
- Per-message agent identity (`Avatar` + `authorLabel` extension): `AgMessage` (≈ line 537) — author row with colored `AgentDot`, display name, model chip, `@handle`. Snapshot fields on `messages` drive this; live agent record is fallback.
- Channel header (title, participant count, settings affordance): `ChannelHeader` (≈ line 451).
- Participants surface: design exposes two complementary surfaces — `AgentsRail` (≈ line 786) is a right-side rail showing all participants with avatars; `SettingsAgentsTab` (≈ line 1001) is the canonical add/remove/configure surface inside the settings modal. **Pick `SettingsAgentsTab`-in-modal as the primary participants panel for U10 and skip the right rail in v0** — it duplicates information already on the message rows and adds a third column that complicates the layout.
- Channel settings: `ChannelSettingsModal` (≈ line 910) with left-rail tabs. v0 implements only the tabs that correspond to in-scope settings:
  - **About** (`SettingsAboutTab`, ≈ line 1169): channel name + description. In scope.
  - **Agents** (`SettingsAgentsTab`, ≈ line 1001): add/remove participants, per-agent mode. In scope.
  - **Behavior** (`SettingsBehaviorTab`, ≈ line 1193): caps (`maxChainedSubTurns`, `maxMessagesPerAgentPerInput`, `tokenBudgetPerInput`), `defaultParticipationMode`, `allowAgentThreading`. In scope; map fields verbatim where possible.
  - **Manage** (`SettingsDangerTab`, ≈ line 1292): archive/delete. Already exists in repo for parent chats; reuse.
  - **People** / **Context & memory**: **omit** in v0 (no human collaborators, no agent memory).
- Per-agent participation mode chip: `SpeaksWhenChip` (≈ line 1150).

**Divergences from design:**
- The design's `SpeaksWhenChip` exposes three modes — `mention | proactive | every`. The plan ships only **two**: `mention-only` (= design `mention`) and `auto-decide` (= design `proactive`). The `every` ("always responds") mode is explicitly outside this product's identity (origin Scope Boundaries: a blunt always-respond mode contradicts the human-Slack model). Drop "every" from the chip's enum.
- The design surfaces `tools`, `memory notes`, `in N channels`, `7d msgs · spend` on each agent row. None of those data points exist in v0. The Agents tab inside channel settings should render only: agent dot + display name + `@handle` + model chip + speaks-when chip + edit/remove. The columns are dropped from the grid template.
- Design shows a "Suggested for this channel" affordance under the agents tab. Out of scope — drop.
- Design's `AgentsRail` is a right-side panel that lists all participants in-room. Keep `MultiAgentChannel`'s shell minus the rail (`railOpen={false}` is the v0 default). The header agent stack inside `ChannelHeader` is sufficient at-a-glance affordance.
- Design uses an aubergine Slack-style palette (`#3F0E40` sidebar, etc.). The repo currently themes via tokens (see commit `fe32b3f` "Replace hardcoded bg-white with theme tokens"). Treat the design palette as direction, not pixel-spec: map colors to existing tokens; if no token exists, add one. Do not introduce hex literals into components.

**Patterns to follow:**
- `src/features/settings/openrouter-settings-page-content.tsx` for the settings-panel editable-rows pattern.
- `src/features/chat/components/parent-chat-workspace.tsx` `Avatar` and `authorLabel` (lines ~181 / ~447) — extension points for agent identity.

**Test scenarios:**
- Covers R8/R9. Happy path: channel with 2 agents, render the timeline → each assistant row shows its agent's display name and a stable colored marker. Snapshot the rendering against a fixture so future agent-config edits don't accidentally rewrite history.
- Edge case: an agent message whose definition was later deleted — renders from `agentSnapshot` (display name preserved); no crash.
- Happy path: open channel participants panel → see list → remove one agent → next turn excludes that agent; previous messages still render with the agent's identity (snapshot preserved).
- Happy path: open channel settings → change `maxChainedSubTurns` from default to 0 → confirm → next channel turn does not chain.
- Covers AE5. Integration: while a channel turn is running (orchestrator mid-loop), Cancel button is visible and clicking it closes the turn with `'user-interrupt'`; UI updates within one render of state change.
- Edge case: model-DM rendering byte-identical to before this plan (visual snapshot test — author label shows `modelShortName`, no agent marker).
- Edge case: agent-DM rows show the agent's color marker (scaled down) where model-DM rows show the "~" glyph; both render in the same DM-equivalent listings.

**Verification:**
- A user can add/remove participants, edit channel settings, see clear agent identity in messages, and cancel a runaway turn — all from the UI.

---

### U13. Sidebar restructure: dedicated Channels section ⏳ not started

**Goal:** Channels live in their own sidebar section (Slack convention), not mixed into the flat parent-chat list. DMs (model and agent) continue to surface through today's listings (Saved, Starred, Recent, Archived); channels surface separately.

**Requirements:** R1 (kind discriminator surfaced in navigation), R6 (channels are first-class), supports the channel-as-room mental model from origin Problem Frame.

**Dependencies:** U5 (channel rows exist), U9 (channels can be created), U10 (channel rendering exists). U13 is the last UI unit before U11 thread work and U12 docs.

**Files:**
- Modify: `src/app/app-shell.tsx` (add a Channels section above or below Recent — placement is a UX call made at implementation; filter today's parent-chat queries by `kind` to exclude channels from DM-equivalent listings; add a Channels query that filters by `kind='channel'`)
- Modify: `src/app/app-shell.test.tsx` (cover the section split: model-DMs and agent-DMs render in DM listings only; channels render in the Channels section only; archived channels follow the existing archive treatment)
- Modify: `src/features/chat/repository.ts` (add `listChannels()` and update existing `listRecentParentChats()` / Starred / Saved hooks to filter by `kind='dm'` so channels don't bleed into them)
- Modify: `src/features/chat/repository.test.ts` (cover the new query filters)

**Approach:**
- Keep today's sidebar shape (Saved-for-later, Starred, This conversation, Recent, Archived). Add a **Channels** section as a peer — likely above Recent, mirroring how Slack stacks Channels above DMs. Final placement is an implementation-time UX call.
- Channels section behavior: list channels in a `kind='channel'` Recent-equivalent ordering (most recent activity first), with an overflow link to a future "all channels" page if the count grows (placeholder for now — out of scope to build the page).
- Existing DM-equivalent sections (Recent, Starred, Saved) get filtered down to `kind='dm'` so channels don't double-list.
- The "This conversation" branch tree continues to work for both kinds — no change needed.
- Archived: archived channels appear under the same Archived footer toggle, alongside archived DMs. No separate archived-channels section (kind is visible by section context once the user opens Archived).
- Sidebar marker for DM-internal model-vs-agent distinction (introduced in U10) stays — channels don't need it because the section header carries that meaning.

**Design reference:** `docs/design/2026-05-10-multi-agent-conversations/direction-b-agents.jsx`
- Sidebar shell + grouping: `AgSidebar` (≈ line 177). Specifically the **CHANNELS** group with `#` glyph, unread badge, agent count per row; and the mixed DMs list with people and agent rows side by side.
- `SidebarGroup` (≈ line 417) is the section primitive — title + optional action affordance (e.g., `+` for new channel).

**Divergences from design:**
- The design's DMs list mixes humans and agents. This product has no human collaborators in v0 — the DMs section in this app is purely model-DMs and agent-DMs. Keep the mixed-row visual treatment (model-DM marker vs agent-DM colored dot) but omit the people rows.
- The design shows expandable agent-DM rows with per-agent chat history (e.g., "Strategy Lead" expands to four prior chats). That richer affordance is **deferred** — v0 lists each agent-DM as a separate row in the DM-equivalent listings (matching today's parent-chat row behavior). Tracked as follow-up.
- The design's sidebar palette is aubergine. Same theme-token note as U10 applies — colors come from tokens, not literals.

**Patterns to follow:**
- `src/app/app-shell.tsx` existing sidebar section structure (Saved-for-later block, Starred section, Recent section, Archived footer) — add Channels following the same structural pattern.
- `src/features/chat/repository.ts` existing `listRecentParentChats` / starred/saved query helpers — extend with `kind` filter rather than forking new functions.

**Test scenarios:**
- Happy path: a workspace with 2 model-DMs, 1 agent-DM, and 1 channel → DM-equivalent listings show 3 rows; Channels section shows 1 row; nothing double-listed.
- Happy path: a channel with recent activity bubbles to the top of the Channels section.
- Edge case: a workspace with zero channels → Channels section is hidden (empty state suppressed) or rendered with an inline "No channels yet" hint, depending on the chosen placement decision. Document the choice in U13's actual diff.
- Edge case: archived channel → appears under Archived footer alongside archived DMs; restoring brings it back to the Channels section, not Recent.
- Edge case: starring a channel — does it appear under Starred (alongside DMs) or under a sub-pin within Channels? Recommend: Starred remains a single mixed section (per existing UX), since star is a per-chat affordance regardless of kind.
- Integration: kind discriminator filter is consistently applied across `listRecentParentChats`, the starred query, and the saved-messages collection so a channel never accidentally bleeds into a DM listing.

**Verification:**
- The sidebar reads like Slack: DMs and Channels are visually and structurally separate. A user can navigate to either without confusion. No row appears in both surfaces.

---

### U11. Thread inheritance for channels: snapshot participants at creation ✅ shipped as **v9** (`20390e1`)

**Goal:** Threads created from a channel message inherit the channel's kind, participants, and modes at creation time; they do not look up live (R17).

**Requirements:** R17

**Dependencies:** U5, U7, U14

**Files:**
- Modify: `src/features/chat/repository.ts` (extend thread creation to snapshot the parent's `chatParticipants` rows into the new thread's own participants — copy approach, simplest)
- Modify: `src/features/chat/database.ts` (Dexie v5 — extend `chatParticipants.chatId` so it points to either a `parentChats.id` or a `threads.id`)
- Modify: `src/features/chat/orchestrator.ts` (resolve participants from the conversation that owns the user message: thread participants if in-thread, channel participants if in parent)
- Modify: `src/features/chat/repository.ts` (update `assertChannelInvariants` from U5 to handle the dual-target `chatId`: validate against `parentChats.kind='channel'` when `chatId` is a parent-chat id, and against the underlying parent chat's kind when `chatId` is a thread id)
- Modify: `src/features/chat/repository.test.ts`
- Modify: `src/features/chat/migrations.test.ts` (v4→v5 migration: existing `chatParticipants` rows remain valid; threads start empty of participants until thread creation snapshots them; `assertChannelInvariants` continues to reject DM-scoped participant rows)

**Approach:**
- Storage: extend `chatParticipants` so `chatId` is generic (parent or thread). Index `[chatId+sortKey]` already covers both. Cheaper than a parallel table.
- Thread creation snapshot: when creating a thread under a channel, copy the parent channel's participants + per-agent mode. Add/remove on the thread mutates only the thread's rows.
- Thread of a DM: inherits `kind='dm'` and `agentId` (already on the thread row from prior schema); no participant rows needed.
- Inheritance algorithm itself unchanged — context assembly already walks ancestor messages via `parentThreadId`. What's new: the orchestrator at U7 reads participants from `conversationId` (the thread's id when in-thread), not from the parent.

**Patterns to follow:**
- `src/features/chat/repository.ts` thread creation logic — extend, don't fork.
- The frozen-branch rule documented in `docs/architecture.md` and `docs/threaded-chat-prd.md` applies verbatim.

**Test scenarios:**
- Covers AE6. Integration: parent channel with participants {A, B}; create thread from a message; later add C to the parent → thread still has only {A, B}; sending in the thread fans out only to A and B.
- Happy path: thread of a DM continues to behave like a DM (single participant, no decide step).
- Edge case: remove participant A from the parent channel after the thread is created — thread still has A in its own participants; sending in the thread still includes A.
- Edge case: add a participant to a thread independently → parent channel is unaffected.
- Edge case: same-timestamp tie-break for the snapshot copy — sortKeys are regenerated for the thread's participants in stable order.

**Verification:**
- Thread participation behaves per AE6. Frozen branch rule extends naturally to participants.

---

### U12. Update architecture.md and db-schema.md ⏳ not started

**Goal:** Architecture and schema docs reflect the new shape. `AGENTS.md` constraint: "When a feature intentionally violates this guide, update the guide in the same change with the reason."

**Requirements:** Process — supports R1-R18 by establishing the canonical reference.

**Dependencies:** U1-U11, U13 (all schema, code, and sidebar shapes are stable)

**Files:**
- Modify: `docs/architecture.md` (sections to update: Current Shape, Architectural Principles if needed, Module Boundaries, Data Model Guidelines, Streaming And Turn Lifecycle, Materialized Summary Ownership; add a new "Channel Orchestration" section)
- Modify: `docs/db-schema.md` (promote `turns`, `providerRequestAttempts`, `messageRevisions`-style additions; add `agents`, `chatParticipants`, `channelSettings`; update relationship table; promote planned tables to "Already implemented")
- Modify: `docs/tasks.md` (mark "defining agents" and "allow multiple agents to participate in a chat" complete; add follow-up items listed in Scope Boundaries → Deferred to Follow-Up Work)

**Approach:**
- Describe the orchestrator as a domain module that depends on persistence and provider via the same interfaces today's `send-turn.ts` uses; resists special-casing.
- Document the stop-reason taxonomy (`complete | no-trigger | cap-hit | user-interrupt | error`) and the per-attempt ownership-check rule.
- Document the snapshot rule for participants on threads.
- Note channel-only invariants: `parentChats.agentId` null when `kind='channel'`; `chatParticipants` only on channel-kind chats.

**Test expectation:** none — documentation-only unit. No behavior change.

**Verification:**
- Docs read end-to-end without contradicting the code.

---

## System-Wide Impact

- **Interaction graph:**
  - `send-turn.ts` becomes a dispatcher (DM → existing flow; channel → orchestrator). Every existing entry point continues to work.
  - Provider adapters gain an optional `signal` parameter — backward compatible (adapters that don't pass it still work, but lose abort behavior).
  - `onChunk` / `onMessageId` callbacks now flow through ownership-checked writes.
- **Error propagation:** Provider errors continue to surface through the existing `error` field on messages plus the new `errorCode` on `providerRequestAttempts`. Stop reasons surface on `turns` and bubble up to UI as toasts/badges only when meaningful (cap-hit, user-interrupt).
- **State lifecycle risks:** Stale streams from cancelled attempts must not write rows. Without the per-call ownership check (U6), fan-out makes this dramatically more likely than today's single-stream world.
- **API surface parity:** None. The provider contract gains an optional field; no consumer outside the provider stack changes.
- **Integration coverage:** Orchestrator behavior is integration-shaped (provider × persistence × cancellation × cap counting). U7's tests must cover all stop reasons end-to-end with mocked providers, not just unit scope.
- **Unchanged invariants:**
  - Frozen-branch rule for thread context: unchanged in algorithm, extended in payload (participants now snapshot).
  - Model-DM behavior: byte-for-byte identical (AE7 enforced as a snapshot test in U6).
  - `directReplyCount` definition: unchanged ("direct messages in the thread, excluding nested descendants").
  - `parentChats.starredAt` lifecycle: unchanged (no interaction with kind or agents).

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Orchestrator complexity becomes a bug magnet (concurrent streams, caps, stop reasons, per-step exclusion). | U7 has the largest test scenario list in the plan and an explicit `Execution note: test-first`. Pin every stop reason and the no-self-reply rule before adding richness. |
| Sentinel-silence convention misclassifies real responses as silence (or vice versa). | Strict start-anchored sentinel + explicit "empty/whitespace = silence" rule (both unit-tested in U7). Document the sentinel form in U12 so agent system prompts can be written against it. |
| Migration v1 → v2/v3/v4/v5 breaks existing user data. | Each version ships with a migration test from a hand-built fixture of the prior version. Migrations are additive only (no destructive transforms). Same-PR test of "AE7 holds against migrated data" in U6. |
| Per-attempt ownership check missed somewhere → stale chunks corrupt the wrong message. | The check is centralized in `turn-lifecycle.ts` (U6) as a single helper; every `onChunk`/`onMessageId` write goes through it. Lint-style review check: any persistence write inside `send-turn.ts` or `orchestrator.ts` that doesn't first call `attemptStillCurrent` is wrong. |
| Provider adapters silently ignore `signal` → cancellation does nothing. | Adapter tests in U6 explicitly assert `signal.abort()` propagates to the underlying fetch (one new test per adapter). |
| Decide-to-respond doubles cost on every channel turn (every agent burns a full prompt budget even when silent). | Accepted for v0 per Key Technical Decisions. The token-budget cap (R14c) is the safety net; the pre-call optimization is documented as a Deferred-to-Implementation knob. |
| Mentions break on agent rename. | Documented v0 behavior. Stale mentions are accepted; rename is a no-op on existing message bodies. Display-name uniqueness within the agents library is enforced at U2 to keep behavior predictable. |
| Sidebar UX feels confused with mixed DMs and channels in a flat list. | Inline kind badge in U10. Structural reorganization deferred to follow-up work (called out in Scope Boundaries). |
| Materialized summaries (`updatedAt`, `lastActivityPreview`) get double-written or out-of-order under fan-out. | Single writer pattern: `closeTurn` is the only place that updates these fields (enforced in U6). |

---

## Documentation / Operational Notes

- `docs/architecture.md` and `docs/db-schema.md` update lands in U12 (same final commit as the last code).
- `docs/tasks.md` updated in U12 to mark the two planned items complete and add follow-up items from Scope Boundaries.
- No external rollout. Browser-only app; users get the new behavior on next page load. Existing data migrates additively.
- No analytics / monitoring changes. Stop-reason distribution is something to surface in a future "channel insights" view (out of scope here).

---

## Design References

Static React mockups live at `docs/design/2026-05-10-multi-agent-conversations/`. They are illustrative — the implementation maps them onto the existing component primitives and theme tokens rather than reproducing literal markup or palette.

### File map

| File | Use during |
|------|------------|
| `direction-b-v2.jsx` | Reference for the overall app shell (sidebar + main + side panel layout). Already largely in place in `src/app/app-shell.tsx` — consult for sidebar grouping conventions. |
| `direction-b-agents.jsx` | **Primary reference for U2, U4, U9, U10, U13.** Contains `MultiAgentChannel`, `AgSidebar`, `AgMessage`, `ChannelHeader`, `ChannelSettingsModal` and tabs, `CreateAgentModal`, `CreateChannelModal`. |
| `direction-b-settings.jsx` | Reference for settings-page chrome (already shipped for providers). Borrow the editable-row shape for the agents library (U2). |
| `direction-a-paper.jsx`, `direction-c-midnight.jsx` | Alternate aesthetic directions (light editorial; dark serif). Not the primary direction; consult only if a token mapping needs an alternate palette. |
| `design-canvas.jsx`, `shared-data.jsx`, `LLM Slack*.html` | Harness only — pan/zoom canvas wrapper and shared fixture data. Not implementation-relevant. |

### Cross-cutting divergences (apply to all UI units)

- **Participation modes:** plan ships `auto-decide` + `mention-only`. Design's third mode `every` is out of identity (origin Scope) — drop.
- **Out-of-scope agent surfaces:** `tools`, `memory`, `in N channels`, `msgs7d`, `spend7d` exist only in the design's data shape. They are **inspirational, not implementation targets** for v0. Agent definition is `displayName + model + systemPrompt`; everything else is deferred.
- **Theme tokens, not literals:** the design uses an aubergine Slack-style palette (`#3F0E40` sidebar, `#611F69` accent, `#007A5A` send). Map these onto existing theme tokens (see commit `fe32b3f`). Don't introduce hex literals into components.
- **No human collaborators:** the design's sidebar mixes people-DMs with agent-DMs. v0 has no human side; render only model-DM and agent-DM rows.

### Per-unit mapping (summary)

| Unit | Primary components in `direction-b-agents.jsx` |
|------|-----------------------------------------------|
| U2 — Agents library page | `CreateAgentModal`, `AgentDot`, `SettingsAgentsTab` (row shape only) |
| U4 — New-chat modal | `CreateChannelModal` (chrome) — Channel tab is placeholder |
| U9 — Channel creation flow | `CreateChannelModal` (name step) → land in channel settings → `SettingsAgentsTab` (add agents) |
| U10 — Channel UI | `MultiAgentChannel` (shell), `ChannelHeader`, `AgMessage`, `AgentDot`, `ChannelSettingsModal` with tabs About / Agents / Behavior / Manage only, `SpeaksWhenChip` |
| U13 — Sidebar restructure | `AgSidebar`, `SidebarGroup` — CHANNELS group + DMs section |

---

## Sources & References

- **Origin document:** `docs/brainstorms/multi-agent-conversations-requirements.md`
- **Design mockups:** `docs/design/2026-05-10-multi-agent-conversations/` (primary file: `direction-b-agents.jsx`)
- Architecture guardrail: `docs/architecture.md`
- Schema reference: `docs/db-schema.md`
- Provider refactor (`ModelRef`, `resolveForSend`): `docs/providers-refactor.md`
- Threaded chat PRD (frozen-branch rule): `docs/threaded-chat-prd.md`
- Repository instructions: `AGENTS.md` (= `CLAUDE.md`)
- Strictly-monotonic sortKey precedent: commit `521c516`
- Current send lifecycle: `src/features/chat/send-turn.ts`
- Current schema (v1): `src/features/chat/database.ts`
- Settings shell pattern: `src/features/settings/settings-shell.tsx`
- Message rendering extension points: `src/features/chat/components/parent-chat-workspace.tsx` (`Avatar`, `authorLabel`, lines ~181 / ~447)
