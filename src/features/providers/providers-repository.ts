import { db } from '@/features/chat/database'
import type { ProviderConnection } from '@/features/providers/entities'
import type { ModelRef, ProviderKind } from '@/features/providers/model-ref'
import { getAdapter } from '@/features/providers/registry'

export async function listProviders() {
  return db.providers.orderBy('createdAt').toArray()
}

export async function getProvider(id: string) {
  return db.providers.get(id)
}

export async function listProvidersByKind(kind: ProviderKind) {
  return db.providers.where('kind').equals(kind).sortBy('createdAt')
}

export async function getFirstProviderOfKind(kind: ProviderKind) {
  const matches = await listProvidersByKind(kind)
  return matches[0]
}

export interface ProviderInput {
  kind: ProviderKind
  label: string
  apiKey: string
  baseUrl?: string
  metadata?: Record<string, string>
}

export async function createProvider(input: ProviderInput) {
  const now = Date.now()
  const provider: ProviderConnection = {
    id: crypto.randomUUID(),
    kind: input.kind,
    label: input.label.trim() || defaultLabelForKind(input.kind),
    apiKey: input.apiKey,
    baseUrl: input.baseUrl?.trim() || undefined,
    metadata: input.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  }

  await db.providers.add(provider)
  return provider
}

export async function updateProvider(id: string, updates: Partial<ProviderInput>) {
  const patch: Partial<ProviderConnection> = { updatedAt: Date.now() }
  if (updates.kind !== undefined) patch.kind = updates.kind
  if (updates.label !== undefined) patch.label = updates.label.trim() || defaultLabelForKind(updates.kind ?? 'openrouter')
  if (updates.apiKey !== undefined) patch.apiKey = updates.apiKey
  if (updates.baseUrl !== undefined) patch.baseUrl = updates.baseUrl.trim() || undefined
  if (updates.metadata !== undefined) patch.metadata = updates.metadata
  await db.providers.update(id, patch)
  return db.providers.get(id)
}

// Upsert the seeded "first OpenRouter" provider used by the existing settings
// UI before the multi-provider redesign lands. Idempotent and keyed by kind +
// label so a user accidentally clicking save twice doesn't grow the list.
export async function upsertSingletonOpenRouter(input: {
  apiKey: string
  metadata?: Record<string, string>
}): Promise<ProviderConnection> {
  const existing = await getFirstProviderOfKind('openrouter')
  if (existing) {
    const updated = await updateProvider(existing.id, {
      apiKey: input.apiKey,
      metadata: input.metadata ?? existing.metadata,
    })
    return updated ?? existing
  }

  return createProvider({
    kind: 'openrouter',
    label: 'OpenRouter',
    apiKey: input.apiKey,
    metadata: input.metadata,
  })
}

// Removing a provider cascades to its modelOverrides and clears every
// ModelRef snapshot whose providerId matches it. The snapshot's
// providerKind/providerModelId stay so history remains renderable. The
// settings.defaultModel is repointed to another same-kind connection that
// also serves the same providerModelId; otherwise it is set to null so the
// UI can prompt for a new default.
export async function deleteProvider(id: string) {
  await db.transaction(
    'rw',
    [
      db.providers,
      db.modelOverrides,
      db.settings,
      db.parentChats,
      db.threads,
      db.messages,
    ],
    async () => {
      const target = await db.providers.get(id)
      if (!target) return

      await db.modelOverrides.where('providerId').equals(id).delete()

      const settings = await db.settings.get('app')
      if (settings?.defaultModel?.providerId === id) {
        const replacement = await pickReplacementProvider(
          id,
          target.kind,
          settings.defaultModel.providerModelId,
        )
        await db.settings.put({
          ...settings,
          defaultModel: replacement
            ? {
                providerId: replacement.id,
                providerKind: replacement.kind,
                providerModelId: settings.defaultModel.providerModelId,
              }
            : null,
        })
      }

      await rewriteSnapshotsClearingProvider(id)
      await db.providers.delete(id)
    },
  )
}

async function pickReplacementProvider(
  excludeId: string,
  kind: ProviderConnection['kind'],
  providerModelId: string,
): Promise<ProviderConnection | undefined> {
  const candidates = await db.providers
    .where('kind')
    .equals(kind)
    .filter((p) => p.id !== excludeId)
    .sortBy('createdAt')
  if (candidates.length === 0) return undefined

  // Prefer a candidate whose effective catalog (bundled list ± overrides)
  // would include the providerModelId, otherwise return the first same-kind
  // connection so the user still has something to point at.
  const overrides = await db.modelOverrides
    .where('providerId')
    .anyOf(candidates.map((c) => c.id))
    .toArray()

  const adapter = getAdapter(kind)
  const bundledIds = new Set(adapter.bundledCatalog().map((entry) => entry.providerModelId))

  for (const candidate of candidates) {
    const localOverrides = overrides.filter((o) => o.providerId === candidate.id)
    const hidden = localOverrides.some(
      (o) => o.providerModelId === providerModelId && !o.customMetadata && o.enabled === false,
    )
    if (hidden) continue
    const isBundled = bundledIds.has(providerModelId)
    const customAdd = localOverrides.some(
      (o) => o.providerModelId === providerModelId && o.customMetadata && o.enabled !== false,
    )
    if (isBundled || customAdd) return candidate
  }

  return candidates[0]
}

async function rewriteSnapshotsClearingProvider(providerId: string) {
  await db.parentChats
    .toCollection()
    .modify((chat) => {
      if (chat.model?.providerId === providerId) {
        chat.model = dropProviderId(chat.model)
      }
    })

  await db.threads
    .toCollection()
    .modify((thread) => {
      if (thread.model?.providerId === providerId) {
        thread.model = dropProviderId(thread.model)
      }
    })

  await db.messages
    .toCollection()
    .modify((message) => {
      if (message.model?.providerId === providerId) {
        message.model = dropProviderId(message.model)
      }
    })
}

function dropProviderId(ref: ModelRef): ModelRef {
  return {
    providerKind: ref.providerKind,
    providerModelId: ref.providerModelId,
  }
}

function defaultLabelForKind(kind: ProviderKind) {
  switch (kind) {
    case 'openrouter':
      return 'OpenRouter'
    case 'anthropic':
      return 'Anthropic'
    case 'openai':
      return 'OpenAI'
    case 'openai-compatible':
      return 'Custom endpoint'
  }
}
