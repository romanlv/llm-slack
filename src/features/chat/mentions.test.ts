import { describe, expect, it } from 'vitest'

import { parseMentions } from '@/features/chat/mentions'

const critic = { id: 'a-critic', displayName: 'Critic', username: 'critic' }
const strategist = { id: 'a-strat', displayName: 'Strategist', username: 'strat' }
const senior = { id: 'a-senior', displayName: 'Senior', username: 'snr' }
const seniorReviewer = { id: 'a-sr', displayName: 'Senior Reviewer', username: 'sr' }

describe('parseMentions', () => {
  it('matches a single mention case-insensitively', () => {
    expect(parseMentions('@critic what do you think?', [critic])).toEqual(['a-critic'])
    expect(parseMentions('@CRITIC??', [critic])).toEqual(['a-critic'])
  })

  it('prefers the longest match when multiple candidates share a prefix', () => {
    expect(
      parseMentions('@Senior Reviewer please weigh in', [senior, seniorReviewer]),
    ).toEqual(['a-sr'])
  })

  it('still matches the short candidate when the longer one would not fit', () => {
    expect(parseMentions('@Senior!', [senior, seniorReviewer])).toEqual(['a-senior'])
  })

  it('returns matched ids in first-occurrence order without duplicates', () => {
    const text = '@critic and @strategist and again @critic'
    expect(parseMentions(text, [critic, strategist])).toEqual(['a-critic', 'a-strat'])
  })

  it('ignores mentions inside fenced code blocks', () => {
    const text = '```\n@critic this is in code\n```\nbut @strategist is in prose'
    expect(parseMentions(text, [critic, strategist])).toEqual(['a-strat'])
  })

  it('ignores mentions inside inline code spans', () => {
    expect(
      parseMentions('the `@critic` token is literal but @strategist is mentioned', [
        critic,
        strategist,
      ]),
    ).toEqual(['a-strat'])
  })

  it('does not match email-shaped tokens', () => {
    expect(
      parseMentions('ping me at user@example.com', [
        { id: 'u', displayName: 'example' },
      ]),
    ).toEqual([])
  })

  it('matches when followed by punctuation but not when followed by a letter', () => {
    expect(parseMentions('hello @Critic, please!', [critic])).toEqual(['a-critic'])
    expect(parseMentions('hello @CriticSpecial', [critic])).toEqual([])
  })

  it('returns [] when there are no candidates', () => {
    expect(parseMentions('@anybody', [])).toEqual([])
  })

  it('returns [] when text has no @ at all', () => {
    expect(parseMentions('just prose', [critic])).toEqual([])
  })

  it('only matches at word-start (so cat@critic does not match)', () => {
    expect(parseMentions('cat@critic', [critic])).toEqual([])
  })

  it('matches by username when the displayName has spaces', () => {
    expect(parseMentions('hey @sr please weigh in', [seniorReviewer])).toEqual(['a-sr'])
    expect(parseMentions('hey @SR please', [seniorReviewer])).toEqual(['a-sr'])
  })

  it('treats username and displayName as equivalent handles for the same agent', () => {
    // Two different forms of the same agent shouldn't produce duplicate ids.
    const text = '@strat then later @Strategist again'
    expect(parseMentions(text, [strategist])).toEqual(['a-strat'])
  })

  it('still works for candidates without a username (back-compat)', () => {
    const legacy = { id: 'legacy', displayName: 'Legacy' }
    expect(parseMentions('@legacy hello', [legacy])).toEqual(['legacy'])
  })
})
