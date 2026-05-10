import type { ProviderAdapter } from '@/features/providers/provider-contract'

export const openaiCompatibleAdapter: ProviderAdapter = {
  kind: 'openai-compatible',
  // No bundled models — users add custom URL models via the override flow.
  bundledCatalog: () => [],
  streamChat: async () => {
    throw new Error(
      'Custom OpenAI-compatible providers are not wired up yet. Use OpenRouter for now.',
    )
  },
}
