/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { createAgent } from '@/features/agents/agents-repository'
import { db } from '@/features/chat/database'
import { createProvider } from '@/features/providers/providers-repository'

import { NewChatModal } from './new-chat-modal'

afterEach(() => {
  cleanup()
})

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => setOpen(true)} type="button">
        Open new chat
      </button>
      <Outlet />
      <NewChatModal onOpenChange={setOpen} open={open} />
    </div>
  )
}

function renderWithHarness() {
  // Render the Harness around the matched route so the "Open new chat"
  // affordance stays mounted after navigation. Lets us re-open the modal
  // from the chat-page placeholder to test repeat-entry behavior.
  const rootRoute = createRootRoute({
    component: () => (
      <Harness />
    ),
  })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <Outlet />,
  })
  const chatRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/chat/$chatId',
    component: () => <div data-testid="chat-page">chat</div>,
  })
  const agentsSettingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings/agents',
    component: () => <div data-testid="agents-settings">agents library</div>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, chatRoute, agentsSettingsRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return { view: render(<RouterProvider router={router} />), router }
}

async function seedAgent(displayName: string) {
  const provider = await createProvider({ kind: 'openai', apiKey: 'sk-proj-test' })
  return createAgent({
    displayName,
    model: {
      providerId: provider.id,
      providerKind: 'openai',
      providerModelId: 'gpt-5.5',
    },
    systemPrompt: '',
  })
}

describe('NewChatModal', () => {
  it('opens on Model tab and creates a model-DM via Start', async () => {
    const { router } = renderWithHarness()

    await userEvent.click(await screen.findByRole("button", { name: /open new chat/i }))
    expect(
      await screen.findByRole('heading', { name: /start a new chat/i }),
    ).toBeInTheDocument()

    // Model tab is selected by default.
    expect(screen.getByRole('tab', { name: /model/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    await userEvent.click(screen.getByRole('button', { name: /^start$/i }))

    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(/^\/chat\//)
    })
    const chat = await db.parentChats.toCollection().first()
    expect(chat?.kind).toBe('dm')
    expect(chat?.agentId).toBeFalsy()
  })

  it('switches to the Agent tab and creates an agent-DM when an agent is picked', async () => {
    const agent = await seedAgent('PM Lens')
    const { router } = renderWithHarness()

    await userEvent.click(await screen.findByRole("button", { name: /open new chat/i }))
    await userEvent.click(screen.getByRole('tab', { name: /agent/i }))

    // The list shows the seeded agent.
    const agentRow = await screen.findByRole('button', { name: /pm lens/i })
    await userEvent.click(agentRow)

    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(/^\/chat\//)
    })
    const chats = await db.parentChats.toArray()
    const agentDm = chats.find((c) => c.agentId === agent.id)
    expect(agentDm?.kind).toBe('dm')
    expect(agentDm?.title).toBe('PM Lens')
  })

  it('renders an empty state and a link to the agents library on the Agent tab when no agents exist', async () => {
    renderWithHarness()

    await userEvent.click(await screen.findByRole("button", { name: /open new chat/i }))
    await userEvent.click(screen.getByRole('tab', { name: /agent/i }))

    expect(await screen.findByText(/no agents yet/i)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /open agents library/i })
    expect(link.getAttribute('href')).toBe('/settings/agents')
  })

  it('renders a coming-soon placeholder on the Channel tab', async () => {
    renderWithHarness()

    await userEvent.click(await screen.findByRole("button", { name: /open new chat/i }))
    await userEvent.click(screen.getByRole('tab', { name: /channel/i }))

    expect(
      await screen.findByText(/channels are coming soon/i),
    ).toBeInTheDocument()
  })

  it('returns the same empty model-DM on repeated Start clicks (idempotent entry)', async () => {
    const { router } = renderWithHarness()

    await userEvent.click(await screen.findByRole("button", { name: /open new chat/i }))
    await userEvent.click(screen.getByRole('button', { name: /^start$/i }))

    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(/^\/chat\//)
    })
    const firstChatId = router.state.location.pathname.split('/').at(-1)

    // Open again and click Start — should land on the same empty chat.
    await userEvent.click(await screen.findByRole("button", { name: /open new chat/i }))
    await userEvent.click(screen.getByRole('button', { name: /^start$/i }))

    await waitFor(() => {
      const path = router.state.location.pathname
      expect(path.split('/').at(-1)).toBe(firstChatId)
    })
    const chats = await db.parentChats.toArray()
    expect(chats.length).toBe(1)
  })

  it('reopens the same agent-DM when the agent is picked twice', async () => {
    const agent = await seedAgent('Critic')
    const { router } = renderWithHarness()

    await userEvent.click(await screen.findByRole("button", { name: /open new chat/i }))
    await userEvent.click(screen.getByRole('tab', { name: /agent/i }))
    await userEvent.click(
      await screen.findByRole('button', { name: /critic/i }),
    )

    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(/^\/chat\//)
    })
    const firstChatId = router.state.location.pathname.split('/').at(-1)

    await userEvent.click(await screen.findByRole("button", { name: /open new chat/i }))
    await userEvent.click(screen.getByRole('tab', { name: /agent/i }))
    await userEvent.click(
      await screen.findByRole('button', { name: /critic/i }),
    )

    await waitFor(() => {
      const path = router.state.location.pathname
      expect(path.split('/').at(-1)).toBe(firstChatId)
    })
    const chats = await db.parentChats.toArray()
    const forAgent = chats.filter((c) => c.agentId === agent.id)
    expect(forAgent.length).toBe(1)
  })

  it('closes the dialog when Escape is pressed', async () => {
    renderWithHarness()
    await userEvent.click(await screen.findByRole("button", { name: /open new chat/i }))
    const dialog = await screen.findByRole('dialog', { name: /new chat/i })
    expect(dialog).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /new chat/i })).toBeNull()
    })
  })

  it('shows three tabs labelled Model, Agent, Channel', async () => {
    renderWithHarness()
    await userEvent.click(await screen.findByRole("button", { name: /open new chat/i }))

    const tablist = await screen.findByRole('tabpanel')
    expect(tablist).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /model/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /agent/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /channel/i })).toBeInTheDocument()
  })

  it('handles a no-providers, no-agents environment gracefully (Model tab still creates an empty chat)', async () => {
    // No providers configured. findOrCreateEmptyParentChat doesn't require
    // a provider — the user picks the model later in the composer.
    const { router } = renderWithHarness()

    await userEvent.click(await screen.findByRole("button", { name: /open new chat/i }))
    await userEvent.click(screen.getByRole('button', { name: /^start$/i }))

    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(/^\/chat\//)
    })
    const chats = await within(document.body).queryAllByTestId('chat-page')
    expect(chats.length).toBeGreaterThan(0)
  })
})
