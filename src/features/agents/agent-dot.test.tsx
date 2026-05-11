/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { AgentDot } from './agent-dot'

afterEach(() => {
  cleanup()
})

function dotEl(view: ReturnType<typeof render>) {
  const node = view.container.firstElementChild
  if (!(node instanceof HTMLElement)) {
    throw new Error('Expected an AgentDot element to render.')
  }
  return node
}

describe('AgentDot', () => {
  it('renders initials from the first two words of the display name', () => {
    const view = render(<AgentDot displayName="Senior Reviewer" />)
    expect(dotEl(view).textContent).toBe('SR')
  })

  it('takes the first two characters when the name has one word', () => {
    const view = render(<AgentDot displayName="Critic" />)
    expect(dotEl(view).textContent).toBe('CR')
  })

  it('keeps the same color for the same id across renders (deterministic palette)', () => {
    const first = render(<AgentDot agentId="agent-1" displayName="A" />)
    const second = render(<AgentDot agentId="agent-1" displayName="A" />)
    const firstClass = dotEl(first).className
    const secondClass = dotEl(second).className
    const colorClass = (cls: string) => cls.split(/\s+/).find((c) => c.startsWith('bg-'))
    expect(colorClass(firstClass)).toBe(colorClass(secondClass))
  })

  it('falls back to display-name-based color when agentId is missing', () => {
    const view = render(<AgentDot displayName="Hello" />)
    expect(dotEl(view).className).toMatch(/bg-[a-z]+-500/)
  })
})
