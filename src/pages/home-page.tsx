import { useNavigate } from '@tanstack/react-router'
import { Database, GitBranch, Layers3 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { findOrCreateEmptyParentChat } from '@/features/chat/repository'

const pillars = [
  {
    icon: Layers3,
    title: 'Parent chat + thread routing',
    body: 'Parent chats live in the sidebar, while message-rooted threads open as focused side conversations.',
  },
  {
    icon: Database,
    title: 'IndexedDB persistence',
    body: 'Threads and messages are stored locally with Dexie, so the browser is the source of truth.',
  },
  {
    icon: GitBranch,
    title: 'Slack-style branching',
    body: 'Open a thread from any message, keep the root visible, and continue the side path without polluting the parent chat.',
  },
]

export function HomePage() {
  const navigate = useNavigate()

  const handleStart = async () => {
    const parentChat = await findOrCreateEmptyParentChat()
    await navigate({
      to: '/chat/$chatId',
      params: { chatId: parentChat.id },
    })
  }

  return (
    <div className="grid min-h-[calc(100vh-3rem)] gap-8 p-6 md:p-10 xl:grid-cols-[1.2fr_0.8fr] xl:items-center">
      <div>
        <Badge>Bootstrap foundation</Badge>
        <h2 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-foreground md:text-5xl">
          Parent chats with Slack-style message threads for browser-only LLM work.
        </h2>
        <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
          The app keeps L1 parent chats in the sidebar and lets you branch into
          message-rooted threads that inherit only the ancestor chain up to the
          root message.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button onClick={handleStart} size="lg">
            Start a parent chat
          </Button>
          <a
            className="inline-flex h-11 items-center justify-center rounded-full border border-border bg-white/70 px-5 text-sm font-medium text-foreground transition hover:bg-white"
            href="https://openrouter.ai/docs/api-reference/chat-completion"
            rel="noreferrer"
            target="_blank"
          >
            OpenRouter docs
          </a>
        </div>
      </div>

      <div className="grid gap-4">
        {pillars.map(({ body, icon: Icon, title }) => (
          <div
            className="rounded-3xl border border-border bg-white/72 p-6 shadow-[0_16px_48px_-36px_rgba(15,23,42,0.5)]"
            key={title}
          >
            <Icon className="size-5 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-semibold text-foreground">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
