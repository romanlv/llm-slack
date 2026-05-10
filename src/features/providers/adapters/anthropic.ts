import type { ProviderAdapter, CatalogEntry } from '@/features/providers/provider-contract'

const BUNDLED: CatalogEntry[] = [
  {
    providerModelId: 'claude-opus-4-7',
    name: 'Claude Opus 4.7',
    contextLength: 200_000,
  },
  {
    providerModelId: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    contextLength: 200_000,
  },
  {
    providerModelId: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    contextLength: 200_000,
  },
]

export const anthropicAdapter: ProviderAdapter = {
  kind: 'anthropic',
  bundledCatalog: () => BUNDLED,
  streamChat: async () => {
    throw new Error(
      'Anthropic direct provider is not wired up yet. Use OpenRouter for now.',
    )
  },
}
