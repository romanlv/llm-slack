import { describe, expect, it } from 'vitest'

import { db } from '@/features/chat/database'
import { openrouterAdapter } from '@/features/providers/adapters/openrouter'
import {
  listEffectiveForProvider,
  resolveForSend,
} from '@/features/providers/models-catalog'
import { upsertOverride } from '@/features/providers/model-overrides-repository'
import { createProvider } from '@/features/providers/providers-repository'

const BUNDLED_ID = openrouterAdapter.bundledCatalog()[0].providerModelId

async function seedOpenRouter(label: string, apiKey = 'key') {
  return createProvider({ kind: 'openrouter', label, apiKey })
}

describe('buildEffective merge', () => {
  it('returns the bundled list as enabled by default', async () => {
    const provider = await seedOpenRouter('OR')

    const effective = await listEffectiveForProvider(provider.id)
    const bundled = openrouterAdapter.bundledCatalog()

    expect(effective).toHaveLength(bundled.length)
    expect(effective.every((m) => m.enabled && m.isBundled)).toBe(true)
  })

  it('hides a bundled model when the override sets customMetadata undefined and enabled false', async () => {
    const provider = await seedOpenRouter('OR')
    await upsertOverride(
      { providerId: provider.id, providerModelId: BUNDLED_ID, enabled: false },
      { isBundled: true },
    )

    const effective = await listEffectiveForProvider(provider.id)
    expect(effective.some((m) => m.providerModelId === BUNDLED_ID)).toBe(false)
  })

  it('overlays customMetadata onto a bundled entry without changing its bundled flag', async () => {
    const provider = await seedOpenRouter('OR')
    await upsertOverride(
      {
        providerId: provider.id,
        providerModelId: BUNDLED_ID,
        enabled: true,
        customMetadata: { name: 'Renamed', contextLength: 999 },
      },
      { isBundled: true },
    )

    const effective = await listEffectiveForProvider(provider.id)
    const entry = effective.find((m) => m.providerModelId === BUNDLED_ID)
    expect(entry).toMatchObject({ name: 'Renamed', contextLength: 999, isBundled: true })
  })

  it('adds a non-bundled model as isCustom', async () => {
    const provider = await seedOpenRouter('OR')
    await upsertOverride(
      {
        providerId: provider.id,
        providerModelId: 'long/tail-model',
        enabled: true,
        customMetadata: { name: 'Long tail' },
      },
      { isBundled: false },
    )

    const effective = await listEffectiveForProvider(provider.id)
    const entry = effective.find((m) => m.providerModelId === 'long/tail-model')
    expect(entry).toMatchObject({ name: 'Long tail', isBundled: false, isCustom: true })
  })
})

describe('resolveForSend fallback chain', () => {
  it('returns the matching connection without substitution when the snapshot resolves directly', async () => {
    const provider = await seedOpenRouter('OR')

    const result = await resolveForSend({
      providerId: provider.id,
      providerKind: 'openrouter',
      providerModelId: BUNDLED_ID,
    })

    expect(result?.connection.id).toBe(provider.id)
    expect(result?.substituted).toBe(false)
  })

  it('falls back to a same-kind connection and marks the result as substituted', async () => {
    const a = await seedOpenRouter('A')
    const b = await seedOpenRouter('B')

    const result = await resolveForSend({
      providerId: 'missing',
      providerKind: 'openrouter',
      providerModelId: BUNDLED_ID,
    })

    expect(result?.connection.id === a.id || result?.connection.id === b.id).toBe(true)
    expect(result?.substituted).toBe(true)
  })

  it('prefers settings.defaultModel.providerId among same-kind candidates', async () => {
    const a = await seedOpenRouter('A')
    const b = await seedOpenRouter('B')

    const result = await resolveForSend(
      {
        providerKind: 'openrouter',
        providerModelId: BUNDLED_ID,
      },
      {
        settingsDefault: {
          providerId: b.id,
          providerKind: 'openrouter',
          providerModelId: BUNDLED_ID,
        },
      },
    )

    expect(result?.connection.id).toBe(b.id)
    // sanity: A is older
    expect(a.createdAt).toBeLessThanOrEqual(b.createdAt)
  })

  it('synthesizes a fallback entry for a single same-kind connection even when the model is missing from the catalog', async () => {
    const only = await seedOpenRouter('OR')

    const result = await resolveForSend({
      providerKind: 'openrouter',
      providerModelId: 'never-cataloged',
    })

    expect(result?.connection.id).toBe(only.id)
    expect(result?.model.providerModelId).toBe('never-cataloged')
  })

  it('does not synthesize a fallback when the user has explicitly hidden the model on the only connection', async () => {
    const only = await seedOpenRouter('OR')
    await upsertOverride(
      { providerId: only.id, providerModelId: 'hidden-id', enabled: false },
      { isBundled: false },
    )

    const result = await resolveForSend({
      providerKind: 'openrouter',
      providerModelId: 'hidden-id',
    })

    expect(result).toBeNull()
  })

  it('returns null when no connection exists', async () => {
    const result = await resolveForSend({
      providerKind: 'openrouter',
      providerModelId: BUNDLED_ID,
    })
    expect(result).toBeNull()
    await expect(db.providers.count()).resolves.toBe(0)
  })

  it('falls back to settings.defaultModel when the ref does not match anything', async () => {
    const provider = await seedOpenRouter('OR')

    const result = await resolveForSend(
      {
        providerKind: 'anthropic',
        providerModelId: 'claude-sonnet-4-6',
      },
      {
        settingsDefault: {
          providerId: provider.id,
          providerKind: 'openrouter',
          providerModelId: BUNDLED_ID,
        },
      },
    )

    expect(result?.connection.id).toBe(provider.id)
    expect(result?.substituted).toBe(true)
  })
})
