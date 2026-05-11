
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
- [ ] defining agents (model + prompt + tools)
- [ ] allow multiple agents to participate in a chat
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
