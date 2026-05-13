import { describe, expect, it } from 'vitest'

import { silenceSentinel } from '@/features/chat/defaults'
import {
  buildDecideSystemPrompt,
  parseAgentResponse,
} from '@/features/chat/decide-to-respond'

describe('parseAgentResponse', () => {
  it('returns silence for an empty response', () => {
    expect(parseAgentResponse('')).toEqual({ respond: false, content: '' })
    expect(parseAgentResponse('   \n')).toEqual({ respond: false, content: '' })
  })

  it('returns silence when the response is exactly the silence sentinel after trimming', () => {
    expect(parseAgentResponse(silenceSentinel)).toEqual({ respond: false, content: '' })
    expect(parseAgentResponse(`  ${silenceSentinel}\n`)).toEqual({
      respond: false,
      content: '',
    })
  })

  it('treats the sentinel with extra text as plain content', () => {
    const out = parseAgentResponse(`${silenceSentinel}\nActually, one concern.`)
    expect(out).toEqual({
      respond: true,
      content: `${silenceSentinel}\nActually, one concern.`,
    })
  })

  it('treats the sentinel mid-text as plain content', () => {
    const out = parseAgentResponse(`Quote: "${silenceSentinel}" means decline.`)
    expect(out.respond).toBe(true)
    expect(out.content).toContain(silenceSentinel)
  })

  it('treats plain text as a reply on the main timeline', () => {
    const out = parseAgentResponse('hello, here is my take')
    expect(out).toEqual({ respond: true, content: 'hello, here is my take' })
  })

  it('parses a JSON envelope declaring respondIn=thread', () => {
    const raw = JSON.stringify({
      respond: true,
      respondIn: 'thread',
      content: 'opening thread',
    })
    expect(parseAgentResponse(raw)).toEqual({
      respond: true,
      respondIn: 'thread',
      content: 'opening thread',
    })
  })

  it('parses a JSON envelope declaring respond=false as silence', () => {
    expect(parseAgentResponse('{"respond": false}')).toEqual({ respond: false, content: '' })
  })

  it('treats JSON respond=true with empty or missing content as no-message fallback', () => {
    expect(parseAgentResponse('{"respond": true, "content": ""}')).toEqual({
      respond: false,
      content: '',
    })
    expect(parseAgentResponse('{"respond": true}')).toEqual({
      respond: false,
      content: '',
    })
    expect(parseAgentResponse('{"respond": true, "content": "   "}')).toEqual({
      respond: false,
      content: '',
    })
  })

  it('falls back to plain-text when the JSON envelope is malformed', () => {
    const out = parseAgentResponse('{ not json: yes }')
    expect(out.respond).toBe(true)
    expect(out.content).toContain('not json')
  })
})

describe('buildDecideSystemPrompt', () => {
  it('lists participants and references the silence sentinel', () => {
    const text = buildDecideSystemPrompt({
      channelTitle: 'q2-launch',
      participants: [{ displayName: 'Strategist' }, { displayName: 'Critic' }],
      agentSystemPrompt: 'You are the Critic.',
      allowAgentThreading: false,
      isInsideThread: false,
    })
    expect(text).toContain('q2-launch')
    expect(text).toContain('Strategist')
    expect(text).toContain('Critic')
    expect(text).toContain(silenceSentinel)
    expect(text).toContain('You are the Critic.')
  })

  it('includes the threading instruction only when allowed and not already in a thread', () => {
    const withThreading = buildDecideSystemPrompt({
      channelTitle: 'c',
      participants: [],
      agentSystemPrompt: '',
      allowAgentThreading: true,
      isInsideThread: false,
    })
    expect(withThreading).toContain('respondIn')

    const inThread = buildDecideSystemPrompt({
      channelTitle: 'c',
      participants: [],
      agentSystemPrompt: '',
      allowAgentThreading: true,
      isInsideThread: true,
    })
    expect(inThread).not.toContain('respondIn')

    const noThreading = buildDecideSystemPrompt({
      channelTitle: 'c',
      participants: [],
      agentSystemPrompt: '',
      allowAgentThreading: false,
      isInsideThread: false,
    })
    expect(noThreading).not.toContain('respondIn')
  })
})
