import { ChevronDown } from 'lucide-react'

import type { ProviderConnection } from '@/features/providers/entities'
import type { ProviderKind } from '@/features/providers/model-ref'
import type { EffectiveModel } from '@/features/providers/models-catalog'

import { buildPickerValue, parsePickerValue } from './model-picker-helpers'

function computeAmbiguousKinds(connections: ProviderConnection[]) {
  const seenKinds = new Set<ProviderKind>()
  const ambiguous = new Set<ProviderKind>()
  for (const connection of connections) {
    if (seenKinds.has(connection.kind)) ambiguous.add(connection.kind)
    seenKinds.add(connection.kind)
  }
  return ambiguous
}

export function MiniModelSelect({
  availableModels,
  connections,
  disabled,
  fallbackLabel,
  onChange,
  value,
}: {
  availableModels: EffectiveModel[]
  connections: ProviderConnection[]
  disabled?: boolean
  fallbackLabel: (providerModelId: string) => string
  onChange: (value: string) => void
  value: string
}) {
  const ambiguousKinds = computeAmbiguousKinds(connections)
  const labelByConnectionId = new Map(connections.map((c) => [c.id, c.label]))
  const inKnownList = availableModels.some(
    (model) => buildPickerValue(model.providerId, model.providerModelId) === value,
  )
  const effectiveDisabled = disabled || availableModels.length === 0

  const optionLabel = (model: EffectiveModel) => {
    const base = model.name ?? model.providerModelId
    if (!ambiguousKinds.has(model.providerKind)) return base
    const connectionLabel = labelByConnectionId.get(model.providerId)
    return connectionLabel ? `${base} · ${connectionLabel}` : base
  }

  const widthClass = ambiguousKinds.size > 0 ? 'max-w-64' : 'max-w-40'

  return (
    <label className="inline-flex h-[22px] min-w-0 max-w-full items-center gap-1 rounded-xs border border-line bg-surface-muted px-1.5 font-mono text-meta text-ink">
      <span className="leading-none text-accent">●</span>
      <select
        className={`min-w-0 ${widthClass} bg-transparent text-ink outline-none disabled:opacity-60`}
        disabled={effectiveDisabled}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {availableModels.length === 0 ? (
          <option value="">No models available</option>
        ) : null}
        {availableModels.map((model) => {
          const pickerValue = buildPickerValue(model.providerId, model.providerModelId)
          return (
            <option key={pickerValue} value={pickerValue}>
              {optionLabel(model)}
            </option>
          )
        })}
        {value && !inKnownList ? (
          <option value={value}>
            {fallbackLabel(parsePickerValue(value)?.providerModelId ?? value)}
          </option>
        ) : null}
      </select>
      <ChevronDown className="size-2.5 text-ink-dim" />
    </label>
  )
}
