import type { ProviderAdapter, CatalogEntry } from '@/features/providers/provider-contract'

const BUNDLED: CatalogEntry[] = [
  { providerModelId: 'gpt-4o', name: 'GPT-4o', contextLength: 128_000 },
  { providerModelId: 'gpt-4o-mini', name: 'GPT-4o mini', contextLength: 128_000 },
  { providerModelId: 'o1-mini', name: 'o1-mini', contextLength: 128_000 },
]

export const openaiAdapter: ProviderAdapter = {
  kind: 'openai',
  bundledCatalog: () => BUNDLED,
  streamChat: async () => {
    throw new Error(
      'OpenAI direct provider is not wired up yet. Use OpenRouter for now.',
    )
  },
}
