import { db } from '@/features/chat/database'
import type { ModelMetadata, ModelOverride } from '@/features/providers/entities'

export async function listOverrides() {
  return db.modelOverrides.toArray()
}

export async function listOverridesForProvider(providerId: string) {
  return db.modelOverrides.where('providerId').equals(providerId).toArray()
}

export async function getOverride(providerId: string, providerModelId: string) {
  return db.modelOverrides
    .where('[providerId+providerModelId]')
    .equals([providerId, providerModelId])
    .first()
}

export interface OverrideInput {
  providerId: string
  providerModelId: string
  enabled: boolean
  customMetadata?: ModelMetadata
}

// Sparse-write rule: if the resulting row would be a no-op deviation (enabled
// + no customMetadata for a bundled model), delete instead of storing it. The
// caller decides whether the model is bundled via the `isBundled` flag.
export async function upsertOverride(input: OverrideInput, options: { isBundled: boolean }) {
  const existing = await getOverride(input.providerId, input.providerModelId)
  const wouldBeNoOp = options.isBundled && input.enabled && !input.customMetadata

  if (wouldBeNoOp) {
    if (existing) {
      await db.modelOverrides.delete(existing.id)
    }
    return undefined
  }

  const now = Date.now()
  if (existing) {
    const next: ModelOverride = {
      ...existing,
      enabled: input.enabled,
      customMetadata: input.customMetadata,
      updatedAt: now,
    }
    await db.modelOverrides.put(next)
    return next
  }

  const created: ModelOverride = {
    id: crypto.randomUUID(),
    providerId: input.providerId,
    providerModelId: input.providerModelId,
    enabled: input.enabled,
    customMetadata: input.customMetadata,
    createdAt: now,
    updatedAt: now,
  }

  await db.modelOverrides.add(created)
  return created
}

export async function deleteOverride(providerId: string, providerModelId: string) {
  const existing = await getOverride(providerId, providerModelId)
  if (existing) {
    await db.modelOverrides.delete(existing.id)
  }
}
