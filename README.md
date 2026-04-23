# Deepchat

Browser-first parent-chat and thread workspace built with:

- React 19
- TypeScript
- Vite
- Tailwind CSS v4
- TanStack Router
- Dexie (IndexedDB)
- shadcn-compatible structure and utilities

## Scripts

```bash
pnpm dev
pnpm build
pnpm typecheck
pnpm lint
```

## Project shape

- `src/router.tsx`: route tree and router registration
- `src/app/`: application shell and top-level layout
- `src/components/ui/`: shared UI primitives only
- `src/features/chat/`: parent-chat and Slack-style thread experience
- `src/features/model-selection/`: reusable OpenRouter model selection controls
- `src/pages/`: route-level page adapters
- `src/lib/db.ts`: IndexedDB schema for parent chats, threads, and messages
- `src/lib/openrouter.ts`: browser-side OpenRouter chat transport
- `docs/threaded-chat-prd.md`: product requirements for the thread-based app

## Current state

This scaffold includes:

- persistent local parent chats and message-rooted threads
- per-conversation model selection for parent chats and threads
- browser-side OpenRouter API key settings
- parent-chat and thread composers with separate draft persistence
- streaming assistant responses
- parent-chat search and archive/restore
- responsive side-by-side parent chat and thread layout
- a clean route structure for `/chat/:id`, `/chat/:id/thread/:threadId`, and `/settings`

## Quick test

1. Run `pnpm dev`.
2. Open `/settings`.
3. Paste your OpenRouter API key and save.
4. Open or create a parent chat.
5. Send a message in the parent chat.
6. Open a thread from that message and reply inside the thread pane.
