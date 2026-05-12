# Chat Mechanics

How `llm-slack` behaves when a user sends a message, across every supported
conversation shape. *What the user experiences and why* — not which file
does what. Code shape: `docs/architecture.md`. Schema: `docs/db-schema.md`.

## The three shapes

Every chat is one of three shapes, distinguished by `parentChats.kind` +
`parentChats.agentId`:

| Shape | `kind` | `agentId` | Participants | Who responds |
| --- | --- | --- | --- | --- |
| **Model DM** | `dm` | `null` | One model, picked in composer | Always. No decide, no mention parsing. |
| **Agent DM** | `dm` | set | One configured agent (model + system prompt) | Always. No decide, no mention parsing. |
| **Channel** | `channel` | `null` | Roster of agents, each with a participation mode | Each agent decides independently, bounded by caps. |

Shape is fixed at creation. No DM→channel promotion, no channel→DM demotion
in v0.

All three share the same persistence (`parentChats`, `threads`, `messages`,
`turns`, `providerRequestAttempts`). What differs is *orchestration* —
what runs between "send" and "turn closed."

---

## Sending a message: one lifecycle, three branches

```
sendUserMessage(chatId, prompt)
  └─> openTurn(chatId, userMessageId)
       │
       ├─ Model DM       → one attempt, picked model. Produces one assistant message.
       ├─ Agent DM       → one attempt, agent's model + agent.systemPrompt prefix. One message.
       └─ Channel        → orchestrator.runChannelTurn(...): bounded fan-out + decide + caps.
       │
       └─ closeTurn(stopReason)   // single writer for updatedAt, lastActivityPreview
```

Same auditable artifacts everywhere: one `turns` row, N
`providerRequestAttempts` rows (N=1 for DMs, 0..many for channels), a
recorded `stopReason`. UI distinguishes shapes; persistence and
cancellation primitives don't.

### Stop reasons (every closed turn carries one)

- `complete` — DM finished, or every channel candidate had its say.
- `no-trigger` — channel step produced no messages (everyone silent, or no
  candidates). Channel-only.
- `cap-hit` — `maxChainedSubTurns`, `maxMessagesPerAgentPerInput`, or
  token budget stopped the loop. Channel-only.
- `user-interrupt` — Cancel button.
- `error` — DM call threw, or every fan-out attempt in a channel step
  errored.

### User interrupt

`interruptActiveTurn(parentChatId)` is the single entry point. DM: aborts
the stream controller. Channel: closes the turn so the orchestrator's loop
guard bails before the next step. Partial streamed content stays; new
chunks from in-flight attempts are dropped by the `attemptStillCurrent`
gate.

---

## What each shape sends to the model

Persistence, threading, ordering keys, and frozen-branch semantics are
identical across shapes. Only the transport payload and orchestration
differ.

### Model DM

Conversation messages (`user | assistant`) in order. No system message.
Model is per chat (or per thread). Byte-for-byte today's behavior (AE7).

### Agent DM

`{role: 'system', content: agent.systemPrompt}` prepended to the
conversation. Model is `agent.model`, not the chat-level model — the user
can't change the model from the composer; the agent *is* the model+prompt
pair. Empty `systemPrompt` → no system message (don't send empty content).

### Channel

Per agent attempt, transport is:

1. **Room context** as `{role: 'system'}` from the orchestrator: channel
   name (and description — see C1), participant roster (display names —
   see C2), the silence convention, and (when `allowAgentThreading=true`
   and reading the main timeline) how to declare `respondIn: 'thread'`.
2. **Agent prompt** as a second `{role: 'system'}` — room context first
   (situational), agent prompt second (more specific "character").
3. **Conversation messages.** Agent messages are rendered with author
   attribution in the text body (`[@Critic]: …`) so responders can
   attribute prior turns despite the uniform `assistant` role.

Each agent calls its own provider with its own model. Different agents in
the same turn can hit different providers; per-attempt model snapshots
make this auditable.

---

## Channels: how a turn unfolds

The orchestrator makes channels feel like Slack instead of
auto-everyone-replies. It selects candidates per step, then lets each
candidate decide.

```
runChannelTurn:
  open turn
  loop:
    if turn closed externally (interrupt) → return
    candidates = autoDecideAgentsThatDidntJustSpeak
               + mentionOnlyAgentsNamedInLatestEvent
    if no candidates                 → close('no-trigger'); return
    if next step would exceed caps   → close('cap-hit');   return
    fanOut(candidates) in parallel   // Promise.allSettled
    if step produced 0 messages
       and every attempt errored     → close('error');     return
    if step produced 0 messages      → close('no-trigger');return
  close('complete')
```

### Who is a candidate

- **Auto-decide agents** that didn't just speak. After speaking, an agent
  is excluded until at least one event from a different participant
  intervenes (no self-reply, R12). Tracked in-memory, not persisted.
- **Mention-only agents** named in the latest event. They never volunteer;
  `@DisplayName` is the only trigger.

An auto-decide agent named explicitly is *also* a candidate (mention is a
strong signal) — but decide-to-respond still applies. Mention doesn't
force speech, it just guarantees the agent is asked.

### How an agent says no

Decide-to-respond is a single provider call, not a separate yes/no probe.
The room-context prefix names the silence convention; the reply parses as:

- **Silence** — sentinel marker, empty, or whitespace-only. Recorded as
  `decided-silent`. No `messages` row.
- **Content, implicit location** — normal reply. Persists on the same
  conversation as the triggering event (main or thread, wherever the
  agent was reading from).
- **Content, explicit `respondIn: 'thread'`** — honored only when
  `allowAgentThreading=true` and the agent is reading from main. Opens
  or reuses a thread on the triggering message. Multiple agents picking
  thread in the same step all land in one thread.

If `allowAgentThreading=false`, any declared `respondIn` is ignored. If
the agent is already inside a thread, it always replies in that thread
— no escalation back to main in v0.

### Caps

All three live on `channelSettings`, per channel, with app-level defaults
overlaid:

- `maxChainedSubTurns` — number of fan-out steps per user input. `0`
  disables agent-to-agent chains (only initial step runs).
- `maxMessagesPerAgentPerInput` — agent excluded from candidacy after
  hitting the cap.
- `tokenBudgetPerInput` — aggregated from
  `providerRequestAttempts.usage`. Planned; see `docs/tasks.md`
  follow-ups.

First cap to fire → `stopReason='cap-hit'`. No-candidate step →
`'no-trigger'`. Natural exit → `'complete'`.

### Within one step

Fan-out is parallel (`Promise.allSettled`). Ordering of messages produced
in the same step is **not** guaranteed. One agent erroring does not abort
the step — only when *every* attempt errors does the turn close `'error'`.

---

## Threads

Threads inherit their parent's shape at creation. Frozen-branch rule
applies to participants too.

- **Thread of a model DM** — `kind='dm'`, `agentId=null`. No participants
  table involved. One assistant message per send.
- **Thread of an agent DM** — `kind='dm'`, `agentId` from parent. Same
  agent, same one-on-one behavior.
- **Thread of a channel** — `chatParticipants` rows are *copied* from the
  parent at thread creation, with their per-agent modes. Later
  adds/removes on the parent don't propagate down; thread-level changes
  don't propagate up. Inherits `allowAgentThreading` from the parent's
  `channelSettings`.

---

## Mentions

`@DisplayName`, case-insensitive, longest-match. Renaming an agent does
not rewrite past message bodies — stale mentions stop firing on rename.
Display names within the library are unique to keep this predictable.

Excluded from candidacy detection: fenced code blocks and inline code.
Matched (false positives accepted in v0): markdown links and blockquotes.
Email-shaped tokens (`@user@example.com`) are excluded.

Effect depends on receiving agent's mode:

- **Mention-only** — the only way it becomes a candidate.
- **Auto-decide** — would have been a candidate anyway; mention adds
  emphasis but doesn't force speech.

---

## Settings stack

Least-specific to most-specific:

1. **App defaults** (see C3 — currently TBD): cap values + default
   participation mode, stamped onto `channelSettings` at channel
   creation. Later changes to app defaults don't propagate into existing
   channels.
2. **Channel settings** (`channelSettings`, per channel): the real tuning
   surface. Caps, default mode for newly added participants,
   `allowAgentThreading`.
3. **Agent-in-channel** (`chatParticipants`): which agents are in this
   channel and each one's participation mode here. The same agent can be
   auto-decide in one channel and mention-only in another — mode is
   per-chat-per-agent.

The agent definition itself (`agents`) is workspace-global, not a fourth
layer. Editing an agent's system prompt affects every chat that agent is
in, from the next turn forward.

---

## Cross-cutting invariants

Preserved across shapes — orthogonal to kind:

- Frozen-branch context: a thread's inherited context is fixed at thread
  creation. Later edits/deletes/regens of ancestors don't retro-mutate
  thread context.
- Per-message model + agent snapshots: every assistant message records
  the model that produced it (and agent identity when applicable).
  Deleting the agent or losing the provider doesn't break history.
- `closeTurn` is the single writer for `ParentChat.updatedAt` and
  `lastActivityPreview`. Fan-out attempts don't bump these.
- Strictly-monotonic ordering keys with same-millisecond tie-break
  (`pinnedMessages.sortKey`, `chatParticipants.sortKey`, future turn
  sequence numbers).

---

## Open product questions

Where the original sketch is under-specified or where implementation
hasn't picked a direction.

### C1. Channel description vs. channel-wide system prompt

The sketch conflated *"description and/or system prompt that will be used
for other agents."* Two different things:

| Field | For whom | Visibility |
| --- | --- | --- |
| **Channel description** | Humans — header / settings | Optional. Not sent to agents. |
| **Channel-wide system prompt ("house rules")** | Agents — prepended to every transport on top of agent's own prompt | The orchestrator already injects a generated room-context system message; this would be a user-authored *additional* layer. |

`channelSettings` has neither today. Recommend:

- Ship **description**. Free-text on `channelSettings` (or on
  `parentChats` next to `title`). Human-only.
- Defer **channel-wide system prompt**. It duplicates the per-agent prompt
  surface and erodes "agents are reusable across channels" — once it
  exists, every channel grows its own dialect. Add later if real usage
  shows a gap.

### C2. What agents see about each other

The room-context system message lists participants by **display name**.
Two open axes:

- **Per-agent handle / one-line role in the roster.** Recommend yes — a
  short "what this agent is for" (new optional field on `agents`,
  separate from `systemPrompt`). Keeps room context compact and useful.
- **Each other's system prompts.** Recommend **no**. Prompts are private
  character and may include user-specific instructions. Sharing them
  leaks setup into every reply and pulls the channel toward a hive mind.

### C3. App-level channel defaults

Plan calls for app-level defaults; schema today has none. Two options:

- Code-level constants seeded into `channelSettings` at creation. Cheap;
  changing requires a release.
- `appChannelDefaults` blob on `settings`. Lets the user shift defaults
  workspace-wide. More surface.

Recommend code constants for v0 — these are tuning knobs, not user
preferences, until experience says otherwise.

### C4. Mention → thread → "DM-like" behavior

The sketch said *"mention on agents, will act as DM when their message is
branched out (maybe)."* Cleanest reading:

> When a user `@`-mentions exactly one agent, then opens a thread on that
> agent's reply, the thread should *feel like* a DM with just that agent.

Two ways to deliver it:

- **Special-case the snapshot:** thread snapshots only the mentioned
  agent. Everyone else excluded by construction.
- **Don't special-case:** thread inherits the full roster (R17); user
  removes others manually if they want a one-on-one.

Recommend **don't special-case**. R17 is clean; the DM-feel is one mode
change away. A "thread of a channel" that secretly behaves like an
agent-DM reintroduces the kind-discriminator ambiguity we worked to
eliminate (same `kind='channel'` but observably DM-shaped).

If the gesture turns out to be common, the right answer is a
**promote-mention-to-agent-DM** button — a fresh agent-DM with that
agent, optionally carrying the message context. That's a fourth variant
of the already-deferred DM↔channel promotion family.

### C5. Auto-decide silence in agent-DMs

The brainstorm says: in a DM, the single participant always responds (no
decide step). Right for the common case.

But: an agent-DM with a strong "stay quiet unless asked" prompt can
produce empty replies via the silence convention. Today the agent-DM
path doesn't parse silence — it persists whatever returns, including
blank.

Recommend: don't run the silence parser in DM mode. An empty DM reply is
the agent's bug; surface as a blank-message warning rather than silently
dropping the turn. Keeps "DM always responds" clean.

---

## Decision matrix

| Question | Model DM | Agent DM | Channel |
| --- | --- | --- | --- |
| Who responds? | Picked model | Configured agent | 0..N agents that choose to |
| System prompt sent? | None | Agent's | Room context + agent's (per attempt) |
| Mention parsing? | — | — | Yes |
| Decide-to-respond? | No (always) | No (always) | Yes (sentinel-silence) |
| Caps applied? | No | No | Yes |
| Cancel button? | Yes | Yes | Yes |
| Threads inherit kind? | DM | DM (carries agentId) | Channel (snapshots participants) |
| Agent identity in UI? | Just model name | Agent dot + name | Agent dot + name (per message) |
| `settings.defaultModel` applies? | Yes | No — agent's model wins | No — per-attempt agent model |
