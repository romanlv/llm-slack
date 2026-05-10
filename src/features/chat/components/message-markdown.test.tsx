/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { MessageMarkdown } from './message-markdown'

afterEach(() => {
  cleanup()
})

describe('MessageMarkdown', () => {
  it('renders bold, italic, and inline code', () => {
    render(<MessageMarkdown content="**bold** and *italic* and `code`" />)

    expect(screen.getByText('bold').tagName).toBe('STRONG')
    expect(screen.getByText('italic').tagName).toBe('EM')
    expect(screen.getByText('code').tagName).toBe('CODE')
  })

  it('renders headings, lists, and links with safe link attributes', () => {
    render(
      <MessageMarkdown
        content={[
          '# Title',
          '',
          '- one',
          '- two',
          '',
          '[Anthropic](https://anthropic.com)',
        ].join('\n')}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem').map((node) => node.textContent)).toEqual([
      'one',
      'two',
    ])

    const link = screen.getByRole('link', { name: 'Anthropic' })
    expect(link).toHaveAttribute('href', 'https://anthropic.com')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('renders fenced code blocks inside a pre wrapper', () => {
    render(<MessageMarkdown content={'```ts\nconst x = 1\n```'} />)

    const code = screen.getByText('const x = 1')
    expect(code.tagName).toBe('CODE')
    expect(code.parentElement?.tagName).toBe('PRE')
  })

  it('does not render raw HTML embedded in markdown', () => {
    const { container } = render(
      <MessageMarkdown content="Hello <script>alert('x')</script> world" />,
    )

    expect(container.querySelector('script')).toBeNull()
  })

  it('renders gfm extensions like strikethrough and tables', () => {
    render(
      <MessageMarkdown
        content={[
          '~~gone~~',
          '',
          '| a | b |',
          '| - | - |',
          '| 1 | 2 |',
        ].join('\n')}
      />,
    )

    expect(screen.getByText('gone').tagName).toBe('DEL')
    expect(screen.getByRole('table')).toBeInTheDocument()
  })
})
