import { describe, expect, it } from 'vitest'

import type { Agent } from '@/features/chat/domain'
import {
  applyMentionInsertion,
  detectMentionQuery,
  filterAgentsForMention,
} from './mention-autocomplete-engine'
import { makeModelRef } from '@/test/fixtures'

function agent(displayName: string, username: string): Agent {
  const now = 0
  return {
    id: `id-${username}`,
    displayName,
    username,
    model: makeModelRef(),
    systemPrompt: '',
    chattiness: 2,
    createdAt: now,
    updatedAt: now,
  }
}

const critic = agent('Critic', 'critic')
const strategist = agent('Strategist', 'strat')
const seniorReviewer = agent('Senior Reviewer', 'sr')

describe('detectMentionQuery', () => {
  it('opens immediately after a bare @ at start of line', () => {
    const q = detectMentionQuery('@', 1)
    expect(q).toEqual({ start: 0, end: 1, query: '' })
  })

  it('opens after @ that follows whitespace', () => {
    const q = detectMentionQuery('hello @cri', 'hello @cri'.length)
    expect(q).toEqual({ start: 6, end: 10, query: 'cri' })
  })

  it('does not open when @ is preceded by a non-space character (email-style)', () => {
    expect(detectMentionQuery('mail user@example.com', 'mail user@e'.length)).toBeNull()
  })

  it('closes when the caret crosses a space', () => {
    expect(detectMentionQuery('@critic ', 8)).toBeNull()
  })

  it('returns null when the caret is at position 0', () => {
    expect(detectMentionQuery('@', 0)).toBeNull()
  })
})

describe('filterAgentsForMention', () => {
  it('ranks username prefix matches above displayName prefix matches', () => {
    const out = filterAgentsForMention({
      agents: [critic, strategist, seniorReviewer],
      query: 'sr',
    })
    expect(out[0]?.id).toBe(seniorReviewer.id) // username prefix wins
  })

  it('falls back to substring matches when no prefix matches exist', () => {
    const found = agent('Found Agent', 'found')
    const result = filterAgentsForMention({ agents: [found], query: 'oun' })
    expect(result.map((a) => a.id)).toEqual([found.id])
  })

  it('returns the full list (sorted) on empty query', () => {
    const out = filterAgentsForMention({
      agents: [strategist, critic, seniorReviewer],
      query: '',
    })
    expect(out.map((a) => a.displayName)).toEqual(['Critic', 'Senior Reviewer', 'Strategist'])
  })

  it('returns an empty array when nothing matches', () => {
    expect(filterAgentsForMention({ agents: [critic], query: 'xyz' })).toEqual([])
  })
})

describe('applyMentionInsertion', () => {
  it('replaces the in-progress @query with @username and a trailing space', () => {
    const next = applyMentionInsertion('hey @cri', 'hey @cri'.length, critic)
    expect(next.value).toBe('hey @critic ')
    expect(next.caret).toBe('hey @critic '.length)
  })

  it('does not double up the trailing space when one already follows', () => {
    const next = applyMentionInsertion('hey @cri ok', 'hey @cri'.length, critic)
    expect(next.value).toBe('hey @critic ok')
  })

  it('is a no-op when the caret is not inside an active mention query', () => {
    const next = applyMentionInsertion('plain text', 5, critic)
    expect(next.value).toBe('plain text')
    expect(next.caret).toBe(5)
  })
})
