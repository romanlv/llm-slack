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
  it('renders initials: first two words, falling back to first two characters', () => {
    expect(dotEl(render(<AgentDot displayName="Senior Reviewer" />)).textContent).toBe('SR')
    cleanup()
    expect(dotEl(render(<AgentDot displayName="Critic" />)).textContent).toBe('CR')
  })

  it('picks a stable color per id (deterministic palette)', () => {
    const colorOf = (view: ReturnType<typeof render>) =>
      dotEl(view)
        .className.split(/\s+/)
        .find((c) => c.startsWith('bg-'))
    const first = colorOf(render(<AgentDot agentId="agent-1" displayName="A" />))
    cleanup()
    const second = colorOf(render(<AgentDot agentId="agent-1" displayName="A" />))
    expect(first).toBe(second)
  })
})
