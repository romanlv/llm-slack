
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

# planned

- [ ] regenerate assistant reply with user hint
- [x] defining agents (model + prompt) — `/settings/agents` library; tools deferred
- [x] allow multiple agents to participate in a chat — channels with `auto-decide` / `mention-only` modes, bounded fan-out, decide-to-respond, stop reasons
- [ ] global search / command palette (⌘K)
- [ ] slash commands (/branch parser; extensible registry)
- [ ] file attachments (composer paperclip, Files tab)
- [ ] branch map / tree visualization (sidebar "map ↗", header GitFork)
- [ ] reply-in-thread composer mode toggle
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
- [ ] thread-write path for `respondIn: 'thread'` agent responses (R13a;
      orchestrator currently parses but persists on the main timeline)
- [ ] token-budget cap aggregation across `providerRequestAttempts.usage`
