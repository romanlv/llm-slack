import { useId, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate } from '@tanstack/react-router'
import { Bot, Check, Hash, MessageSquarePlus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { AgentDot } from '@/features/agents/agent-dot'
import { listAgents } from '@/features/agents/agents-repository'
import type { Agent, ParentChat, ParticipationMode } from '@/features/chat/domain'
import {
  createAgentDm,
  createChannel,
  findOrCreateEmptyParentChat,
} from '@/features/chat/repository'
import type { ModelRef } from '@/features/providers/model-ref'
import { listEnabledModels, type EffectiveModel } from '@/features/providers/models-catalog'
import { listProviders } from '@/features/providers/providers-repository'
import { getSettings } from '@/features/settings/settings-repository'
import { cn } from '@/lib/utils'

import { buildPickerValue, refFromPickerString } from './model-picker-helpers'
import { MiniModelSelect } from './model-picker'
import { ParticipationModeSelect } from './participation-mode-select'

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

  const startModelDm = async (model: ModelRef | null) => {
    if (busy) return
    setBusy(true)
    try {
      const chat = await findOrCreateEmptyParentChat(model)
      await goToChat(chat)
    } finally {
      setBusy(false)
    }
  }

  const startAgentDm = async (agent: Agent) => {
    if (busy) return
    setBusy(true)
    try {
      const chat = await createAgentDm(agent.id)
      await goToChat(chat)
    } finally {
      setBusy(false)
    }
  }

  const startChannel = async (input: {
    title: string
    participants: Array<{ agentId: string; mode: ParticipationMode }>
  }) => {
    if (busy) return
    setBusy(true)
    try {
      const chat = await createChannel({
        title: input.title,
        participants: input.participants,
      })
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
          {tab === 'channel' ? (
            <ChannelTab busy={busy} onCreate={startChannel} />
          ) : null}
        </div>
      </div>
    </>
  )
}

function ModelTab({
  busy,
  onStart,
}: {
  busy: boolean
  onStart: (model: ModelRef | null) => void
}) {
  const availableModels = useLiveQuery(
    () => listEnabledModels(),
    [],
    [] as EffectiveModel[],
  )
  const providers = useLiveQuery(() => listProviders(), [], [])
  const settings = useLiveQuery(() => getSettings(), [], undefined)

  // The fallback resolves to the saved default if it is still enabled,
  // otherwise the first available model. Mirrors the chat-workspace picker
  // so the modal and composer agree on "what would be used right now".
  const fallbackPickerValue = useMemo(() => {
    const defaultRef = settings?.defaultModel
    if (defaultRef) {
      const match = availableModels.find(
        (model) =>
          model.providerModelId === defaultRef.providerModelId &&
          (!defaultRef.providerId || model.providerId === defaultRef.providerId),
      )
      if (match) return buildPickerValue(match.providerId, match.providerModelId)
    }
    const first = availableModels[0]
    return first ? buildPickerValue(first.providerId, first.providerModelId) : ''
  }, [availableModels, settings?.defaultModel])

  const [pickerValue, setPickerValue] = useState<string | null>(null)
  const effectiveValue = pickerValue ?? fallbackPickerValue

  const start = () => {
    onStart(
      refFromPickerString(effectiveValue, {
        availableModels,
        settingsDefault: settings?.defaultModel,
      }),
    )
  }

  return (
    <div className="grid gap-4">
      <div>
        <h3 className="text-heading font-semibold text-ink">Model DM</h3>
        <p className="mt-1 text-small text-ink-muted">
          Start a 1:1 chat with one of your configured models. Pick the model
          here — you can change it later from the chat header.
        </p>
      </div>
      <div className="grid gap-1.5">
        <span className="font-mono text-meta font-semibold uppercase tracking-wider text-ink-muted">
          Model
        </span>
        <div>
          <MiniModelSelect
            availableModels={availableModels}
            connections={providers}
            fallbackLabel={(id) => id}
            onChange={setPickerValue}
            value={effectiveValue}
          />
        </div>
        {availableModels.length === 0 ? (
          <p className="text-small text-ink-muted">
            No models available yet — connect a provider in settings, or
            start the chat and pick a model from the composer.
          </p>
        ) : null}
      </div>
      <div>
        <Button disabled={busy} onClick={start}>
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

function ChannelTab({
  busy,
  onCreate,
}: {
  busy: boolean
  onCreate: (input: {
    title: string
    participants: Array<{ agentId: string; mode: ParticipationMode }>
  }) => void
}) {
  const agents = useLiveQuery(() => listAgents(), [], [] as Agent[])
  const [title, setTitle] = useState('')
  const [selections, setSelections] = useState<Record<string, ParticipationMode>>({})
  const [error, setError] = useState('')
  const titleId = useId()

  const toggleAgent = (agentId: string) => {
    setSelections((prev) => {
      const next = { ...prev }
      if (next[agentId]) {
        delete next[agentId]
      } else {
        next[agentId] = 'auto-decide'
      }
      return next
    })
  }
  const setMode = (agentId: string, mode: ParticipationMode) => {
    setSelections((prev) => (prev[agentId] ? { ...prev, [agentId]: mode } : prev))
  }

  const participants = Object.entries(selections).map(([agentId, mode]) => ({
    agentId,
    mode,
  }))

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    const trimmed = title.trim()
    if (!trimmed) {
      setError('Channel name is required.')
      return
    }
    setError('')
    onCreate({ title: trimmed, participants })
  }

  if (agents.length === 0) {
    return (
      <div className="grid gap-3 rounded-md border border-dashed border-line bg-surface/60 px-6 py-10 text-center">
        <Hash className="mx-auto size-8 text-ink-muted" />
        <div>
          <p className="text-body font-semibold text-ink">No agents yet</p>
          <p className="mt-1 text-small text-ink-muted">
            Channels need at least one agent. Create one first — you can
            always come back to add more.
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
    <form className="grid gap-4" onSubmit={submit}>
      <div>
        <h3 className="text-heading font-semibold text-ink">New channel</h3>
        <p className="mt-1 text-small text-ink-muted">
          A channel hosts a roster of agents; each decides whether to
          respond. Agent participation modes can be edited later in channel
          settings.
        </p>
      </div>

      <div className="grid gap-1.5">
        <label
          className="font-mono text-meta font-semibold uppercase tracking-wider text-ink-muted"
          htmlFor={titleId}
        >
          Name
        </label>
        <div className="flex items-center gap-2">
          <span aria-hidden className="font-mono text-body text-ink-dim">
            #
          </span>
          <Input
            autoFocus
            id={titleId}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. launch-plan"
            value={title}
          />
        </div>
      </div>

      <div className="grid gap-2">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-meta font-semibold uppercase tracking-wider text-ink-muted">
            Agents
          </span>
          <span className="font-mono text-meta text-ink-muted">
            {participants.length} selected
          </span>
        </div>
        <ul className="grid gap-2">
          {agents.map((agent) => {
            const selectedMode = selections[agent.id]
            const selected = Boolean(selectedMode)
            return (
              <li key={agent.id}>
                <div
                  className={cn(
                    'flex items-center gap-3 rounded-md border bg-surface px-3 py-2 transition',
                    selected ? 'border-accent/40 ring-1 ring-accent/30' : 'border-line',
                  )}
                >
                  <button
                    aria-pressed={selected}
                    className="flex flex-1 items-center gap-3 text-left"
                    onClick={() => toggleAgent(agent.id)}
                    type="button"
                  >
                    <span
                      className={cn(
                        'flex size-5 shrink-0 items-center justify-center rounded border transition',
                        selected
                          ? 'border-accent bg-accent text-white'
                          : 'border-line bg-canvas',
                      )}
                    >
                      {selected ? <Check className="size-3.5" /> : null}
                    </span>
                    <AgentDot
                      agentId={agent.id}
                      displayName={agent.displayName}
                      size="md"
                    />
                    <div className="min-w-0">
                      <div className="text-body font-semibold text-ink">
                        {agent.displayName}
                      </div>
                      <div className="font-mono text-meta text-ink-muted">
                        {agent.model.providerModelId}
                      </div>
                    </div>
                  </button>
                  {selected ? (
                    <ParticipationModeSelect
                      onChange={(mode) => setMode(agent.id, mode)}
                      value={selectedMode!}
                    />
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
        {participants.length === 0 ? (
          <p className="text-small text-ink-muted">
            Add at least one agent to start — but you can also create an
            empty channel and add agents from channel settings later.
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-small text-danger">
          {error}
        </p>
      ) : null}

      <div>
        <Button disabled={busy} type="submit">
          <Hash className="size-4" />
          Create channel
        </Button>
      </div>
    </form>
  )
}

