import { describe, expect, it } from 'vitest'

import { db } from '@/features/chat/database'
import {
  getOverride,
  upsertOverride,
} from '@/features/providers/model-overrides-repository'
import { createProvider } from '@/features/providers/providers-repository'

async function seedProvider() {
  return createProvider({ kind: 'openrouter', label: 'OR', apiKey: 'k' })
}

describe('modelOverrides sparse-row rule', () => {
  it('drops a no-op enable on a bundled model and removes any pre-existing row', async () => {
    const provider = await seedProvider()
    await upsertOverride(
      { providerId: provider.id, providerModelId: 'bundled-id', enabled: false },
      { isBundled: true },
    )
    await expect(getOverride(provider.id, 'bundled-id')).resolves.toBeDefined()

    const result = await upsertOverride(
      { providerId: provider.id, providerModelId: 'bundled-id', enabled: true },
      { isBundled: true },
    )

    expect(result).toBeUndefined()
    await expect(getOverride(provider.id, 'bundled-id')).resolves.toBeUndefined()
  })

  it('keeps an explicit hide on a bundled model', async () => {
    const provider = await seedProvider()
    const row = await upsertOverride(
      { providerId: provider.id, providerModelId: 'bundled-id', enabled: false },
      { isBundled: true },
    )
    expect(row?.enabled).toBe(false)
    await expect(getOverride(provider.id, 'bundled-id')).resolves.toMatchObject({
      enabled: false,
      customMetadata: undefined,
    })
  })

  it('stores customMetadata for an added extra and preserves createdAt on update', async () => {
    const provider = await seedProvider()
    const first = await upsertOverride(
      {
        providerId: provider.id,
        providerModelId: 'custom-id',
        enabled: true,
        customMetadata: { name: 'My model', contextLength: 32_000 },
      },
      { isBundled: false },
    )
    expect(first?.createdAt).toBeGreaterThan(0)

    const second = await upsertOverride(
      {
        providerId: provider.id,
        providerModelId: 'custom-id',
        enabled: false,
        customMetadata: { name: 'My model', contextLength: 32_000 },
      },
      { isBundled: false },
    )

    expect(second?.id).toBe(first?.id)
    expect(second?.createdAt).toBe(first?.createdAt)
    expect(second?.enabled).toBe(false)
  })

  it('keeps a single row per (providerId, providerModelId)', async () => {
    const provider = await seedProvider()
    await upsertOverride(
      { providerId: provider.id, providerModelId: 'x', enabled: true, customMetadata: { name: 'X' } },
      { isBundled: false },
    )
    await upsertOverride(
      { providerId: provider.id, providerModelId: 'x', enabled: false, customMetadata: { name: 'X' } },
      { isBundled: false },
    )

    const rows = await db.modelOverrides.where('providerId').equals(provider.id).toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.enabled).toBe(false)
  })
})
