import { anthropicAdapter } from '@/features/providers/adapters/anthropic'
import { openaiAdapter } from '@/features/providers/adapters/openai'
import { openaiCompatibleAdapter } from '@/features/providers/adapters/openai-compatible'
import { openrouterAdapter } from '@/features/providers/adapters/openrouter'
import type { ProviderKind } from '@/features/providers/model-ref'
import type { ProviderAdapter } from '@/features/providers/provider-contract'

const REGISTRY: Record<ProviderKind, ProviderAdapter> = {
  openrouter: openrouterAdapter,
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  'openai-compatible': openaiCompatibleAdapter,
}

export function getAdapter(kind: ProviderKind): ProviderAdapter {
  const adapter = REGISTRY[kind]
  if (!adapter) {
    throw new Error(
      `No provider adapter registered for kind "${kind}". Check src/features/providers/registry.ts.`,
    )
  }
  return adapter
}

