import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, Pencil } from 'lucide-react'

import { Dialog } from '@/components/ui/dialog'
import type { ProviderConnection } from '@/features/providers/entities'
import { getProvider } from '@/features/providers/providers-repository'

import type { ProviderDefinition } from './provider-definitions'
import { ProviderConnectPanel } from './provider-connect-panel'

// Edit modal reuses the same ProviderConnectPanel as the Add flow so the
// "where to get a key" instructions and form layout stay identical. The
// modal opens directly on the chosen provider — no master/detail picker —
// and pre-fills the existing key so the user can review or rotate it.
type EditProviderModalProps = {
  definition?: ProviderDefinition
  onOpenChange: (open: boolean) => void
  onSaved?: (provider: ProviderConnection) => void
  open: boolean
  provider?: ProviderConnection
}

export function EditProviderModal({
  definition,
  onOpenChange,
  onSaved,
  open,
  provider,
}: EditProviderModalProps) {
  const ready = open && Boolean(definition && provider)
  const [busy, setBusy] = useState(false)
  // Watch the live row separately from the snapshot prop. If it transitions
  // to null (deleted from another tab), surface an inline banner instead of
  // silently closing or saving against a missing id.
  const liveProvider = useLiveQuery(
    async () => (provider ? ((await getProvider(provider.id)) ?? null) : undefined),
    [provider?.id],
    undefined,
  )
  const deleted = ready && liveProvider === null

  return (
    <Dialog
      className="max-w-2xl"
      contentLabel="Edit provider key"
      dismissible={!busy}
      onOpenChange={onOpenChange}
      open={open}
    >
      {ready && definition && provider ? (
        <>
          <header className="flex items-start gap-3 border-b border-line bg-surface px-6 py-5 pr-12">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent">
              <Pencil className="size-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-ink">
                Update {definition.name} key
              </h2>
              <p className="text-small text-ink-muted">
                Replace the stored key — the previous one is overwritten in this
                browser.
              </p>
            </div>
          </header>

          {deleted ? (
            <div
              className="mx-6 mt-4 flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-small text-ink"
              role="alert"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
              <p>
                This connection was deleted in another tab. Close to dismiss.
              </p>
            </div>
          ) : null}

          <ProviderConnectPanel
            definition={definition}
            disabled={deleted}
            existingProviderId={provider.id}
            initialBaseUrl={provider.baseUrl}
            initialKey={provider.apiKey}
            initialLabel={provider.label}
            initialModelId={provider.metadata?.modelId}
            key={provider.id}
            mode="edit"
            onBusyChange={setBusy}
            onCancel={() => onOpenChange(false)}
            onSaved={(saved) => {
              onSaved?.(saved)
              onOpenChange(false)
            }}
          />
        </>
      ) : null}
    </Dialog>
  )
}
