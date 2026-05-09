export type OpenRouterModelOption = {
  id: string
  label: string
}

// Seeded from OpenRouter daily/weekly usage rankings checked on 2026-04-23.
export const OPENROUTER_TRENDING_MODELS: OpenRouterModelOption[] = [
  {
    id: 'moonshotai/kimi-k2.6',
    label: 'Kimi K2.6',
  },
  {
    id: 'anthropic/claude-sonnet-4.6',
    label: 'Claude Sonnet 4.6',
  },
  {
    id: 'deepseek/deepseek-v3.2',
    label: 'DeepSeek V3.2',
  },
  {
    id: 'anthropic/claude-opus-4.7',
    label: 'Claude Opus 4.7',
  },
  {
    id: 'google/gemini-3-flash-preview',
    label: 'Gemini 3 Flash Preview',
  },
  {
    id: 'minimax/minimax-m2.5',
    label: 'MiniMax M2.5',
  },
  {
    id: 'xiaomi/mimo-v2-pro',
    label: 'MiMo V2 Pro',
  },
  {
    id: 'minimax/minimax-m2.7',
    label: 'MiniMax M2.7',
  },
  {
    id: 'google/gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash Lite',
  },
  {
    id: 'x-ai/grok-4.1-fast',
    label: 'Grok 4.1 Fast',
  },
  {
    id: 'openrouter/elephant-alpha',
    label: 'Elephant Alpha',
  },
]

export const DEFAULT_OPENROUTER_MODEL = OPENROUTER_TRENDING_MODELS[0].id
