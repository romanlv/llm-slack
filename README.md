# llm-slack

llm-slack is a browser-first LLM chat workspace inspired by Slack.

Most AI chat tools are one long flat transcript. llm-slack experiments with a
different shape: keep the main conversation readable, then branch into
message-level threads when an idea needs its own side path.

The project is currently a local-first prototype. It runs entirely in the
browser, stores data in IndexedDB, and talks directly to OpenRouter from the
client using an API key you provide in settings.

The Slack-like interface is intentional: channels, sidebars, threads, pins, and
saved items are already familiar to many people, so the app can introduce a new
LLM workflow without making users learn a completely new navigation model.

## Why This Exists

LLM conversations get messy quickly. A single chat can contain planning,
debugging, follow-up questions, rejected ideas, and useful snippets all mixed
together.

llm-slack is exploring a more work-oriented interface:

- conversations live in a sidebar like channels
- any message can open a focused thread
- threads keep their own draft, model, and message history
- saved messages and pins make useful context easy to find again
- everything persists locally so the app is easy to test without a backend

The goal is not to clone Slack. The goal is to make LLM work feel easier to
organize when one conversation starts turning into several related decisions.

## Current Status

This is an MVP/prototype, not a hosted production app.

The big pieces already in place are:

- local conversations with persistent drafts and browser storage
- message-rooted threads, including nested branches
- streaming OpenRouter responses with per-conversation model selection
- message actions for editing, deleting, copying, pinning, and saving
- saved messages, pinned messages, starred conversations, and archives
- responsive conversation + thread layout

More features will be built over time. See [docs/tasks.md](docs/tasks.md) for
the current working backlog and planned direction.

## Important Security Note

The app currently sends provider requests directly from browser JavaScript.
That means your OpenRouter API key is stored in your local browser profile and
is available to the frontend runtime.

This is acceptable for local development and personal experimentation. It is
not appropriate for a public hosted app using shared production credentials.
Moving provider calls behind a backend proxy is part of the longer-term
architecture direction.

## Tech Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS v4
- TanStack Router
- Dexie / IndexedDB
- Vitest
- React Testing Library
- OpenRouter chat completions API

## Getting Started

Requirements:

- Node.js 22+
- pnpm
- an OpenRouter API key if you want to send real model requests

Install dependencies:

```bash
pnpm install
```

Start the development server:

```bash
pnpm dev
```

Open the local URL Vite prints, usually:

```text
http://127.0.0.1:5173/
```

Then:

1. Open Settings.
2. Paste your OpenRouter API key.
3. Choose or enter a default model.
4. Start a conversation.
5. Send a message.
6. Hover a message and open a branch/thread from it.

## Scripts

```bash
pnpm dev          # start Vite in development mode
pnpm build        # build the app
pnpm preview      # preview the production build locally
pnpm test         # run the Vitest suite once
pnpm test:watch   # run Vitest in watch mode
pnpm typecheck    # run TypeScript checks
pnpm lint         # run ESLint
```

Before committing runtime or test changes, run:

```bash
pnpm test
pnpm typecheck
pnpm lint
```

## Deployment

Merges to `main` deploy automatically to GitHub Pages through
[.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml).

The workflow installs dependencies, runs typecheck/lint/tests, builds the Vite
app with the `/llm-slack/` base path, adds a `404.html` SPA fallback, and
publishes the `dist/` artifact with GitHub Pages.

The expected Pages URL is:

```text
https://romanlv.github.io/llm-slack/
```

## Project Layout

```text
src/
  app/                    app shell and sidebar layout
  components/ui/          shared UI primitives
  features/
    chat/                 conversation, thread, message, and send behavior
    model-selection/      model picker controls
    providers/            provider contract and OpenRouter adapter
    settings/             settings persistence and settings pages
  pages/                  route-level page components
  router.tsx              TanStack Router route tree

docs/
  architecture.md         engineering guardrails and target boundaries
  db-schema.md            IndexedDB/Dexie schema notes
  tasks.md                current and planned product work
  threaded-chat-prd.md    original threaded chat product notes
```

The code intentionally keeps provider transport, persistence, product behavior,
and UI rendering separated where practical. For feature work, start with
[docs/architecture.md](docs/architecture.md).

## Data Storage

Data is stored locally in IndexedDB through Dexie. There is no account system
and no server sync.

Stored locally:

- conversations
- threads
- messages
- drafts
- saved messages
- pinned messages
- settings
- OpenRouter API key

If you need a clean slate during development, clear site data for the local dev
origin in your browser.

## Contributing Notes

This repo is still early, so small focused changes are easier to review than
large rewrites.

When changing conversation behavior, preserve the core invariants:

- a thread belongs to exactly one main conversation
- a thread starts from a specific root message
- later messages in the main conversation should not silently change existing
  thread context
- deleting a conversation should clean up its owned threads, messages, pins,
  and saved-message records
- provider-specific request details should stay behind provider adapters

Tests should be colocated with the files they verify and should use Vitest. Use
React Testing Library for component behavior and fake IndexedDB for persistence
tests.

## Roadmap Direction

Near term, llm-slack is focused on becoming a better local LLM workbench:

- more reliable send/retry/regenerate flows
- richer search and navigation
- attachments
- clearer branch maps
- better handling of free/out-of-credit provider states

Longer term, the project may grow toward workspaces/projects, agent definitions,
multi-agent conversations, and a backend boundary for secure provider access.
