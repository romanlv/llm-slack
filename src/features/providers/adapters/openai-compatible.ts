import { createOpenAIChatCompletionsAdapter } from './openai-chat-completions'

// OpenAI-compatible adapter — runtime baseUrl from the connection. Used for
// local LLM servers (Ollama, llama.cpp), alternative gateways (Together,
// Groq, Fireworks), or any host that speaks the /v1/chat/completions
// protocol. No bundled catalog: the user defines models via the override
// flow (or a future runtime fetch from the endpoint's /v1/models). API key
// is optional so unauthenticated local endpoints work.
export const openaiCompatibleAdapter = createOpenAIChatCompletionsAdapter({
  kind: 'openai-compatible',
  bundled: [],
  usageTag: 'openai-compatible',
  requiresApiKey: false,
})
