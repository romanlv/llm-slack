export interface MentionCandidate {
  id: string
  displayName: string
  // Short @-handle for the agent. Falls back to displayName when callers
  // haven't loaded a username (e.g. very old fixtures), so the parser
  // still works against pre-username candidates.
  username?: string
}

/**
 * Find which mention candidates are referenced in `text`.
 *
 * Matching rules (v0):
 * - Mentions are written as `@<display-name>` OR `@<username>`.
 * - Case-insensitive against both candidate.displayName and candidate.username.
 * - Greedy longest-match across both forms: when multiple candidates share a
 *   prefix (e.g. "Senior" and "Senior Reviewer"), the longest matching name
 *   wins. Username matches are also considered in the same pool.
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

  // Flatten each candidate into one or more (handle, id) entries so the
  // longest-match scan can consider displayName and username uniformly.
  interface Handle {
    id: string
    handle: string
  }
  const handles: Handle[] = []
  for (const c of candidates) {
    handles.push({ id: c.id, handle: c.displayName })
    if (c.username && c.username !== c.displayName) {
      handles.push({ id: c.id, handle: c.username })
    }
  }
  const sorted = handles.sort((a, b) => b.handle.length - a.handle.length)

  const matchedIds = new Set<string>()
  const result: string[] = []

  for (let cursor = 0; cursor < scrubbed.length; cursor += 1) {
    if (scrubbed[cursor] !== '@') continue
    // Reject email-shaped @ (preceded by an alphanumeric char or `.`).
    const prev = cursor > 0 ? scrubbed[cursor - 1] : ''
    if (/[a-z0-9._-]/i.test(prev)) continue

    const rest = scrubbed.slice(cursor + 1)
    for (const entry of sorted) {
      const head = rest.slice(0, entry.handle.length)
      if (head.toLowerCase() !== entry.handle.toLowerCase()) continue
      // Don't match if the next char is alphanumeric — that would mean
      // we matched a prefix of a longer word that isn't another candidate.
      const next = rest[entry.handle.length] ?? ''
      if (/[a-z0-9_]/i.test(next)) continue

      if (!matchedIds.has(entry.id)) {
        matchedIds.add(entry.id)
        result.push(entry.id)
      }
      cursor += entry.handle.length
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
