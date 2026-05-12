import { describe, expect, it } from 'vitest'

import { db } from '@/features/chat/database'
import {
  attemptStillCurrent,
  cancelAttempt,
  closeTurn,
  completeAttempt,
  failAttempt,
  getActiveTurnForConversation,
  getActiveTurnForParentChat,
  interruptActiveTurn,
  listAttemptsForTurn,
  markAttemptStreaming,
  openAttempt,
  openTurn,
} from '@/features/chat/turn-lifecycle'
import { withFrozenClock } from '@/test/clock'
import { makeModelRef, seedMessageInParent, seedModelDm } from '@/test/fixtures'

describe('turn lifecycle', () => {
  it('openTurn + openAttempt + completeAttempt + closeTurn round-trips', async () => {
    const chat = await seedModelDm()
    const user = await seedMessageInParent(chat.id, { role: 'user', content: 'hi' })
    const assistant = await seedMessageInParent(chat.id, {
      role: 'assistant',
      status: 'streaming',
      content: '',
    })

    const turn = await openTurn({
      parentChatId: chat.id,
      conversationType: 'parent',
      conversationId: chat.id,
      userMessageId: user.id,
    })
    expect(turn.status).toBe('active')

    const { attempt } = await openAttempt({
      turnId: turn.id,
      assistantMessageId: assistant.id,
      model: makeModelRef({ providerModelId: 'm' }),
    })
    expect(attempt.attemptNumber).toBe(1)
    await markAttemptStreaming(attempt.id)

    await completeAttempt(attempt.id, { providerRequestId: 'req-1' })
    await closeTurn(turn.id, 'complete')

    const stored = await db.turns.get(turn.id)
    expect(stored?.status).toBe('closed')
    expect(stored?.stopReason).toBe('complete')

    const attempts = await listAttemptsForTurn(turn.id)
    expect(attempts).toHaveLength(1)
    expect(attempts[0].status).toBe('complete')
    expect(attempts[0].providerRequestId).toBe('req-1')
  })

  it('closeTurn aborts open attempts and marks them cancelled', async () => {
    const chat = await seedModelDm()
    const turn = await openTurn({
      parentChatId: chat.id,
      conversationType: 'parent',
      conversationId: chat.id,
      userMessageId: 'u',
    })
    const { attempt, controller } = await openAttempt({
      turnId: turn.id,
      assistantMessageId: 'a',
      model: makeModelRef(),
    })

    await closeTurn(turn.id, 'user-interrupt')

    expect(controller.signal.aborted).toBe(true)
    const refreshed = await db.providerRequestAttempts.get(attempt.id)
    expect(refreshed?.status).toBe('cancelled')
  })

  it('attemptStillCurrent returns false once the attempt closes', async () => {
    const chat = await seedModelDm()
    const turn = await openTurn({
      parentChatId: chat.id,
      conversationType: 'parent',
      conversationId: chat.id,
      userMessageId: 'u',
    })
    const { attempt } = await openAttempt({
      turnId: turn.id,
      assistantMessageId: 'a',
      model: makeModelRef(),
    })
    await markAttemptStreaming(attempt.id)
    expect(await attemptStillCurrent(attempt.id)).toBe(true)

    await failAttempt(attempt.id, 'rate-limited')
    expect(await attemptStillCurrent(attempt.id)).toBe(false)
  })

  it('strictly monotonic attemptNumber within a turn under a frozen clock', async () => {
    const chat = await seedModelDm()
    const turn = await openTurn({
      parentChatId: chat.id,
      conversationType: 'parent',
      conversationId: chat.id,
      userMessageId: 'u',
    })

    await withFrozenClock(1000, async () => {
      const a = await openAttempt({ turnId: turn.id, assistantMessageId: 'a', model: makeModelRef() })
      const b = await openAttempt({ turnId: turn.id, assistantMessageId: 'b', model: makeModelRef() })
      const c = await openAttempt({ turnId: turn.id, assistantMessageId: 'c', model: makeModelRef() })
      expect([a.attempt.attemptNumber, b.attempt.attemptNumber, c.attempt.attemptNumber]).toEqual([
        1, 2, 3,
      ])
    })
  })

  it('getActiveTurnForConversation returns the latest active turn or undefined', async () => {
    const chat = await seedModelDm()
    expect(await getActiveTurnForConversation(chat.id)).toBeUndefined()

    const turn = await openTurn({
      parentChatId: chat.id,
      conversationType: 'parent',
      conversationId: chat.id,
      userMessageId: 'u',
    })
    expect((await getActiveTurnForConversation(chat.id))?.id).toBe(turn.id)

    await closeTurn(turn.id, 'complete')
    expect(await getActiveTurnForConversation(chat.id)).toBeUndefined()
  })

  it('interruptActiveTurn closes the active turn for a parent chat with user-interrupt', async () => {
    const chat = await seedModelDm()
    const turn = await openTurn({
      parentChatId: chat.id,
      conversationType: 'parent',
      conversationId: chat.id,
      userMessageId: 'u',
    })
    await openAttempt({
      turnId: turn.id,
      assistantMessageId: 'a',
      model: makeModelRef(),
    })

    const closed = await interruptActiveTurn(chat.id)
    expect(closed).toBe(true)

    const refreshed = await db.turns.get(turn.id)
    expect(refreshed?.status).toBe('closed')
    expect(refreshed?.stopReason).toBe('user-interrupt')
  })

  it('interruptActiveTurn returns false when no turn is active for the chat', async () => {
    const chat = await seedModelDm()
    expect(await interruptActiveTurn(chat.id)).toBe(false)
  })

  it('interruptActiveTurn is idempotent — calling twice does not change the stop reason', async () => {
    const chat = await seedModelDm()
    const turn = await openTurn({
      parentChatId: chat.id,
      conversationType: 'parent',
      conversationId: chat.id,
      userMessageId: 'u',
    })
    expect(await interruptActiveTurn(chat.id)).toBe(true)
    // Already closed — getActiveTurnForParentChat returns undefined now.
    expect(await interruptActiveTurn(chat.id)).toBe(false)
    const refreshed = await db.turns.get(turn.id)
    expect(refreshed?.stopReason).toBe('user-interrupt')
  })

  it('getActiveTurnForParentChat finds turns under a thread sharing the same parent', async () => {
    const chat = await seedModelDm()
    const threadTurn = await openTurn({
      parentChatId: chat.id,
      conversationType: 'thread',
      conversationId: 'thread-xyz',
      userMessageId: 'u',
    })
    expect(await getActiveTurnForParentChat(chat.id)).toMatchObject({
      id: threadTurn.id,
    })
  })

  it('cancelAttempt releases the controller from the in-memory map', async () => {
    const chat = await seedModelDm()
    const turn = await openTurn({
      parentChatId: chat.id,
      conversationType: 'parent',
      conversationId: chat.id,
      userMessageId: 'u',
    })
    const { attempt, controller } = await openAttempt({
      turnId: turn.id,
      assistantMessageId: 'a',
      model: makeModelRef(),
    })
    await cancelAttempt(attempt.id)
    // Aborting now is a no-op against the controller map; the lifecycle's
    // closeTurn path will not try to abort again.
    expect(controller.signal.aborted).toBe(false)
    expect((await db.providerRequestAttempts.get(attempt.id))?.status).toBe('cancelled')
  })
})
