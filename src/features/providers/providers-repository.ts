import { db } from '@/features/chat/database'
import { abortAllStreams } from '@/features/chat/stream-controllers'
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
  // Optional. When omitted or empty, falls back to the kind's default name
  // and auto-suffixes " (2)", " (3)" etc. when a connection with that label
  // already exists. When non-empty, treated as an explicit user choice and
  // throws DuplicateLabelError on collision so the UI can surface the error.
  label?: string
  apiKey: string
  baseUrl?: string
  metadata?: Record<string, string>
}

export class DuplicateLabelError extends Error {
  constructor(label: string) {
    super(`A provider connection named "${label}" already exists.`)
    this.name = 'DuplicateLabelError'
  }
}

// Resolves the final label inside a Dexie rw transaction. Reading the
// existing rows and inserting the new one in the same transaction prevents
// two concurrent createProvider calls from both computing "OpenAI (2)" and
// both succeeding — Dexie serializes rw transactions on the same table.
async function resolveLabelInTx(
  desired: string | undefined,
  kind: ProviderKind,
  excludeId?: string,
): Promise<string> {
  const trimmed = desired?.trim() ?? ''
  const explicit = trimmed.length > 0
  const all = await db.providers.toArray()
  const used = new Set(
    all.filter((p) => p.id !== excludeId).map((p) => p.label),
  )

  if (explicit) {
    if (used.has(trimmed)) throw new DuplicateLabelError(trimmed)
    return trimmed
  }

  const base = defaultLabelForKind(kind)
  if (!used.has(base)) return base
  for (let n = 2; n < 10_000; n += 1) {
    const candidate = `${base} (${n})`
    if (!used.has(candidate)) return candidate
  }
  // Defensive ceiling: a user with 10k connections of the same kind is
  // already in trouble; fail loud rather than spin forever.
  throw new Error(`Could not allocate a unique label for kind "${kind}".`)
}

function normalizeBaseUrl(value: string | undefined) {
  return value?.trim().replace(/\/+$/, '') || undefined
}

export async function createProvider(input: ProviderInput) {
  return db.transaction('rw', db.providers, async () => {
    const label = await resolveLabelInTx(input.label, input.kind)
    const now = Date.now()
    const provider: ProviderConnection = {
      id: crypto.randomUUID(),
      kind: input.kind,
      label,
      apiKey: input.apiKey,
      baseUrl: normalizeBaseUrl(input.baseUrl),
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    }
    await db.providers.add(provider)
    return provider
  })
}

export async function updateProvider(id: string, updates: Partial<ProviderInput>) {
  return db.transaction('rw', db.providers, async () => {
    const existing = await db.providers.get(id)
    if (!existing) {
      throw new Error(`Cannot update provider: id ${id} not found`)
    }
    const patch: Partial<ProviderConnection> = { updatedAt: Date.now() }
    if (updates.kind !== undefined) patch.kind = updates.kind
    if (updates.label !== undefined) {
      patch.label = await resolveLabelInTx(
        updates.label,
        updates.kind ?? existing.kind,
        id,
      )
    }
    if (updates.apiKey !== undefined) patch.apiKey = updates.apiKey
    if (updates.baseUrl !== undefined) patch.baseUrl = normalizeBaseUrl(updates.baseUrl)
    if (updates.metadata !== undefined) {
      // Merge with existing metadata so callers can patch one field (e.g.
      // siteUrl) without dropping the rest of the bag.
      patch.metadata = { ...(existing.metadata ?? {}), ...updates.metadata }
    }
    await db.providers.update(id, patch)
    return db.providers.get(id)
  })
}

// Removing a provider cascades to its modelOverrides and clears every
// ModelRef snapshot whose providerId matches it. The snapshot's
// providerKind/providerModelId stay so history remains renderable. The
// settings.defaultModel is repointed to another same-kind connection that
// also serves the same providerModelId; otherwise it is set to null so the
// UI can prompt for a new default.
export async function deleteProvider(id: string) {
  // Aborting before the cascade prevents in-flight streams from racing the
  // delete (e.g. writing usage rows or snapshot updates against the
  // provider being removed). Streams keyed elsewhere are safe to abort —
  // their consumers can re-send.
  abortAllStreams()
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
