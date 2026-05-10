import { describe, expect, it } from 'vitest'

import { messageToTransport, previewText, titleFromPrompt, type ChatMessage } from './domain'

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'message',
    conversationType: 'parent',
    conversationId: 'parent',
    parentChatId: 'parent',
    role: 'user',
    content: 'hello',
    createdAt: 1,
    status: 'complete',
    directReplyCount: 0,
    ...overrides,
  }
}

describe('chat domain text derivation', () => {
  it('normalizes previews and derives bounded titles', () => {
    expect(previewText('  hello\n\nthere\tfriend  ')).toBe('hello there friend')
    expect(titleFromPrompt('x'.repeat(60))).toBe(`${'x'.repeat(49)}...`)
  })

  it('strips markdown syntax when deriving previews', () => {
    expect(previewText('# Heading\n**bold** and *italic*')).toBe('Heading bold and italic')
    expect(previewText('see [docs](https://example.com) for more')).toBe('see docs for more')
    expect(previewText('- one\n- two\n- three')).toBe('one two three')
    expect(previewText('use `code` here')).toBe('use code here')
  })
})

describe('messageToTransport', () => {
  it('keeps meaningful user/system messages and only complete assistant replies', () => {
    expect(
      messageToTransport([
        message({ role: 'system', content: '  system instruction  ' }),
        message({ role: 'user', content: 'question' }),
        message({ role: 'assistant', status: 'streaming', content: 'partial' }),
        message({ role: 'assistant', status: 'error', content: 'failed' }),
        message({ role: 'assistant', status: 'complete', content: 'answer' }),
        message({ role: 'user', content: '   ' }),
      ]),
    ).toEqual([
      { role: 'system', content: '  system instruction  ' },
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'answer' },
    ])
  })
})
