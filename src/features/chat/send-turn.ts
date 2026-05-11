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
import type { ModelRef } from '@/features/providers/model-ref'
import { resolveForSend, type ResolveForSendResult } from '@/features/providers/models-catalog'
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

export async function sendParentChatTurn(parentChatId: string, prompt: string) {
  const parentChat = await db.parentChats.get(parentChatId)
  if (!parentChat) {
    throw new Error('Conversation not found.')
  }
  if (parentChat.archivedAt) {
    throw new Error('Archived conversations cannot accept new sends.')
  }

  const agent = await resolveAgentBinding(parentChat.agentId)
  const resolved = await resolveSendTarget(agent ? agent.model : parentChat.model ?? null)
  const snapshot: ModelRef = {
    providerId: resolved.connection.id,
    providerKind: resolved.connection.kind,
    providerModelId: resolved.model.providerModelId,
  }

  const trimmed = prompt.trim()
  await markParentDraftSent(parentChatId, trimmed)

  await appendUserMessage({
    conversationType: 'parent',
    conversationId: parentChatId,
    parentChatId,
    prompt: trimmed,
    model: snapshot,
  })

  const assistantMessage = await createAssistantMessage({
    conversationType: 'parent',
    conversationId: parentChatId,
    parentChatId,
    model: snapshot,
    ...(agent
      ? { agentId: agent.id, agentSnapshot: snapshotForAgent(agent, snapshot) }
      : {}),
  })

  const controller = registerStreamController(parentChatId)
  try {
    const conversation = await getParentConversation(parentChatId)
    if (estimateContextSize(conversation) > APPROX_CONTEXT_CHAR_LIMIT) {
      throw new Error(
        'This conversation is too long for the current browser-side safety limit. Start a new conversation or continue in a thread.',
      )
    }

    const transport = withAgentSystemPrompt(agent, conversation)

    let assistantContent = ''
    const adapter = getAdapter(resolved.connection.kind)

    const onUnawaitedWriteError = (err: unknown) => {
      // Surface QuotaExceededError (or any persistence failure) by aborting
      // the stream — the AbortError path below converts it to a failed message
      // status rather than leaving it stuck in 'streaming'.
      if (!controller.signal.aborted) controller.abort(err)
    }

    const response = await adapter.streamChat(resolved.connection, snapshot, {
      messages: transport,
      signal: controller.signal,
      onChunk: (chunk) => {
        assistantContent += chunk
        updateMessage(assistantMessage.id, {
          content: assistantContent,
          status: 'streaming',
        }).catch(onUnawaitedWriteError)
      },
      onMessageId: (id) => {
        updateMessage(assistantMessage.id, { providerRequestId: id }).catch(
          onUnawaitedWriteError,
        )
      },
    })

    const finalContent = response.content.trim() || 'The provider returned an empty response.'
    await completeMessage(assistantMessage.id, finalContent, response.usage)
    if (response.id) {
      await updateMessage(assistantMessage.id, { providerRequestId: response.id })
    }
    await finalizeParentChatAfterSend(parentChatId, trimmed, finalContent)
  } catch (error) {
    if (isAbortError(error) || controller.signal.aborted) {
      await failMessage(assistantMessage.id, 'Request cancelled.', 'Cancelled')
      await finalizeParentChatAfterSend(parentChatId, trimmed, 'Request cancelled.')
      return
    }
    const message = normalizeErrorMessage(error)
    await failMessage(assistantMessage.id, `Request failed: ${message}`, message)
    await finalizeParentChatAfterSend(parentChatId, trimmed, `Request failed: ${message}`)
    throw new Error(message)
  } finally {
    clearStreamController(parentChatId, controller)
  }
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

  // Thread inherits agent binding from its parent in v0 (agent-DM threads).
  // U11 lands the full participant-snapshot inheritance for channels.
  const agent = await resolveAgentBinding(parentChat.agentId)
  const resolved = await resolveSendTarget(
    agent ? agent.model : thread.model ?? parentChat.model ?? null,
  )
  const snapshot: ModelRef = {
    providerId: resolved.connection.id,
    providerKind: resolved.connection.kind,
    providerModelId: resolved.model.providerModelId,
  }

  const trimmed = prompt.trim()
  await markThreadDraftSent(threadId, thread.parentChatId, trimmed)

  await appendUserMessage({
    conversationType: 'thread',
    conversationId: threadId,
    parentChatId: thread.parentChatId,
    prompt: trimmed,
    model: snapshot,
  })

  await syncRootReplyCountForThread(threadId)

  const assistantMessage = await createAssistantMessage({
    conversationType: 'thread',
    conversationId: threadId,
    parentChatId: thread.parentChatId,
    model: snapshot,
    ...(agent
      ? { agentId: agent.id, agentSnapshot: snapshotForAgent(agent, snapshot) }
      : {}),
  })

  await syncRootReplyCountForThread(threadId)

  const controller = registerStreamController(threadId)
  try {
    const conversation = await getThreadConversation(threadId)
    if (estimateContextSize(conversation) > APPROX_CONTEXT_CHAR_LIMIT) {
      throw new Error(
        'This thread is too long for the current browser-side safety limit. Start a new thread from a narrower message or open a fresh conversation.',
      )
    }

    const transport = withAgentSystemPrompt(agent, conversation)

    let assistantContent = ''
    const adapter = getAdapter(resolved.connection.kind)

    const onUnawaitedWriteError = (err: unknown) => {
      if (!controller.signal.aborted) controller.abort(err)
    }

    const response = await adapter.streamChat(resolved.connection, snapshot, {
      messages: transport,
      signal: controller.signal,
      onChunk: (chunk) => {
        assistantContent += chunk
        updateMessage(assistantMessage.id, {
          content: assistantContent,
          status: 'streaming',
        }).catch(onUnawaitedWriteError)
      },
      onMessageId: (id) => {
        updateMessage(assistantMessage.id, { providerRequestId: id }).catch(
          onUnawaitedWriteError,
        )
      },
    })

    const finalContent = response.content.trim() || 'The provider returned an empty response.'
    await completeMessage(assistantMessage.id, finalContent, response.usage)
    if (response.id) {
      await updateMessage(assistantMessage.id, { providerRequestId: response.id })
    }
    await finalizeThreadAfterSend(threadId, thread.parentChatId, trimmed, finalContent)
  } catch (error) {
    if (isAbortError(error) || controller.signal.aborted) {
      await failMessage(assistantMessage.id, 'Request cancelled.', 'Cancelled')
      await finalizeThreadAfterSend(threadId, thread.parentChatId, trimmed, 'Request cancelled.')
      return
    }
    const message = normalizeErrorMessage(error)
    await failMessage(assistantMessage.id, `Request failed: ${message}`, message)
    await finalizeThreadAfterSend(
      threadId,
      thread.parentChatId,
      trimmed,
      `Request failed: ${message}`,
    )
    throw new Error(message)
  } finally {
    clearStreamController(threadId, controller)
  }
}
