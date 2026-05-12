import { getAgent } from '@/features/agents/agents-repository'
import type { Agent, AgentMessageSnapshot } from '@/features/chat/domain'
import {
  appendUserMessage,
  completeMessage,
  createAssistantMessage,
  db,
  failMessage,
  finalizeParentChatAfterSend,
  finalizeThreadAfterSend,
  getParentConversation,
  getThreadConversation,
  markParentDraftSent,
  markThreadDraftSent,
  syncRootReplyCountForThread,
  updateMessage,
} from '@/features/chat/repository'
import {
  abortAllStreams,
  abortStreamsForConversation,
  clearStreamController,
  registerStreamController,
} from '@/features/chat/stream-controllers'
import {
  attemptStillCurrent,
  cancelAttempt,
  closeTurn,
  completeAttempt,
  failAttempt,
  markAttemptStreaming,
  openAttempt,
  openTurn,
} from '@/features/chat/turn-lifecycle'
import type { ModelRef } from '@/features/providers/model-ref'
import { resolveForSend, type ResolveForSendResult } from '@/features/providers/models-catalog'
import type { ChatProviderMessage } from '@/features/providers/provider-contract'
import { getAdapter } from '@/features/providers/registry'
import { getSettings } from '@/features/settings/settings-repository'

const APPROX_CONTEXT_CHAR_LIMIT = 48_000

export { abortAllStreams, abortStreamsForConversation }

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true
  if (error instanceof Error && error.name === 'AbortError') return true
  return false
}

function normalizeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }
  return 'The request failed before a response completed.'
}

function estimateContextSize(messages: Array<{ content: string }>) {
  return messages.reduce((total, message) => total + message.content.length, 0)
}

// When a chat is agent-bound, resolve the agent and substitute its model
// for the chat's. Returns null for model-DMs (today's behavior).
async function resolveAgentBinding(agentId: string | null | undefined): Promise<Agent | null> {
  if (!agentId) return null
  const agent = await getAgent(agentId)
  if (!agent) {
    // Orphaned agent-DM (definition was deleted). Refuse to send rather
    // than silently swapping to the chat's stale model — the chat row's
    // archived-style guard pattern is the closest analog.
    throw new Error(
      'This agent-DM is orphaned (the agent was deleted). Start a fresh agent-DM to continue.',
    )
  }
  return agent
}

function snapshotForAgent(agent: Agent, resolvedSnapshot: ModelRef): AgentMessageSnapshot {
  return {
    displayName: agent.displayName,
    model: resolvedSnapshot,
  }
}

// Prepend the agent's system prompt as a {role:'system'} message. Empty or
// whitespace-only prompts pass through unchanged so transport stays
// byte-identical to a model-DM (AE7 invariant). Idempotent against a prior
// identical system prefix.
function withAgentSystemPrompt<M extends { role: string; content: string }>(
  agent: Agent | null,
  messages: M[],
): Array<{ role: 'system'; content: string } | M> {
  if (!agent) return messages
  const prompt = agent.systemPrompt.trim()
  if (!prompt) return messages
  const first = messages[0]
  if (first && first.role === 'system' && first.content === agent.systemPrompt) {
    return messages
  }
  return [{ role: 'system' as const, content: agent.systemPrompt }, ...messages]
}

async function resolveSendTarget(modelRef: ModelRef | null): Promise<ResolveForSendResult> {
  const settings = await getSettings()
  const resolved = await resolveForSend(modelRef, { settingsDefault: settings.defaultModel })

  if (!resolved) {
    throw new Error(
      'No connected provider can serve the selected model. Connect a provider or pick a model in Settings.',
    )
  }

  const adapter = getAdapter(resolved.connection.kind)
  if (adapter.requiresApiKey && !resolved.connection.apiKey.trim()) {
    throw new Error(
      `Provider "${resolved.connection.label}" has no API key set. Update it in Settings before sending.`,
    )
  }

  return resolved
}

// Per-surface descriptor. The DM core runs the same lifecycle for parent
// chats and threads; what differs is where the user/assistant rows live,
// which draft to clear, how to build the context window, and the
// thread-only reply-count sync.
interface DmSendSurface {
  conversationType: 'parent' | 'thread'
  conversationId: string
  parentChatId: string
  // Conversation channel used by stream-controllers + cancel routing.
  streamConversationId: string
  // Inbound context (messages already in the conversation).
  buildConversation(): Promise<ChatProviderMessage[]>
  // Persist the draft-sent state for the user message.
  markDraftSent(prompt: string): Promise<void>
  // Final summary writeback after the assistant turn closes.
  finalize(prompt: string, response: string): Promise<void>
  // Optional thread-only hook to keep root reply counts in sync.
  syncReplyCount?(): Promise<void>
  // Cap-hit error wording differs by surface so the user knows whether to
  // start a new thread vs. a new conversation.
  contextTooLongMessage: string
}

async function runDmSend(
  surface: DmSendSurface,
  prompt: string,
  resolved: ResolveForSendResult,
  snapshot: ModelRef,
  agent: Agent | null,
) {
  const trimmed = prompt.trim()
  await surface.markDraftSent(trimmed)

  const userMessage = await appendUserMessage({
    conversationType: surface.conversationType,
    conversationId: surface.conversationId,
    parentChatId: surface.parentChatId,
    prompt: trimmed,
    model: snapshot,
  })

  if (surface.syncReplyCount) {
    await surface.syncReplyCount()
  }

  const assistantMessage = await createAssistantMessage({
    conversationType: surface.conversationType,
    conversationId: surface.conversationId,
    parentChatId: surface.parentChatId,
    model: snapshot,
    ...(agent
      ? { agentId: agent.id, agentSnapshot: snapshotForAgent(agent, snapshot) }
      : {}),
  })

  const turn = await openTurn({
    parentChatId: surface.parentChatId,
    conversationType: surface.conversationType,
    conversationId: surface.conversationId,
    userMessageId: userMessage.id,
  })
  const { attempt, controller: attemptController } = await openAttempt({
    turnId: turn.id,
    assistantMessageId: assistantMessage.id,
    agentId: agent?.id,
    model: snapshot,
  })
  // Register the attempt's controller as THE active stream for this
  // conversation. Callers that can't see turn ids (deleteProvider's
  // abortAllStreams, providers-repository) can still cancel us via the
  // registry; in-band cancel goes through interruptActiveTurn → closeTurn
  // → controller.abort().
  registerStreamController(surface.streamConversationId, attemptController)

  try {
    await markAttemptStreaming(attempt.id)
    const conversation = await surface.buildConversation()
    if (estimateContextSize(conversation) > APPROX_CONTEXT_CHAR_LIMIT) {
      throw new Error(surface.contextTooLongMessage)
    }

    const transport = withAgentSystemPrompt(agent, conversation)

    let assistantContent = ''
    const adapter = getAdapter(resolved.connection.kind)

    const onUnawaitedWriteError = (err: unknown) => {
      // Surface QuotaExceededError (or any persistence failure) by aborting
      // the stream — the AbortError path below converts it to a failed
      // message status rather than leaving it stuck in 'streaming'.
      if (!attemptController.signal.aborted) attemptController.abort(err)
    }

    const response = await adapter.streamChat(resolved.connection, snapshot, {
      messages: transport,
      signal: attemptController.signal,
      onChunk: (chunk) => {
        assistantContent += chunk
        // Ownership-guarded write: skip if the attempt was already closed
        // by the lifecycle (e.g. user-interrupt). Without this guard, a
        // late chunk would resurrect 'streaming' status after closeTurn.
        attemptStillCurrent(attempt.id)
          .then((ok) => {
            if (!ok) return
            return updateMessage(assistantMessage.id, {
              content: assistantContent,
              status: 'streaming',
            })
          })
          .catch(onUnawaitedWriteError)
      },
      onMessageId: (id) => {
        attemptStillCurrent(attempt.id)
          .then((ok) => {
            if (!ok) return
            return updateMessage(assistantMessage.id, { providerRequestId: id })
          })
          .catch(onUnawaitedWriteError)
      },
    })

    const finalContent = response.content.trim() || 'The provider returned an empty response.'
    await completeMessage(assistantMessage.id, finalContent, response.usage)
    if (response.id) {
      await updateMessage(assistantMessage.id, { providerRequestId: response.id })
    }
    await completeAttempt(attempt.id, {
      providerRequestId: response.id,
      usage: response.usage,
    })
    await surface.finalize(trimmed, finalContent)
    await closeTurn(turn.id, 'complete')
  } catch (error) {
    if (isAbortError(error) || attemptController.signal.aborted) {
      await failMessage(assistantMessage.id, 'Request cancelled.', 'Cancelled')
      await cancelAttempt(attempt.id)
      await closeTurn(turn.id, 'user-interrupt')
      await surface.finalize(trimmed, 'Request cancelled.')
      return
    }
    const message = normalizeErrorMessage(error)
    await failMessage(assistantMessage.id, `Request failed: ${message}`, message)
    await failAttempt(attempt.id, message)
    await closeTurn(turn.id, 'error')
    await surface.finalize(trimmed, `Request failed: ${message}`)
    throw new Error(message)
  } finally {
    clearStreamController(surface.streamConversationId, attemptController)
  }
}

export async function sendParentChatTurn(parentChatId: string, prompt: string) {
  const parentChat = await db.parentChats.get(parentChatId)
  if (!parentChat) {
    throw new Error('Conversation not found.')
  }
  if (parentChat.archivedAt) {
    throw new Error('Archived conversations cannot accept new sends.')
  }

  // Channels go through the orchestrator (U7). The user message is
  // persisted here so callers see consistent ordering; the orchestrator
  // takes over from openTurn.
  if (parentChat.kind === 'channel') {
    const trimmed = prompt.trim()
    await markParentDraftSent(parentChatId, trimmed)
    const userMessage = await appendUserMessage({
      conversationType: 'parent',
      conversationId: parentChatId,
      parentChatId,
      prompt: trimmed,
      model: undefined,
    })
    const { runChannelTurn } = await import('@/features/chat/orchestrator')
    await runChannelTurn({ chatId: parentChatId, userMessageId: userMessage.id })
    return
  }

  const agent = await resolveAgentBinding(parentChat.agentId)
  const resolved = await resolveSendTarget(agent ? agent.model : parentChat.model ?? null)
  const snapshot: ModelRef = {
    providerId: resolved.connection.id,
    providerKind: resolved.connection.kind,
    providerModelId: resolved.model.providerModelId,
  }

  await runDmSend(
    {
      conversationType: 'parent',
      conversationId: parentChatId,
      parentChatId,
      streamConversationId: parentChatId,
      buildConversation: () => getParentConversation(parentChatId),
      markDraftSent: (trimmed) => markParentDraftSent(parentChatId, trimmed),
      finalize: (trimmed, response) =>
        finalizeParentChatAfterSend(parentChatId, trimmed, response),
      contextTooLongMessage:
        'This conversation is too long for the current browser-side safety limit. Start a new conversation or continue in a thread.',
    },
    prompt,
    resolved,
    snapshot,
    agent,
  )
}

export async function sendThreadTurn(threadId: string, prompt: string) {
  const thread = await db.threads.get(threadId)
  if (!thread) {
    throw new Error('Thread not found.')
  }
  const parentChat = await db.parentChats.get(thread.parentChatId)
  if (!parentChat) {
    throw new Error('Conversation not found.')
  }
  if (parentChat.archivedAt) {
    throw new Error('Archived conversations cannot accept new sends.')
  }

  // Channel threads go through the orchestrator. The thread carries its own
  // snapshot of participants (U11) — fan-out, decide-to-respond, and mention
  // parsing all run against that snapshot. This mirrors the parent-channel
  // branch in sendParentChatTurn and is what closes the "thread started from
  // an agent message in a group chat" gap.
  if (parentChat.kind === 'channel') {
    const trimmed = prompt.trim()
    await markThreadDraftSent(threadId, thread.parentChatId, trimmed)
    const userMessage = await appendUserMessage({
      conversationType: 'thread',
      conversationId: threadId,
      parentChatId: thread.parentChatId,
      prompt: trimmed,
      model: undefined,
    })
    await syncRootReplyCountForThread(threadId)
    const { runChannelTurn } = await import('@/features/chat/orchestrator')
    await runChannelTurn({
      chatId: thread.parentChatId,
      threadId,
      userMessageId: userMessage.id,
    })
    return
  }

  // Thread inherits agent binding from its parent (agent-DM threads). U11
  // lands full participant-snapshot inheritance for channels via the
  // orchestrator branch above.
  const agent = await resolveAgentBinding(parentChat.agentId)
  const resolved = await resolveSendTarget(
    agent ? agent.model : thread.model ?? parentChat.model ?? null,
  )
  const snapshot: ModelRef = {
    providerId: resolved.connection.id,
    providerKind: resolved.connection.kind,
    providerModelId: resolved.model.providerModelId,
  }

  await runDmSend(
    {
      conversationType: 'thread',
      conversationId: threadId,
      parentChatId: thread.parentChatId,
      streamConversationId: threadId,
      buildConversation: () => getThreadConversation(threadId),
      markDraftSent: (trimmed) =>
        markThreadDraftSent(threadId, thread.parentChatId, trimmed),
      finalize: (trimmed, response) =>
        finalizeThreadAfterSend(threadId, thread.parentChatId, trimmed, response),
      syncReplyCount: () => syncRootReplyCountForThread(threadId),
      contextTooLongMessage:
        'This thread is too long for the current browser-side safety limit. Start a new thread from a narrower message or open a fresh conversation.',
    },
    prompt,
    resolved,
    snapshot,
    agent,
  )
}
