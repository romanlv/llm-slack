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

import type { Agent, ChannelSettings, ChattinessLevel } from './domain'

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
 * `chattiness` defaults below mid: LLMs lean toward "yes I can help" once
 * they emit any content token, so the silence-leaning level pushes back
 * against the chatty default behavior. Users dial up explicitly when they
 * want a more talkative agent.
 */
export const agentDefaults: Pick<Agent, 'systemPrompt' | 'chattiness'> = {
  systemPrompt: '',
  chattiness: 2,
}

// ─── Live constants ──────────────────────────────────────────────────

/**
 * The exact string an agent emits to decline this step. The parser trims
 * surrounding whitespace, but any extra content means the response is a
 * real reply, not silence.
 */
export const silenceSentinel = '<silent>'

/**
 * Per-level mapping consumed by both the editor UI (slider label) and the
 * orchestrator (decide-to-respond prompt fragment). Iterating wording here
 * is the primary lever for taming or unlocking channel chattiness without
 * a schema change. Keep fragments self-contained second-person sentences;
 * they're slotted into the decide prompt body verbatim.
 */
export const chattinessLevels: Record<
  ChattinessLevel,
  { codename: string; promptFragment: string }
> = {
  1: {
    codename: 'wallflower',
    promptFragment:
      'Speak only when directly addressed by name. Default to silence on everything else, even when you could contribute.',
  },
  2: {
    codename: 'reserved',
    promptFragment:
      'Speak only when you are the clear domain authority for what was said, or when there is a factual error you must correct. When in doubt, stay silent.',
  },
  3: {
    codename: 'balanced',
    promptFragment:
      'Speak when you have something genuinely useful to add — a missing perspective, a needed clarification, a constructive challenge. Skip messages where you would only be agreeing, restating, or being polite.',
  },
  4: {
    codename: 'engaged',
    promptFragment:
      'Engage actively. Offer perspective, ask follow-up questions, and surface missed considerations whenever they would move the conversation forward.',
  },
  5: {
    codename: 'eager',
    promptFragment:
      'Lean in. Volunteer thoughts, explore tangents, and keep the conversation moving — speak unless you truly have nothing to add.',
  },
}
