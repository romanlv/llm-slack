# Cross-Chat Agent Memory

**Status:** placeholder. Needs its own research, brainstorming, and design
pass. Nothing here is committed — this doc collects what `chat-mechanics.md`
defers and gives the work a home.

## What the feature is

An agent's **memory** is a durable per-agent artifact that accumulates
across every chat the agent participates in (channels and agent-DMs).
It's distinct from within-chat conversation context, which is just the
chat itself.

The motivation: in `chat-mechanics.md` we commit to "no in-chat memory
mechanism" in v0 — within a chat, the agent reads a sliding recent
window and forgets what scrolls past. That's acceptable for short or
single-purpose chats. For agents that work across many conversations
over time — a Critic that reviews drafts, a Strategy Lead that touches
many planning chats — the lack of continuity becomes a real ceiling.
Memory is what builds continuity.

Mental model: an agent's memory is the institutional knowledge it forms
by being part of many conversations. The same way a teammate who's been
in a company for a year knows things a fresh hire doesn't.

## What chat-mechanics.md already commits to

These constraints are *upstream* of any memory design — the memory
feature has to fit inside them:

- **Per-agent, not per-user, not per-workspace.** Memory belongs to the
  agent definition (`agents` table). Same agent in two different
  user-created chats sees the same memory.
- **Built across chats, used across chats.** A memory formed in
  channel A is available to the agent when responding in channel B
  or in an agent-DM.
- **Distinct from `agent.systemPrompt`.** The system prompt is the
  user-authored character. Memory is the accumulated experience.
  They compose in the transport prefix; they don't replace each
  other.
- **Distinct from `chatParticipants.role` and `chatParticipants.bio`.**
  Those are public, user-authored, static per-room. Memory is
  agent-authored, dynamic, accumulates over time.
- **Privacy boundary stays inside the workspace.** No cross-workspace
  memory sharing (workspaces aren't even a concept yet, but flagging
  for when they are).
- **Robust to source-message edits/deletes.** Memory is summarized
  prose, not message-id references. Edits and deletions of source
  messages don't invalidate memory (though quality may drift).
- **Editing memory never auto-reruns turns.** Same rule as message
  edits — see [[edits-dont-auto-rerun]] in
  `chat-mechanics.md`. The user can edit memory; downstream replies
  pick up the change on the next turn.
- **No in-chat compaction.** The chosen direction is **sliding
  attention** (in-transport reorganization) and **agent search
  tools** (retrieval on demand) — both lossless — not compaction.
  Memory should compose with both, not duplicate them.

## What's NOT decided — the design surface

Big-rock open questions for the design pass:

### 1. Storage shape

- A **per-agent file** (markdown? structured prose?), or a database
  table, or both?
- Single file vs many chunks (one entry per chat, per topic, per
  insight)?
- Local-only (IndexedDB) or sync-capable to a backend?
- If file-based: where does it live in the repo / on disk / in the
  browser?

### 2. Formation triggers

When does the agent write to its memory?

- At natural turn close, once per turn the agent contributed to.
- At chat archive / chat close.
- On user gesture ("save this to @Alice's memory").
- On schedule (background reflection).
- All of the above.

Cost matters here — each formation event is an LLM call. Volume of
calls × number of agents × number of chats compounds quickly.

### 3. Retrieval shape

**No embeddings** — per the C14 commitment in
`chat-mechanics.md`. Retrieval is text-based and agent-driven.

Two extremes within that constraint:

- **Always-include** — the entire memory artifact is prepended to
  every agent transport. Simple. Scales poorly past a certain
  size.
- **Search-on-demand** — memory lives outside the default
  transport; the agent calls a search tool to query it when
  relevant. Better scaling. Costs a tool-call round-trip when
  used.

Or a hybrid: a small always-included "top of mind" plus a larger
searchable archive accessed via the agent search tool (C14). Probably
the right shape — but design it for real once we see how big
memory artifacts grow.

### 4. Memory granularity

- One blob of free-text prose per agent.
- Structured entries (per-topic, per-chat, per-person).
- Multiple "memory types" (facts, preferences, episodic
  recollections, decisions made).

Trade-off: structure is more queryable but harder to write/maintain;
free-text is more flexible but harder to retrieve from precisely.

### 5. User-editable memory

- Should the user be able to read agent memory? Probably yes —
  transparency.
- Edit it? Powerful (correct hallucinated memories, prime new
  agents) but a footgun.
- See a diff per memory update?
- Suppress / "forget this" gestures from chat messages?

### 6. Interaction with agent search tools (C14)

If memory exists as a searchable file, the agent's search tool can
query both *this chat's history beyond the sliding window* AND
*its own memory file*. Same tool, two scopes. Worth designing the
search-tool interface in tandem with memory.

### 7. Memory and threads

A thread of a channel snapshots channel participants at creation
(R17). Does it also snapshot the agent's memory state? Or does
memory always read the live agent-level file regardless of which
thread the agent is responding in?

Tension: thread context is frozen (frozen-branch rule), but memory
is a forward-evolving artifact. Snapshotting the memory makes
threads behave as historical artifacts; live-reading makes the
agent feel current at the cost of breaking the freeze.

### 8. Memory and regeneration

Same question for regeneration. If memory was updated after the
original turn closed, does a regenerated attempt see the new memory
or roll back to the prior state?

`chat-mechanics.md` is silent on this — the current rule there
("regeneration doesn't roll memory back, and doesn't update memory")
was written under the now-discarded per-chat-notepad model. The
cross-chat memory feature gets to redecide.

### 9. Cost guardrails

- Cap on formation calls per turn (cost protection)?
- Cap on memory file size?
- Cap on retrieval-call budget per agent attempt?
- Per-agent metering (was deferred in the brainstorm; relevant
  here)?

## Composition with adjacent features

- **C13 sliding attention** — reorganizes what's already in the
  agent's transport budget. Memory provides the *raw material* to
  reorganize.
- **C14 agent search tools** — retrieves on demand. Memory is one
  of the things to search.
- **C12 deferred** — this doc *is* C12's resolution. When this doc
  graduates from placeholder to design, C12 in `chat-mechanics.md`
  gets replaced with a forward-reference.

## What this doc is not

- Not a v0 commitment. Memory does not ship in the multi-agent
  foundation plan.
- Not a design. The open questions above are scope of the design
  pass.
- Not a research log. Source material (related work, frameworks
  surveyed, prior attempts) gets added when the design pass starts.

## When to write the design

When **at least one** of these is true:

- Users start hitting the "agent forgot what we discussed last week"
  pain in real use.
- The multi-agent foundation has shipped and we're picking the next
  big feature.
- Tool-use infrastructure (for C14) lands and we want the first
  concrete tool.

Until then, this is a holding pen.
