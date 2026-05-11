import { anthropicAdapter } from '@/features/providers/adapters/anthropic'
import { openaiAdapter } from '@/features/providers/adapters/openai'
import { openaiCompatibleAdapter } from '@/features/providers/adapters/openai-compatible'
import { openrouterAdapter } from '@/features/providers/adapters/openrouter'
import type { ProviderKind } from '@/features/providers/model-ref'

export type AuthMethodKind = 'oauth' | 'apikey'

// One AuthMethod per "way to get a key" — rendered as a card in the connect
// panel. Recommended methods carry a callout label (e.g. "USES YOUR PLAN").
// Use `steps` for providers whose setup needs multiple precise actions
// (e.g. Anthropic's mandatory org-level CORS toggle); otherwise leave it
// empty and let `description` carry a one-sentence summary.
export type AuthMethod = {
  kind: AuthMethodKind
  badge: string
  recommended?: boolean
  recommendedNote?: string
  description: string
  source: { label: string; url: string }
  format: string
  steps?: string[]
}

// Custom-field descriptors describe extra inputs the connect form needs to
// collect for definitions that are parameterized at connection time. First-
// party providers (OpenAI/Anthropic/OpenRouter) leave these undefined and the
// form just collects the API key. Custom definitions (OpenAI-compatible
// endpoints, future Ollama) declare requiresBaseUrl + requiresLabel so each
// connection can name its host.
export type ProviderDefinition = {
  kind: ProviderKind
  name: string
  tagline: string
  modalTagline: string
  glyph: string
  glyphBg: string
  glyphFg: string
  site: string
  siteUrl: string
  authBadge: 'API KEY' | 'OAUTH' | 'OAUTH OR API KEY'
  apiKeyPlaceholder: string
  modelCount: number
  detailRoute?: string
  authMethods: AuthMethod[]
  connectMethodSummary: string
  connectFooter?: string
  requiresBaseUrl?: { placeholder: string; helpText?: string }
  requiresLabel?: { placeholder: string; helpText?: string }
  // For definitions with no bundled catalog, the form collects a single
  // model id from the user and the catalog synthesizes one EffectiveModel
  // per connection named "${label} model". Today only openai-compatible
  // sets this; a future runtime /v1/models fetch can replace it.
  requiresModelId?: { placeholder: string; helpText?: string }
}

export const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  {
    kind: 'openrouter',
    name: 'OpenRouter',
    tagline: 'Unified gateway to many model labs — one key, many models.',
    modalTagline: 'Unified gateway to 200+ models from every major lab',
    glyph: 'OR',
    glyphBg: 'bg-zinc-900',
    glyphFg: 'text-white',
    site: 'openrouter.ai',
    siteUrl: 'https://openrouter.ai',
    authBadge: 'API KEY',
    apiKeyPlaceholder: 'sk-or-v1-…',
    modelCount: openrouterAdapter.bundledCatalog().length,
    detailRoute: '/settings/models',
    connectMethodSummary: 'Single API key, billed per-token through OpenRouter.',
    authMethods: [
      {
        kind: 'apikey',
        badge: 'API KEY',
        description:
          'Create a key at openrouter.ai scoped to chat completions. Billed per-token through your OpenRouter balance.',
        source: { label: 'openrouter.ai/keys', url: 'https://openrouter.ai/keys' },
        format: 'sk-or-v1-…',
      },
    ],
  },
  {
    kind: 'openai',
    name: 'OpenAI',
    tagline: 'Direct OpenAI API — Codex, GPT-5, o-series models.',
    modalTagline: 'Use your existing ChatGPT plan — Codex + GPT models',
    glyph: 'AI',
    glyphBg: 'bg-emerald-600',
    glyphFg: 'text-white',
    site: 'platform.openai.com',
    siteUrl: 'https://platform.openai.com/api-keys',
    authBadge: 'OAUTH OR API KEY',
    apiKeyPlaceholder: 'sk-proj-…  or  Bearer eyJ…',
    modelCount: openaiAdapter.bundledCatalog().length,
    connectMethodSummary: 'Two ways to authenticate — we auto-detect by prefix.',
    connectFooter:
      'We send the value as a Bearer token to api.openai.com. OAuth tokens rotate on their own; project keys do not.',
    authMethods: [
      {
        kind: 'oauth',
        badge: 'OAUTH',
        recommended: true,
        recommendedNote: 'RECOMMENDED — USES YOUR PLAN',
        description:
          'Uses your ChatGPT Plus / Pro plan — no extra billing. Install the Codex CLI and run `codex login`. Copy the `access_token` from `~/.codex/auth.json`.',
        source: {
          label: 'codex CLI',
          url: 'https://platform.openai.com/docs/codex',
        },
        format: 'Bearer eyJ…',
      },
      {
        kind: 'apikey',
        badge: 'API KEY',
        description:
          'Billed per-token from your platform balance — separate from any ChatGPT plan.',
        source: {
          label: 'platform.openai.com/api-keys',
          url: 'https://platform.openai.com/api-keys',
        },
        format: 'sk-proj-…',
      },
    ],
  },
  {
    // API-key-only for now. OAuth tokens (sk-ant-oat…) cannot be used from a
    // browser regardless of org settings, and API keys still require the
    // org-level CORS opt-in described in the setup steps. Once the proxy in
    // docs/tasks.md ships, we'll re-enable OAuth and drop the CORS step.
    kind: 'anthropic',
    name: 'Claude (Anthropic)',
    tagline: 'Direct Anthropic API — bring your own console API key.',
    modalTagline: 'Direct Anthropic API — billed from your console balance',
    glyph: 'C',
    glyphBg: 'bg-orange-500',
    glyphFg: 'text-white',
    site: 'console.anthropic.com',
    siteUrl: 'https://console.anthropic.com/settings/keys',
    authBadge: 'API KEY',
    apiKeyPlaceholder: 'sk-ant-api03-…',
    modelCount: anthropicAdapter.bundledCatalog().length,
    connectMethodSummary:
      'API key only. OAuth tokens (sk-ant-oat…) need a server-side proxy — not shipped yet.',
    connectFooter:
      'Heads up: without the org-level CORS opt-in (step 2), every request will fail with a CORS error from api.anthropic.com.',
    authMethods: [
      {
        kind: 'apikey',
        badge: 'API KEY',
        description:
          'Billed per-token from your Anthropic console balance. The key stays in this browser and is sent directly to api.anthropic.com as the x-api-key header.',
        source: {
          label: 'console.anthropic.com/settings/keys',
          url: 'https://console.anthropic.com/settings/keys',
        },
        format: 'sk-ant-api03-…',
        steps: [
          'Open console.anthropic.com → Settings → API keys → "Create Key" and copy the value (starts with `sk-ant-api03-`).',
          'In the same console, open Settings → Organization (or Privacy) and enable "Allow CORS requests from a browser" / "Browser API access". Without this, the browser blocks every call with a CORS error.',
          'Paste the key below. It stays on this device — we never send it anywhere except api.anthropic.com.',
        ],
      },
    ],
  },
  {
    kind: 'openai-compatible',
    name: 'OpenAI-compatible endpoint',
    tagline: 'Any /v1/chat/completions endpoint — local LLMs, alternative gateways.',
    modalTagline: 'Bring your own OpenAI-compatible host (Ollama, vLLM, Together, Groq, …)',
    glyph: '⇄',
    glyphBg: 'bg-zinc-700',
    glyphFg: 'text-white',
    site: 'custom endpoint',
    siteUrl: 'https://platform.openai.com/docs/api-reference/chat',
    authBadge: 'API KEY',
    apiKeyPlaceholder: 'leave blank for local endpoints',
    requiresBaseUrl: {
      placeholder: 'http://localhost:11434/v1',
      helpText:
        'Root URL up to (and including) /v1. We append /chat/completions when sending.',
    },
    requiresLabel: {
      placeholder: 'Ollama (laptop)',
      helpText: 'Shows up in the model picker — pick something you’ll recognize later.',
    },
    requiresModelId: {
      placeholder: 'llama3.1:70b',
      helpText:
        'The exact model id your endpoint accepts (e.g. `llama3.1:70b` for Ollama, `meta-llama/Llama-3.1-70B-Instruct` for vLLM).',
    },
    modelCount: openaiCompatibleAdapter.bundledCatalog().length,
    connectMethodSummary:
      'Any host that speaks the OpenAI Chat Completions protocol — Ollama, llama.cpp, vLLM, hosted gateways.',
    authMethods: [
      {
        kind: 'apikey',
        badge: 'API KEY',
        description:
          'Many local endpoints (Ollama, llama.cpp) don’t need a key. For hosted gateways, paste whatever the provider issues.',
        source: { label: 'your endpoint docs', url: 'https://platform.openai.com/docs/api-reference/chat' },
        format: 'sk-… or blank',
      },
    ],
  },
]
