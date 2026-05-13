import { silenceSentinel } from './defaults'

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
  participants: Array<{ displayName: string }>
  agentSystemPrompt: string
  allowAgentThreading: boolean
  isInsideThread: boolean
}

// The {role:'system'} prefix the orchestrator prepends to every per-agent
// transport. Names the channel, the participant roster, and the silence
// convention. Includes the threading instruction only when the agent
// could meaningfully choose `respondIn: 'thread'` (R13a v0: threading
// works one-way from main).
export function buildDecideSystemPrompt(input: DecideSystemPromptInput): string {
  const roster = input.participants.map((p) => `- ${p.displayName}`).join('\n')
  const lines = [
    input.agentSystemPrompt.trim(),
    input.agentSystemPrompt.trim() ? '' : undefined,
    `You are participating in the channel "${input.channelTitle}" with these agents:`,
    roster,
    '',
    `If you do not have something useful to add, respond with exactly "${silenceSentinel}" — your silence is recorded but no message will be posted. Do not return an empty message.`,
  ].filter((line): line is string => line !== undefined)

  if (input.allowAgentThreading && !input.isInsideThread) {
    lines.push(
      '',
      'You may reply inside a thread on the triggering message by returning a JSON envelope: {"respond": true, "respondIn": "thread", "content": "..."}. Otherwise reply with plain text and your message lands on the main timeline.',
    )
  }

  return lines.join('\n')
}
