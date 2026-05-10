import { useId, useState } from 'react'
import { Settings2 } from 'lucide-react'

import { Input } from '@/components/ui/input'
import {
  DEFAULT_OPENROUTER_MODEL,
  OPENROUTER_TRENDING_MODELS,
} from '@/features/providers/openrouter-models'
import { cn } from '@/lib/utils'

type ModelPickerProps = {
  className?: string
  description?: string
  label: string
  name?: string
  onValueChange?: (value: string) => void
  value?: string
  defaultValue?: string
}

export function ModelPicker({
  className,
  defaultValue = DEFAULT_OPENROUTER_MODEL,
  description,
  label,
  name,
  onValueChange,
  value,
}: ModelPickerProps) {
  const inputId = useId()
  const selectId = useId()
  const descriptionId = useId()
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue)
  const [editing, setEditing] = useState(false)
  const currentValue = value ?? uncontrolledValue
  const currentModel = OPENROUTER_TRENDING_MODELS.find(
    (model) => model.id === currentValue,
  )
  const selectedOption = OPENROUTER_TRENDING_MODELS.some(
    (model) => model.id === currentValue,
  )
    ? currentValue
    : 'custom'

  const updateValue = (nextValue: string) => {
    setUncontrolledValue(nextValue)
    onValueChange?.(nextValue)
  }

  return (
    <div className={cn('grid gap-2 text-sm font-medium text-foreground', className)}>
      <div className="flex items-center justify-between gap-3">
        <span>{label}</span>
        <button
          aria-expanded={editing}
          aria-controls={description ? descriptionId : undefined}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
          onClick={() => setEditing((value) => !value)}
          type="button"
        >
          <Settings2 className="size-3.5" />
          {editing ? 'Close' : 'Change'}
        </button>
      </div>
      <button
        className="flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-2xl border border-input bg-surface px-4 py-2 text-left text-sm font-normal text-foreground transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring"
        onClick={() => setEditing((value) => !value)}
        type="button"
      >
        <span className="min-w-0 truncate">{currentModel?.label ?? currentValue}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {currentModel ? currentModel.id : 'custom'}
        </span>
      </button>
      {editing ? (
        <div className="grid gap-2">
          <label className="sr-only" htmlFor={selectId}>
            Pick a ranked model
          </label>
          <select
            className="flex h-10 w-full rounded-2xl border border-input bg-surface px-3 py-2 text-sm font-normal text-foreground outline-none transition focus-visible:ring-4 focus-visible:ring-ring"
            id={selectId}
            onChange={(event) => {
              if (event.target.value !== 'custom') {
                updateValue(event.target.value)
              }
            }}
            value={selectedOption}
          >
            {OPENROUTER_TRENDING_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
            <option value="custom">Custom model slug</option>
          </select>
          <Input
            className="h-10 rounded-2xl px-3"
            id={inputId}
            name={name}
            onChange={(event) => updateValue(event.target.value)}
            placeholder={DEFAULT_OPENROUTER_MODEL}
            value={currentValue}
          />
          {description ? (
            <p
              className="text-xs font-normal leading-5 text-muted-foreground"
              id={descriptionId}
            >
              {description}
            </p>
          ) : null}
        </div>
      ) : name ? <input name={name} type="hidden" value={currentValue} /> : null}
    </div>
  )
}
