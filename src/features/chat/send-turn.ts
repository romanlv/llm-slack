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
import type { ModelRef } from '@/features/providers/model-ref'
import { resolveForSend, type ResolveForSendResult } from '@/features/providers/models-catalog'
import { getAdapter } from '@/features/providers/registry'
import { getSettings } from '@/features/settings/settings-repository'

const APPROX_CONTEXT_CHAR_LIMIT = 48_000

function normalizeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }
  return 'The request failed before a response completed.'
}

function estimateContextSize(messages: Array<{ content: string }>) {
  return messages.reduce((total, message) => total + message.content.length, 0)
}

async function resolveSendTarget(modelRef: ModelRef | null): Promise<ResolveForSendResult> {
  const settings = await getSettings()
  const resolved = await resolveForSend(modelRef, { settingsDefault: settings.defaultModel })

  if (!resolved) {
    throw new Error(
      'No connected provider can serve the selected model. Connect a provider or pick a model in Settings.',
    )
  }

  if (!resolved.connection.apiKey.trim()) {
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

  const resolved = await resolveSendTarget(parentChat.model ?? null)
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
  })

  try {
    const conversation = await getParentConversation(parentChatId)
    if (estimateContextSize(conversation) > APPROX_CONTEXT_CHAR_LIMIT) {
      throw new Error(
        'This conversation is too long for the current browser-side safety limit. Start a new conversation or continue in a thread.',
      )
    }

    let assistantContent = ''
    const adapter = getAdapter(resolved.connection.kind)

    const response = await adapter.streamChat(resolved.connection, snapshot, {
      messages: conversation,
      onChunk: (chunk) => {
        assistantContent += chunk
        void updateMessage(assistantMessage.id, {
          content: assistantContent,
          status: 'streaming',
        })
      },
      onMessageId: (id) => {
        void updateMessage(assistantMessage.id, { providerRequestId: id })
      },
    })

    const finalContent = response.content.trim() || 'The provider returned an empty response.'
    await completeMessage(assistantMessage.id, finalContent, response.usage)
    if (response.id) {
      await updateMessage(assistantMessage.id, { providerRequestId: response.id })
    }
    await finalizeParentChatAfterSend(parentChatId, trimmed, finalContent)
  } catch (error) {
    const message = normalizeErrorMessage(error)
    await failMessage(assistantMessage.id, `Request failed: ${message}`, message)
    await finalizeParentChatAfterSend(parentChatId, trimmed, `Request failed: ${message}`)
    throw new Error(message)
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

  const resolved = await resolveSendTarget(thread.model ?? parentChat.model ?? null)
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
  })

  await syncRootReplyCountForThread(threadId)

  try {
    const conversation = await getThreadConversation(threadId)
    if (estimateContextSize(conversation) > APPROX_CONTEXT_CHAR_LIMIT) {
      throw new Error(
        'This thread is too long for the current browser-side safety limit. Start a new thread from a narrower message or open a fresh conversation.',
      )
    }

    let assistantContent = ''
    const adapter = getAdapter(resolved.connection.kind)

    const response = await adapter.streamChat(resolved.connection, snapshot, {
      messages: conversation,
      onChunk: (chunk) => {
        assistantContent += chunk
        void updateMessage(assistantMessage.id, {
          content: assistantContent,
          status: 'streaming',
        })
      },
      onMessageId: (id) => {
        void updateMessage(assistantMessage.id, { providerRequestId: id })
      },
    })

    const finalContent = response.content.trim() || 'The provider returned an empty response.'
    await completeMessage(assistantMessage.id, finalContent, response.usage)
    if (response.id) {
      await updateMessage(assistantMessage.id, { providerRequestId: response.id })
    }
    await finalizeThreadAfterSend(threadId, thread.parentChatId, trimmed, finalContent)
  } catch (error) {
    const message = normalizeErrorMessage(error)
    await failMessage(assistantMessage.id, `Request failed: ${message}`, message)
    await finalizeThreadAfterSend(
      threadId,
      thread.parentChatId,
      trimmed,
      `Request failed: ${message}`,
    )
    throw new Error(message)
  }
}
