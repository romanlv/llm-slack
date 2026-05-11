# Providers — multi-connection refactor

## Why

Today the providers UI assumes **one connection per `ProviderKind`**: the
settings page renders one card per `ProviderDefinition`, the Add provider
modal filters out kinds that already have a connection, and `excludeKinds`
plumbs the singleton invariant through the picker. This breaks the moment
the user wants:

- Two Anthropic / OpenAI keys (personal + work)
- Multiple Ollama or LM Studio instances on different `baseUrl`s
- Several OpenAI-compatible endpoints (Together, Groq, Fireworks)

The duplication the user spotted — unconnected providers showing up both as
"Not connected" rows on `/providers` **and** as items in the Add provider
picker — is a symptom of collapsing **definition** (template) and
**connection** (instance) into the same UI shape.

## What changes

Two concepts, treated separately:

- **Definition** — a template (`ProviderDefinition`). Kind, glyph, default
  tagline, auth method, optional configurable fields. First-party and
  custom (Ollama, OpenAI-compatible) are both definitions.
- **Connection** — an instance (`ProviderConnection`). User-named, points
  at a definition, holds the credential + URL + label. 0..N per
  definition.

`/providers` lists **connections**. The Add provider modal picks
**definitions**.

## Current state — what's already done

The data layer is largely connection-first already:

- `ModelRef` carries `providerId?` alongside `providerKind`
  (`src/features/providers/model-ref.ts`).
- `resolveForSend` resolves by `providerId` first, falls back to same-kind
  (`src/features/providers/models-catalog.ts:131-227`).
- `send-turn.ts` stamps `providerId` on every message snapshot.
- `deleteProvider` cascades to overrides, repoints `settings.defaultModel`,
  and rewrites chat/thread/message snapshots
  (`src/features/providers/providers-repository.ts:89-201`).
- `openai-compatible` kind already exists in `PROVIDER_KINDS`.
- `ProviderConnection` already has `baseUrl` and `label` fields.

The remaining work is **UI + picker disambiguation + surfacing
configurable definitions**, not data-model surgery.

## Milestones

### M1 — Kill remaining singleton assumptions (small)

- Delete `upsertSingletonOpenRouter` (vestigial seed code) and the test
  branch that depends on it, if any.
- `settings-page-content.tsx`: replace the `providersByKind: Map<Kind,
  Connection>` dedup with a flat connection list.
- `getFirstProviderOfKind` / `listProvidersByKind` stay as repo helpers —
  they're useful, they're just not allowed to gate UI behavior.

Exit gate: an existing user with one connection per kind sees no change.

### M2 — `/providers` page lists connections, not definitions

- One row per `ProviderConnection`. Editable label (defaulting to
  `definition.name`, auto-numbering when a kind already has one).
- Drop `excludeKinds`, `addableDefinitions`, `availableToAddCount`,
  `AllConnectedEmptyState`.
- `AddProviderModal` becomes a pure template picker — every non-hidden
  definition is always pickable.
- Edit/Disconnect address by connection id (already supported by the
  repo; just stop addressing by kind in the UI).
- **Decision**: deletion of a connection that messages reference. The
  repo already rewrites snapshots to drop the `providerId` (history stays
  renderable) and repoints `settings.defaultModel`. Surface a count in
  the disconnect confirm so the user knows what will be affected.

Exit gate: user can connect "OpenAI – personal" and "OpenAI – work" side
by side and use either from a chat.

### M3 — Model picker disambiguation

- In `parent-chat-workspace.tsx`'s model picker: when a kind has 1
  connection, render plain model rows. When ≥2, group rows by connection
  and append a `· {label}` chip or suffix on the rows for that kind.
- Search input matches both `providerModelId` and connection `label`.
- Rows are already keyed by `${providerId}:${providerModelId}` — good.

Exit gate: two same-kind connections are visually distinguishable, search
finds them by label.

### M4 — First configurable definition end-to-end

- Extend `ProviderDefinition` with a configurable-fields descriptor:
  `requiresBaseUrl?: { placeholder }`, optional `fetchModelsAtRuntime`.
- Extend `ProviderConnectPanel` to render configurable fields generically
  off the descriptor — don't hardcode an OpenAI-compatible form.
- Add an `openai-compatible` definition (the kind already exists). Wire
  through `createProvider` so `baseUrl` is persisted.

Exit gate: user can connect a custom OpenAI-compatible endpoint with a
named `baseUrl`.

### Cleanup pass

- Delete dead UI scaffolding: `excludeKinds`, the empty-state path,
  `addableDefinitions`, the `key={initialKind ?? 'first'}` remount trick.
- Consider whether `providerKind` on `ModelRef` can be dropped now that
  `providerId` is the primary key. Probably not — historical snapshots
  rely on `providerKind` when a referenced connection has been deleted
  (the repo's `rewriteSnapshotsClearingProvider` clears `providerId` but
  keeps `providerKind`). Leave it.

## Out of scope

- Per-thread connection switching UI.
- "Default connection per kind" — every ref names its connection
  explicitly; `settings.defaultModel` already serves the
  "what connection to fall back to" role.
- Runtime model-list fetching for first-party providers (Anthropic,
  OpenAI, OpenRouter) — they keep their bundled catalogs.
- Connection-aware billing/quota tracking.

## Open questions

- **Soft hint when adding a second connection of an existing kind?** Lean
  no — fewer special cases, and multiple keys is a legitimate workflow.
- **Adding an Ollama-specific definition vs. covering it under
  openai-compatible?** Defer until after M4 lands — likely
  openai-compatible covers it if the model-list fetch path works.
