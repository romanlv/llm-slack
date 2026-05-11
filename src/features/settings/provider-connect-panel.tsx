import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  createProvider,
  updateProvider,
} from '@/features/providers/providers-repository'
import type { ProviderConnection } from '@/features/providers/entities'
import { getAdapter } from '@/features/providers/registry'

import type { ProviderDefinition } from './provider-definitions'
import { AuthBadge, ProviderGlyph } from './provider-glyph'

// Single source of truth for the provider connection UI: shows the provider
// header, "where to get a key" instructions, and the paste-key form. Used by
// both AddProviderModal (master/detail picker, mode='add' → createProvider)
// and EditProviderModal (single provider, mode='edit' → updateProvider by id).
// The two consumers determine which path runs by passing `mode` + an existing
// provider id rather than the panel re-deriving it at submit time.
type AddPanelProps = {
  definition: ProviderDefinition
  initialKey?: string
  initialBaseUrl?: string
  initialLabel?: string
  initialModelId?: string
  mode: 'add'
  onBusyChange?: (busy: boolean) => void
  onCancel?: () => void
  onSaved: (provider: ProviderConnection) => void
}

type EditPanelProps = {
  definition: ProviderDefinition
  // When true, the panel disables Save — used by EditProviderModal when the
  // underlying connection was deleted in another tab.
  disabled?: boolean
  existingProviderId: string
  initialKey?: string
  initialBaseUrl?: string
  initialLabel?: string
  initialModelId?: string
  mode: 'edit'
  onBusyChange?: (busy: boolean) => void
  onCancel?: () => void
  onSaved: (provider: ProviderConnection) => void
}

type ProviderConnectPanelProps = AddPanelProps | EditPanelProps

export function ProviderConnectPanel(props: ProviderConnectPanelProps) {
  const {
    definition,
    initialKey = '',
    initialBaseUrl = '',
    initialLabel = '',
    initialModelId = '',
    mode,
    onBusyChange,
    onCancel,
    onSaved,
  } = props
  // In edit mode we deliberately do NOT prefill the existing API key into
  // the input — the placeholder shows it's already stored, and we only send
  // a new value if the user types one. This avoids leaking the stored key
  // via DOM inspection / autofill / clipboard side channels.
  const [apiKey, setApiKey] = useState(mode === 'edit' ? '' : initialKey)
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl)
  const [label, setLabel] = useState(initialLabel)
  const [modelId, setModelId] = useState(initialModelId)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const apiKeyRequired = getAdapter(definition.kind).requiresApiKey
  // Edit modal pre-fills nothing for the key; the placeholder masks the
  // existing one, and we only call updateProvider with apiKey when the user
  // actually types something new.
  const editApiKeyPrefilled = mode === 'edit' && Boolean(initialKey)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    onBusyChange?.(busy)
  }, [busy, onBusyChange])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedKey = apiKey.trim()
    const trimmedBaseUrl = baseUrl.trim()
    const trimmedLabel = label.trim()
    const trimmedModelId = modelId.trim()

    if (!trimmedKey && apiKeyRequired && !editApiKeyPrefilled) {
      setError('Paste a token or API key first.')
      return
    }
    if (definition.requiresBaseUrl && !trimmedBaseUrl) {
      setError('Enter the endpoint URL.')
      return
    }
    if (definition.requiresLabel && !trimmedLabel) {
      setError('Give this connection a name.')
      return
    }
    if (definition.requiresModelId && !trimmedModelId) {
      setError('Enter the model id your endpoint serves.')
      return
    }

    setBusy(true)
    setError('')
    try {
      const metadata = definition.requiresModelId
        ? { modelId: trimmedModelId }
        : undefined
      const saved =
        props.mode === 'edit'
          ? await updateProvider(props.existingProviderId, {
              ...(trimmedKey ? { apiKey: trimmedKey } : {}),
              ...(definition.requiresBaseUrl ? { baseUrl: trimmedBaseUrl } : {}),
              ...(definition.requiresLabel ? { label: trimmedLabel } : {}),
              ...(metadata ? { metadata } : {}),
            })
          : await createProvider({
              kind: definition.kind,
              apiKey: trimmedKey,
              ...(definition.requiresBaseUrl ? { baseUrl: trimmedBaseUrl } : {}),
              ...(definition.requiresLabel ? { label: trimmedLabel } : {}),
              ...(metadata ? { metadata } : {}),
            })
      if (!mountedRef.current) return
      if (saved) onSaved(saved)
    } catch (problem) {
      if (!mountedRef.current) return
      const message =
        problem instanceof Error ? problem.message : 'Could not save the key.'
      setError(message)
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  const submitLabel = mode === 'edit' ? 'Update' : 'Connect'
  const busyLabel = mode === 'edit' ? 'Saving…' : 'Connecting…'
  const pasteLabel = !apiKeyRequired
    ? 'Paste your API key (optional)'
    : definition.authMethods.length > 1
      ? 'Paste your OAuth token or API key'
      : 'Paste your API key'

  return (
    <div className="overflow-y-auto bg-pin-bg/40 px-6 py-6">
      <header className="flex items-start gap-3">
        <ProviderGlyph definition={definition} size={10} />
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-ink">{definition.name}</h3>
          <p className="text-small text-ink-muted">{definition.modalTagline}</p>
        </div>
      </header>

      <section className="mt-6 grid gap-2">
        <SectionLabel>Connection method</SectionLabel>
        <div className="flex items-start gap-3 rounded-md border border-line bg-surface px-3 py-2.5">
          <AuthBadge label={definition.authBadge} />
          <span className="text-small text-ink-muted">
            {definition.connectMethodSummary}
          </span>
        </div>
      </section>

      <section className="mt-6 grid gap-3">
        <SectionLabel>Where to get it</SectionLabel>
        {definition.authMethods.map((method) => (
          <div
            className="rounded-md border border-line bg-surface px-3 py-3"
            key={method.kind}
          >
            <div className="flex flex-wrap items-center gap-2">
              <AuthBadge label={method.badge} />
              {method.recommendedNote ? (
                <span className="inline-flex items-center rounded bg-send/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-send">
                  {method.recommendedNote}
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-small leading-6 text-ink">
              {method.description}
            </p>
            {method.steps && method.steps.length > 0 ? (
              <ol className="mt-3 ml-5 list-decimal space-y-1.5 text-small leading-6 text-ink">
                {method.steps.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ol>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <a
                className="inline-flex items-center gap-1 rounded-md border border-line bg-canvas px-2 py-1 font-mono text-meta text-accent underline"
                href={method.source.url}
                rel="noreferrer"
                target="_blank"
              >
                {method.source.label} <ExternalLink className="size-3.5" />
              </a>
              <span className="font-mono text-meta text-ink-muted">
                format: {method.format}
              </span>
            </div>
          </div>
        ))}
      </section>

      <form className="mt-6 grid gap-4" onSubmit={submit}>
        {definition.requiresLabel ? (
          <div className="grid gap-2">
            <SectionLabel>Connection name</SectionLabel>
            <Input
              autoComplete="off"
              autoFocus
              className="font-mono"
              name="label"
              onChange={(event) => setLabel(event.target.value)}
              placeholder={definition.requiresLabel.placeholder}
              spellCheck={false}
              type="text"
              value={label}
            />
            {definition.requiresLabel.helpText ? (
              <p className="text-meta text-ink-muted">{definition.requiresLabel.helpText}</p>
            ) : null}
          </div>
        ) : null}

        {definition.requiresBaseUrl ? (
          <div className="grid gap-2">
            <SectionLabel>Endpoint URL</SectionLabel>
            <Input
              autoComplete="off"
              autoFocus={!definition.requiresLabel}
              className="font-mono"
              name="baseUrl"
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={definition.requiresBaseUrl.placeholder}
              spellCheck={false}
              type="text"
              value={baseUrl}
            />
            {definition.requiresBaseUrl.helpText ? (
              <p className="text-meta text-ink-muted">{definition.requiresBaseUrl.helpText}</p>
            ) : null}
          </div>
        ) : null}

        {definition.requiresModelId ? (
          <div className="grid gap-2">
            <SectionLabel>Model</SectionLabel>
            <Input
              autoComplete="off"
              className="font-mono"
              name="modelId"
              onChange={(event) => setModelId(event.target.value)}
              placeholder={definition.requiresModelId.placeholder}
              spellCheck={false}
              type="text"
              value={modelId}
            />
            {definition.requiresModelId.helpText ? (
              <p className="text-meta text-ink-muted">{definition.requiresModelId.helpText}</p>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-2">
          <SectionLabel>{pasteLabel}</SectionLabel>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              autoComplete="off"
              autoFocus={!definition.requiresLabel && !definition.requiresBaseUrl}
              className="flex-1 min-w-[260px] font-mono"
              name="apiKey"
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={
                editApiKeyPrefilled ? '••••••••' : definition.apiKeyPlaceholder
              }
              spellCheck={false}
              type="password"
              value={apiKey}
            />
            <Button disabled={busy || (props.mode === 'edit' && props.disabled)} type="submit">
              {busy ? busyLabel : submitLabel}
            </Button>
            {onCancel ? (
              <Button onClick={onCancel} type="button" variant="ghost">
                Cancel
              </Button>
            ) : null}
          </div>
        </div>
        {error ? <p className="text-small text-danger">{error}</p> : null}
        {definition.connectFooter ? (
          <p className="text-meta text-ink-muted">{definition.connectFooter}</p>
        ) : null}
      </form>
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-meta font-semibold uppercase tracking-wider text-ink-muted">
      {children}
    </div>
  )
}
