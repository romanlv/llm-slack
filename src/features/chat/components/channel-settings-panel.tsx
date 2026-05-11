import { useId, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DEFAULT_CHANNEL_SETTINGS,
  type ChannelSettings,
  type ParticipationMode,
} from '@/features/chat/domain'
import { getChannelSettings, setChannelSettings } from '@/features/chat/repository'

type FormState = {
  maxChainedSubTurns: string
  maxMessagesPerAgentPerInput: string
  tokenBudgetPerInput: string
  defaultParticipationMode: ParticipationMode
  allowAgentThreading: boolean
}

function fromSettings(settings: ChannelSettings | undefined): FormState {
  const base = settings ?? {
    ...DEFAULT_CHANNEL_SETTINGS,
    id: '',
    createdAt: 0,
    updatedAt: 0,
  }
  return {
    maxChainedSubTurns: String(base.maxChainedSubTurns),
    maxMessagesPerAgentPerInput: String(base.maxMessagesPerAgentPerInput),
    tokenBudgetPerInput: String(base.tokenBudgetPerInput),
    defaultParticipationMode: base.defaultParticipationMode,
    allowAgentThreading: base.allowAgentThreading,
  }
}

function parseNonNegativeInt(raw: string, fallback: number) {
  const trimmed = raw.trim()
  if (!trimmed) return fallback
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    return null
  }
  return parsed
}

export function ChannelSettingsPanel({ chatId }: { chatId: string }) {
  const settings = useLiveQuery(
    () => getChannelSettings(chatId),
    [chatId],
    undefined as ChannelSettings | undefined,
  )
  const [form, setForm] = useState<FormState>(() => fromSettings(undefined))
  // Fingerprint of the last settings snapshot we used to seed `form`.
  // Updating it during render (the React-recommended "store previous prop"
  // pattern) reseeds the form when settings load or change without
  // overwriting in-flight edits.
  const [seedFingerprint, setSeedFingerprint] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const settingsFingerprint = settings
    ? `${settings.id}:${settings.updatedAt}`
    : null
  if (settingsFingerprint && seedFingerprint !== settingsFingerprint) {
    setSeedFingerprint(settingsFingerprint)
    setForm(fromSettings(settings))
  }
  const subTurnsId = useId()
  const perAgentId = useId()
  const tokenBudgetId = useId()
  const defaultModeId = useId()
  const threadingId = useId()

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setStatusMessage('')

    const chained = parseNonNegativeInt(form.maxChainedSubTurns, 0)
    const perAgent = parseNonNegativeInt(form.maxMessagesPerAgentPerInput, 0)
    const tokenBudget = parseNonNegativeInt(form.tokenBudgetPerInput, 0)
    if (chained === null || perAgent === null || tokenBudget === null) {
      setError('Caps must be non-negative integers.')
      return
    }

    setBusy(true)
    try {
      await setChannelSettings(chatId, {
        maxChainedSubTurns: chained,
        maxMessagesPerAgentPerInput: perAgent,
        tokenBudgetPerInput: tokenBudget,
        defaultParticipationMode: form.defaultParticipationMode,
        allowAgentThreading: form.allowAgentThreading,
      })
      setStatusMessage('Saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save settings.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div>
        <h3 className="text-heading font-semibold text-ink">Behavior</h3>
        <p className="mt-1 text-small text-ink-muted">
          Safety caps and channel-wide defaults. Each cap stops the
          orchestrator with the matching stop reason; lower values keep
          channels chatty-but-bounded.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <label
            className="font-mono text-meta font-semibold uppercase tracking-wider text-ink-muted"
            htmlFor={subTurnsId}
          >
            Max chained sub-turns
          </label>
          <Input
            id={subTurnsId}
            inputMode="numeric"
            onChange={(event) =>
              setForm((prev) => ({ ...prev, maxChainedSubTurns: event.target.value }))
            }
            value={form.maxChainedSubTurns}
          />
        </div>
        <div className="grid gap-1.5">
          <label
            className="font-mono text-meta font-semibold uppercase tracking-wider text-ink-muted"
            htmlFor={perAgentId}
          >
            Max msgs per agent per input
          </label>
          <Input
            id={perAgentId}
            inputMode="numeric"
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                maxMessagesPerAgentPerInput: event.target.value,
              }))
            }
            value={form.maxMessagesPerAgentPerInput}
          />
        </div>
        <div className="grid gap-1.5">
          <label
            className="font-mono text-meta font-semibold uppercase tracking-wider text-ink-muted"
            htmlFor={tokenBudgetId}
          >
            Token budget per input
          </label>
          <Input
            id={tokenBudgetId}
            inputMode="numeric"
            onChange={(event) =>
              setForm((prev) => ({ ...prev, tokenBudgetPerInput: event.target.value }))
            }
            value={form.tokenBudgetPerInput}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label
            className="font-mono text-meta font-semibold uppercase tracking-wider text-ink-muted"
            htmlFor={defaultModeId}
          >
            Default participation mode
          </label>
          <select
            className="h-11 rounded-2xl border border-input bg-surface px-4 text-sm text-foreground outline-none focus-visible:ring-4 focus-visible:ring-ring"
            id={defaultModeId}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                defaultParticipationMode: event.target.value as ParticipationMode,
              }))
            }
            value={form.defaultParticipationMode}
          >
            <option value="auto-decide">auto-decide</option>
            <option value="mention-only">mention-only</option>
          </select>
          <p className="font-mono text-meta text-ink-muted">
            Applied to agents added without an explicit mode.
          </p>
        </div>
        <div className="grid gap-1.5">
          <label
            className="font-mono text-meta font-semibold uppercase tracking-wider text-ink-muted"
            htmlFor={threadingId}
          >
            Allow agent threading
          </label>
          <label className="flex items-center gap-2 text-small text-ink">
            <input
              checked={form.allowAgentThreading}
              className="size-4 rounded border-line"
              id={threadingId}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  allowAgentThreading: event.target.checked,
                }))
              }
              type="checkbox"
            />
            Agents may open threads on a triggering message
          </label>
          <p className="font-mono text-meta text-ink-muted">
            Off keeps every reply pinned to the main timeline.
          </p>
        </div>
      </div>

      {error ? (
        <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-small text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button disabled={busy} type="submit">
          Save settings
        </Button>
        {statusMessage ? (
          <span className="font-mono text-meta text-send" role="status">
            {statusMessage}
          </span>
        ) : null}
      </div>
    </form>
  )
}
