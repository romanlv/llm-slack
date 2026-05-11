import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate } from '@tanstack/react-router'
import { Bot, Hash, MessageSquarePlus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { AgentDot } from '@/features/agents/agent-dot'
import { listAgents } from '@/features/agents/agents-repository'
import type { Agent, ParentChat } from '@/features/chat/domain'
import {
  findOrCreateAgentDm,
  findOrCreateEmptyParentChat,
} from '@/features/chat/repository'
import { cn } from '@/lib/utils'

type NewChatModalProps = {
  onOpenChange: (open: boolean) => void
  open: boolean
}

type Tab = 'model' | 'agent' | 'channel'

const TABS: Array<{
  id: Tab
  label: string
  icon: typeof MessageSquarePlus
  description: string
}> = [
  {
    id: 'model',
    label: 'Model',
    icon: MessageSquarePlus,
    description: 'Direct chat with one of your configured models.',
  },
  {
    id: 'agent',
    label: 'Agent',
    icon: Bot,
    description: 'Reusable persona with its own model and system prompt.',
  },
  {
    id: 'channel',
    label: 'Channel',
    icon: Hash,
    description: 'Multiple agents in one room — they decide when to respond.',
  },
]

export function NewChatModal({ onOpenChange, open }: NewChatModalProps) {
  return (
    <Dialog
      className="max-w-3xl"
      contentLabel="New chat"
      onOpenChange={onOpenChange}
      open={open}
    >
      {open ? <NewChatModalBody onClose={() => onOpenChange(false)} /> : null}
    </Dialog>
  )
}

function NewChatModalBody({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('model')
  const [busy, setBusy] = useState(false)

  const goToChat = async (chat: ParentChat) => {
    await navigate({ to: '/chat/$chatId', params: { chatId: chat.id } })
    onClose()
  }

  const startModelDm = async () => {
    if (busy) return
    setBusy(true)
    try {
      const chat = await findOrCreateEmptyParentChat()
      await goToChat(chat)
    } finally {
      setBusy(false)
    }
  }

  const startAgentDm = async (agent: Agent) => {
    if (busy) return
    setBusy(true)
    try {
      const chat = await findOrCreateAgentDm(agent.id)
      await goToChat(chat)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className="flex items-start gap-3 border-b border-line bg-surface px-6 py-5 pr-12">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
          <MessageSquarePlus className="size-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-ink">Start a new chat</h2>
          <p className="text-small text-ink-muted">
            Pick a kind — Model for a 1:1 with a model, Agent for a reusable
            persona, Channel for a multi-agent room.
          </p>
        </div>
      </header>

      <div className="grid max-h-[78vh] grid-cols-[200px_minmax(0,1fr)] overflow-hidden">
        <ul className="overflow-y-auto border-r border-line bg-surface px-2 py-3">
          {TABS.map((entry) => {
            const Icon = entry.icon
            const active = entry.id === tab
            return (
              <li key={entry.id}>
                <button
                  aria-selected={active}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-small transition',
                    active
                      ? 'bg-accent-soft text-accent ring-1 ring-accent/30'
                      : 'text-ink hover:bg-canvas/60',
                  )}
                  onClick={() => setTab(entry.id)}
                  role="tab"
                  type="button"
                >
                  <Icon className="size-4" />
                  <span className="font-semibold">{entry.label}</span>
                </button>
              </li>
            )
          })}
        </ul>

        <div className="overflow-y-auto px-6 py-5" role="tabpanel">
          {tab === 'model' ? (
            <ModelTab busy={busy} onStart={startModelDm} />
          ) : null}
          {tab === 'agent' ? (
            <AgentTab busy={busy} onPick={startAgentDm} />
          ) : null}
          {tab === 'channel' ? <ChannelTab /> : null}
        </div>
      </div>
    </>
  )
}

function ModelTab({ busy, onStart }: { busy: boolean; onStart: () => void }) {
  return (
    <div className="grid gap-4">
      <div>
        <h3 className="text-heading font-semibold text-ink">Model DM</h3>
        <p className="mt-1 text-small text-ink-muted">
          Start a 1:1 chat with one of your configured models. Pick the model
          in the composer once you're in the chat — your default is used
          unless you change it.
        </p>
      </div>
      <div>
        <Button disabled={busy} onClick={onStart}>
          <MessageSquarePlus className="size-4" />
          Start
        </Button>
      </div>
    </div>
  )
}

function AgentTab({
  busy,
  onPick,
}: {
  busy: boolean
  onPick: (agent: Agent) => void
}) {
  const agents = useLiveQuery(() => listAgents(), [], [] as Agent[])

  if (agents.length === 0) {
    return (
      <div className="grid gap-3 rounded-md border border-dashed border-line bg-surface/60 px-6 py-10 text-center">
        <Bot className="mx-auto size-8 text-ink-muted" />
        <div>
          <p className="text-body font-semibold text-ink">No agents yet</p>
          <p className="mt-1 text-small text-ink-muted">
            Agents are reusable personas with their own model and system
            prompt. Create one in settings to get started.
          </p>
        </div>
        <div>
          <Link
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-canvas px-4 py-2 text-small font-medium text-ink transition hover:bg-canvas/60"
            to="/settings/agents"
          >
            Open agents library
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      <div>
        <h3 className="text-heading font-semibold text-ink">Direct message an agent</h3>
        <p className="mt-1 text-small text-ink-muted">
          Pick an agent to start (or reopen) a 1:1 chat with it.
        </p>
      </div>
      <ul className="grid gap-2">
        {agents.map((agent) => (
          <li key={agent.id}>
            <button
              className="flex w-full items-center gap-3 rounded-md border border-line bg-surface px-4 py-3 text-left transition hover:bg-canvas/40 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busy}
              onClick={() => onPick(agent)}
              type="button"
            >
              <AgentDot agentId={agent.id} displayName={agent.displayName} size="md" />
              <div className="min-w-0 flex-1">
                <div className="text-body font-semibold text-ink">
                  {agent.displayName}
                </div>
                <div className="font-mono text-meta text-ink-muted">
                  {agent.model.providerModelId}
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ChannelTab() {
  return (
    <div className="grid gap-3 rounded-md border border-dashed border-line bg-surface/60 px-6 py-10 text-center">
      <Hash className="mx-auto size-8 text-ink-muted" />
      <div>
        <p className="text-body font-semibold text-ink">Channels are coming soon</p>
        <p className="mt-1 text-small text-ink-muted">
          A channel hosts multiple agents in one room — each decides whether
          to respond to a message. The creation flow lands in a follow-up
          unit.
        </p>
      </div>
    </div>
  )
}
