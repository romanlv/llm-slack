// Single source of truth for default values and tunable strings used
// across the chat feature. See docs/chat-mechanics.md for product
// semantics — this file is the place to *iterate* values without a
// schema change.
//
// Two kinds of value live here:
//   • Seeds     — stamped into rows at creation. Editing affects new
//                 rows only; existing rows keep their stored values.
//   • Constants — read every operation, never persisted. Editing takes
//                 effect on the next call.

import type { Agent, ChannelSettings } from './domain'

// ─── Seeds ───────────────────────────────────────────────────────────

/**
 * Channel settings stamped into a new `channelSettings` row at creation.
 * Callers spread this and supply the chat-specific fields (id, timestamps).
 *
 * Shape is pinned to `ChannelSettings` via `Omit`, so adding a new
 * settings field forces an update here at compile time.
 */
export const channelDefaults: Omit<ChannelSettings, 'id' | 'createdAt' | 'updatedAt'> = {
  /** Fan-out steps per user input. 0 disables agent-to-agent chains. */
  maxChainedSubTurns: 3,
  /** Per-agent message ceiling within one user-initiated turn. */
  maxMessagesPerAgentPerInput: 2,
  /**
   * Turn-wide token budget. Aggregated from
   * `providerRequestAttempts.usage` across the turn. Wide default so it
   * does not bite under normal use; enforcement deferred (see
   * docs/tasks.md follow-ups).
   */
  tokenBudgetPerInput: 200_000,
  /**
   * Mode applied to newly added participants — also the pre-fill in the
   * add-to-channel modal. Per-participant overrides live on
   * `chatParticipants.mode`.
   */
  defaultParticipationMode: 'auto-decide',
  /**
   * Whether agents may emit `respondIn: 'thread'`. Slack-like behavior
   * is the v0 default; channel owners can disable to keep replies pinned
   * to the main timeline (R14e).
   */
  allowAgentThreading: true,
}

/**
 * Agent fields with system-provided defaults at creation. Identity
 * (`displayName`, `username`, `model`) is user-supplied — this seed only
 * covers character fields the user may leave empty.
 *
 * Currently the agents-repository sets `systemPrompt` directly from the
 * editor; this constant exists so future seed sites have a single
 * reference and so adding new optional character fields lands here.
 */
export const agentDefaults: Pick<Agent, 'systemPrompt'> = {
  systemPrompt: '',
}

// ─── Live constants ──────────────────────────────────────────────────

/**
 * The exact string an agent emits to decline this step. The parser trims
 * surrounding whitespace, but any extra content means the response is a
 * real reply, not silence.
 */
export const silenceSentinel = '<silent>'
