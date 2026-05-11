---
date: 2026-05-10
topic: multi-agent-conversations
---

# Multi-Agent Conversations

## Summary

Today's chat is a Slack-style DM with a raw model: pick Claude (or another model), talk, always get a reply. Keep that flow exactly as is, and add two new conversation shapes: an **agent-DM** (1:1 with a configured agent — same UX as model-DM, just with a system prompt behind the scenes) and a **channel** (multiple named agents that each decide whether to respond, unless mention-only). All three shapes share the same `parentChats` primitive, extended with a `kind` discriminator; the orchestrator, send-turn, and UI add channel-only branches around shared code rather than forking.

---

## Problem Frame

The chat is single-assistant today: every chat has one effective model, `messages.role` is `user | assistant`, and a turn assumes one user message produces one assistant message. That's fine for talking to one model, but forecloses the multi-participant experiment the PRD flags as Deferred Decision #3 and `tasks.md` lists as planned work ("defining agents," "allow multiple agents to participate").

The experiment targets a Slack channel of humans as its mental model: most messages don't earn a response from everyone in the room — participants read, judge whether they can add value, and reply or stay silent. Today's product can't express that. There's no concept of multiple named non-user participants, no way to model "this party stays quiet unless asked," and no provision for parties that respond only when addressed. The data model and turn lifecycle assume one author.

---

## Actors

- A1. **User**: human participant who initiates turns and can interrupt them.
- A2. **Agent**: a named, configured non-human participant (LLM + system prompt; later: memories, tools). One agent definition can participate in any number of chats.

---

## Key Flows

- F1. **Auto-decide fan-out (channel)**
  - **Trigger:** user message in a channel with one or more auto-decide agents.
  - **Steps:** orchestrator offers the conversation to each auto-decide agent in parallel → each agent independently decides whether to respond using its model + system prompt → agents that decide yes produce one message; the rest stay silent (no row).
  - **Outcome:** 0..N agent messages, each from an agent that judged it had something to add.
  - **Covered by:** R4, R6, R10, R11

- F2. **Chained sub-turn, capped (channel)**
  - **Trigger:** an agent message creates a new event other agents can evaluate or be mentioned in.
  - **Steps:** orchestrator re-offers the conversation to remaining auto-decide agents and re-parses mentions on the new message → an agent that just spoke is not re-offered until at least one event from a different participant has occurred → repeats until no agent responds, no mention fires, or a safety cap is hit.
  - **Outcome:** back-and-forth only when agents *choose* to continue; always terminates.
  - **Covered by:** R12, R15, R16

- F3. **DM send (today's behavior, unchanged)**
  - **Trigger:** user message in a DM, either model-backed or agent-backed.
  - **Steps:** orchestrator skips decide-to-respond and mention parsing → the single participant (model or agent) generates one response using its model + (if an agent) system prompt.
  - **Outcome:** familiar single-assistant turn for model-DMs; same flow with a configured prompt for agent-DMs.
  - **Covered by:** R1, R10

- F4. **User interrupts a running turn**
  - **Trigger:** user clicks stop or starts typing while agents are still responding.
  - **Steps:** orchestrator cancels pending agent calls; partial content already streamed is preserved; turn closes with reason user-interrupt.
  - **Covered by:** R17

---

## Requirements

**Conversation kind**

- R1. A chat has a kind:
  - **dm**: exactly one participant — either a raw model (today's behavior, no system prompt) or a named agent. The participant always responds; no decide step, no mention parsing.
  - **channel**: one or more named agents with explicit participation modes; orchestration applies.
- R2. The kind is set at creation and does not change in v0. A DM cannot be promoted to a channel and cannot gain participants. To converse with multiple agents, create a fresh channel. (Trade-off: the user re-creates context if they want to "extend" a DM; carrying content across is out of scope for v0.)

**Agent definitions**

- R3. An agent has an id, display name, model selection, and system prompt. The display name is what users see and what mention syntax matches. The system prompt is the primary place where an auto-decide agent's participation behavior is shaped.
- R4. Agent definitions are reusable across any number of chats (DMs and channels).
- R5. The agent record must accommodate later additions (memories, tools) without migrating existing rows.

**Channel participation**

- R6. A channel tracks an ordered set of participating agents. Adding or removing an agent applies from the next turn forward; prior messages keep the agent identity that produced them.
- R7. Each participating agent in a channel has a per-chat-per-agent participation mode:
  - **auto-decide** (default): the agent decides whether to respond on each new event, informed by its system prompt and the visible conversation.
  - **mention-only**: no decide step; responds only when explicitly mentioned.

**Message authorship**

- R8. Every assistant-authored message records its source. In channels and agent-DMs, the source is the agent identity. In model-DMs, the source is the model selection alone (today's behavior preserved — no agent involved). Source attribution is preserved across later configuration changes.
- R9. The message UI renders agent identity (name + visual marker) in channels so users can distinguish authors at a glance. DMs (model or agent) render more minimally; the participant is implied.

**Turn orchestration**

- R10. A user message initiates a turn. In a DM (model or agent), the single participant produces one response — no decide step, no mention parsing. In a channel, each fan-out step the orchestrator offers the conversation to candidates and collects at most one message per agent. Candidates: auto-decide agents that haven't just spoken, plus mention-only agents named in the latest event. Within a step, candidates evaluate and generate in parallel; ordering within a step is not guaranteed.
- R11. The decide-to-respond judgment is owned by the agent (its model + prompt), not the orchestrator. Silence does not write a row.
- R12. An agent message can trigger further responses. The orchestrator continues until no agent responds, no mention fires, or a safety cap is hit. An agent is not re-offered the conversation until at least one event from a different participant has occurred (no self-reply).
- R13. Mention-only agents fire when their display name appears preceded by `@`. Exact mention syntax is an outstanding question.
- R13a. In channels, an agent's response location (main timeline vs. thread on the triggering event's message) is part of the agent's decision when the channel setting `allowAgentThreading` is enabled. When disabled, agent responses always land in the same conversation as the triggering event (no choice). Agents responding inside a thread always respond in that thread for v0 — no escalation back to main.

**Channel settings**

- R14. A channel has tunable settings, configurable per-chat with app-level defaults. v0 settings include: (a) max chained sub-turns per user input (set to 0 to disable agent-to-agent chains entirely), (b) max messages per agent per user input, (c) token/cost budget per user input, (d) default participation mode applied to newly added agents (auto-decide or mention-only), (e) `allowAgentThreading` — whether agents may choose to respond in a thread instead of the main timeline (R13a). Settings are the primary way to tune channel behavior alongside agent system prompts. DMs are unaffected beyond app-level defaults.
- R15. When a cap fires, the orchestrator stops cleanly. Every turn closes with a recorded stop reason; values include at least cap-hit, no-trigger, user-interrupt, error.
- R16. The user can interrupt an in-progress turn; pending calls are cancelled, partial streamed content is preserved, and the turn closes as user-interrupt.

**Threads and providers**

- R17. A thread inherits its parent conversation's kind, participants, and modes at creation time. Later changes in the parent do not flow into existing threads. Threads follow the same no-promotion rule as their parent: a DM thread stays a DM thread; a channel thread can add or remove participating agents independently of the parent channel.
- R18. Each agent's model selection drives its own provider request; different agents in the same turn may target different providers/models. Existing per-message model snapshot semantics apply per agent message.

---

## Acceptance Examples

- AE1. **Covers R7, R10, R11.** Given a channel with two auto-decide agents (a generalist and a specialist) and one mention-only agent, when the user asks a domain question without mentioning the third agent, then the specialist responds, the generalist may respond or stay silent based on its own judgment, and the mention-only agent stays silent.
- AE2. **Covers R11, R15.** Given an auto-decide agent whose prompt instructs it to stay quiet unless asked, when the user sends a general message that does not invite its input, then no message is produced and the turn closes with reason no-trigger.
- AE3. **Covers R12.** Given auto-decide agents A and B in a channel, when A responds to a user input, then B may respond to A in a chained sub-turn, but A is not re-offered the conversation until another participant produces an event.
- AE4. **Covers R14, R15.** Given a max-chained-sub-turns cap of N, when chained responses reach N, then the orchestrator stops and the turn is recorded as cap-hit.
- AE5. **Covers R16.** Given an in-progress turn with multiple agents queued or streaming, when the user interrupts, then queued calls are cancelled, in-flight streams are aborted with partial content preserved, and the turn closes as user-interrupt.
- AE6. **Covers R17.** Given a parent channel with participants {A, B} and a thread created from a message in it, when participant C is later added to the parent, then the thread continues with {A, B} until C is explicitly added.
- AE7. **Covers R1, R10.** Given either a model-DM or an agent-DM, when the user sends a message, then exactly one response is produced and no decide-to-respond or mention-parsing logic runs.
- AE8. **Covers R13a, R14.** Given a channel with `allowAgentThreading=true` and an auto-decide agent, when the user posts a message and the agent chooses to respond in a thread, then the orchestrator opens a thread on the user message (or reuses the existing thread) and persists the agent's reply inside the thread, leaving the main timeline unchanged.
- AE9. **Covers R13a.** Given a channel with `allowAgentThreading=false` and an auto-decide agent, when the agent attempts to declare `respondIn: 'thread'`, then the orchestrator ignores the location and persists the reply on the main timeline.

---

## Success Criteria

- A channel feels like a real Slack room: agents pick their moments, often stay quiet, and the conversation reads as guided by judgment rather than mechanical fan-out.
- DMs behave exactly as they do today after migration; users notice no regression in the single-assistant flow.
- Channel behavior is tunable via channel settings and agent system prompts (no code changes); chained agent activity always terminates with a recorded stop reason.
- A planner can specify entities, kind discriminator, orchestration loop, caps, authorship, and thread inheritance from this doc without inventing product behavior.

---

## Scope Boundaries

### Deferred for later

- Agent memories and agent tools.
- Pluggable orchestration strategies / swappable scheduler (Approach B from the brainstorm).
- Participation modes beyond auto-decide and mention-only (regex, keyword, conditional).
- Per-agent (rather than per-turn) cost metering.
- Streaming-UX refinements specific to many in-flight agents.
- Agent-library UX beyond minimal add/remove (search, tagging, sharing, import/export).
- Promoting a DM to a channel, carrying DM context into a new channel, and demoting a channel back to a DM. All three deferred.

### Outside this product's identity

- A blunt "always respond" mode in *channels* — contradicts the human-Slack model that defines that surface. (Always-respond is the correct DM behavior and is expressed via the `dm` kind, not a participation mode.)
- Background or scheduled agents acting without a user-initiated turn.
- Agent-to-agent communication outside the visible chat surface.
- Hierarchical team / manager-worker abstractions. Agents in a channel are peers in a room.
- An agent marketplace or community sharing surface.

---

## Key Decisions

- **One conversation primitive, two kinds.** Extend `parentChats` with a `kind` discriminator (`dm | channel`) rather than introducing a new entity. Persistence, branching, threads, search, sidebar, and the provider stack remain shared; only orchestration, send-turn, and chat-level UI grow channel-aware branches.
- **Model-DM preserves today's behavior verbatim.** Existing chats migrate to `dm` kind with their existing `model` field as the participant. No agent rows are created for legacy chats. No user-visible regression; no decide-to-respond, no mention parsing, no participant UI.
- **Agent-DM is a thin extension, not a new surface.** Picking an agent at DM creation swaps the participant from "raw model" to "configured agent." The orchestration path is identical; the only difference is that the agent's system prompt is sent to the provider.
- **No DM promotion in v0.** A DM never gains participants and never becomes a channel. Channels are created fresh. Carrying content across is deferred. This is the simpler model and matches Slack's own DM/channel separation.
- **Agents are first-class, reusable entities, not chat-scoped.** Required by `tasks.md` ordering and necessary to reuse the same agent across DMs and channels.
- **Participation mode lives on the chat-participation record, not on the agent definition.** The same agent can be auto-decide in one channel and mention-only in another.
- **Auto-decide is the default mode in channels and the channel surface's identity.** Always-respond is rejected at the channel level — it's the DM kind's job to express that behavior.
- **The decide-to-respond step is owned by the agent, not the orchestrator.** Orchestrator presents the conversation; the agent's model + prompt make the call. Implementation shape (pre-call vs. single call with sentinel-silence) deferred to planning.
- **v0 ships bounded fan-out, not strategy-pluggable orchestration.** Data model is identical to the pluggable version; defer the strategy abstraction until experiments inform it.
- **Channel settings are a first-class tuning surface alongside agent system prompts.** Safety caps, default participation mode, and future orchestration knobs live on the channel with app-level defaults — not per-agent. Per-agent caps would duplicate concerns already covered at the channel level.

---

## Dependencies / Assumptions

- Existing `parentChats`, `threads`, `messages`, `turns`, `providerRequestAttempts` (per `docs/db-schema.md`) are extended, not replaced. `parentChats.kind` is added; the chat row also carries an optional `agentId` for agent-DMs; `messages` gains a nullable agent-identity column (set in channels and agent-DMs, null in model-DMs); `turns` relaxes one-assistant-per-turn to 0..N.
- Provider contract (`src/features/providers/`) needs no shape change beyond being callable per-agent (or per-model in the legacy DM case).
- Frozen-branch context rule extends naturally: each inherited message carries its source attribution; the inheritance algorithm is unchanged.
- Migration is additive: legacy chats default to `kind = dm` with `agentId` null. Existing `model` and message rows are untouched. No agent rows are created retroactively.

---

## Outstanding Questions

### Resolve Before Planning

- [Affects R1][User decision] When creating a new chat, what does the entry point look like? Today it's "pick a model." With agent-DMs and channels, the user has three paths (model-DM, agent-DM, channel) — is that one combined picker, three buttons, or something else? Affects the new-chat UI but not the underlying data model.
- [Affects R7, R13][User decision] What @-mention syntax does v0 support — display name only, id-stable form, or both with display preferred?

### Deferred to Planning

- [Affects R11][Technical] Implementation of decide-to-respond: cheap pre-call returning `respond | silent` (more controllable, doubles latency) vs. single call that emits sentinel-silence (cheaper, commits full prompt budget every time).
- [Affects R3, R7][Technical] How participation behavior is surfaced in the system prompt UI: free-text the user writes vs. a structured field the orchestrator appends, or both.
- [Affects R12, R14][Technical] Whether chained sub-turns are one turn record or a chain of linked turn records; default cap values; whether parallel fan-out uses `Promise.all` over streams or sequential-with-UI-tricks.
- [Affects R17][Technical] Thread participation stored as a copy at creation vs. a delta layered over the parent.
- [Affects R5][Needs research] What per-agent memory wants from the agent record; scan a couple of multi-agent frameworks before committing to a v0 shape that constrains future memory design.
- [Affects R13][Needs research] Robust mention parsing around code blocks, quotes, and emails.
