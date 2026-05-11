import { getAgent } from '@/features/agents/agents-repository'
import {
  buildDecideSystemPrompt,
  parseAgentResponse,
} from '@/features/chat/decide-to-respond'
import { db } from '@/features/chat/database'
import type {
  Agent,
  ChannelParticipant,
  ChannelSettings,
  ChatMessage,
  ParticipationMode,
} from '@/features/chat/domain'
import { DEFAULT_CHANNEL_SETTINGS } from '@/features/chat/domain'
import { parseMentions } from '@/features/chat/mentions'
import {
  completeMessage,
  createAssistantMessage,
  failMessage,
  getChannelSettings,
  getParentConversation,
  listChannelParticipants,
} from '@/features/chat/repository'
import {
  attemptStillCurrent,
  closeTurn,
  completeAttempt,
  failAttempt,
  markAttemptDecidedSilent,
  markAttemptStreaming,
  openAttempt,
  openTurn,
} from '@/features/chat/turn-lifecycle'
import type { ModelRef } from '@/features/providers/model-ref'
import { resolveForSend } from '@/features/providers/models-catalog'
import { getAdapter } from '@/features/providers/registry'
import { getSettings } from '@/features/settings/settings-repository'

// The orchestrator drives a channel turn from a single user message:
//   1. Compute candidates (auto-decide that didn't just speak + mention-only
//      named in the latest event).
//   2. Apply the per-agent + chained-sub-turn caps.
//   3. Fan out in parallel; each attempt has its own AbortController and a
//      pre-prepended {role:'system'} decide-to-respond prompt.
//   4. Parse each response: silence → record decided-silent; otherwise →
//      persist a message (main or thread per R13a).
//   5. Repeat until a stop reason fires.
//
// This v0 implementation skips the token-budget cap (no usage aggregation
// in fake fixtures) and the "concurrent thread on same trigger" merge
// nuance — both lift naturally onto this loop in a follow-up.

export interface RunChannelTurnInput {
  chatId: string
  userMessageId: string
}

interface CandidateAgent {
  agent: Agent
  mode: ParticipationMode
}

export async function runChannelTurn(input: RunChannelTurnInput): Promise<void> {
  const channel = await db.parentChats.get(input.chatId)
  if (!channel || channel.kind !== 'channel') {
    throw new Error(`Cannot run channel turn: chat "${input.chatId}" is not a channel.`)
  }

  const userMessage = await db.messages.get(input.userMessageId)
  if (!userMessage) {
    throw new Error(`User message "${input.userMessageId}" missing.`)
  }

  const turn = await openTurn({
    parentChatId: input.chatId,
    conversationType: 'parent',
    conversationId: input.chatId,
    userMessageId: input.userMessageId,
  })

  const settings = (await getChannelSettings(input.chatId)) ?? {
    id: input.chatId,
    ...DEFAULT_CHANNEL_SETTINGS,
    createdAt: 0,
    updatedAt: 0,
  }

  const participants = await listChannelParticipants(input.chatId)
  const agentsById = new Map<string, Agent>()
  for (const p of participants) {
    const agent = await getAgent(p.agentId)
    if (agent) agentsById.set(agent.id, agent)
  }

  const perAgentMessageCount = new Map<string, number>()
  let lastSpeakerByAgentId: string | null = null
  let triggeringEvent: ChatMessage = userMessage

  for (let step = 0; step < settings.maxChainedSubTurns + 1; step += 1) {
    const candidates = selectCandidates({
      participants,
      agentsById,
      triggeringEvent,
      lastSpeakerByAgentId,
      perAgentCap: settings.maxMessagesPerAgentPerInput,
      perAgentMessageCount,
    })
    if (candidates.length === 0) {
      await closeTurn(turn.id, 'no-trigger')
      return
    }

    if (step >= settings.maxChainedSubTurns + 1) {
      await closeTurn(turn.id, 'cap-hit')
      return
    }

    const fanOut = await Promise.allSettled(
      candidates.map((c) =>
        runOneAttempt({
          turnId: turn.id,
          channelTitle: channel.title,
          channelSettings: settings,
          participantsForRoster: participants
            .map((p) => agentsById.get(p.agentId))
            .filter((a): a is Agent => !!a),
          candidate: c,
          triggeringEvent,
          isInsideThread: false,
        }),
      ),
    )

    const newEvents: ChatMessage[] = []
    let anyError = false
    let allError = true
    for (const outcome of fanOut) {
      if (outcome.status === 'fulfilled') {
        allError = false
        if (outcome.value.message) {
          newEvents.push(outcome.value.message)
          perAgentMessageCount.set(
            outcome.value.agentId,
            (perAgentMessageCount.get(outcome.value.agentId) ?? 0) + 1,
          )
          lastSpeakerByAgentId = outcome.value.agentId
        }
      } else {
        anyError = true
      }
    }

    if (newEvents.length === 0) {
      await closeTurn(turn.id, anyError && allError ? 'error' : 'no-trigger')
      return
    }

    // Take the last new event as the next triggering event so mention-only
    // candidates can re-fire on it.
    triggeringEvent = newEvents[newEvents.length - 1]

    if (step + 1 > settings.maxChainedSubTurns) {
      // The next loop iteration would be over the cap.
      await closeTurn(turn.id, 'cap-hit')
      return
    }
  }

  await closeTurn(turn.id, 'complete')
}

interface SelectCandidatesInput {
  participants: ChannelParticipant[]
  agentsById: Map<string, Agent>
  triggeringEvent: ChatMessage
  lastSpeakerByAgentId: string | null
  perAgentCap: number
  perAgentMessageCount: Map<string, number>
}

function selectCandidates(input: SelectCandidatesInput): CandidateAgent[] {
  const mentioned = parseMentions(
    input.triggeringEvent.content,
    Array.from(input.agentsById.values()).map((a) => ({ id: a.id, displayName: a.displayName })),
  )

  const out: CandidateAgent[] = []
  for (const p of input.participants) {
    const agent = input.agentsById.get(p.agentId)
    if (!agent) continue
    if ((input.perAgentMessageCount.get(agent.id) ?? 0) >= input.perAgentCap) continue
    if (input.lastSpeakerByAgentId === agent.id) continue
    if (p.mode === 'auto-decide') {
      out.push({ agent, mode: p.mode })
    } else if (p.mode === 'mention-only' && mentioned.includes(agent.id)) {
      out.push({ agent, mode: p.mode })
    }
  }
  return out
}

interface RunOneAttemptInput {
  turnId: string
  channelTitle: string
  channelSettings: ChannelSettings
  participantsForRoster: Agent[]
  candidate: CandidateAgent
  triggeringEvent: ChatMessage
  isInsideThread: boolean
}

interface RunOneAttemptResult {
  agentId: string
  message?: ChatMessage
}

async function runOneAttempt(input: RunOneAttemptInput): Promise<RunOneAttemptResult> {
  const { candidate, channelSettings, channelTitle } = input

  const appSettings = await getSettings()
  const resolved = await resolveForSend(candidate.agent.model, {
    settingsDefault: appSettings.defaultModel,
  })
  if (!resolved) {
    throw new Error(
      `Cannot resolve agent ${candidate.agent.displayName}: no connected provider serves the model.`,
    )
  }
  const adapter = getAdapter(resolved.connection.kind)
  const snapshot: ModelRef = {
    providerId: resolved.connection.id,
    providerKind: resolved.connection.kind,
    providerModelId: resolved.model.providerModelId,
  }

  // The assistant message row is created *after* we know the agent
  // decided to respond. This matches the plan's "silence writes no row"
  // semantic and keeps every assistantMessageId on an attempt resolvable.
  // For real streaming, the row would be created once a chunk arrives
  // confirming non-silence; v0's fake harness emits content in one chunk
  // so we buffer and decide at the end.
  let assistantMessageId: string | undefined
  const { attempt, controller } = await openAttempt({
    turnId: input.turnId,
    // Placeholder — patched below when the row is created. We delete the
    // attempt instead if it stays silent.
    assistantMessageId: 'pending',
    agentId: candidate.agent.id,
    model: snapshot,
  })

  try {
    await markAttemptStreaming(attempt.id)
    const conversation = await getParentConversation(input.triggeringEvent.parentChatId)
    const systemPrompt = buildDecideSystemPrompt({
      channelTitle,
      participants: input.participantsForRoster,
      agentSystemPrompt: candidate.agent.systemPrompt,
      allowAgentThreading: channelSettings.allowAgentThreading,
      isInsideThread: input.isInsideThread,
    })

    const response = await adapter.streamChat(resolved.connection, snapshot, {
      messages: [{ role: 'system', content: systemPrompt }, ...conversation],
      signal: controller.signal,
      // Buffer chunks until the response completes; the row is created
      // after the silence/content decision. The ownership-check pattern
      // stays in send-turn for the single-stream DM path.
      onChunk: () => {},
      onMessageId: () => {},
    })

    if (!(await attemptStillCurrent(attempt.id))) {
      // closeTurn already cancelled this attempt (user-interrupt).
      return { agentId: candidate.agent.id }
    }

    const decision = parseAgentResponse(response.content)
    if (!decision.respond) {
      // The attempt's assistantMessageId placeholder is replaced with the
      // tombstone "" so the invariant treats it as "no message row".
      await db.providerRequestAttempts.update(attempt.id, { assistantMessageId: '' })
      await markAttemptDecidedSilent(attempt.id)
      return { agentId: candidate.agent.id }
    }

    const assistant = await createAssistantMessage({
      conversationType: 'parent',
      conversationId: input.triggeringEvent.parentChatId,
      parentChatId: input.triggeringEvent.parentChatId,
      model: snapshot,
      agentId: candidate.agent.id,
      agentSnapshot: { displayName: candidate.agent.displayName, model: snapshot },
    })
    assistantMessageId = assistant.id
    await db.providerRequestAttempts.update(attempt.id, { assistantMessageId: assistant.id })

    await completeMessage(assistant.id, decision.content)
    await completeAttempt(attempt.id, {
      providerRequestId: response.id,
      usage: response.usage,
    })
    const persisted = await db.messages.get(assistant.id)
    return { agentId: candidate.agent.id, message: persisted ?? undefined }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown'
    if (assistantMessageId) {
      await failMessage(assistantMessageId, `Request failed: ${message}`, message)
    }
    await failAttempt(attempt.id, message)
    throw error
  }
}
