
# next
- [x] user profile/user name
- [x] delete chat
- [x] delete message
- [x] edit message
- [x] markdown support
- [x] saved messages (per-message bookmark + sidebar collection)
- [x] pinned messages (per-message pin)
- [x] message actions menu (the per-message ⋯ button)
- [x] copy message
- [x] starred chats (per-chat star toggle, Starred sidebar section, star icon in chat header)
- [x] recent chats with cap + "View all conversations" overflow page (`/chats`)
- [x] all conversations page
- [x] subtle pill-shaped active selection in sidebar
- [ ] retry failed assistant message
- [ ] claude code oauth token provider
- [x] codex oauth token provider
- [ ] Openrouter - selecting models
- [ ] free models from open router
- [ ] paste images / upload files to chat
- [ ] out of credits state
- [ ] prompt caching
- [ ] mobile view
- [ ] demo channel - features

# planned

- [ ] regenerate assistant reply with user hint
- [x] defining agents (model + prompt) — `/settings/agents` library; tools deferred
- [x] allow multiple agents to participate in a chat — channels with `auto-decide` / `mention-only` modes, bounded fan-out, decide-to-respond, stop reasons
- [ ] global search / command palette (⌘K)
- [ ] slash commands (/branch parser; extensible registry)
- [ ] file attachments (composer paperclip, Files tab)
- [ ] branch map / tree visualization (sidebar "map ↗", header GitFork)
- [ ] reply-in-thread composer mode toggle
- [ ] queue composer messages submitted while a turn is already responding
- [ ] channel-level pins (distinct from per-message pins)
- [ ] reactions to messages with emojis 
- [ ] search
- [ ] projects?  workspaces are projects
- [ ] export chats
- [ ] show pricing per chat
- [ ] anthropic proxy: thin pass-through (Cloudflare Worker / Vercel function) so direct-browser Claude calls work without the org-level CORS opt-in, and so OAuth tokens (`sk-ant-oat…`) can be used at all. Once shipped, drop the CORS step from the Anthropic auth method in `src/features/settings/provider-definitions.ts` and re-add the OAuth `authMethods` entry.

# multi-agent follow-ups

Deferred from the multi-agent foundation (see
`docs/plans/2026-05-10-001-feat-multi-agent-conversations-plan.md`):

- [ ] agent card (model, context )
- [ ] agent memories and agent tools (R5 future-proofing already in the type)
- [ ] pluggable orchestration strategies / swappable scheduler
- [x] per-agent chattiness dial (1–5) shaping channel decide-to-respond
      framing; per-channel and per-participant overrides still deferred
- [ ] additional participation modes beyond `auto-decide` / `mention-only`
      (regex, keyword, conditional)
- [ ] per-agent (rather than per-turn) cost metering
- [ ] streaming-UX refinements for many in-flight channel agents
- [ ] agent-library UX: search, tagging, sharing, import/export
- [ ] promote a DM to a channel; carry DM context into a new channel; demote
- [ ] expandable agent-DM rows in the sidebar (per-agent chat history)
- [ ] background recovery for stale `streaming` rows on app start
      (architecture P0c.3)
- [ ] decide-status hint UI ("agent X is deciding")
- [ ] decide-to-respond pre-call cost optimization (settings knob)
- [ ] thread-write path for `respondIn: 'thread'` agent responses (R13a).
      `decide-to-respond.parseAgentResponse` already extracts `respondIn`, but
      `orchestrator.runOneAttempt` ignores it and writes the reply on the
      turn's starting scope. Need: when `!isInsideThread &&
      channelSettings.allowAgentThreading && decision.respondIn === 'thread'`,
      call `getOrCreateThreadForMessage(triggeringEvent.id)` and persist the
      assistant message into that branch (single branch per fan-out step;
      reuse if multiple agents in the same step both pick thread).
      Sync the root reply count so the branch indicator shows on the parent
      message. User-visible symptom today: agents asked to "reply in a
      branch" emit content that lands silently on main; the branch panel
      stays empty. Likely also wants a stronger envelope nudge in
      `buildDecideSystemPrompt` — current one-liner is too easy to ignore.
- [ ] token-budget cap aggregation across `providerRequestAttempts.usage`
