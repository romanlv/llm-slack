import { useId, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { channelDefaults } from '@/features/chat/defaults'
import {
  type ChainFollowupMode,
  type ChannelSettings,
} from '@/features/chat/domain'
import { getChannelSettings, setChannelSettings } from '@/features/chat/repository'

type FormState = {
  description: string
  systemPrompt: string
  maxChainedSubTurns: string
  chainFollowupMode: ChainFollowupMode
  maxMessagesPerAgentPerInput: string
  tokenBudgetPerInput: string
  allowAgentThreading: boolean
}

export type ChannelSettingsSection = 'general' | 'advanced'

function fromSettings(settings: ChannelSettings | undefined): FormState {
  const base = settings ?? {
    ...channelDefaults,
    id: '',
    createdAt: 0,
    updatedAt: 0,
  }
  return {
    description: base.description,
    systemPrompt: base.systemPrompt,
    maxChainedSubTurns: String(base.maxChainedSubTurns),
    chainFollowupMode: base.chainFollowupMode,
    maxMessagesPerAgentPerInput: String(base.maxMessagesPerAgentPerInput),
    tokenBudgetPerInput: String(base.tokenBudgetPerInput),
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

export function ChannelSettingsPanel({
  chatId,
  section = 'general',
}: {
  chatId: string
  section?: ChannelSettingsSection
}) {
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
  const descriptionId = useId()
  const systemPromptId = useId()
  const subTurnsId = useId()
  const followupModeId = useId()
  const perAgentId = useId()
  const tokenBudgetId = useId()
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
        description: form.description,
        systemPrompt: form.systemPrompt,
        maxChainedSubTurns: chained,
        chainFollowupMode: form.chainFollowupMode,
        maxMessagesPerAgentPerInput: perAgent,
        tokenBudgetPerInput: tokenBudget,
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
    <form className="grid gap-6" onSubmit={submit}>
      {section === 'general' ? (
        <div className="grid gap-4">
          <div>
            <h3 className="text-heading font-semibold text-ink">Topic & house rules</h3>
            <p className="mt-1 text-small text-ink-muted">
              Description is visible in the channel header and shared with
              agents as <code>&lt;description&gt;</code>. House rules are
              injected as <code>&lt;house_rules&gt;</code> on every channel
              turn.
            </p>
          </div>
          <div className="grid gap-1.5">
            <label
              className="font-mono text-meta font-semibold uppercase tracking-wider text-ink-muted"
              htmlFor={descriptionId}
            >
              Description
            </label>
            <Textarea
              id={descriptionId}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, description: event.target.value }))
              }
              placeholder="What is this room for?"
              rows={2}
              value={form.description}
            />
          </div>
          <div className="grid gap-1.5">
            <label
              className="font-mono text-meta font-semibold uppercase tracking-wider text-ink-muted"
              htmlFor={systemPromptId}
            >
              House rules (system prompt)
            </label>
            <Textarea
              id={systemPromptId}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, systemPrompt: event.target.value }))
              }
              placeholder="Norms, tone, and constraints that apply to every agent in the room."
              rows={6}
              value={form.systemPrompt}
            />
          </div>
        </div>
      ) : null}

      {section === 'advanced' ? (
        <div className="grid gap-4">
          <div>
            <h3 className="text-heading font-semibold text-ink">Behavior</h3>
            <p className="mt-1 text-small text-ink-muted">
              Safety caps and follow-up policy. Each cap stops the
              orchestrator with the matching stop reason; lower values
              keep channels chatty-but-bounded.
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
                  setForm((prev) => ({
                    ...prev,
                    maxChainedSubTurns: event.target.value,
                  }))
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
                  setForm((prev) => ({
                    ...prev,
                    tokenBudgetPerInput: event.target.value,
                  }))
                }
                value={form.tokenBudgetPerInput}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <label
              className="font-mono text-meta font-semibold uppercase tracking-wider text-ink-muted"
              htmlFor={followupModeId}
            >
              Follow-up chain mode
            </label>
            <select
              className="h-11 rounded-2xl border border-input bg-surface px-4 text-sm text-foreground outline-none focus-visible:ring-4 focus-visible:ring-ring"
              id={followupModeId}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  chainFollowupMode: event.target.value as ChainFollowupMode,
                }))
              }
              value={form.chainFollowupMode}
            >
              <option value="none">none — only one round of replies</option>
              <option value="mentions-only">
                mentions-only — agents follow up when @-mentioned
              </option>
              <option value="auto-decide">
                auto-decide — full decide-to-respond loop
              </option>
            </select>
            <p className="font-mono text-meta text-ink-muted">
              Whether an agent's reply may itself trigger more agents in
              the same turn.
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
      ) : null}

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
