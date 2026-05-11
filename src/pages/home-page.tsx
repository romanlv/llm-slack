import { useState } from 'react'
import { Bookmark, Database, GitBranch, Hash, Pin } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NewChatModal } from '@/features/chat/components/new-chat-modal'
import heroImage from '@/assets/hero.png'

const pillars = [
  {
    icon: Hash,
    title: 'Conversations in the sidebar',
    body: 'Keep each workstream separate, star active ones, and jump back into recent or archived chats.',
  },
  {
    icon: GitBranch,
    title: 'Threads from any message',
    body: 'Branch from a specific point, keep the root visible, and continue without muddying the main conversation.',
  },
  {
    icon: Bookmark,
    title: 'Saved and pinned context',
    body: 'Save messages globally, pin important replies inside a conversation, and return to source threads later.',
  },
  {
    icon: Database,
    title: 'Local-first by default',
    body: 'Chats, threads, drafts, settings, pins, and saved messages stay in browser storage.',
  },
]

export function HomePage() {
  const [newChatOpen, setNewChatOpen] = useState(false)

  return (
    <div className="grid min-h-[calc(100vh-3rem)] gap-8 overflow-hidden bg-surface px-5 py-6 md:px-8 md:py-8 xl:grid-cols-[minmax(0,0.96fr)_minmax(420px,0.78fr)] xl:items-center">
      <section className="min-w-0">
        <div className="flex items-center gap-3">
          <img alt="" className="size-11 object-contain" src={heroImage} />
          <Badge>llm-slack</Badge>
        </div>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-ink md:text-5xl">
          Chat with AI like you work in Slack.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-ink-muted md:text-lg">
          Use llm-slack to turn model conversations into a local workspace with
          sidebar chats, message threads, saved replies, pins, and
          per-conversation model choices.
        </p>
        <div className="mt-5 grid max-w-2xl grid-cols-2 gap-2 text-small text-ink-muted sm:grid-cols-4">
          <span className="inline-flex items-center gap-1.5 rounded border border-line bg-white px-2.5 py-1.5">
            <Hash className="size-3.5 text-accent" />
            Chats
          </span>
          <span className="inline-flex items-center gap-1.5 rounded border border-line bg-white px-2.5 py-1.5">
            <GitBranch className="size-3.5 text-accent" />
            Threads
          </span>
          <span className="inline-flex items-center gap-1.5 rounded border border-line bg-white px-2.5 py-1.5">
            <Bookmark className="size-3.5 text-accent" />
            Saved
          </span>
          <span className="inline-flex items-center gap-1.5 rounded border border-line bg-white px-2.5 py-1.5">
            <Pin className="size-3.5 text-accent" />
            Pins
          </span>
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button onClick={() => setNewChatOpen(true)} size="lg">
            Start a conversation
          </Button>
        </div>
      </section>

      <section className="grid min-w-0 gap-4 lg:grid-cols-[0.9fr_1.1fr] xl:grid-cols-1">
        <div className="overflow-hidden rounded-lg border border-line bg-white shadow-[0_18px_54px_-38px_rgba(15,23,42,0.55)]">
          <div className="border-b border-line bg-sidebar px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-send" />
              <span className="text-small font-semibold">llm-slack workspace</span>
            </div>
          </div>
          <div className="grid grid-cols-[136px_minmax(0,1fr)]">
            <div className="space-y-2 border-r border-line bg-sidebar px-3 py-4 text-sidebar-fg">
              <div className="font-mono text-meta font-bold uppercase tracking-[0.08em] text-sidebar-fg-muted">
                Starred
              </div>
              <div className="rounded bg-sidebar-active px-2 py-1.5 text-small font-semibold text-white">
                # release-plan
              </div>
              <div className="px-2 py-1 text-small"># prompts</div>
              <div className="pt-3 font-mono text-meta font-bold uppercase tracking-[0.08em] text-sidebar-fg-muted">
                This conversation
              </div>
              <div className="flex items-center gap-1 px-2 py-1 text-small text-sidebar-chip">
                <GitBranch className="size-3" />
                pricing branch
              </div>
            </div>
            <div className="min-w-0 bg-white p-4">
              <div className="mb-3 flex items-center justify-between border-b border-line pb-2">
                <div>
                  <p className="text-heading font-bold text-ink"># release-plan</p>
                  <p className="text-meta text-ink-muted">3 messages · 2 branches</p>
                </div>
                <Pin className="size-4 text-accent" />
              </div>
              <div className="space-y-3">
                <div className="rounded border border-line bg-surface-muted p-3">
                  <p className="text-small font-semibold text-ink">You</p>
                  <p className="mt-1 text-small leading-5 text-ink-muted">
                    Draft the launch checklist and split risk notes into a thread.
                  </p>
                </div>
                <div className="rounded border border-line bg-white p-3 shadow-[0_10px_26px_-24px_rgba(15,23,42,0.65)]">
                  <p className="text-small font-semibold text-ink">Assistant</p>
                  <p className="mt-1 text-small leading-5 text-ink-muted">
                    Here is the main plan. I opened a branch for pricing risk.
                  </p>
                  <div className="mt-2 inline-flex items-center gap-1 rounded bg-surface-muted px-2 py-1 text-meta text-accent">
                    <GitBranch className="size-3" />
                    2 replies
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
          {pillars.map(({ body, icon: Icon, title }) => (
            <div
              className="rounded-lg border border-line bg-white p-4 shadow-[0_14px_34px_-32px_rgba(15,23,42,0.5)]"
              key={title}
            >
              <Icon className="size-4 text-accent" />
              <h2 className="mt-3 text-body font-semibold text-ink">{title}</h2>
              <p className="mt-1.5 text-small leading-5 text-ink-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <NewChatModal onOpenChange={setNewChatOpen} open={newChatOpen} />
    </div>
  )
}
