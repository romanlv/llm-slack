/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatMessage, ParentChat } from '@/features/chat/domain'
import { db } from '@/features/chat/repository'
import { DEFAULT_SETTINGS } from '@/features/settings/settings-repository'

import { ChatShell } from './chat-shell'

const navigate = vi.fn()
const location = { pathname: '/chat/parent-1' }

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    ...props
  }: {
    children: ReactNode
    to: string
    params?: Record<string, string>
    [key: string]: unknown
  }) => {
    const href = params
      ? Object.entries(params).reduce(
          (acc, [key, value]) => acc.replaceAll(`$${key}`, value),
          to,
        )
      : to
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
  Outlet: () => <div data-testid="outlet" />,
  useNavigate: () => navigate,
  useLocation: () => location,
}))

const TEST_MODEL_REF = {
  providerKind: 'openrouter' as const,
  providerModelId: 'openai/gpt-4o-mini',
}

function parentChat(overrides: Partial<ParentChat> = {}): ParentChat {
  return {
    id: 'parent-1',
    title: 'Planning',
    model: TEST_MODEL_REF,
    createdAt: 1,
    updatedAt: 1,
    draft: '',
    lastActivityPreview: '',
    ...overrides,
  }
}

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'message-1',
    conversationType: 'parent',
    conversationId: 'parent-1',
    parentChatId: 'parent-1',
    role: 'user',
    content: 'hello',
    createdAt: 1,
    status: 'complete',
    directReplyCount: 0,
    model: TEST_MODEL_REF,
    ...overrides,
  }
}

beforeEach(async () => {
  navigate.mockReset()
  location.pathname = '/chat/parent-1'
  await db.settings.put(DEFAULT_SETTINGS)
})

afterEach(() => {
  cleanup()
})

describe('ChatShell chat actions', () => {
  it('links to the GitHub repository from the sidebar footer', async () => {
    await db.parentChats.add(parentChat({ id: 'parent-1', title: 'Planning' }))

    render(<ChatShell />)

    const link = await screen.findByRole('link', { name: /github/i }, { timeout: 3000 })
    expect(link).toHaveAttribute('href', 'https://github.com/romanlv/llm-slack')
  })

  it('deletes a chat from the sidebar menu after confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await db.parentChats.bulkAdd([
      parentChat({ id: 'parent-1', title: 'Planning', updatedAt: 2 }),
      parentChat({ id: 'parent-2', title: 'Other', updatedAt: 1 }),
    ])
    await db.messages.add(message({}))

    render(<ChatShell />)

    await userEvent.click(
      await screen.findByRole(
        'button',
        { name: 'Actions for Planning' },
        { timeout: 3000 },
      ),
    )
    await userEvent.click(await screen.findByRole('menuitem', { name: /delete chat/i }))

    expect(confirmSpy).toHaveBeenCalled()
    await waitFor(async () => {
      await expect(db.parentChats.get('parent-1')).resolves.toBeUndefined()
    })
    expect(navigate).toHaveBeenCalledWith({ to: '/' })
    await expect(db.messages.get('message-1')).resolves.toBeUndefined()
    await expect(db.parentChats.get('parent-2')).resolves.toBeDefined()
  })

  it('aborts deletion when confirmation is dismissed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await db.parentChats.add(parentChat({ id: 'parent-1', title: 'Planning' }))

    render(<ChatShell />)

    await userEvent.click(
      await screen.findByRole(
        'button',
        { name: 'Actions for Planning' },
        { timeout: 3000 },
      ),
    )
    await userEvent.click(await screen.findByRole('menuitem', { name: /delete chat/i }))

    await expect(db.parentChats.get('parent-1')).resolves.toBeDefined()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('renders starred chats in the Starred section and other chats in Recent', async () => {
    location.pathname = '/chat/parent-active'
    await db.parentChats.bulkAdd([
      parentChat({ id: 'parent-active', title: 'Active chat', updatedAt: 5 }),
      parentChat({ id: 'parent-star', title: 'Important', updatedAt: 4, starredAt: 99 }),
      parentChat({ id: 'parent-other', title: 'Other chat', updatedAt: 3 }),
    ])

    render(<ChatShell />)

    const starredHeading = await screen.findByText('Starred', undefined, { timeout: 3000 })
    const starredSection = starredHeading.closest('section')
    expect(starredSection).not.toBeNull()
    expect(starredSection!.textContent).toContain('Important')
    expect(starredSection!.textContent).not.toContain('Other chat')

    const recentHeading = screen.getByText('Recent')
    const recentSection = recentHeading.closest('section')
    expect(recentSection).not.toBeNull()
    expect(recentSection!.textContent).toContain('Other chat')
    expect(recentSection!.textContent).not.toContain('Important')
    // Active chat stays visible in Recent so the list does not shift on selection.
    expect(recentSection!.textContent).toContain('Active chat')
  })

  it('toggles star state from the chat actions menu', async () => {
    location.pathname = '/chat/parent-1'
    await db.parentChats.add(parentChat({ id: 'parent-1', title: 'Planning' }))

    render(<ChatShell />)

    await userEvent.click(
      await screen.findByRole(
        'button',
        { name: 'Actions for Planning' },
        { timeout: 3000 },
      ),
    )
    await userEvent.click(await screen.findByRole('menuitem', { name: /star chat/i }))

    await waitFor(async () => {
      const chat = await db.parentChats.get('parent-1')
      expect(chat?.starredAt).toEqual(expect.any(Number))
    })
  })

  it('does not navigate away when deleting a non-active chat', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    location.pathname = '/chat/parent-1'
    await db.parentChats.bulkAdd([
      parentChat({ id: 'parent-1', title: 'Planning', updatedAt: 2 }),
      parentChat({ id: 'parent-2', title: 'Other', updatedAt: 1 }),
    ])

    render(<ChatShell />)

    await userEvent.click(
      await screen.findByRole(
        'button',
        { name: 'Actions for Other' },
        { timeout: 3000 },
      ),
    )
    await userEvent.click(await screen.findByRole('menuitem', { name: /delete chat/i }))

    await waitFor(async () => {
      await expect(db.parentChats.get('parent-2')).resolves.toBeUndefined()
    })
    expect(navigate).not.toHaveBeenCalled()
  })
})
