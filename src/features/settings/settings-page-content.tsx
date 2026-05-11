import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from '@tanstack/react-router'
import {
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  KeyRound,
  Plug,
  Plus,
  ShieldAlert,
  Trash2,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  deleteProvider,
  listProviders,
} from '@/features/providers/providers-repository'
import type { ProviderConnection } from '@/features/providers/entities'
import type { ProviderKind } from '@/features/providers/model-ref'
import { getAdapter } from '@/features/providers/registry'

import { AddProviderModal } from './add-provider-modal'
import { EditProviderModal } from './edit-provider-modal'
import {
  PROVIDER_DEFINITIONS,
  type ProviderDefinition,
} from './provider-definitions'
import { ProviderGlyph } from './provider-glyph'

function maskApiKey(apiKey: string) {
  const trimmed = apiKey.trim()
  if (!trimmed) return ''
  if (trimmed.length <= 12) return `${trimmed.slice(0, 3)}••••`
  return `${trimmed.slice(0, 8)}••••••••${trimmed.slice(-4)}`
}

function findDefinition(kind: ProviderKind): ProviderDefinition | undefined {
  return PROVIDER_DEFINITIONS.find((definition) => definition.kind === kind)
}

function ConnectionRow({
  connection,
  definition,
  onEdit,
}: {
  connection: ProviderConnection
  definition: ProviderDefinition
  onEdit: () => void
}) {
  const [revealed, setRevealed] = useState(false)
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)
  const apiKeyRequired = getAdapter(connection.kind).requiresApiKey
  const hasKey = Boolean(connection.apiKey.trim())
  // "Connected" means usable: either a key is present, or the adapter doesn't
  // require one (Ollama-style local endpoints). Drives both the badge and
  // whether to render the API key reveal row.
  const connected = hasKey || !apiKeyRequired

  return (
    <article className="overflow-hidden rounded-md border border-line bg-surface">
      <header className="flex flex-wrap items-center gap-3 px-4 py-3">
        <ProviderGlyph definition={definition} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-body font-semibold text-ink">{connection.label}</h3>
            {connected ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-send-soft px-2 py-0.5 font-mono text-meta font-semibold text-send">
                <CheckCircle2 className="size-3" /> Connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-canvas px-2 py-0.5 font-mono text-meta font-semibold text-ink-muted">
                <Plug className="size-3" /> Needs key
              </span>
            )}
          </div>
          <p className="mt-0.5 text-small text-ink-muted">
            <span className="font-mono text-meta uppercase tracking-wider">
              {definition.name}
            </span>{' '}
            · {definition.tagline}
          </p>
        </div>
        <a
          className="hidden items-center gap-1 font-mono text-meta text-accent underline md:inline-flex"
          href={definition.siteUrl}
          rel="noreferrer"
          target="_blank"
        >
          {definition.site} <ExternalLink className="size-3.5" />
        </a>
        <div className="flex flex-wrap items-center gap-2">
          {definition.detailRoute ? (
            <Link
              className="inline-flex items-center gap-1 rounded-md border border-line bg-canvas px-3 py-1.5 font-mono text-meta font-semibold text-ink transition hover:bg-canvas/60"
              to={definition.detailRoute}
            >
              Manage models <ChevronRight className="size-3.5" />
            </Link>
          ) : null}
          <Button onClick={onEdit} size="sm" variant="outline">
            Edit
          </Button>
          <Button
            onClick={() => setConfirmingDisconnect(true)}
            size="sm"
            variant="ghost"
          >
            <Trash2 className="size-3.5 text-danger" />
            <span className="text-danger">Disconnect</span>
          </Button>
        </div>
      </header>

      <ConfirmDialog
        body={
          <>
            Removes the saved credentials from this browser. Chats that used
            this connection keep their history but will need a replacement
            provider to send new messages.
          </>
        }
        confirmLabel="Disconnect"
        destructive
        onCancel={() => setConfirmingDisconnect(false)}
        onConfirm={async () => {
          setConfirmingDisconnect(false)
          await deleteProvider(connection.id)
        }}
        open={confirmingDisconnect}
        title={`Disconnect "${connection.label}"?`}
      />

      {hasKey ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-canvas/40 px-4 py-2 text-small">
          <KeyRound className="size-3.5 text-ink-muted" />
          <span className="font-mono text-meta uppercase tracking-wider text-ink-muted">
            API key
          </span>
          <code className="rounded border border-line bg-surface px-2 py-0.5 font-mono text-meta text-ink">
            {revealed ? connection.apiKey : maskApiKey(connection.apiKey)}
          </code>
          <button
            className="font-mono text-meta text-accent underline"
            onClick={() => setRevealed((value) => !value)}
            type="button"
          >
            {revealed ? 'Hide' : 'Reveal'}
          </button>
        </div>
      ) : connection.baseUrl ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-canvas/40 px-4 py-2 text-small">
          <KeyRound className="size-3.5 text-ink-muted" />
          <span className="font-mono text-meta uppercase tracking-wider text-ink-muted">
            Endpoint
          </span>
          <code className="rounded border border-line bg-surface px-2 py-0.5 font-mono text-meta text-ink">
            {connection.baseUrl}
          </code>
        </div>
      ) : null}
    </article>
  )
}

// Defensive row for connections whose kind isn't in PROVIDER_DEFINITIONS —
// e.g. a kind removed from the codebase but still present in IndexedDB.
// Without this, those rows would be invisible and the user could not delete
// them from the UI.
function UnknownConnectionRow({ connection }: { connection: ProviderConnection }) {
  const [confirming, setConfirming] = useState(false)
  return (
    <article className="overflow-hidden rounded-md border border-warn/40 bg-surface">
      <header className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-warn/15 font-mono text-meta font-semibold text-warn">
          ?
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-body font-semibold text-ink">{connection.label}</h3>
          <p className="mt-0.5 text-small text-ink-muted">
            <span className="font-mono text-meta uppercase tracking-wider">
              {connection.kind}
            </span>{' '}
            · Unknown provider type. This connection is no longer usable.
          </p>
        </div>
        <Button onClick={() => setConfirming(true)} size="sm" variant="ghost">
          <Trash2 className="size-3.5 text-danger" />
          <span className="text-danger">Disconnect</span>
        </Button>
      </header>
      <ConfirmDialog
        body={
          <>
            This provider type is no longer supported by this app. Removing
            the connection clears its credentials and frees its label.
          </>
        }
        confirmLabel="Remove"
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          setConfirming(false)
          await deleteProvider(connection.id)
        }}
        open={confirming}
        title={`Remove "${connection.label}"?`}
      />
    </article>
  )
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="grid gap-3 rounded-md border border-dashed border-line bg-surface/60 px-6 py-10 text-center">
      <Plug className="mx-auto size-8 text-ink-muted" />
      <div>
        <p className="text-body font-semibold text-ink">No providers connected</p>
        <p className="mt-1 text-small text-ink-muted">
          Add a provider to start chatting. Keys stay on this device.
        </p>
      </div>
      <div>
        <Button onClick={onAdd} size="sm">
          <Plus className="size-4" />
          Add provider
        </Button>
      </div>
    </div>
  )
}

export function SettingsPageContent() {
  const connections = useLiveQuery(
    () => listProviders(),
    [],
    [] as ProviderConnection[],
  )
  const [addModalOpen, setAddModalOpen] = useState(false)
  // Snapshot the connection at open time. Re-deriving from the live query
  // would silently unmount the modal if another tab deletes the row mid-edit;
  // instead we hold the snapshot and let the modal show a deleted banner.
  const [editingSnapshot, setEditingSnapshot] = useState<ProviderConnection | undefined>(
    undefined,
  )
  const editingDefinition = editingSnapshot
    ? findDefinition(editingSnapshot.kind)
    : undefined

  return (
    <div className="p-6 md:p-10">
      <CardHeader className="px-0 pt-0">
        <Badge>Settings</Badge>
        <CardTitle className="text-3xl">Model providers</CardTitle>
        <CardDescription className="max-w-3xl text-base">
          Bring your own keys, your own bill. Connect one or more providers — keys stay on
          this device and are sent directly from the browser.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-6 px-0 pb-0">
        <section className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-baseline gap-2">
              <h3 className="text-heading font-semibold text-ink">Connections</h3>
              <span className="font-mono text-meta text-ink-muted">
                {connections.length}{' '}
                {connections.length === 1 ? 'connection' : 'connections'}
              </span>
            </div>
            <Button onClick={() => setAddModalOpen(true)} size="sm">
              <Plus className="size-4" />
              Add provider
            </Button>
          </div>

          {connections.length === 0 ? (
            <EmptyState onAdd={() => setAddModalOpen(true)} />
          ) : (
            <div className="grid gap-3">
              {connections.map((connection) => {
                const definition = findDefinition(connection.kind)
                if (!definition) {
                  return (
                    <UnknownConnectionRow
                      connection={connection}
                      key={connection.id}
                    />
                  )
                }
                return (
                  <ConnectionRow
                    connection={connection}
                    definition={definition}
                    key={connection.id}
                    onEdit={() => setEditingSnapshot(connection)}
                  />
                )
              })}
            </div>
          )}
        </section>

        <div className="rounded-md border border-warn/30 bg-pin-bg p-5 text-small leading-6 text-ink-muted">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warn" />
            <div>
              <p className="font-semibold text-ink">Browser-only security tradeoff</p>
              <p className="mt-1">
                Anyone with local access to this browser profile can read the saved keys.
                Fine for local testing; not for shared or production credentials.
              </p>
            </div>
          </div>
        </div>
      </CardContent>

      <AddProviderModal
        onOpenChange={setAddModalOpen}
        open={addModalOpen}
      />
      <EditProviderModal
        definition={editingDefinition}
        onOpenChange={(open) => {
          if (!open) setEditingSnapshot(undefined)
        }}
        open={Boolean(editingSnapshot && editingDefinition)}
        provider={editingSnapshot}
      />
    </div>
  )
}
