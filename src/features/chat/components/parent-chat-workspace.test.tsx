/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatMessage, ConversationThread, ParentChat } from '@/features/chat/domain'
import { db } from '@/features/chat/repository'
import { sendParentChatTurn } from '@/features/chat/send-turn'
import { saveSettings } from '@/features/settings/settings-repository'

import { ParentChatWorkspace } from './parent-chat-workspace'

const navigate = vi.fn()

vi.mock('@tanstack/react-router', () => {
  return {
    Link: ({
      children,
      to,
      ...props
    }: {
      children: ReactNode
      to: string
      [key: string]: unknown
    }) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
    useNavigate: () => navigate,
  }
})

vi.mock('@/features/chat/send-turn', () => ({
  sendParentChatTurn: vi.fn(),
  sendThreadTurn: vi.fn(),
}))

const mockedSendParentChatTurn = vi.mocked(sendParentChatTurn)

function parentChat(overrides: Partial<ParentChat> = {}): ParentChat {
  return {
    id: 'parent-1',
    title: 'Planning',
    model: 'openai/gpt-4o-mini',
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
    content: 'Root message',
    createdAt: 1,
    status: 'complete',
    directReplyCount: 0,
    model: 'openai/gpt-4o-mini',
    ...overrides,
  }
}

function thread(overrides: Partial<ConversationThread> = {}): ConversationThread {
  return {
    id: 'thread-1',
    parentChatId: 'parent-1',
    rootMessageId: 'message-1',
    depth: 1,
    draft: '',
    model: 'openai/gpt-4o-mini',
    createdAt: 2,
    updatedAt: 2,
    ...overrides,
  }
}

beforeEach(() => {
  navigate.mockReset()
  mockedSendParentChatTurn.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('ParentChatWorkspace', () => {
  it('renders a missing parent chat state', async () => {
    render(<ParentChatWorkspace chatId="missing-chat" />)

    expect(await screen.findByText('Parent chat not found')).toBeInTheDocument()
  })

  it('disables the parent composer when the parent chat is archived', async () => {
    await db.parentChats.add(parentChat({ archivedAt: 10, draft: 'blocked prompt' }))

    render(<ParentChatWorkspace chatId="parent-1" />)

    expect(
      await screen.findByText('This parent chat is archived. Restore it from the sidebar to continue.'),
    ).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Ask anything, or /branch to fork this convo...')).toBeDisabled()
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled()
  })

  it('submits the parent draft with the command-enter keyboard shortcut', async () => {
    mockedSendParentChatTurn.mockResolvedValueOnce(undefined)
    await db.parentChats.add(parentChat({ draft: 'Summarize this plan' }))

    render(<ParentChatWorkspace chatId="parent-1" />)

    const textarea = await screen.findByPlaceholderText('Ask anything, or /branch to fork this convo...')
    textarea.focus()
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')

    await waitFor(() => {
      expect(mockedSendParentChatTurn).toHaveBeenCalledWith('parent-1', 'Summarize this plan')
    })
  })

  it('shows an explicit missing thread state and disables the thread composer', async () => {
    await db.parentChats.add(parentChat())

    render(<ParentChatWorkspace chatId="parent-1" threadId="missing-thread" />)

    expect(await screen.findByText('This branch does not exist in local storage.')).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText('Continue this branch, or /branch to fork again...'),
    ).toBeDisabled()
  })

  it('opens an existing branch when a message reply count is selected', async () => {
    await db.parentChats.add(parentChat())
    await db.messages.add(message({ directReplyCount: 2 }))
    await db.threads.add(thread())

    render(<ParentChatWorkspace chatId="parent-1" />)

    await userEvent.click(await screen.findByRole('button', { name: '2 msgs' }))

    expect(navigate).toHaveBeenCalledWith({
      to: '/chat/$chatId/thread/$threadId',
      params: {
        chatId: 'parent-1',
        threadId: 'thread-1',
      },
    })
  })

  it('copies the message content from the per-message actions menu', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    await db.parentChats.add(parentChat())
    await db.messages.add(message({ content: 'Copy me please' }))

    render(<ParentChatWorkspace chatId="parent-1" />)

    await userEvent.click(await screen.findByRole('button', { name: 'Message actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /copy message/i }))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('Copy me please')
    })
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
  })

  it('renders user messages with the configured local profile name', async () => {
    await saveSettings({ userName: 'Ada Lovelace' })
    await db.parentChats.add(parentChat())
    await db.messages.add(message({ content: 'Profile check' }))

    render(<ParentChatWorkspace chatId="parent-1" />)

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('AL')).toBeInTheDocument()
  })

  it('edits a user message via the actions menu and persists the change', async () => {
    await db.parentChats.add(parentChat())
    await db.messages.add(message({ id: 'm1', content: 'first draft' }))

    render(<ParentChatWorkspace chatId="parent-1" />)

    await userEvent.click(await screen.findByRole('button', { name: 'Message actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /edit message/i }))

    const textarea = await screen.findByDisplayValue('first draft')
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'revised draft')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(async () => {
      const stored = await db.messages.get('m1')
      expect(stored?.content).toBe('revised draft')
      expect(stored?.editedAt).toBeGreaterThan(0)
    })
    expect(await screen.findByText('revised draft')).toBeInTheDocument()
    expect(screen.getByText('(edited)')).toBeInTheDocument()
  })

  it('does not offer Edit on assistant messages', async () => {
    await db.parentChats.add(parentChat())
    await db.messages.add(message({ id: 'a1', role: 'assistant', content: 'AI reply' }))

    render(<ParentChatWorkspace chatId="parent-1" />)

    await userEvent.click(await screen.findByRole('button', { name: 'Message actions' }))

    expect(await screen.findByRole('menuitem', { name: /copy message/i })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /edit message/i })).not.toBeInTheDocument()
  })

  it('deletes a confirmed message and removes it from the chat', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await db.parentChats.add(parentChat())
    await db.messages.bulkAdd([
      message({ id: 'm1', content: 'goodbye', createdAt: 1 }),
      message({ id: 'm2', content: 'still here', createdAt: 2 }),
    ])

    render(<ParentChatWorkspace chatId="parent-1" />)

    const triggers = await screen.findAllByRole('button', { name: 'Message actions' })
    await userEvent.click(triggers[0])
    await userEvent.click(await screen.findByRole('menuitem', { name: /delete message/i }))

    await waitFor(async () => {
      await expect(db.messages.get('m1')).resolves.toBeUndefined()
    })
    expect(confirmSpy).toHaveBeenCalled()
    expect(screen.queryByText('goodbye')).not.toBeInTheDocument()
    expect(screen.getByText('still here')).toBeInTheDocument()
  })

  it('aborts deletion when the confirmation prompt is dismissed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await db.parentChats.add(parentChat())
    await db.messages.add(message({ id: 'm1', content: 'keep me' }))

    render(<ParentChatWorkspace chatId="parent-1" />)

    await userEvent.click(await screen.findByRole('button', { name: 'Message actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /delete message/i }))

    await expect(db.messages.get('m1')).resolves.toBeDefined()
    expect(screen.getByText('keep me')).toBeInTheDocument()
  })
})
