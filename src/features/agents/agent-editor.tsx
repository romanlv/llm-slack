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
import type { Agent } from '@/features/chat/domain'
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
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? '')
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
  const systemPromptId = useId()
  const modelId = useId()

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

    setBusy(true)
    try {
      const saved = isEditing
        ? await updateAgent(agent!.id, {
            displayName,
            model: ref,
            systemPrompt,
          })
        : await createAgent({
            displayName,
            model: ref,
            systemPrompt,
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
