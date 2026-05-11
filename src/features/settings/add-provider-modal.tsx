import { useState } from 'react'
import { Plus } from 'lucide-react'

import { Dialog } from '@/components/ui/dialog'
import type { ProviderConnection } from '@/features/providers/entities'
import type { ProviderKind } from '@/features/providers/model-ref'
import { cn } from '@/lib/utils'

import {
  PROVIDER_DEFINITIONS,
  type ProviderDefinition,
} from './provider-definitions'
import { ProviderConnectPanel } from './provider-connect-panel'
import { AuthBadge, ProviderGlyph } from './provider-glyph'

type AddProviderModalProps = {
  onOpenChange: (open: boolean) => void
  open: boolean
}

export function AddProviderModal({ onOpenChange, open }: AddProviderModalProps) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      className="max-w-5xl"
      contentLabel="Add a provider"
      dismissible={!busy}
      onOpenChange={onOpenChange}
      open={open}
    >
      {open ? (
        <AddProviderModalBody
          onBusyChange={setBusy}
          onConnected={() => onOpenChange(false)}
        />
      ) : null}
    </Dialog>
  )
}

function AddProviderModalBody({
  onBusyChange,
  onConnected,
}: {
  onBusyChange?: (busy: boolean) => void
  onConnected: (provider: ProviderConnection) => void
}) {
  const choices = PROVIDER_DEFINITIONS
  const initialDefinition = choices[0]
  const [selectedKind, setSelectedKind] = useState<ProviderKind | undefined>(
    initialDefinition?.kind,
  )
  const selected = selectedKind
    ? choices.find((definition) => definition.kind === selectedKind) ?? initialDefinition
    : initialDefinition

  return (
    <>
      <header className="flex items-start gap-3 border-b border-line bg-surface px-6 py-5 pr-12">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-purple-500 text-white">
          <Plus className="size-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-ink">Add a provider</h2>
          <p className="text-small text-ink-muted">
            Pick a provider — we&rsquo;ll walk you through its connection method.
          </p>
        </div>
      </header>

      <div className="grid max-h-[78vh] grid-cols-[280px_minmax(0,1fr)] overflow-hidden">
        <ul className="overflow-y-auto border-r border-line bg-surface px-3 py-3">
          {choices.map((definition) => (
            <ProviderPickerItem
              active={definition.kind === selected?.kind}
              definition={definition}
              key={definition.kind}
              onSelect={() => setSelectedKind(definition.kind)}
            />
          ))}
        </ul>

        {selected ? (
          <ProviderConnectPanel
            definition={selected}
            key={selected.kind}
            mode="add"
            onBusyChange={onBusyChange}
            onSaved={onConnected}
          />
        ) : null}
      </div>
    </>
  )
}

function ProviderPickerItem({
  active,
  definition,
  onSelect,
}: {
  active: boolean
  definition: ProviderDefinition
  onSelect: () => void
}) {
  return (
    <li>
      <button
        className={cn(
          'group flex w-full gap-3 rounded-md px-3 py-3 text-left transition',
          active
            ? 'bg-purple-500/10 ring-1 ring-purple-500/30'
            : 'hover:bg-canvas/60',
        )}
        onClick={onSelect}
        type="button"
      >
        <ProviderGlyph definition={definition} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-body font-semibold text-ink">
              {definition.name}
            </span>
            <AuthBadge label={definition.authBadge} />
          </div>
          <p className="mt-0.5 line-clamp-2 text-small text-ink-muted">
            {definition.modalTagline}
          </p>
          <p className="mt-1 font-mono text-meta text-ink-muted">
            {definition.modelCount > 0 ? `${definition.modelCount} models` : 'Custom model'}
          </p>
        </div>
      </button>
    </li>
  )
}
