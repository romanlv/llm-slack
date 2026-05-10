export type ProviderKind = 'openrouter' | 'anthropic' | 'openai' | 'openai-compatible'

export const PROVIDER_KINDS: readonly ProviderKind[] = [
  'openrouter',
  'anthropic',
  'openai',
  'openai-compatible',
]

export interface ModelRef {
  providerId?: string
  providerKind: ProviderKind
  providerModelId: string
}

export function modelRefsEqual(a: ModelRef | null | undefined, b: ModelRef | null | undefined) {
  if (!a || !b) {
    return a === b
  }
  return (
    a.providerKind === b.providerKind &&
    a.providerModelId === b.providerModelId &&
    (a.providerId ?? null) === (b.providerId ?? null)
  )
}
