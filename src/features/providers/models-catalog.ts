import { db } from '@/features/chat/database'
import type { ModelMetadata, ModelOverride, ProviderConnection } from '@/features/providers/entities'
import type { ModelRef, ProviderKind } from '@/features/providers/model-ref'
import { getAdapter } from '@/features/providers/registry'

export interface EffectiveModel extends ModelMetadata {
  providerId: string
  providerKind: ProviderKind
  providerModelId: string
  enabled: boolean
  isBundled: boolean
  isCustom: boolean
}

export interface ResolveForSendResult {
  connection: ProviderConnection
  model: EffectiveModel
  substituted: boolean
}

interface CatalogContext {
  providers: ProviderConnection[]
  overrides: ModelOverride[]
}

async function loadContext(): Promise<CatalogContext> {
  const [providers, overrides] = await Promise.all([
    db.providers.orderBy('createdAt').toArray(),
    db.modelOverrides.toArray(),
  ])
  return { providers, overrides }
}

function buildEffective(
  provider: ProviderConnection,
  overrides: ModelOverride[],
): EffectiveModel[] {
  const adapter = getAdapter(provider.kind)
  const bundled = adapter.bundledCatalog()
  const result: EffectiveModel[] = []
  const seen = new Set<string>()

  for (const entry of bundled) {
    seen.add(entry.providerModelId)
    const override = overrides.find((o) => o.providerModelId === entry.providerModelId)
    if (override && override.customMetadata === undefined && override.enabled === false) {
      // explicit hide
      continue
    }
    result.push({
      providerId: provider.id,
      providerKind: provider.kind,
      providerModelId: entry.providerModelId,
      enabled: override?.enabled ?? true,
      isBundled: true,
      isCustom: false,
      name: override?.customMetadata?.name ?? entry.name,
      description: override?.customMetadata?.description ?? entry.description,
      contextLength: override?.customMetadata?.contextLength ?? entry.contextLength,
      pricing: override?.customMetadata?.pricing ?? entry.pricing,
      modalities: override?.customMetadata?.modalities ?? entry.modalities,
    })
  }

  for (const override of overrides) {
    if (seen.has(override.providerModelId)) continue
    if (!override.customMetadata) continue
    result.push({
      providerId: provider.id,
      providerKind: provider.kind,
      providerModelId: override.providerModelId,
      enabled: override.enabled,
      isBundled: false,
      isCustom: true,
      name: override.customMetadata.name,
      description: override.customMetadata.description,
      contextLength: override.customMetadata.contextLength,
      pricing: override.customMetadata.pricing,
      modalities: override.customMetadata.modalities,
    })
  }

  return result
}

export async function listEffectiveForProvider(providerId: string): Promise<EffectiveModel[]> {
  const { providers, overrides } = await loadContext()
  const provider = providers.find((p) => p.id === providerId)
  if (!provider) return []
  const scoped = overrides.filter((o) => o.providerId === providerId)
  return buildEffective(provider, scoped)
}

export async function listEffectiveAll(): Promise<EffectiveModel[]> {
  const { providers, overrides } = await loadContext()
  return providers.flatMap((provider) =>
    buildEffective(
      provider,
      overrides.filter((o) => o.providerId === provider.id),
    ),
  )
}

export async function listEnabledModels(): Promise<EffectiveModel[]> {
  const all = await listEffectiveAll()
  return all.filter((model) => model.enabled)
}

export async function resolveModel(ref: ModelRef): Promise<EffectiveModel | null> {
  const all = await listEffectiveAll()
  return (
    all.find(
      (model) =>
        (ref.providerId ? model.providerId === ref.providerId : true) &&
        model.providerKind === ref.providerKind &&
        model.providerModelId === ref.providerModelId,
    ) ??
    all.find(
      (model) =>
        model.providerKind === ref.providerKind &&
        model.providerModelId === ref.providerModelId,
    ) ??
    null
  )
}

// resolveForSend walks the fallback chain documented in
// docs/providers-refactor.md and returns the connection + effective model the
// caller should actually use, plus a `substituted` flag so the UI can surface
// "switched model" notices when the snapshotted providerId no longer matches.
export async function resolveForSend(
  ref: ModelRef | null | undefined,
  options: { settingsDefault?: ModelRef | null } = {},
): Promise<ResolveForSendResult | null> {
  const { providers, overrides } = await loadContext()
  if (providers.length === 0) return null

  const synthEffective = (connection: ProviderConnection, candidate: ModelRef): EffectiveModel => ({
    providerId: connection.id,
    providerKind: connection.kind,
    providerModelId: candidate.providerModelId,
    enabled: true,
    isBundled: false,
    isCustom: true,
    name: candidate.providerModelId,
  })

  const isExplicitlyHidden = (providerId: string, providerModelId: string) =>
    overrides.some(
      (o) =>
        o.providerId === providerId &&
        o.providerModelId === providerModelId &&
        !o.customMetadata &&
        o.enabled === false,
    )

  const tryMatch = (candidate: ModelRef): ResolveForSendResult | null => {
    const provider = candidate.providerId
      ? providers.find((p) => p.id === candidate.providerId)
      : undefined

    if (provider && provider.kind === candidate.providerKind) {
      const effective = buildEffective(
        provider,
        overrides.filter((o) => o.providerId === provider.id),
      )
      const model =
        effective.find((entry) => entry.providerModelId === candidate.providerModelId) ??
        synthEffective(provider, candidate)
      return { connection: provider, model, substituted: false }
    }

    // Same-kind fallback: prefer settings.defaultModel.providerId when it's
    // one of the same-kind candidates, then any candidate whose catalog
    // includes the providerModelId.
    const sameKind = providers.filter((p) => p.kind === candidate.providerKind)
    const preferredId = options.settingsDefault?.providerId
    const sortedSameKind = [...sameKind].sort((a, b) => {
      if (preferredId && a.id === preferredId) return -1
      if (preferredId && b.id === preferredId) return 1
      return 0
    })

    for (const connection of sortedSameKind) {
      if (isExplicitlyHidden(connection.id, candidate.providerModelId)) continue
      const effective = buildEffective(
        connection,
        overrides.filter((o) => o.providerId === connection.id),
      )
      const model = effective.find(
        (entry) => entry.providerModelId === candidate.providerModelId,
      )
      if (model) {
        return { connection, model, substituted: true }
      }
    }

    // Single same-kind connection that hasn't explicitly hidden this model:
    // trust the snapshot for historical sends even when the model is not in
    // the effective catalog (e.g. a long-tail OpenRouter model the user
    // typed in before adding it as an override).
    if (sortedSameKind.length === 1) {
      const connection = sortedSameKind[0]
      if (!isExplicitlyHidden(connection.id, candidate.providerModelId)) {
        return {
          connection,
          model: synthEffective(connection, candidate),
          substituted: true,
        }
      }
    }

    return null
  }

  if (ref) {
    const hit = tryMatch(ref)
    if (hit) return hit
  }

  if (options.settingsDefault && (!ref || !modelRefsEqual(ref, options.settingsDefault))) {
    const hit = tryMatch(options.settingsDefault)
    if (hit) return { ...hit, substituted: true }
  }

  return null
}

function modelRefsEqual(a: ModelRef, b: ModelRef) {
  return (
    a.providerKind === b.providerKind &&
    a.providerModelId === b.providerModelId &&
    (a.providerId ?? null) === (b.providerId ?? null)
  )
}
