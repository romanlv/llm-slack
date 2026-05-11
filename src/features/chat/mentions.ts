export interface MentionCandidate {
  id: string
  displayName: string
}

/**
 * Find which mention candidates are referenced in `text`.
 *
 * Matching rules (v0):
 * - Mentions are written as `@<display-name>`.
 * - Case-insensitive against candidate.displayName.
 * - Greedy longest-match: when multiple candidates share a prefix (e.g.
 *   "Senior" and "Senior Reviewer"), the longest matching name wins.
 * - Text inside fenced code blocks (``` ... ```) and inline code (`...`) is
 *   excluded — those segments are stripped before scanning.
 * - Email-shaped tokens (e.g. `user@example.com`) are skipped — the `@`
 *   must not be preceded by an alphanumeric character.
 * - Mentions in markdown links and quoted blocks are matched in v0 (false
 *   positives accepted; tracked as a future polish per plan U8).
 *
 * Returns the set of matched candidate ids, in first-occurrence order.
 */
export function parseMentions(text: string, candidates: MentionCandidate[]): string[] {
  if (candidates.length === 0 || !text) return []

  const scrubbed = stripCode(text)
  // Sort candidates by displayName length, longest first, so the regex
  // alternation prefers longer matches. Without this, "Senior" would match
  // before "Senior Reviewer" had a chance.
  const sorted = [...candidates].sort(
    (a, b) => b.displayName.length - a.displayName.length,
  )

  const matchedIds = new Set<string>()
  const result: string[] = []

  for (let cursor = 0; cursor < scrubbed.length; cursor += 1) {
    if (scrubbed[cursor] !== '@') continue
    // Reject email-shaped @ (preceded by an alphanumeric char or `.`).
    const prev = cursor > 0 ? scrubbed[cursor - 1] : ''
    if (/[a-z0-9._-]/i.test(prev)) continue

    const rest = scrubbed.slice(cursor + 1)
    for (const candidate of sorted) {
      const head = rest.slice(0, candidate.displayName.length)
      if (head.toLowerCase() !== candidate.displayName.toLowerCase()) continue
      // Don't match if the next char is alphanumeric — that would mean
      // we matched a prefix of a longer word that isn't another candidate.
      const next = rest[candidate.displayName.length] ?? ''
      if (/[a-z0-9_]/i.test(next)) continue

      if (!matchedIds.has(candidate.id)) {
        matchedIds.add(candidate.id)
        result.push(candidate.id)
      }
      cursor += candidate.displayName.length
      break
    }
  }

  return result
}

function stripCode(text: string): string {
  // Replace fenced code blocks with whitespace of the same length to keep
  // offsets sane (not strictly required by the parser, but useful when
  // anyone consumes character positions later).
  let out = text.replace(/```[\s\S]*?```/g, (m) => ' '.repeat(m.length))
  out = out.replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length))
  return out
}
