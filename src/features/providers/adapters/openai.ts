import type { CatalogEntry } from '@/features/providers/provider-contract'

import { createOpenAIChatCompletionsAdapter } from './openai-chat-completions'

const BUNDLED: CatalogEntry[] = [
  { providerModelId: 'gpt-5.5-pro', name: 'GPT-5.5 Pro', contextLength: 1_000_000 },
  { providerModelId: 'gpt-5.5', name: 'GPT-5.5', contextLength: 1_000_000 },
  { providerModelId: 'gpt-5.4', name: 'GPT-5.4', contextLength: 1_000_000 },
  { providerModelId: 'gpt-5.4-mini', name: 'GPT-5.4 mini', contextLength: 400_000 },
  { providerModelId: 'gpt-5.4-nano', name: 'GPT-5.4 nano', contextLength: 400_000 },
]

export const openaiAdapter = createOpenAIChatCompletionsAdapter({
  kind: 'openai',
  defaultBaseUrl: 'https://api.openai.com/v1',
  bundled: BUNDLED,
  usageTag: 'openai',
  requiresApiKey: true,
})
