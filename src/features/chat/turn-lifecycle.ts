import { db } from '@/features/chat/database'
import type {
  ConversationType,
  ProviderAttemptStatus,
  ProviderRequestAttempt,
  ProviderUsage,
  StopReason,
  Turn,
} from '@/features/chat/domain'
import {
  abortStreamsForConversation,
} from '@/features/chat/stream-controllers'
import type { ModelRef } from '@/features/providers/model-ref'

export interface OpenTurnInput {
  parentChatId: string
  conversationType: ConversationType
  conversationId: string
  userMessageId: string
}

export async function openTurn(input: OpenTurnInput): Promise<Turn> {
  const now = Date.now()
  const turn: Turn = {
    id: crypto.randomUUID(),
    parentChatId: input.parentChatId,
    conversationType: input.conversationType,
    conversationId: input.conversationId,
    userMessageId: input.userMessageId,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.turns.add(turn)
  return turn
}

export interface OpenAttemptInput {
  turnId: string
  assistantMessageId: string
  agentId?: string | null
  model: ModelRef
}

export interface OpenAttemptResult {
  attempt: ProviderRequestAttempt
  controller: AbortController
}

// In-memory map from attemptId to its AbortController so callers can
// abort by id without retaining the controller themselves (the UI's
// cancelTurn path looks the turn up and aborts each open attempt).
const attemptControllers = new Map<string, AbortController>()

export async function openAttempt(input: OpenAttemptInput): Promise<OpenAttemptResult> {
  const prior = await db.providerRequestAttempts
    .where('turnId')
    .equals(input.turnId)
    .toArray()
  const attemptNumber = prior.length + 1
  const now = Date.now()
  const attempt: ProviderRequestAttempt = {
    id: crypto.randomUUID(),
    turnId: input.turnId,
    assistantMessageId: input.assistantMessageId,
    ...(input.agentId ? { agentId: input.agentId } : {}),
    model: input.model,
    status: 'pending',
    attemptNumber,
    startedAt: now,
  }
  await db.providerRequestAttempts.add(attempt)
  const controller = new AbortController()
  attemptControllers.set(attempt.id, controller)
  return { attempt, controller }
}

export async function markAttemptStreaming(attemptId: string): Promise<void> {
  await db.providerRequestAttempts.update(attemptId, { status: 'streaming' })
}

export async function completeAttempt(
  attemptId: string,
  patch: { providerRequestId?: string; usage?: ProviderUsage } = {},
): Promise<void> {
  await db.providerRequestAttempts.update(attemptId, {
    status: 'complete',
    completedAt: Date.now(),
    ...patch,
  })
  releaseAttempt(attemptId)
}

export async function failAttempt(
  attemptId: string,
  errorCode: string,
  errorRetryable = false,
): Promise<void> {
  await db.providerRequestAttempts.update(attemptId, {
    status: 'error',
    completedAt: Date.now(),
    errorCode,
    errorRetryable,
  })
  releaseAttempt(attemptId)
}

export async function cancelAttempt(attemptId: string): Promise<void> {
  await db.providerRequestAttempts.update(attemptId, {
    status: 'cancelled',
    completedAt: Date.now(),
  })
  releaseAttempt(attemptId)
}

export async function markAttemptDecidedSilent(attemptId: string): Promise<void> {
  await db.providerRequestAttempts.update(attemptId, {
    status: 'decided-silent',
    completedAt: Date.now(),
  })
  releaseAttempt(attemptId)
}

// Per the plan: every chunk callback must verify the attempt is still
// current before persisting. Returns true if the attempt is still pending
// or streaming, false otherwise (closed turn, cancelled, etc.).
export async function attemptStillCurrent(attemptId: string): Promise<boolean> {
  const row = await db.providerRequestAttempts.get(attemptId)
  if (!row) return false
  return row.status === 'pending' || row.status === 'streaming'
}

export async function closeTurn(turnId: string, stopReason: StopReason): Promise<void> {
  await db.transaction('rw', [db.turns, db.providerRequestAttempts], async () => {
    const turn = await db.turns.get(turnId)
    if (!turn || turn.status === 'closed') return
    await db.turns.update(turnId, {
      status: 'closed',
      stopReason,
      updatedAt: Date.now(),
    })
    // Abort any still-open attempts so their chunk callbacks bail.
    const open = await db.providerRequestAttempts
      .where('turnId')
      .equals(turnId)
      .filter((a) => a.status === 'pending' || a.status === 'streaming')
      .toArray()
    for (const attempt of open) {
      attemptControllers.get(attempt.id)?.abort()
      await db.providerRequestAttempts.update(attempt.id, {
        status: 'cancelled',
        completedAt: Date.now(),
      })
      releaseAttempt(attempt.id)
    }
  })
}

export async function listAttemptsForTurn(turnId: string): Promise<ProviderRequestAttempt[]> {
  return db.providerRequestAttempts
    .where('[turnId+attemptNumber]')
    .between([turnId, 0], [turnId, Number.MAX_SAFE_INTEGER])
    .toArray()
}

export async function getActiveTurnForConversation(
  conversationId: string,
): Promise<Turn | undefined> {
  const candidates = await db.turns
    .where('[conversationId+createdAt]')
    .between([conversationId, 0], [conversationId, Number.MAX_SAFE_INTEGER])
    .reverse()
    .toArray()
  return candidates.find((t) => t.status === 'active')
}

// Active turn predicate scoped to a parent chat — covers both the parent
// conversation and any thread under it. Used by the UI to decide whether
// to show the Cancel button while a channel turn fans out across the
// parent and an opened thread.
export async function getActiveTurnForParentChat(
  parentChatId: string,
): Promise<Turn | undefined> {
  const candidates = await db.turns
    .where('parentChatId')
    .equals(parentChatId)
    .toArray()
  return candidates.find((t) => t.status === 'active')
}

// Single repo-level entry for "user clicked Cancel on this chat." Closes
// the most recent active turn with `user-interrupt` (idempotent via
// closeTurn's status guard) and aborts any in-flight stream registered
// for the conversation. Safe to call when no turn is active.
export async function interruptActiveTurn(
  parentChatId: string,
): Promise<boolean> {
  const turn = await getActiveTurnForParentChat(parentChatId)
  if (!turn) return false
  // Aborting first lets the DM send-turn's catch path run and observe
  // `signal.aborted`, then it calls closeTurn itself. The explicit
  // closeTurn after is the safety net for the channel-orchestrator path,
  // which doesn't register a controller — closeTurn is idempotent.
  abortStreamsForConversation(turn.conversationId)
  await closeTurn(turn.id, 'user-interrupt')
  return true
}

export function attemptStatusFor(reason: StopReason): ProviderAttemptStatus | undefined {
  // Map a turn-level stop reason to the attempt-level status used by the
  // orchestrator when it closes a turn while attempts are still pending.
  switch (reason) {
    case 'user-interrupt':
      return 'cancelled'
    case 'error':
      return 'error'
    default:
      return undefined
  }
}

function releaseAttempt(attemptId: string): void {
  attemptControllers.delete(attemptId)
}
