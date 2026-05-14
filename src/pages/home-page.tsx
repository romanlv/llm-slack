import { useState } from 'react'
import { Bookmark, Database, GitBranch, Hash, Users } from 'lucide-react'

import { AgentDot } from '@/features/agents/agent-dot'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NewChatModal } from '@/features/chat/components/new-chat-modal'
import heroImage from '@/assets/hero.png'

const pillars = [
  {
    icon: Users,
    title: 'Multi-agent channels',
    body: 'Add agents with their own prompts and models. Mention them when you want input.',
  },
  {
    icon: GitBranch,
    title: 'Threads',
    body: 'Start a thread from any message, so the main channel stays readable.',
  },
  {
    icon: Bookmark,
    title: 'Save important replies',
    body: 'Pin or save replies you want to find again later.',
  },
  {
    icon: Database,
    title: 'Runs in your browser',
    body: 'Chats and settings stay in local browser storage. No account required.',
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
          Chat with multiple AI agents in channels and threads.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-ink-muted md:text-lg">
          llm-slack is an open-source experiment for keeping AI conversations
          organized. Create channels, add agents, start threads, and save
          the replies worth keeping.
        </p>
        <div className="mt-5 grid max-w-2xl grid-cols-2 gap-2 text-small text-ink-muted sm:grid-cols-4">
          <span className="inline-flex items-center gap-1.5 rounded border border-line bg-white px-2.5 py-1.5">
            <Hash className="size-3.5 text-accent" />
            Channels
          </span>
          <span className="inline-flex items-center gap-1.5 rounded border border-line bg-white px-2.5 py-1.5">
            <Users className="size-3.5 text-accent" />
            Agents
          </span>
          <span className="inline-flex items-center gap-1.5 rounded border border-line bg-white px-2.5 py-1.5">
            <GitBranch className="size-3.5 text-accent" />
            Threads
          </span>
          <span className="inline-flex items-center gap-1.5 rounded border border-line bg-white px-2.5 py-1.5">
            <Bookmark className="size-3.5 text-accent" />
            Saved
          </span>
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Button onClick={() => setNewChatOpen(true)} size="lg">
            Start a conversation
          </Button>
          <p className="text-small text-ink-muted">
            Prototype. Ideas and rough edges welcome.{' '}
            <a
              className="text-accent underline-offset-4 hover:underline"
              href="https://github.com/romanlv/llm-slack/issues"
              rel="noreferrer"
              target="_blank"
            >
              Open an issue.
            </a>
          </p>
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
                Channels
              </div>
              <div className="rounded bg-sidebar-active px-2 py-1.5 text-small font-semibold text-white">
                # release-plan
              </div>
              <div className="px-2 py-1 text-small"># prompts</div>
              <div className="pt-3 font-mono text-meta font-bold uppercase tracking-[0.08em] text-sidebar-fg-muted">
                Agents
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1 text-small text-sidebar-chip">
                <AgentDot agentId="planner" displayName="Planner" size="sm" />
                @planner
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1 text-small text-sidebar-chip">
                <AgentDot agentId="critic" displayName="Critic" size="sm" />
                @critic
              </div>
            </div>
            <div className="min-w-0 bg-white p-4">
              <div className="mb-3 flex items-center justify-between border-b border-line pb-2">
                <div>
                  <p className="text-heading font-bold text-ink"># release-plan</p>
                  <p className="text-meta text-ink-muted">2 agents · 1 thread</p>
                </div>
                <GitBranch className="size-4 text-accent" />
              </div>
              <div className="space-y-3">
                <div className="rounded border border-line bg-surface-muted p-3">
                  <p className="text-small font-semibold text-ink">You</p>
                  <p className="mt-1 text-small leading-5 text-ink-muted">
                    Draft the launch checklist. @planner @critic - push back on
                    risky assumptions.
                  </p>
                </div>
                <div className="rounded border border-line bg-white p-3 shadow-[0_10px_26px_-24px_rgba(15,23,42,0.65)]">
                  <div className="flex items-center gap-2">
                    <AgentDot agentId="planner" displayName="Planner" size="sm" />
                    <p className="text-small font-semibold text-ink">@planner</p>
                    <span className="text-meta text-ink-muted">gpt-5</span>
                  </div>
                  <p className="mt-1.5 text-small leading-5 text-ink-muted">
                    Main path looks sound. Pricing risk should move into its
                    own thread.
                  </p>
                  <div className="mt-2 inline-flex items-center gap-1 rounded bg-surface-muted px-2 py-1 text-meta text-accent">
                    <GitBranch className="size-3" />
                    2 replies
                  </div>
                </div>
                <div className="rounded border border-line bg-white p-3 shadow-[0_10px_26px_-24px_rgba(15,23,42,0.65)]">
                  <div className="flex items-center gap-2">
                    <AgentDot agentId="critic" displayName="Critic" size="sm" />
                    <p className="text-small font-semibold text-ink">@critic</p>
                    <span className="text-meta text-ink-muted">claude-opus-4-7</span>
                  </div>
                  <p className="mt-1.5 text-small leading-5 text-ink-muted">
                    The rollout assumes a clean migration. Add rollback
                    criteria before launch.
                  </p>
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
