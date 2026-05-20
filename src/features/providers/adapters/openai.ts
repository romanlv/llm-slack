import type { CatalogEntry, ProviderAdapter } from '@/features/providers/provider-contract'

import { createOpenAIChatCompletionsAdapter } from './openai-chat-completions'
import { isCodexOAuthToken, streamCodexResponses } from './openai-codex-responses'

const BUNDLED: CatalogEntry[] = [
  { providerModelId: 'gpt-5.5-pro', name: 'GPT-5.5 Pro', contextLength: 1_000_000 },
  { providerModelId: 'gpt-5.5', name: 'GPT-5.5', contextLength: 1_000_000 },
  { providerModelId: 'gpt-5.4', name: 'GPT-5.4', contextLength: 1_000_000 },
  { providerModelId: 'gpt-5.4-mini', name: 'GPT-5.4 mini', contextLength: 400_000 },
  { providerModelId: 'gpt-5.4-nano', name: 'GPT-5.4 nano', contextLength: 400_000 },
]

// API-key requests go to api.openai.com/v1/chat/completions via the shared
// chat-completions adapter. JWT OAuth tokens (from `codex login`) are scoped
// to the Codex CLI client and are only accepted by chatgpt.com/backend-api,
// so we route them through the Responses-API codex backend instead.
const chatCompletions = createOpenAIChatCompletionsAdapter({
  kind: 'openai',
  defaultBaseUrl: 'https://api.openai.com/v1',
  bundled: BUNDLED,
  usageTag: 'openai',
  requiresApiKey: true,
})

// Forward kind / requiresApiKey / bundledCatalog from the inner adapter so
// there is exactly one source of truth — the wrapper only owns the routing
// decision between the two transports.
export const openaiAdapter: ProviderAdapter = {
  kind: chatCompletions.kind,
  requiresApiKey: chatCompletions.requiresApiKey,
  bundledCatalog: chatCompletions.bundledCatalog,
  streamChat: (connection, model, input) => {
    if (isCodexOAuthToken(connection.apiKey)) {
      return streamCodexResponses(connection, model, input)
    }
    return chatCompletions.streamChat(connection, model, input)
  },
}
