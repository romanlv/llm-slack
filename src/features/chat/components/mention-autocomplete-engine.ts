import type { Agent } from '@/features/chat/domain'

// Maximum number of suggestions shown in the popup. Beyond this the
// user should keep typing to narrow further.
const MAX_MENTION_SUGGESTIONS = 8

export interface MentionQuery {
  // Index of the `@` that opened the popup, in the textarea value.
  start: number
  // Caret position (exclusive end of the in-progress handle).
  end: number
  // Lowercased characters between `@` and the caret. Empty string is
  // valid — the user just typed `@` and hasn't started filtering yet.
  query: string
}

/**
 * Inspect the current value/caret and decide whether an @-mention popup
 * should be open. The popup opens when the caret sits at the end of a
 * partial `@handle` token and the `@` is either at the start of the
 * textarea or preceded by whitespace.
 *
 * Returns null when the popup should be closed.
 */
export function detectMentionQuery(value: string, caret: number): MentionQuery | null {
  if (caret < 1) return null
  let i = caret - 1
  while (i >= 0) {
    const ch = value[i]
    if (ch === '@') {
      const prev = i > 0 ? value[i - 1] : ''
      if (prev !== '' && !/\s/.test(prev)) return null
      return {
        start: i,
        end: caret,
        query: value.slice(i + 1, caret).toLowerCase(),
      }
    }
    if (!/[a-z0-9_-]/i.test(ch)) return null
    i -= 1
  }
  return null
}

export interface FilterAgentsInput {
  agents: Agent[]
  query: string
}

/**
 * Filter and order agents for the autocomplete popup.
 *
 * Ranking, in order of precedence:
 *   1. Username prefix match (the "primary" handle).
 *   2. Display-name prefix match (case-insensitive).
 *   3. Substring match anywhere in either field.
 * Ties break alphabetically by displayName so the order is stable.
 *
 * An empty query returns every agent.
 */
export function filterAgentsForMention({ agents, query }: FilterAgentsInput): Agent[] {
  const q = query.toLowerCase()
  if (!q) {
    return [...agents]
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .slice(0, MAX_MENTION_SUGGESTIONS)
  }

  const scored: Array<{ agent: Agent; score: number }> = []
  for (const agent of agents) {
    const u = agent.username.toLowerCase()
    const d = agent.displayName.toLowerCase()
    let score = -1
    if (u.startsWith(q)) score = 0
    else if (d.startsWith(q)) score = 1
    else if (u.includes(q) || d.includes(q)) score = 2
    if (score >= 0) scored.push({ agent, score })
  }
  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score
    return a.agent.displayName.localeCompare(b.agent.displayName)
  })
  return scored.slice(0, MAX_MENTION_SUGGESTIONS).map((s) => s.agent)
}

export function applyMentionInsertion(
  value: string,
  caret: number,
  agent: Agent,
): { value: string; caret: number } {
  const q = detectMentionQuery(value, caret)
  if (!q) return { value, caret }
  const before = value.slice(0, q.start)
  const after = value.slice(q.end)
  const trailing = after.startsWith(' ') ? '' : ' '
  const insertion = `@${agent.username}${trailing}`
  const nextValue = before + insertion + after
  const nextCaret = before.length + insertion.length
  return { value: nextValue, caret: nextCaret }
}
