# Chat Mechanics

How `llm-slack` behaves when a user sends a message, across every supported
conversation shape. *What the user experiences and why* — not which file
does what. Code shape: `docs/architecture.md`. Schema: `docs/db-schema.md`.

This is the grand-vision document. It is allowed to describe target behavior
that is not fully shipped yet, but those gaps should be visible here so coding
agents do not accidentally treat aspirational mechanics as completed
invariants.

## Implementation checklist

Status convention: `[x]` means future agents can rely on the behavior as
implemented. `[ ]` means the doc body describes the intended direction, but
the behavior is not yet complete and should not be assumed in code without
checking the current implementation.

### Working now

- [x] Three top-level chat shapes exist via `parentChats.kind` +
  `parentChats.agentId`: model DM, agent DM, channel.
- [x] Agent DMs prepend the agent's `systemPrompt` as a `{role:'system'}`
  transport message and use the agent's model.
- [x] Channels use one `turns` row with multiple `providerRequestAttempts`
  rows, one provider call per candidate, sentinel silence, and chained/per-agent
  fan-out caps.
- [x] Channel threads snapshot their participant rows at creation, so later
  parent-channel roster changes do not rewrite the thread roster.
- [x] Mentions match `@username` (single-word, lowercase). Display name
  is the rendered label, not a mention target.
- [x] User interrupt routes through `interruptActiveTurn(parentChatId)` and
  closes the active turn with `user-interrupt`.

### Build next / keep aligned with this doc

- [ ] Agent-DM creation should always create a fresh chat for the agent. Current
  code still reuses the most recent non-archived agent DM.
- [ ] Sidebar Agents section should list every defined agent, expose one-click
  new-chat creation, and expand to show that agent's chats.
- [x] Agent-DM empty responses should be dropped with no assistant message row.
  Current code persists a fallback empty-response message.
- [ ] The richer XML channel prompt (`<description>`, `<house_rules>`,
  public roster role/bio, `<your_role>`) needs schema fields and prompt
  builder support.
- [ ] Channel transport should include snapshotted agent author attribution for
  prior assistant messages so agents can tell who said what even after renames
  or deletes.
- [ ] Channel fan-out should use barriered trigger batches instead of choosing
  one "latest" reply as the next trigger. `chainFollowupMode` should tune
  whether follow-up steps are disabled, mention-only, or auto-decide.
- [x] Per-agent chattiness dial (1–5, default 2 "reserved") shapes the
  decide-to-respond prefix. Per-channel and per-participant overrides
  are still pending; chattiness lives on the agent only for now.
- [ ] Channel-level and per-participant chattiness overrides on top of
  the per-agent value.
- [ ] Primary-responder channel threads need a persisted thread field and
  decide-to-respond bias.
- [ ] Branch context scope needs to be snapshotted per thread
  (`parent-only` / `last-N-tokens` / `all-ancestors`).
- [ ] `messageRevisions`, `currentRevisionId`, `rootRevisionId`, and tombstone
  deletes need to land before edit/delete behavior can satisfy the
  frozen-branch rules described below.
- [ ] Regeneration lineage (`regeneratedFromTurnId`, per-agent regenerate,
  per-turn channel regenerate, optional regeneration hint) needs workflow
  and UI support.
- [ ] Token-budget enforcement should aggregate provider usage across channel
  attempts.
- [ ] Context-window logic should use model metadata consistently instead of the
  current approximate character safety limit.

## The three shapes

Every chat is one of three shapes, distinguished by `parentChats.kind` +
`parentChats.agentId`:

| Shape | `kind` | `agentId` | Participants | Who responds |
| --- | --- | --- | --- | --- |
| **Model DM** | `dm` | `null` | One model, picked in composer | Always asked, normally responds. No decide step, no mention parsing. |
| **Agent DM** | `dm` | set | One configured agent (model + system prompt) | Always asked. Normally responds; an empty reply is dropped (no row), same as a human who didn't reply. |
| **Channel** | `channel` | `null` | Roster of agents, each with a participation mode | Each agent decides independently, bounded by caps. |

Shape is fixed at creation. No DM↔channel promotion in v0.

All three share the same persistence (`parentChats`, `threads`, `messages`,
`turns`, `providerRequestAttempts`). What differs is *orchestration* —
what runs between "send" and "turn closed."

## One agent, many chats

An **agent** is a reusable definition (model + system prompt + display
name). A **chat** is a conversation context. The same agent can be the
participant in **many independent agent-DMs**, each with its own context
and history. The same agent can also belong to many channels.

Keeping topics separate keeps context windows clean and prevents
inadvertent topic bleed. *"What did we decide about X?"* lives in one
chat; *"help me draft Y"* lives in another. The user creates a new chat
with an agent the same way they create a new chat with a model — every
"New chat → Agent → pick agent" produces a fresh context.

This makes both DM flavors consistent: an agent is to its chats as a
model is to its chats — a definition, not a chat instance. Model DMs
already behave this way (`findOrCreateEmptyParentChat`); the agent-DM
flow currently defaults to find-or-create-by-agent and should be
updated to always create new. The "open my last chat with @critic"
gesture, if we want it, lives on the agent's chat list UI, not on
chat creation.

### Where chats with an agent surface

In the sidebar. The sidebar's **Agents** section (alongside Channels)
lists every defined agent as a row. Each row carries:

- The agent's display name (and identity dot).
- A **`+`** affordance for one-click "new chat with this agent."
- An expansion control; the row expands to show that agent's chats,
  most-recent first.

Behavior:

- **Collapsed by default.** Click to expand; expanding more than one
  agent at a time is fine (no accordion lockout).
- **Auto-expand when active.** Entering a chat with @alice
  auto-expands Alice's row so neighboring chats with her stay visible.
- **Recent section shows model DMs only** — agent DMs live under
  their agent in the Agents section, not double-listed. Same pattern
  as Slack's separation between DMs and Channels.
- **Empty-state agents** (defined but never chatted with) still show
  a row with the `+` affordance, so unused agents are discoverable.

The agents settings page at `/settings/agents` stays — but its
purpose narrows to agent *definition* CRUD (create / edit / delete).
The sidebar handles the "find a chat" need; the settings page handles
the "edit the agent itself" need.

> **Implementation note:** the existing sidebar (post-U13) has a
> Channels section but no Agents section yet. This is follow-up work
> beyond the multi-agent foundation plan.

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
recorded `stopReason`.

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
Model is per chat (or per thread).

### Agent DM

`{role: 'system', content: agent.systemPrompt}` prepended to the
conversation. Model is `agent.model`, not the chat-level model — the user
can't change the model from the composer; the agent *is* the model+prompt
pair. Empty `systemPrompt` → no system message.

**Empty responses are dropped.** If the agent returns empty or
whitespace-only content on a successful call, no message row is written
— same posture as a human who didn't reply. The user sees no
"agent stayed silent" warning; the chat just doesn't grow. (Genuine
errors and stream failures still surface through the normal error
path.) DM is "always asked," not "always responds."

### Channel

Per agent attempt, transport is one `{role: 'system'}` message followed
by the conversation. The system message is **XML-tagged** so the agent
can structurally attend to each section instead of guessing from prose
positioning:

```
<channel>
  <name>brainstorm</name>
  <description>quick ideation room, low filter, fast iteration</description>
  <house_rules>be concise; one idea per message; defer critique until asked</house_rules>
  <participants>
    - Alice (database expert): previously built Postgres extensions; opinionated about transactions
    - Bob
    - Critic (logical flaw finder)
  </participants>
</channel>

<conventions>
  - To stay silent, respond with exactly "<silent>".
  - Do not return an empty message to mean silence.
  - To reply inside a thread, return {"respond": true, "respondIn": "thread", "content": "..."}.
</conventions>

<your_role>
  ...the agent's own systemPrompt...
</your_role>
```

Components:

- **`<name>`** — the channel's title.
- **`<description>`** — free-text topic. Both human-visible (in the
  channel header) and injected here. Optional; omit the tag if empty.
- **`<house_rules>`** — the channel's `systemPrompt` field. Behavioral
  guidance that applies to every agent in this room. Optional.
- **`<participants>`** — list of roster members in `- name (role):
  bio` form. `role` and `bio` are optional per-agent fields; either
  is omitted when not set (e.g., *Bob* in the example has neither).
  Other agents' private `systemPrompt` is **never** shared here —
  that stays private character.
- **`<your_role>`** — the agent's own `systemPrompt`. Last, so it's the
  most-recent instruction the model attends to.
- **`<conventions>`** — silence sentinel, threading instruction. Always
  present.

Conversation messages follow. Target channel transport renders agent
messages with snapshotted author attribution in the text body
(`[@critic]: ...` or `[Alice]: ...`) so responders can attribute prior
turns despite the uniform `assistant` role and later agent renames.

Each agent calls its own provider with its own model. Different agents
in the same turn can hit different providers; per-attempt model
snapshots make this auditable.

**Trade-off acknowledged:** `<house_rules>` does erode "agents are
reusable across channels without modification" — a `Critic` in two
channels with different rules will behave differently in each, and
that's the point. The XML-tagged structure mitigates it: the agent
sees clearly which guidance is room-specific vs. its own character,
which keeps the agent from confusing the two.

### Prompts in use

| Stage | Status | File | What it builds |
| --- | --- | --- | --- |
| Agent DM prefix | Current | [`src/features/chat/send-turn.ts:84-99`](../src/features/chat/send-turn.ts) | Prepends `agent.systemPrompt` as `{role:'system'}` if non-empty. |
| Channel decide-to-respond | Current lightweight version | [`src/features/chat/decide-to-respond.ts:77-95`](../src/features/chat/decide-to-respond.ts) | Combines agent prompt + roster + silence convention + optional threading instruction. |
| Rich XML channel prompt | Target | See checklist | Adds channel description, house rules, public role/bio roster, and explicit `<your_role>` / `<conventions>` sections. |
| Channel response parser | Current | [`src/features/chat/decide-to-respond.ts:33-62`](../src/features/chat/decide-to-respond.ts) | Parses `<silent>` / empty / JSON-envelope / raw content. |

There is no *workspace-global* system prompt. Channel-level
`systemPrompt` (house rules) is the target room-level prompt surface and
is XML-tagged as `<house_rules>` in the rich prompt described above.

---

## Channels: how a turn unfolds

The orchestrator makes channels feel like Slack instead of
auto-everyone-replies. A channel turn proceeds in **barriered fan-out
steps**: select candidates, ask them in parallel, wait for every attempt
in that step to settle, then decide whether the full batch of new
messages should trigger another step.

The next step is triggered by the **batch** of messages produced by the
previous step, not by one arbitrary "latest" reply. If Alice and Bob both
reply in the same fan-out step, the next candidate decision sees both
Alice's and Bob's messages as the prior-step trigger batch.

```
runChannelTurn:
  open turn
  triggerBatch = [userMessage]
  producedAnyMessage = false
  loop:
    if turn closed externally (interrupt) → return
    if triggerBatch came from agents
       and chainFollowupMode='none'      → close('complete'); return
    candidates = selectCandidates(triggerBatch, chainFollowupMode)
    if no candidates                     → close(producedAnyMessage ? 'complete' : 'no-trigger'); return
    if next step would exceed caps   → close('cap-hit');   return
    fanOut(candidates) in parallel   // wait for all attempts to settle
    if step produced 0 messages
       and every attempt errored     → close('error');     return
    if step produced 0 messages      → close(producedAnyMessage ? 'complete' : 'no-trigger'); return
    producedAnyMessage = true
    triggerBatch = messages produced by this step
  close('complete')
```

### Who is a candidate

Candidate selection reads the whole trigger batch.

- **Initial user-message step** — `auto-decide` agents are candidates;
  `mention-only` agents are candidates only if named in the user message.
- **Follow-up steps from agent replies** — gated by `chainFollowupMode`:
  - `none` — no follow-up candidates; the turn completes after the
    current step settles.
  - `mentions-only` — only agents mentioned anywhere in the prior reply
    batch are candidates.
  - `auto-decide` — normal `auto-decide` agents may react to the prior
    reply batch; mentioned agents are also candidates.
- **No self-reply / cooldown** — after speaking, an agent is excluded
  until at least one event from a different participant intervenes
  (R12). Tracked in-memory, not persisted. The exact cooldown behavior
  for same-step multi-speaker batches is the next decision to settle
  before implementation.

An auto-decide agent named explicitly is *also* a candidate (mention is a
strong signal) — but decide-to-respond still applies. Mention doesn't
force speech, it just guarantees the agent is asked.

### How an agent says no

Decide-to-respond is a single provider call, not a separate yes/no probe.
The room-context prefix names the silence convention; the reply parses as:

- **Silence / no-message fallback** — intentional silence is exactly
  `<silent>` after trimming surrounding whitespace, or a JSON envelope
  with `respond:false`. Empty/whitespace-only output and JSON
  `respond:true` with blank/missing `content` are tolerated as
  no-message fallback because empty replies should never be saved, but
  they are not the encouraged protocol. `<silent>` plus any extra text is
  content, not silence. Recorded as `decided-silent`. No `messages` row.
- **Content, implicit location** — normal reply. Persists on the same
  conversation as the triggering batch (main or thread, wherever the
  agent was reading from).
- **Content, explicit `respondIn: 'thread'`** — honored only when
  `allowAgentThreading=true` and the agent is reading from main. Opens
  or reuses a thread on the triggering message. With trigger batches,
  the thread target must be deterministic: single-message batches use
  that message; mention-triggered candidates use the message that named
  them. Multi-message auto-decide thread targeting needs a separate
  target-field decision before the batch mechanic is implemented.

If `allowAgentThreading=false`, any declared `respondIn` is ignored. If
the agent is already inside a thread, it always replies in that thread
— no escalation back to main in v0.

### Caps

All three live on `channelSettings`, per channel, with app-level defaults
overlaid:

- `maxChainedSubTurns` — hard upper bound on follow-up fan-out steps
  after the initial user-triggered step. `0` permits no follow-up
  steps; use `chainFollowupMode='none'` when the product intent is
  "no chains" rather than "chains stopped by a cap."
- `maxMessagesPerAgentPerInput` — agent excluded from candidacy after
  hitting the cap.
- `tokenBudgetPerInput` — aggregated from
  `providerRequestAttempts.usage`. Planned; see `docs/tasks.md`
  follow-ups.

First cap to fire → `stopReason='cap-hit'`. First-step no-candidate or
all-silent → `'no-trigger'`. A later quiet/no-candidate step after at
least one agent message → `'complete'`. `chainFollowupMode='none'`
completes normally after the initial fan-out settles; disabling follow-up
chains is not a cap hit.

### Follow-up chain mode

`chainFollowupMode` tunes how much agents can react to one another after
the initial response step:

| Mode | Behavior |
| --- | --- |
| `none` | Only the user's message triggers agents. No agent-to-agent follow-up steps. |
| `mentions-only` | A prior-step agent reply can trigger only agents it explicitly mentions. |
| `auto-decide` | Prior-step agent replies can trigger normal auto-decide candidacy over the full reply batch. |

The barrier stays invariant in every mode: a step's replies do not
trigger follow-up until every attempt in that step has settled.

### Within one step

Fan-out is parallel (`Promise.allSettled`) and barriered. Ordering of
messages produced in the same step must be deterministic for rendering
and tests, but the next candidate decision treats them as a batch rather
than privileging the last persisted row. One agent erroring does not
abort the step — only when *every* attempt errors does the turn close
`'error'`.

> **Implementation note:** current code still carries a single
> `triggeringEvent` forward and uses the last new message as the next
> trigger. The target behavior above replaces that with `triggerBatch`.

### Keeping auto-decide from getting chatty

LLMs default to "yes, I can help" — once they emit one content token,
they almost never bail to `<silent>`. The product's two-layer answer:

- **Decide prompt is framed silence-first.** *"Most messages do not
  need your reply"* — not *"reply unless…"*. Plus restraint signals
  (how many times this agent has spoken this turn; who else is a
  candidate this step). Lives in
  [`decide-to-respond.ts`](../src/features/chat/decide-to-respond.ts).
- **Chattiness dial** — per-agent-per-channel 1–5 slider that shapes
  the per-agent prompt fragment. See **Tuning surfaces → How
  chattiness shapes behavior** for the model and levels.

A two-call yes/no pre-check is the remaining escape hatch if these
two layers can't get the room calm. Deferred.

---

## Threads

Threads inherit their parent's shape at creation. Frozen-branch rule
applies to participants too.

- **Thread of a model DM** — `kind='dm'`, `agentId=null`. No participants
  table involved. One assistant message per send.
- **Thread of an agent DM** — `kind='dm'`, `agentId` from parent. Same
  agent, same one-on-one behavior.
- **Thread of a channel** — `chatParticipants` rows are *copied* from
  the parent at thread creation, with their per-agent modes. Later
  adds/removes on the parent don't propagate down; thread-level
  changes don't propagate up. Inherits `allowAgentThreading` from the
  parent's `channelSettings`.

### Primary responder (channel threads)

When a thread is opened off a specific agent's message, **that agent is
the thread's primary responder**. The thread is still `kind='channel'`
— no kind change, no DM masquerade. What changes is the
decide-to-respond bias: the primary speaks freely; other agents in the
snapshotted roster behave more reservedly (effectively shifted toward
`mention-only` for the duration of the thread, but not literally
remoded — their per-participant `chattiness` and `mode` are unchanged).

This gives the "feels like a DM with this one agent" affordance for
channel threads without reintroducing kind-discriminator ambiguity. If
the user wants to engage the wider roster inside the thread, mentions
still work normally.

The primary is recorded on the thread row at creation (which agent's
message it was rooted on). Threads opened off a *user* message in a
channel have no primary — the whole roster behaves as in the parent.

### Thread context inheritance

The thread inherits an initial context scope at creation —
`parent-only` / `last-N-tokens` / `all-ancestors` — see **Context →
Branch context scope** for the mechanic. This is per-thread, set at
creation; the parent channel's defaults apply unless the user picks
otherwise during thread creation.

---

## Mentions

`@username` is the only mention handle. Usernames are unique, lowercase
`[a-z0-9_-]+`, and optional — agents without one are not mentionable.
Display name is the rendered label, never a mention target.

Matching is case-insensitive and longest-match across known handles.
Renaming an agent or changing its username does not rewrite past message
bodies — stale mentions stop firing after the handle changes.

Excluded from candidacy detection: fenced code blocks and inline code.
Matched (false positives accepted in v0): markdown links and blockquotes.
Email-shaped tokens (`@user@example.com`) are excluded.

Effect depends on receiving agent's mode:

- **Mention-only** — the only way it becomes a candidate.
- **Auto-decide** — would have been a candidate anyway; mention adds
  emphasis but doesn't force speech.

---

## Settings stack

The target stack has four layers, least-specific to most-specific.
Field-by-field detail lives in **Tuning surfaces** below; this section
is the conceptual overview.

1. **Developer defaults** — `channel-defaults.ts`. Seeded into new
   channels and new agents at creation. Not user-visible. Target source
   of truth; current defaults still live partly in `domain.ts`.
2. **Per-agent** — `agents` table. The agent's identity (name, role,
   bio, model, system prompt, default chattiness, default mode).
   Travels with the agent across every chat.
3. **Per-channel** — `channelSettings`. Caps, follow-up chain mode,
   default mode for new participants, `allowAgentThreading`, channel
   description, house rules.
4. **Per-agent-in-channel** — `chatParticipants`. Mode and chattiness
   for one agent in one room. Same agent can be auto-decide in one
   channel and mention-only in another.

Editing the agent definition affects every chat that agent is in
from the next turn forward. **Editing never auto-reruns existing
turns** — regeneration is always explicit (see Edits).

---

## Tuning surfaces

The product targets the feel of a real human team in a Slack channel:
diverse perspectives, varied engagement, members who listen as much as
they speak. Most of those qualities emerge from existing primitives —
system prompts carry voice and domain, the decide-to-respond loop
enforces listening. The remaining dial that humans calibrate
consciously is **how readily each teammate volunteers** when not
directly addressed. (Shared memory from working together — the other
dimension that makes real teams cohere — is the future cross-chat
memory feature, see [`docs/memory.md`](./memory.md).)

The tuning surfaces below are organized by layer, from broadest to most
local. Each layer overrides the one above it. The goal is not to find
the "right" values but to compose combinations that produce useful
behavior for the room's purpose.

### Per agent (workspace-wide)

On the `agents` table. Travel with the agent across every chat it
joins. New agents inherit values from `channel-defaults.ts` (see
**Developer-facing config** below). Fields marked by unchecked checklist
items are target fields, not guaranteed current schema.

Simple tuning fields (chattiness, future dials) **compose into the
agent's prompt under the hood** — the user picks a value, the
orchestrator translates it into the matching fragment from
`defaults.ts` and injects it into the decide-to-respond prefix. Users
never see or edit the underlying strings. The per-agent `composedPrompt`
toggle disables this composition for agents whose `systemPrompt`
already encodes the intended behavior.

| Field | Tunes | Default |
| --- | --- | --- |
| `displayName` | Rendered name in UI and roster. Free-form, can be long; not a mention target. | required |
| `username` | Mention handle (`@username`). Single-word `[a-z0-9_-]+`. Optional — agents without one are not mentionable. | empty (optional) |
| `role` | Short one-line "what this agent is for" — public. Shown to other agents in shared channels and in the user's UI | empty |
| `bio` | Longer free-text background — public. Shown to other agents in shared channels and in the user's UI | empty |
| `model` (`ModelRef`) | Provider, model, context window | required |
| `systemPrompt` | Voice, character, domain emphasis — **private** (the agent's own character; never shown to other agents) | empty |
| `composedPrompt` | When `true`, tuning fragments (chattiness, primary-responder bias, etc.) compose into the prompt automatically. When `false`, only `systemPrompt` is sent — escape hatch for hand-crafted agents. `role` and `bio` still propagate to other agents regardless. | `true` |
| `defaultChattiness` | Initial chattiness (integer 1-5) when the agent joins a new channel | `3` (mid) |
| `defaultParticipationMode` | Initial mode (`auto-decide` / `mention-only`) when added to a new channel | `auto-decide` |

### Per channel

On the `channelSettings` table. Shape the room itself.

| Field | Tunes | Default |
| --- | --- | --- |
| `title` | Sidebar label | required |
| `description` | Free-text room topic. Human-visible in header + injected as `<description>` in agent transport | empty |
| `systemPrompt` | Channel house rules. Injected as `<house_rules>` in agent transport | empty |
| `maxChainedSubTurns` | Hard cap on follow-up fan-out steps after the initial user-triggered step | from `channel-defaults.ts` |
| `chainFollowupMode` | Whether agent replies can trigger no follow-up, mention-only follow-up, or auto-decide follow-up | from `channel-defaults.ts` |
| `maxMessagesPerAgentPerInput` | Per-agent ceiling per turn | from `channel-defaults.ts` |
| `tokenBudgetPerInput` | Turn-wide cost ceiling (planned) | from `channel-defaults.ts` |
| `defaultParticipationMode` | Mode applied to newly added participants | from `channel-defaults.ts` |
| `defaultChattiness` | Chattiness applied to newly added participants | from `channel-defaults.ts` |
| `allowAgentThreading` | Whether agents may choose `respondIn: 'thread'` | `true` |

### Per agent-in-channel

On the `chatParticipants` row. Override how a specific agent behaves
in this specific room.

| Field | Tunes | Default |
| --- | --- | --- |
| `mode` | `auto-decide` / `mention-only` | inherited from channel default |
| `chattiness` | Integer 1-5 (applies only when `mode='auto-decide'`). Maps to a prompt fragment + UI codename via `channel-defaults.ts` | inherited from channel default |

### Developer-facing config (the experimentation file)

Lives in **`src/features/chat/channel-defaults.ts`** — a single
TypeScript file, one place. **Every exported value carries an inline
comment** explaining what it tunes and the expected range or
trade-off. Not user-visible.

The file is the single source of truth for default values stamped
into new channels and new agents, plus the strings and thresholds
the orchestrator and gauge use.

| Param | Tunes |
| --- | --- |
| `channelDefaults.maxChainedSubTurns` | Default for new channels |
| `channelDefaults.chainFollowupMode` | Default follow-up eligibility mode (`none` / `mentions-only` / `auto-decide`) |
| `channelDefaults.maxMessagesPerAgentPerInput` | Default for new channels |
| `channelDefaults.tokenBudgetPerInput` | Default for new channels |
| `channelDefaults.defaultParticipationMode` | Default for new channels |
| `channelDefaults.defaultChattiness` | Default for new channels |
| `channelDefaults.allowAgentThreading` | Default for new channels |
| `agentDefaults.defaultChattiness` | Default for new agents |
| `agentDefaults.defaultParticipationMode` | Default for new agents |
| `chattinessLevels[1..5]` | Per-level `{ codename, promptFragment }` consumed by both UI (slider label) and orchestrator (decide-prompt fragment) |
| `prompts.decideToRespond` | The template used by `buildDecideSystemPrompt` |
| `silenceSentinel` | The string an agent emits to decline (default `<silent>`) |
| `branchScope.default` | `parent-only` / `last-N-tokens` / `all-ancestors` |
| `branchScope.defaultN` | Token target when `last-N-tokens` is chosen (whole-message-rounded in practice) |
| `contextBands.yellow` | Threshold for the yellow band (default 0.7) |
| `contextBands.red` | Threshold for the red band (default 0.9) |

Changing a value here requires a code reload, not a release — the
file is bundled and picked up on the next page load. To track an
experiment, comment the *previous* value beside the new one so you
can revert intentionally.

### How chattiness shapes behavior

Stored as an integer **1–5**. Modifies the `decide-to-respond` system
prefix per agent. The agent is still *asked* every step it's a
candidate — chattiness biases the *framing*, never whether the
orchestrator skips the call.

Each level maps to:

- A **prompt fragment** inserted into the decide-to-respond prefix.
- A **one-word UI codename** for the slider label.

Both live in `channel-defaults.ts` so the mapping can be iterated
without a schema migration. Illustrative seeding (final names and
exact wording TBD in code):

| Level | Codename | Prompt fragment (illustrative) |
| --- | --- | --- |
| 1 | wallflower | *"Speak only when directly addressed. Default to silence."* |
| 2 | reserved | *"You participate only when you are the clear domain authority or can correct a factual error."* |
| 3 | balanced | *"Contribute when you have something genuinely useful — a clarification, a missing perspective, constructive challenge. Otherwise stay silent."* |
| 4 | engaged | *"Engage actively. Offer perspective, ask follow-up questions, surface missed considerations."* |
| 5 | eager | *"Lean in. Volunteer thoughts; explore tangents; keep the conversation moving."* |

UI: a stepped slider (1–5) on the participant row in channel settings,
labeled with the current level's codename.

Scope: chattiness only modifies the decide-to-respond prefix — nothing
else. The agent's `composedPrompt=false` toggle skips this injection
entirely. `mention-only` still wins, because a `mention-only` agent
isn't a candidate without being mentioned and never sees the prefix.

### What's NOT a tuning dial (and why)

Deliberately resisted, to keep the surface comprehensible:

- **Initiative axis** (proactive vs reactive) — collapses naturally
  into chattiness; carry nuance in the agent's `systemPrompt`.
- **Conviction axis** (suggester vs advocate) — write *"you push back
  hard on flimsy claims"* in the agent's `systemPrompt`.
- **Conformity axis** (contrarian vs yes-and) — same; system prompt.
- **Per-topic chattiness** — overfits; let the system prompt say
  *"speak up on database questions, defer otherwise."*
- **Probabilistic skip** — making chattiness skip the LLM call with
  some probability would make behavior unreproducible. Keep it
  deterministic.

---

## Edits, deletes, regeneration

This section describes the target edit/delete/regeneration model. The
current implementation has simpler edit and delete behavior; see the
unchecked `messageRevisions` and regeneration checklist items before
assuming these invariants in code.

Edits create new `messageRevisions` rows; originals are preserved so
existing threads stay valid (frozen-branch rule extends to revisions).
Deletes are tombstones (`deletedAt`), never hard deletes. **Edits never
auto-trigger a new turn** — regeneration is always explicit.

### Who can edit/delete what

| Action | User msg | Assistant msg (model or agent) |
| --- | --- | --- |
| User edits | Yes — new revision | No (would misattribute) |
| User deletes | Yes — tombstone | Yes — tombstone |
| Agent edits | — | No (v0) |
| Agent deletes | — | No (v0) |

UI renders tombstones as `[deleted]`. Future turns assembling context
**skip** tombstones — the model sees a gap, not a placeholder. Threads
rooted before the deletion keep the original revision and render
normally.

### Editing a user message

New `messageRevisions` row. Original revision stays attached to any
thread rooted on this message; future turns walking the parent timeline
use the latest revision. To get a reply against the edited text, the
user explicitly regenerates — preserves history honesty (the original
reply is preserved against its original prompt).

In a channel: editing a user message that triggered a fan-out does **not**
re-run the orchestrator. The original turn's replies stand. Regenerate
the turn (below) if you want the room to re-react.

**Edits never affect in-process requests.** If any edit happens while
a turn is still streaming, the in-flight turn keeps the revisions it
started with. No mid-stream context swaps. The edit takes effect on
the next turn the user explicitly initiates.

### Regenerating an assistant message

Two scopes, one mechanism. Both produce a new `turns` row with
`regeneratedFromTurnId` pointing at the original (schema already has the
lineage column).

- **Per-agent regenerate** (any shape): re-run *one* assistant message
  against the current state of ancestors. One new
  `providerRequestAttempts` row. In channels: only the targeted agent
  re-runs — other agents' replies in the same step are untouched. No
  fan-out continuation; if you want further reactions, send a new turn.
- **Per-turn regenerate** (channel only): re-run the orchestrator's
  full loop against the same user message. Old fan-out replies are
  tombstoned. New turn carries `regeneratedFromTurnId`. Not a default
  action — most useful when the user has edited the triggering
  message and wants to reshape how the room reacts.

Both accept an optional **regeneration hint** — a one-shot
`{role:'system'}` message prepended to the targeted attempt(s) only,
not persisted into any prompt or settings. Free-text input on the
regenerate menu. Examples: *"shorter please," "explain like I'm five,"
"skip the disclaimers," "be more skeptical."*

The regenerated message replaces the prior content inline. Prior
attempts remain in the DB via `providerRequestAttempts` and
`regeneratedFromTurnId` lineage — UI surfacing them as swipeable
history is a later affordance, not a v0 requirement.

---

## Context

Every model has a finite context window. The product accepts this the
way humans do in a long-running room: read what's recent, accept that
older content scrolls past.

### Per-agent context windows

A model's context window is a property of the model, not the chat.
Agents inherit their window from `agent.model`. The model catalog
([`src/features/providers/models-catalog.ts`](../src/features/providers/models-catalog.ts))
should expose a normalized context-window value for every sendable
model. Current provider metadata uses `contextLength` in the catalog
and `contextWindowTokens` in recorded usage; the implementation should
normalize that into one budgeting surface. Unknown models fall back to
the default; known models carry their specific window.

The window is *per agent*, not per room. Two agents in the same channel
may see different slices of the same conversation if they have
different windows. A channel is **not** bottlenecked by the smallest
agent's window — each agent reads what fits its own model; older
messages simply scroll out for the agents with smaller windows.

### Agent transport: system + recent window

For every agent attempt, the transport is:

1. The orchestrator's room-context system prefix (channel name, roster,
   silence convention, threading instruction).
2. The agent's own `systemPrompt`.
3. The recent window — messages that fit the remaining budget after
   (1)–(2) and the user's pending message.

There is no in-chat notepad, no summarization layer, no per-chat memory
of any kind. **The conversation IS the agent's working view of the
chat.** What scrolls out of the window is gone for that agent in that
chat.

Cross-chat agent memory is a separate planned feature — see "Future:
cross-chat agent memory" below.

### Branch context scope

When the user opens a thread, they pick how much ancestor context the
thread inherits at creation. Options:

- **Parent only** — just the message being branched on, plus the
  user's thread-opening reply. Smallest context. Use when the tangent
  is self-contained.
- **Last N tokens** — walk backwards from the parent, including
  whole ancestor messages, until adding the next would exceed N.
  **Round up** — the message that crosses the boundary is included,
  not excluded. The parent itself is always included regardless of
  size. Result: context-coherent (no mid-message cuts), token-bounded
  in practice.
- **All ancestors** — full lineage up to the root. Largest context.
  Today's default.

The choice is snapshotted into the thread's frozen context. Later
ancestor edits don't propagate (frozen-branch rule).

Default scope and the value of N live in `channel-defaults.ts`. The
**whole-message-rounding** convention applies anywhere we make a
budget-vs-messages decision — including the channel sliding window
(how many recent messages each agent sees per turn). Never deliver a
half-truncated message.

UI: input/slider expressed in tokens, with a live "≈ X messages"
preview so the user has both axes visible while adjusting.

### When context is tight

An agent's window can be strained by long messages, dense recent
activity, or a long conversation. Escape hatches:

- **Branch with parent-only scope** — escape heavy ancestor history.
- **Start a fresh chat with the agent** — clean slate (see "One agent,
  many chats").
- **Regenerate prior replies shorter** — free budget in place using
  the regeneration hint.

A pre-send context-budget gauge surfaces when an agent's next attempt
would crowd its window. The gauge is **per-agent** in concept: in
channels each agent has its own; a top-of-channel summary can
aggregate the most-strained agent for at-a-glance awareness; in DMs
it's just the one agent's gauge. Exact placement (agent dot ring,
info card, header bar, composer hint) is UI-experimentation territory
— see C9. No auto-truncation: older messages stop being delivered as
the window slides; nothing is synthesized in their place.

When older context matters, the future toolkit handles it
*losslessly*: **sliding attention** restructures what's already in
transport (C13), and **agent search tools** let the model retrieve
what isn't (C14). Compaction-style summarization is not on the path
— it's lossy, and the two alternatives subsume the need.

## Future: cross-chat agent memory

**Not in v0.** Each agent will accumulate a durable **memory** — built
across every chat the agent participates in, used to inform replies in
any chat. This is what gives an agent continuity across separate
conversations: the institutional knowledge it forms by being in many
chats over time. Distinct from within-chat conversation context, which
is just the chat itself.

Full design surface — storage shape, formation triggers, retrieval,
privacy, user editing, interaction with threads and regeneration —
lives in [`docs/memory.md`](./memory.md). That doc is a placeholder
pending its own research and brainstorming pass.

This chat-mechanics doc commits only to the **interface**: memory
exists per agent, is built and used across chats, and composes with
sliding attention (C13) and agent search tools (C14) rather than
duplicating them. The "no in-chat memory mechanism in v0" rule
stands — any "remember this for later" behavior is delivered by the
cross-chat memory feature when designed.

---

## Open questions

The doc body above reflects my current proposed answers, so it reads
coherently end-to-end. Each item below is still up for decision — when
resolved, the answer is folded into the body and the entry is deleted.

### C9. Where the context gauge surfaces in the UI

**Owned by user — UI experiments.** Body commits to the gauge
existing per-agent (with optional channel-level aggregation
surfacing the most-strained agent). Exact placement — agent dot
ring, info card, header bar, composer pre-send hint, or some
combination — is a design exploration.

Plausible surfaces to test:

- **Composer area pre-send hint** — *"@Alice's window is 87% full
  this turn."* Most actionable; the user is about to commit.
- **Colored ring on agent dots** — per-agent passive awareness.
- **Info card on agent hover/click** — richer per-agent context.
- **Top-of-channel summary** — single bar showing the most-strained
  agent; glanceable.
- **Chat header pill in DMs** — single agent, single gauge.

(Branch-title text is out — clutters titles, changes every send.)

### C13. Sliding attention / mid-context restructuring

Distinct from the sliding *window* (truncation — older messages drop
from transport). Sliding attention is about **actively reorganizing
what's inside the transport budget** to fight the U-shaped attention
curve LLMs exhibit — the "lost in the middle" effect where content
deep inside a long context window is materially less attended to than
content near the start or end.

Possible techniques:

- **Recency re-anchoring** — repeat important early-context facts
  closer to the bottom of the prompt where attention is strongest.
- **Top-pinned synthesis** — a short "what matters right now" block
  at the top, kept current as the chat moves.
- **Position-aware emphasis** — when a message references something
  from earlier, pull that excerpt forward in the transport.
- **XML-tagged priorities** — mark blocks with `<important>` /
  `<context>` so the model can structurally attend (we already use
  XML for sections; this would extend the convention to importance).

Trade-offs:

- Lossless — no summarization step that drops detail.
- Risk of feedback loops or oscillation if the "priority" detection
  is itself noisy.
- Real engineering effort — likely a follow-up to the cross-chat
  memory work ([`docs/memory.md`](./memory.md)), since both depend on
  knowing what "matters" in a way the current naive recent-window
  doesn't.

Parked. Worth designing alongside or after cross-chat memory.

### C14. Agent search tools

When an agent needs information from older messages (scrolled out of
its sliding window) or from its other chats, the agentic answer is
**on-demand retrieval via a tool call** — not pre-emptive context
restructuring.

**Retrieval mechanism: text-based search. No embeddings.** Matches
how Claude Code / Cursor handle codebase context — expose grep-like
tools, let the model be clever about queries (generate synonyms,
refine, broaden). The intelligence lives in the model's tool-use
loop, not in an embedding-similarity algorithm.

Concrete shapes worth designing when tool-use infrastructure lands:

- **In-chat search** — `search(query)` over this chat's full
  history beyond the sliding window. *"What did we decide 50
  messages ago?"*
- **Cross-chat search** — same tool, scoped across the agent's
  other chats and (eventually) its memory file (see
  [`docs/memory.md`](./memory.md)).
- **Result shape** — matching messages with surrounding context,
  sorted by recency or match strength.

**Implication: introduces tool-use to the provider contract.**
Adapters need to handle tool-call message types; the orchestrator
needs a loop for tool→result→reply rounds. The brainstorm listed
"agent tools" as deferred — search is the first concrete tool worth
landing when tool-use infrastructure ships.

**Acknowledged limitation:** text search misses paraphrased
references (*"that idea about caching"* when the original word was
*"memoization"*). Mitigated by the model issuing multiple refined
queries inside its tool-use loop. Embeddings remain available as a
future-future addition if this turns out to be the bottleneck —
but starting simpler is right.

### C12. Cross-chat agent memory — moved to its own doc

The full design lives in [`docs/memory.md`](./memory.md). That doc is
a placeholder for the research + brainstorming pass; this chat-mechanics
doc only commits to the *interface* (memory exists per agent, is built
and used across chats, composes with sliding attention and agent search
tools).

---

## Cross-cutting invariants

Target invariants preserved across shapes — orthogonal to kind. Items
that depend on unchecked checklist work are not guaranteed by current
code yet.

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

## Decision matrix

Target behavior by conversation shape. Use the implementation checklist
at the top as the source of truth for what is already shipped.

| Question | Model DM | Agent DM | Channel |
| --- | --- | --- | --- |
| Who responds? | Picked model | Configured agent | 0..N agents that choose to |
| System prompt sent? | None | Agent's | Room context + agent's (per attempt) |
| Mention parsing? | — | — | Yes |
| Decide-to-respond? | No | No (empty reply drops silently) | Yes (sentinel-silence) |
| Caps applied? | No | No | Yes |
| Cancel button? | Yes | Yes | Yes |
| Threads inherit kind? | DM | DM (carries agentId) | Channel (snapshots participants) |
| Agent identity in UI? | Just model name | Agent dot + name | Agent dot + name (per message) |
| `settings.defaultModel` applies? | Yes | No — agent's model wins | No — per-attempt agent model |
| Edit own message? | Yes (new revision) | Yes (new revision) | Yes (new revision) |
| Edit assistant message? | No | No | No |
| Regenerate? | Per-message | Per-message | Per-message *and* per-turn |
| Optional regen hint? | Yes | Yes | Yes (scoped per-agent or per-turn) |
