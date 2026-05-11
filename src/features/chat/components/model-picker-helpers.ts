import type { ModelRef } from '@/features/providers/model-ref'
import type { EffectiveModel } from '@/features/providers/models-catalog'

// Picker option value encodes the (providerId, providerModelId) pair so the
// select can distinguish between, e.g., "gpt-4o-mini on personal OpenAI" and
// "gpt-4o-mini on work OpenAI". Using ASCII unit separator (U+001F) — a
// non-printable control char guaranteed not to appear in UUIDs, model slugs
// (`llama3.1:70b`, `meta-llama/Llama-3.1-70B`), or any URL fragment.
const PICKER_KEY_SEPARATOR = '\x1f'

export function buildPickerValue(providerId: string, providerModelId: string) {
  return `${providerId}${PICKER_KEY_SEPARATOR}${providerModelId}`
}

export function parsePickerValue(
  value: string,
): { providerId: string; providerModelId: string } | null {
  const idx = value.indexOf(PICKER_KEY_SEPARATOR)
  if (idx < 0) return null
  return {
    providerId: value.slice(0, idx),
    providerModelId: value.slice(idx + PICKER_KEY_SEPARATOR.length),
  }
}

export function pickerValueFromRef(
  ref: ModelRef | null | undefined,
  options: {
    availableModels: EffectiveModel[]
    fallbackPickerValue: string
  },
): string {
  const { availableModels, fallbackPickerValue } = options
  if (!ref) return fallbackPickerValue
  if (ref.providerId) return buildPickerValue(ref.providerId, ref.providerModelId)
  const match = availableModels.find(
    (model) =>
      model.providerKind === ref.providerKind &&
      model.providerModelId === ref.providerModelId,
  )
  if (match) return buildPickerValue(match.providerId, match.providerModelId)
  return fallbackPickerValue
}

export function refFromPickerString(
  value: string,
  options: {
    availableModels: EffectiveModel[]
    settingsDefault: ModelRef | null | undefined
  },
): ModelRef | null {
  const { availableModels, settingsDefault } = options
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = parsePickerValue(trimmed)
  if (parsed) {
    const match = availableModels.find(
      (model) =>
        model.providerId === parsed.providerId &&
        model.providerModelId === parsed.providerModelId,
    )
    if (match) {
      return {
        providerId: match.providerId,
        providerKind: match.providerKind,
        providerModelId: match.providerModelId,
      }
    }
  }
  if (settingsDefault) {
    return {
      providerId: settingsDefault.providerId,
      providerKind: settingsDefault.providerKind,
      providerModelId: parsed?.providerModelId ?? trimmed,
    }
  }
  return null
}
