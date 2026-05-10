# Providers Refactor

Move from a single hardcoded OpenRouter integration to multi-provider, where
the **default model list lives in code** and only **user decisions** are in
the DB.

## Kinds

`openrouter`, `anthropic`, `openai`, `openai-compatible`. Multiple connections
per kind allowed (incl. multiple custom URLs).

## Schema (Dexie v5)

### New: `providers`

`id`, `kind`, `label`, `apiKey`, `baseUrl?`, `metadata` (kind-specific bag —
OpenRouter `siteUrl`/`siteName`, OpenAI `orgId`, …), `createdAt`, `updatedAt`.

Indexes: `kind`, `createdAt`.

### New: `modelOverrides`

Deviations from the bundled list. A row exists in two cases:
- **Hide a bundled model**: `enabled: false`, no `customMetadata`.
- **Add an extra model**: `enabled: true`, `customMetadata` populated.

Columns: `id`, `providerId`, `providerModelId`, `enabled` (`boolean`),
`customMetadata?` (`{ name: string; contextLength?: number; pricing?: { promptPerMillion: number; completionPerMillion: number; currency: 'USD' }; modalities?: Array<'text'|'image'|'audio'> }`),
`createdAt`, `updatedAt`.

Indexes: `providerId`, `&[providerId+providerModelId]`.

Write rule: if a write would leave a row that's a no-op deviation (e.g.
`enabled: true` and `customMetadata: null` for a bundled model), delete the
row instead. Keeps the table sparse.

### Settings / chats / messages

- `settings`: drop `openRouterApiKey`, `siteUrl`, `siteName`. Replace
  `defaultModel: string` with `defaultModel: ModelRef | null`.
- `parentChats`, `threads`: replace `model: string` with `model: ModelRef | null`
  (null = inherit `settings.defaultModel`).
- `messages`, `turns`, `providerRequestAttempts`: replace `model` /
  `provider` columns with one embedded `model: ModelRef` snapshot.

`ModelRef = { providerId?: string; providerKind: ProviderKind; providerModelId: string }`.
No FK constraints — `providerId` is soft. `providerKind` + `providerModelId`
are the durable bits so history always renders.

## Effective catalog

In-memory, computed synchronously per provider:

1. Start with the adapter's **bundled list** (all enabled).
2. Apply `modelOverrides`:
   - Row with `customMetadata = null` → **hides** the matching bundled model.
   - Row with `customMetadata` set → **adds** that model with the metadata in
     the row. (`enabled: false` keeps it saved but hidden from the picker.)
3. Picker shows enabled effective models, ordered: bundled (in bundled order)
   then additions (by `createdAt`).

Bundled lists are kept short and curated — for OpenRouter especially, only
the most common models. Long tail goes through "Add custom model".

No fetching, no TTLs, no refresh button.

## Adapter contract

```ts
export interface ProviderAdapter {
  kind: ProviderKind
  bundledCatalog(): CatalogEntry[]   // may be empty (openai-compatible)
  streamChat(connection, model, input): Promise<StreamChatResult>
}
```

A registry maps `kind → adapter`. Bundled catalogs are plain TS arrays next
to each adapter; updating them is a code PR.

## Send-time resolution

`resolveForSend(ref)` chain:
1. Snapshot's `providerId` if it still exists and matches `providerKind`.
2. Same-kind connection whose effective catalog includes the
   `providerModelId` (prefer `settings.defaultModel.providerId`).
3. `settings.defaultModel` (regenerate / retry only).
4. Null → refuse send, surface "no connection can serve this model".

`substituted: true` flag triggers a small "switched to X" notice.

## Provider deletion

Single Dexie transaction:
- Cascade delete the provider's `modelOverrides`.
- Clear `providerId` on every snapshot whose id matches: `settings.defaultModel`,
  `parentChats.model`, `threads.model`, `messages.model`, `turns.model`,
  `providerRequestAttempts.model`. `providerKind` + `providerModelId` stay.
- For `settings.defaultModel`: try repointing to another same-kind connection
  whose catalog includes the same `providerModelId`; otherwise null it.

## Browser direct-API headers

- **anthropic**: send `anthropic-dangerous-direct-browser-access: true` on
  every request. Connect form warns the user that the API key is sent
  directly from the browser.
- **openai**: same warning copy.
- **openrouter**, **openai-compatible**: standard headers, no extra flags.

## UI surfaces

- **Settings** rewrites: providers list (add/edit/delete with kind-specific
  fields), per-provider models panel (table over the merged catalog with
  enabled toggle, display-name override, "Add custom model" for hand entries),
  default-model picker.
- **Chat picker**: enabled effective models, grouped by connection label.
- **Send / retry / regenerate**: route through `resolveForSend`.

## Files

```
src/features/chat/database.ts                                  v5 schema + upgrade
src/features/chat/domain.ts                                    use ModelRef
src/features/settings/settings-repository.ts                   AppSettings shape
src/features/providers/provider-contract.ts                    adapter contract + ModelRef
src/features/providers/adapters/{openrouter,anthropic,openai,openai-compatible}.ts
src/features/providers/registry.ts                             new
src/features/providers/providers-repository.ts                 new
src/features/providers/model-overrides-repository.ts           new
src/features/providers/models-catalog.ts                       new (synchronous merge)
src/features/chat/send-turn.ts                                 resolve via registry
src/features/settings/settings-page-content.tsx                rewrite
src/features/chat/components/parent-chat-workspace.tsx         picker source
docs/db-schema.md                                              keep in sync
```

## Out of scope

Encryption at rest, per-model parameter overrides (temperature, system prompt),
cost tallies in chat UI, auto-disable on repeated 404s.
