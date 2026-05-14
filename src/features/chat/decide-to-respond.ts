import { chattinessLevels, silenceSentinel } from './defaults'
import type { ChattinessLevel } from './domain'

export interface DecideToRespondResult {
  respond: boolean
  // 'thread' or 'main' — present only when respond=true and the agent
  // explicitly declared a target. The orchestrator decides what to do with
  // the hint based on channel settings (R13a / allowAgentThreading).
  respondIn?: 'main' | 'thread'
  // The content to persist when respond=true. Stripped of the silence
  // sentinel and any envelope prefix.
  content: string
}

// Parse an agent's stream output. The wire convention for v0:
//
//   - Exactly "<silent>", after trimming surrounding whitespace → the
//     agent decided to stay quiet. The orchestrator records the attempt as
//     'decided-silent' and writes no message row.
//   - Otherwise → treat the content as the agent's reply. If the content
//     leads with a JSON envelope like {"respond": true, "respondIn":
//     "thread", "content": "..."} we parse it; otherwise the raw content
//     is the reply.
//   - Empty / whitespace-only output, including parsed JSON with respond=true
//     but blank/missing content, is treated as no-message fallback. Intentional
//     silence should use the explicit sentinel; empty output may be a model or
//     provider bug, but it still must not create an empty message row.
//
// Why exact: an agent legitimately mentioning the sentinel string inside
// its reply (including at the start while explaining it) should not be
// misread as silence. Trimming allows harmless surrounding whitespace but
// any extra content means the reply is content.
export function parseAgentResponse(raw: string): DecideToRespondResult {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { respond: false, content: '' }
  }
  if (trimmed === silenceSentinel) {
    return { respond: false, content: '' }
  }

  // Try JSON envelope if the response begins with `{`.
  if (trimmed[0] === '{') {
    try {
      const parsed = JSON.parse(trimmed) as Partial<DecideToRespondResult>
      if (typeof parsed.respond === 'boolean') {
        if (!parsed.respond) return { respond: false, content: '' }
        const content = typeof parsed.content === 'string' ? parsed.content.trim() : ''
        if (!content) return { respond: false, content: '' }
        return {
          respond: true,
          ...(parsed.respondIn === 'thread' || parsed.respondIn === 'main'
            ? { respondIn: parsed.respondIn }
            : {}),
          content,
        }
      }
    } catch {
      // fall through to raw content
    }
  }

  return { respond: true, content: trimmed }
}

export interface DecideSystemPromptInput {
  channelTitle: string
  // Channel `description` from channelSettings. Empty string omits the
  // <description> tag entirely (per docs/chat-mechanics.md "omit the tag
  // if empty").
  channelDescription: string
  // Channel-wide `systemPrompt` from channelSettings — rendered as
  // <house_rules>. Empty string omits the tag.
  channelSystemPrompt: string
  participants: Array<{ displayName: string }>
  agentSystemPrompt: string
  chattiness: ChattinessLevel
  allowAgentThreading: boolean
  isInsideThread: boolean
}

// Escape user-supplied text before it is embedded in an XML-tagged
// section so a stray `</house_rules>` or `<conventions>` in a description,
// channel title, or display name cannot truncate or forge a section the
// model treats as structural. We escape the three characters that matter
// for tag parsing — `<`, `>`, `&` — using the standard XML entities the
// model is familiar with.
function escapeXmlContent(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Render `<tag>content</tag>` inline for short single-line content and
// in indented block form when content contains a newline. Block form keeps
// multi-paragraph house_rules / your_role legible to both humans
// inspecting the prompt and the model attending to it. `outerIndent` is
// applied to every emitted line so the whole block sits at a consistent
// indentation level inside its parent. Pass `forceBlock: true` for tags
// the doc renders in block form regardless of length (e.g. <your_role>).
// Content is XML-escaped — never call with pre-escaped text.
function renderTag(
  tag: string,
  content: string,
  { outerIndent = '', forceBlock = false }: { outerIndent?: string; forceBlock?: boolean } = {},
): string {
  const escaped = escapeXmlContent(content)
  if (forceBlock || escaped.includes('\n')) {
    const inner = `${outerIndent}  `
    const body = escaped
      .split('\n')
      .map((line) => `${inner}${line}`)
      .join('\n')
    return `${outerIndent}<${tag}>\n${body}\n${outerIndent}</${tag}>`
  }
  return `${outerIndent}<${tag}>${escaped}</${tag}>`
}

// The {role:'system'} prefix the orchestrator prepends to every per-agent
// channel transport. XML-tagged so the model can structurally attend to
// each section instead of guessing from prose positioning — matches the
// target shape in docs/chat-mechanics.md ("Channel" subsection).
//
// Structural ordering:
//   1. <channel>      — room context (name, description?, house_rules?, roster)
//   2. <participation>— silence-first framing + chattiness fragment
//   3. <conventions>  — wire format (silence sentinel, threading envelope)
//   4. <your_role>?   — the agent's own systemPrompt (last, so it's the
//                       most-recent instruction the model attends to).
//
// Silence-first framing is deliberate: LLMs default to "yes, I can help"
// once they emit a content token, so the baseline asks them to skip first
// and only respond when their chattiness-level fragment greenlights it.
//
// Optional tags (<description>, <house_rules>, <participants>, <your_role>)
// are omitted entirely when their source is empty. The `agent.role` /
// `agent.bio` fields documented in docs/chat-mechanics.md are not yet
// stored on the Agent row, so <participants> renders names only — that's
// a clean extension once those fields land.
export function buildDecideSystemPrompt(input: DecideSystemPromptInput): string {
  const description = input.channelDescription.trim()
  const houseRules = input.channelSystemPrompt.trim()
  const yourRole = input.agentSystemPrompt.trim()

  const channelLines: string[] = [
    '<channel>',
    renderTag('name', input.channelTitle, { outerIndent: '  ' }),
  ]
  if (description) {
    channelLines.push(renderTag('description', description, { outerIndent: '  ' }))
  }
  if (houseRules) {
    channelLines.push(renderTag('house_rules', houseRules, { outerIndent: '  ' }))
  }
  // Omit <participants> entirely when the roster is empty — consistent
  // with how <description>/<house_rules>/<your_role> drop their tag when
  // empty rather than emitting a hollow block.
  if (input.participants.length > 0) {
    channelLines.push('  <participants>')
    for (const p of input.participants) {
      channelLines.push(`    - ${escapeXmlContent(p.displayName)}`)
    }
    channelLines.push('  </participants>')
  }
  channelLines.push('</channel>')

  const participationLines = [
    '<participation>',
    '  In a group chat, most messages do not need your reply. The default is silence; speak only when your contribution genuinely improves the conversation.',
    `  ${chattinessLevels[input.chattiness].promptFragment}`,
    '</participation>',
  ]

  const conventionLines = [
    '<conventions>',
    `  - To stay silent, respond with exactly "${silenceSentinel}" and nothing else — your silence is recorded but no message is posted.`,
    '  - Do not return an empty message to mean silence, and do not narrate that you are staying quiet.',
  ]
  if (input.allowAgentThreading && !input.isInsideThread) {
    conventionLines.push(
      '  - To reply inside a thread on the triggering message, return a JSON envelope: {"respond": true, "respondIn": "thread", "content": "..."}. Otherwise reply with plain text and your message lands on the main timeline.',
    )
  }
  conventionLines.push('</conventions>')

  const blocks = [
    channelLines.join('\n'),
    participationLines.join('\n'),
    conventionLines.join('\n'),
  ]
  if (yourRole) {
    // Doc example renders <your_role> in block form regardless of length —
    // it's the agent's character and reads naturally as a block.
    blocks.push(renderTag('your_role', yourRole, { forceBlock: true }))
  }

  return blocks.join('\n\n')
}
