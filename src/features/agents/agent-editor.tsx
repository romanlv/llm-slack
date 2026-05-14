import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'

import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  buildPickerValue,
  pickerValueFromRef,
  refFromPickerString,
} from '@/features/chat/components/model-picker-helpers'
import { agentDefaults, chattinessLevels } from '@/features/chat/defaults'
import type { Agent, ChattinessLevel } from '@/features/chat/domain'
import type { ModelRef } from '@/features/providers/model-ref'
import {
  listEnabledModels,
  type EffectiveModel,
} from '@/features/providers/models-catalog'
import { listProviders } from '@/features/providers/providers-repository'
import type { ProviderConnection } from '@/features/providers/entities'

import {
  AgentValidationError,
  createAgent,
  suggestUsernameFromDisplayName,
  updateAgent,
} from './agents-repository'
import { AgentDot } from './agent-dot'

type AgentEditorProps = {
  agent?: Agent
  onOpenChange: (open: boolean) => void
  onSaved?: (agent: Agent) => void
  open: boolean
}

export function AgentEditor({ agent, onOpenChange, onSaved, open }: AgentEditorProps) {
  return (
    <Dialog
      className="max-w-2xl"
      contentLabel={agent ? `Edit agent ${agent.displayName}` : 'Create agent'}
      onOpenChange={onOpenChange}
      open={open}
    >
      {open ? (
        <AgentEditorBody
          agent={agent}
          key={agent?.id ?? 'new'}
          onClose={() => onOpenChange(false)}
          onSaved={onSaved}
        />
      ) : null}
    </Dialog>
  )
}

function AgentEditorBody({
  agent,
  onClose,
  onSaved,
}: {
  agent?: Agent
  onClose: () => void
  onSaved?: (agent: Agent) => void
}) {
  const isEditing = Boolean(agent)
  const availableModels = useLiveQuery(
    () => listEnabledModels(),
    [],
    [] as EffectiveModel[],
  )
  const connections = useLiveQuery(
    () => listProviders(),
    [],
    [] as ProviderConnection[],
  )

  const [displayName, setDisplayName] = useState(agent?.displayName ?? '')
  const [username, setUsername] = useState(agent?.username ?? '')
  // When creating, leaving the field untouched lets the repository derive
  // the slug at save time. `usernameTouched` is only consulted for the
  // create path; on edit it stays true because we always have an
  // existing value to send.
  const [usernameTouched, setUsernameTouched] = useState(Boolean(agent))
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? '')
  const [chattiness, setChattiness] = useState<ChattinessLevel>(
    agent?.chattiness ?? agentDefaults.chattiness,
  )
  // User-selected picker value, or `undefined` until the user touches the
  // dropdown. At submit time we derive the active value from this override
  // (when set) or from the default. Keeping the override separate avoids a
  // useEffect race where the picker value seeds after availableModels
  // resolves but before the user clicks Save.
  const [pickerOverride, setPickerOverride] = useState<string | undefined>(
    undefined,
  )
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const noModels = availableModels.length === 0
  const fallbackPickerValue =
    !noModels && availableModels[0]
      ? buildPickerValue(
          availableModels[0].providerId,
          availableModels[0].providerModelId,
        )
      : ''
  const defaultPickerValue = pickerValueFromRef(agent?.model ?? null, {
    availableModels,
    fallbackPickerValue,
  })
  const pickerValue = pickerOverride ?? defaultPickerValue
  const displayNameId = useId()
  const usernameId = useId()
  const systemPromptId = useId()
  const modelId = useId()
  const chattinessId = useId()

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')

    const ref: ModelRef | null = refFromPickerString(pickerValue, {
      availableModels,
      settingsDefault: null,
    })
    if (!ref) {
      // Either no model is selected, or availableModels hasn't resolved
      // yet. The Save button is disabled in the no-models case, so this
      // branch covers only the rare "submit before picker resolved" case.
      setError('Pick a model — the catalog may still be loading.')
      return
    }

    // When creating, an untouched/blank username triggers the repository's
    // derive-and-dedupe path. When editing we always send the current
    // value so explicit clears surface as a validation error.
    const usernameForCreate = !usernameTouched && !username ? undefined : username

    setBusy(true)
    try {
      const saved = isEditing
        ? await updateAgent(agent!.id, {
            displayName,
            username,
            model: ref,
            systemPrompt,
            chattiness,
          })
        : await createAgent({
            displayName,
            username: usernameForCreate,
            model: ref,
            systemPrompt,
            chattiness,
          })
      onSaved?.(saved)
      onClose()
    } catch (err) {
      if (err instanceof AgentValidationError) {
        setError(err.message)
      } else {
        setError(err instanceof Error ? err.message : 'Could not save agent.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="grid max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto]" onSubmit={submit}>
      <header className="flex items-start gap-3 border-b border-line bg-surface px-6 py-5 pr-12">
        <AgentDot agentId={agent?.id} displayName={displayName || 'New agent'} size="lg" />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-ink">
            {isEditing ? 'Edit agent' : 'Create agent'}
          </h2>
          <p className="text-small text-ink-muted">
            Agents are reusable across chats. They show up in the New chat
            picker as direct-message partners and can join channels.
          </p>
        </div>
      </header>

      <div className="grid gap-4 overflow-y-auto px-6 py-5">
        <div className="grid gap-1.5">
          <label
            className="font-mono text-meta font-semibold uppercase tracking-wider text-ink-muted"
            htmlFor={displayNameId}
          >
            Display name
          </label>
          <Input
            autoComplete="off"
            autoFocus={!isEditing}
            id={displayNameId}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="e.g. Senior Reviewer"
            required
            value={displayName}
          />
        </div>

        <div className="grid gap-1.5">
          <label
            className="font-mono text-meta font-semibold uppercase tracking-wider text-ink-muted"
            htmlFor={usernameId}
          >
            Username
          </label>
          <div className="flex items-center gap-2">
            <span aria-hidden className="font-mono text-body text-ink-dim">@</span>
            <Input
              autoComplete="off"
              className="flex-1"
              id={usernameId}
              onChange={(event) => {
                setUsernameTouched(true)
                setUsername(event.target.value)
              }}
              placeholder={
                !isEditing && displayName
                  ? suggestUsernameFromDisplayName(displayName)
                  : 'critic'
              }
              required={isEditing}
              spellCheck={false}
              value={username}
            />
          </div>
          <p className="text-small text-ink-muted">
            One-word handle used to @-mention the agent. Lowercase letters,
            digits, dashes, or underscores.
          </p>
        </div>

        <div className="grid gap-1.5">
          <label
            className="font-mono text-meta font-semibold uppercase tracking-wider text-ink-muted"
            htmlFor={modelId}
          >
            Model
          </label>
          {noModels ? (
            <p className="rounded-md border border-warn/40 bg-pin-bg px-3 py-2 text-small text-ink-muted">
              No models available — connect a provider in{' '}
              <span className="font-mono text-meta">Settings → Model providers</span>{' '}
              first.
            </p>
          ) : (
            <select
              className="h-11 w-full rounded-2xl border border-input bg-surface px-4 py-2 text-sm text-foreground outline-none focus-visible:ring-4 focus-visible:ring-ring"
              id={modelId}
              onChange={(event) => setPickerOverride(event.target.value)}
              value={pickerValue}
            >
              {availableModels.map((model) => {
                const value = buildPickerValue(model.providerId, model.providerModelId)
                const connection = connections.find((c) => c.id === model.providerId)
                const suffix = connection ? ` · ${connection.label}` : ''
                return (
                  <option key={value} value={value}>
                    {(model.name ?? model.providerModelId) + suffix}
                  </option>
                )
              })}
            </select>
          )}
        </div>

        <div className="grid gap-1.5">
          <label
            className="font-mono text-meta font-semibold uppercase tracking-wider text-ink-muted"
            htmlFor={systemPromptId}
          >
            System prompt
          </label>
          <Textarea
            className="min-h-40 rounded-md font-mono text-small leading-6"
            id={systemPromptId}
            onChange={(event) => setSystemPrompt(event.target.value)}
            placeholder="You are…"
            value={systemPrompt}
          />
          <p className="text-small text-ink-muted">
            Plain free-text. The agent uses this as its system message on
            every call. In channels, it also shapes the agent's decide-to-respond
            behavior.
          </p>
        </div>

        <div className="grid gap-1.5">
          <label
            className="font-mono text-meta font-semibold uppercase tracking-wider text-ink-muted"
            htmlFor={chattinessId}
          >
            Chattiness
          </label>
          <div className="flex items-center gap-3">
            <input
              className="flex-1 accent-accent"
              id={chattinessId}
              max={5}
              min={1}
              onChange={(event) =>
                setChattiness(Number(event.target.value) as ChattinessLevel)
              }
              step={1}
              type="range"
              value={chattiness}
            />
            <span className="w-24 font-mono text-meta uppercase tracking-wider text-ink">
              {chattinessLevels[chattiness].codename}
            </span>
          </div>
          <p className="text-small text-ink-muted">
            How readily this agent volunteers in channels when not directly
            addressed. Lower keeps the room quieter; higher pushes the agent
            to engage. Ignored in DMs and when mention-only.
          </p>
        </div>

        {error ? (
          <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-small text-danger">
            {error}
          </p>
        ) : null}
      </div>

      <footer className="flex justify-end gap-2 border-t border-line bg-surface px-6 py-4">
        <Button onClick={onClose} type="button" variant="ghost">
          Cancel
        </Button>
        <Button disabled={busy || noModels} type="submit">
          {isEditing ? 'Save' : 'Create agent'}
        </Button>
      </footer>
    </form>
  )
}
