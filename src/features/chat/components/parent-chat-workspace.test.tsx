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
import {
  createProvider,
  deleteProvider,
  getFirstProviderOfKind,
} from '@/features/providers/providers-repository'
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
    useLocation: () => ({ hash: '', pathname: '/', search: '' }),
  }
})

vi.mock('@/features/chat/send-turn', () => ({
  sendParentChatTurn: vi.fn(),
  sendThreadTurn: vi.fn(),
}))

const mockedSendParentChatTurn = vi.mocked(sendParentChatTurn)

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
    kind: 'dm',
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
    model: TEST_MODEL_REF,
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
    model: TEST_MODEL_REF,
    createdAt: 2,
    updatedAt: 2,
    ...overrides,
  }
}

async function setOpenRouterKey(apiKey: string) {
  const existing = await getFirstProviderOfKind('openrouter')
  if (existing) {
    await deleteProvider(existing.id)
  }
  if (apiKey) {
    await createProvider({ kind: 'openrouter', label: 'OpenRouter', apiKey })
  }
}

beforeEach(async () => {
  navigate.mockReset()
  mockedSendParentChatTurn.mockReset()
  await saveSettings({})
  await setOpenRouterKey('test-key')
})

afterEach(() => {
  cleanup()
})

describe('ParentChatWorkspace', () => {
  it('renders a missing parent chat state', async () => {
    render(<ParentChatWorkspace chatId="missing-chat" />)

    expect(await screen.findByText('Conversation not found')).toBeInTheDocument()
  })

  it('disables the parent composer when the parent chat is archived', async () => {
    await db.parentChats.add(parentChat({ archivedAt: 10, draft: 'blocked prompt' }))

    render(<ParentChatWorkspace chatId="parent-1" />)

    expect(
      await screen.findByText('This conversation is archived. Restore it from the sidebar to continue.'),
    ).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Ask anything, or /branch to fork this convo...')).toBeDisabled()
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled()
  })

  it('disables SEND but keeps the textarea editable when no provider key is configured', async () => {
    await setOpenRouterKey('')
    await db.parentChats.add(parentChat({ draft: 'queued prompt' }))

    render(<ParentChatWorkspace chatId="parent-1" />)

    expect(await screen.findByRole('link', { name: /connect/i })).toBeInTheDocument()
    const textarea = screen.getByPlaceholderText('Ask anything, or /branch to fork this convo...')
    expect(textarea).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled()

    textarea.focus()
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    expect(mockedSendParentChatTurn).not.toHaveBeenCalled()
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
      expect(screen.queryByDisplayValue('revised draft')).not.toBeInTheDocument()
      expect(screen.getByText('revised draft')).toBeInTheDocument()
      expect(screen.getByText('(edited)')).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('does not offer Edit on assistant messages', async () => {
    await db.parentChats.add(parentChat())
    await db.messages.add(message({ id: 'a1', role: 'assistant', content: 'AI reply' }))

    render(<ParentChatWorkspace chatId="parent-1" />)

    await userEvent.click(await screen.findByRole('button', { name: 'Message actions' }))

    expect(await screen.findByRole('menuitem', { name: /copy message/i })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /edit message/i })).not.toBeInTheDocument()
  })

  it('pins and unpins a parent message from the message toolbar', async () => {
    await db.parentChats.add(parentChat())
    await db.messages.add(message({ id: 'm1', content: 'Pin me for later' }))

    render(<ParentChatWorkspace chatId="parent-1" />)

    await userEvent.click(await screen.findByRole('button', { name: 'Pin message' }))

    await waitFor(async () => {
      await expect(db.pinnedMessages.where('messageId').equals('m1').count()).resolves.toBe(1)
    })
    await userEvent.click(screen.getByRole('button', { name: /pinned/i }))

    expect(await screen.findByText('Pin me for later')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Pin me for later'))

    expect(screen.getByRole('button', { name: 'Messages' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await userEvent.click(screen.getByRole('button', { name: /pinned/i }))
    expect(screen.getByRole('button', { name: 'Unpin message' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await userEvent.click(screen.getByRole('button', { name: 'Unpin message' }))

    await waitFor(async () => {
      await expect(db.pinnedMessages.where('messageId').equals('m1').count()).resolves.toBe(0)
    })
    expect(await screen.findByText('No pinned messages in this channel yet.')).toBeInTheDocument()
  })

  it('shows thread pins in the root pinned tab and opens the source thread when selected', async () => {
    await db.parentChats.add(parentChat())
    await db.messages.add(message({ id: 'root', content: 'Root message' }))
    await db.threads.add(thread({ id: 'thread-1', rootMessageId: 'root' }))
    await db.messages.add(
      message({
        id: 'thread-message',
        conversationType: 'thread',
        conversationId: 'thread-1',
        content: 'Thread pin',
      }),
    )

    render(<ParentChatWorkspace chatId="parent-1" threadId="thread-1" />)

    const pinButtons = await screen.findAllByRole('button', { name: 'Pin message' })
    await userEvent.click(pinButtons[pinButtons.length - 1])

    await waitFor(async () => {
      await expect(db.pinnedMessages.where('messageId').equals('thread-message').count()).resolves.toBe(1)
    })
    expect(screen.queryByText('Pinned messages')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /pinned/i }))
    await waitFor(() => {
      expect(screen.getAllByText('Thread pin')).toHaveLength(2)
    })

    await userEvent.click(screen.getAllByText('Thread pin')[0])

    expect(navigate).toHaveBeenCalledWith({
      to: '/chat/$chatId/thread/$threadId',
      params: {
        chatId: 'parent-1',
        threadId: 'thread-1',
      },
    })
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

  it('deletes a branch from the thread header menu and returns to the parent chat', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await db.parentChats.add(parentChat())
    await db.messages.add(message({ id: 'root', content: 'Root message', directReplyCount: 1 }))
    await db.threads.add(thread({ id: 'thread-1', rootMessageId: 'root' }))
    await db.messages.add(
      message({
        id: 'thread-message',
        conversationType: 'thread',
        conversationId: 'thread-1',
        content: 'inside the branch',
        createdAt: 2,
      }),
    )

    render(<ParentChatWorkspace chatId="parent-1" threadId="thread-1" />)

    await userEvent.click(await screen.findByRole('button', { name: 'Branch actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /delete branch/i }))

    await waitFor(async () => {
      await expect(db.threads.get('thread-1')).resolves.toBeUndefined()
      await expect(db.messages.get('thread-message')).resolves.toBeUndefined()
    })
    expect(confirmSpy).toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith({
      to: '/chat/$chatId',
      params: { chatId: 'parent-1' },
    })
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

  it('renders an assistant message with the agent display name and an AgentDot when an agentSnapshot is present', async () => {
    await db.parentChats.add(parentChat())
    await db.messages.add(
      message({
        id: 'user-1',
        content: 'hi',
      }),
    )
    await db.messages.add(
      message({
        id: 'agent-1',
        role: 'assistant',
        content: 'Hello back!',
        agentId: 'agent-pm',
        agentSnapshot: { displayName: 'PM Lens', model: TEST_MODEL_REF },
        createdAt: 2,
      }),
    )

    render(<ParentChatWorkspace chatId="parent-1" />)

    // The author label shows the agent's display name, not the model name.
    expect(await screen.findByText('PM Lens')).toBeInTheDocument()
    // The legacy "~" assistant glyph should NOT appear when an agent owns
    // the message — it is replaced by the AgentDot.
    expect(screen.queryByText('~')).toBeNull()
  })

  it('falls back to the model short name on assistant messages without an agent snapshot (AE7 byte-parity)', async () => {
    await db.parentChats.add(parentChat())
    await db.messages.add(
      message({
        id: 'assistant-1',
        role: 'assistant',
        content: 'Plain reply.',
        createdAt: 2,
      }),
    )

    render(<ParentChatWorkspace chatId="parent-1" />)

    // Model-DM behavior preserved: legacy assistant glyph remains.
    expect(await screen.findByText('~')).toBeInTheDocument()
  })

  it('renders a Cancel button while a turn is active and closes the turn when clicked', async () => {
    await db.parentChats.add(parentChat())
    const now = Date.now()
    await db.turns.add({
      id: 'turn-active',
      parentChatId: 'parent-1',
      conversationType: 'parent',
      conversationId: 'parent-1',
      status: 'active',
      userMessageId: 'm1',
      createdAt: now,
      updatedAt: now,
    })

    render(<ParentChatWorkspace chatId="parent-1" />)

    const cancelBtn = await screen.findByRole('button', { name: /^cancel$/i })
    expect(cancelBtn).toBeInTheDocument()
    await userEvent.click(cancelBtn)

    await waitFor(async () => {
      const refreshed = await db.turns.get('turn-active')
      expect(refreshed?.status).toBe('closed')
      expect(refreshed?.stopReason).toBe('user-interrupt')
    })
  })

  it('hides the Cancel button when no turn is active', async () => {
    await db.parentChats.add(parentChat())
    render(<ParentChatWorkspace chatId="parent-1" />)
    await screen.findByDisplayValue('Planning')
    expect(screen.queryByRole('button', { name: /^cancel$/i })).toBeNull()
  })

  it('shows the Channel settings affordance only on channel-kind chats', async () => {
    // First: a DM chat. The button should not render.
    await db.parentChats.add(parentChat())
    render(<ParentChatWorkspace chatId="parent-1" />)
    await screen.findByDisplayValue('Planning')
    expect(
      screen.queryByRole('button', { name: /channel settings/i }),
    ).toBeNull()

    cleanup()

    // Second: a channel chat. The button is visible and opens the dialog.
    await db.parentChats.put(parentChat({ id: 'parent-2', title: 'launch', kind: 'channel', model: null }))
    await db.channelSettings.put({
      id: 'parent-2',
      maxChainedSubTurns: 3,
      maxMessagesPerAgentPerInput: 2,
      tokenBudgetPerInput: 200_000,
      defaultParticipationMode: 'auto-decide',
      allowAgentThreading: true,
      createdAt: 1,
      updatedAt: 1,
    })

    render(<ParentChatWorkspace chatId="parent-2" />)

    const settingsBtn = await screen.findByRole('button', {
      name: /channel settings/i,
    })
    await userEvent.click(settingsBtn)

    expect(
      await screen.findByRole('heading', { name: /^launch$/i }),
    ).toBeInTheDocument()
    // Agents tab is the default tab and renders the empty state.
    expect(
      await screen.findByText(/no agents in this channel yet/i),
    ).toBeInTheDocument()
  })
})
