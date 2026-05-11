import { describe, expect, it } from 'vitest'

import type { ModelRef } from '@/features/providers/model-ref'
import type { EffectiveModel } from '@/features/providers/models-catalog'

import {
  buildPickerValue,
  parsePickerValue,
  pickerValueFromRef,
  refFromPickerString,
} from './model-picker-helpers'

function model(overrides: Partial<EffectiveModel>): EffectiveModel {
  return {
    providerId: 'conn-1',
    providerKind: 'openrouter',
    providerModelId: 'anthropic/claude-sonnet-4.6',
    enabled: true,
    isBundled: true,
    isCustom: false,
    name: 'Claude Sonnet',
    ...overrides,
  }
}

const FALLBACK = buildPickerValue('fallback-conn', 'fallback-model')

describe('picker key encoding', () => {
  it('round-trips through buildPickerValue / parsePickerValue', () => {
    const value = buildPickerValue('conn-1', 'anthropic/claude-sonnet-4.6')
    expect(parsePickerValue(value)).toEqual({
      providerId: 'conn-1',
      providerModelId: 'anthropic/claude-sonnet-4.6',
    })
  })

  it('tolerates model ids that contain colons or slashes', () => {
    // Ollama-style and vLLM-style ids historically tripped a plain-`:` split.
    const value = buildPickerValue('conn-1', 'llama3.1:70b')
    expect(parsePickerValue(value)?.providerModelId).toBe('llama3.1:70b')
  })

  it('returns null for legacy values without the separator', () => {
    expect(parsePickerValue('just-a-model-id')).toBeNull()
  })
})

describe('pickerValueFromRef', () => {
  const availableModels = [
    model({ providerId: 'conn-a', providerKind: 'openai', providerModelId: 'gpt-5' }),
    model({ providerId: 'conn-b', providerKind: 'openai', providerModelId: 'gpt-5' }),
  ]

  it('returns the fallback when ref is null', () => {
    expect(pickerValueFromRef(null, { availableModels, fallbackPickerValue: FALLBACK })).toBe(
      FALLBACK,
    )
  })

  it('encodes (providerId, providerModelId) when the ref names a connection', () => {
    const ref: ModelRef = {
      providerId: 'conn-b',
      providerKind: 'openai',
      providerModelId: 'gpt-5',
    }
    expect(
      pickerValueFromRef(ref, { availableModels, fallbackPickerValue: FALLBACK }),
    ).toBe(buildPickerValue('conn-b', 'gpt-5'))
  })

  it('maps a legacy ref without providerId onto the first matching same-kind connection', () => {
    const ref: ModelRef = { providerKind: 'openai', providerModelId: 'gpt-5' }
    expect(
      pickerValueFromRef(ref, { availableModels, fallbackPickerValue: FALLBACK }),
    ).toBe(buildPickerValue('conn-a', 'gpt-5'))
  })

  it('falls back when the legacy ref has no matching model', () => {
    const ref: ModelRef = { providerKind: 'anthropic', providerModelId: 'claude-x' }
    expect(
      pickerValueFromRef(ref, { availableModels, fallbackPickerValue: FALLBACK }),
    ).toBe(FALLBACK)
  })
})

describe('refFromPickerString', () => {
  const settingsDefault: ModelRef = {
    providerId: 'conn-default',
    providerKind: 'openrouter',
    providerModelId: 'anthropic/claude-sonnet-4.6',
  }
  const availableModels = [
    model({ providerId: 'conn-a', providerKind: 'openai', providerModelId: 'gpt-5' }),
  ]

  it('returns null for empty input', () => {
    expect(refFromPickerString('', { availableModels, settingsDefault })).toBeNull()
  })

  it('resolves a composite value to a full ModelRef', () => {
    const ref = refFromPickerString(buildPickerValue('conn-a', 'gpt-5'), {
      availableModels,
      settingsDefault,
    })
    expect(ref).toEqual({
      providerId: 'conn-a',
      providerKind: 'openai',
      providerModelId: 'gpt-5',
    })
  })

  it('falls back to settings.defaultModel for typed-in legacy ids', () => {
    const ref = refFromPickerString('some/long-tail-id', {
      availableModels,
      settingsDefault,
    })
    expect(ref).toEqual({
      providerId: 'conn-default',
      providerKind: 'openrouter',
      providerModelId: 'some/long-tail-id',
    })
  })

  it('returns null when neither a composite match nor a settings default is available', () => {
    expect(
      refFromPickerString('some/long-tail-id', {
        availableModels,
        settingsDefault: null,
      }),
    ).toBeNull()
  })
})
