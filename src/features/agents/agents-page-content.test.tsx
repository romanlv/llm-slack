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
import { afterEach, describe, expect, it } from 'vitest'

import { db } from '@/features/chat/database'
import { createAgent, listAgents } from '@/features/agents/agents-repository'
import { createProvider } from '@/features/providers/providers-repository'
import type { Agent } from '@/features/chat/domain'

import { AgentsPageContent } from './agents-page-content'

afterEach(() => {
  cleanup()
})

function renderPage() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const agentsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings/agents',
    component: AgentsPageContent,
  })
  const providersRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings/providers',
    component: () => <div>providers placeholder</div>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([agentsRoute, providersRoute]),
    history: createMemoryHistory({ initialEntries: ['/settings/agents'] }),
  })
  return render(<RouterProvider router={router} />)
}

async function seedOpenAIProvider() {
  return createProvider({ kind: 'openai', apiKey: 'sk-proj-test-key' })
}

async function seedAgentRow(overrides: Partial<Parameters<typeof createAgent>[0]> = {}) {
  const provider = await seedOpenAIProvider()
  return createAgent({
    displayName: overrides.displayName ?? 'Senior Reviewer',
    username:
      overrides.username ??
      (overrides.displayName ?? 'senior-reviewer').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    model: overrides.model ?? {
      providerId: provider.id,
      providerKind: 'openai',
      providerModelId: 'gpt-5.5',
    },
    systemPrompt: overrides.systemPrompt ?? 'You are a careful reviewer.',
  })
}

describe('AgentsPageContent', () => {
  it('renders the empty state and opens the create-agent modal from the CTA', async () => {
    await seedOpenAIProvider()
    renderPage()

    expect(await screen.findByText(/no agents yet/i)).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: /create your first agent/i }),
    )
    expect(
      await screen.findByRole('heading', { name: /create agent/i }),
    ).toBeInTheDocument()
  })

  it('creates an agent end-to-end via the editor', async () => {
    await seedOpenAIProvider()
    renderPage()

    await userEvent.click(
      await screen.findByRole('button', { name: /create your first agent/i }),
    )

    const nameInput = await screen.findByPlaceholderText(/senior reviewer/i)
    await userEvent.type(nameInput, 'PM Lens')

    const promptInput = await screen.findByPlaceholderText(/^you are/i)
    await userEvent.type(promptInput, 'You are a product manager.')

    await userEvent.click(screen.getByRole('button', { name: /^create agent$/i }))

    await waitFor(async () => {
      const all = await listAgents()
      expect(all.map((a) => a.displayName)).toContain('PM Lens')
    })
    expect(
      await screen.findByRole('heading', { name: /^pm lens$/i }),
    ).toBeInTheDocument()
  })

  it('edits an existing agent display name through the editor', async () => {
    const seeded = await seedAgentRow({ displayName: 'Old Name' })
    renderPage()

    expect(
      await screen.findByRole('heading', { name: /^old name$/i }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }))

    const nameInput = (await screen.findByPlaceholderText(
      /senior reviewer/i,
    )) as HTMLInputElement
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'New Name')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(async () => {
      const refreshed = await db.agents.get(seeded.id)
      expect(refreshed?.displayName).toBe('New Name')
    })
  })

  it('rejects an empty display name', async () => {
    await seedOpenAIProvider()
    renderPage()

    await userEvent.click(
      await screen.findByRole('button', { name: /create your first agent/i }),
    )

    // The Input is `required`, so the form blocks submit before our
    // validation runs. Confirm no agent was persisted.
    await userEvent.click(screen.getByRole('button', { name: /^create agent$/i }))
    const all = await listAgents()
    expect(all).toEqual([])
  })

  it('disables save when no providers are configured', async () => {
    // No provider seeded — `listEnabledModels` returns empty.
    renderPage()

    await userEvent.click(
      await screen.findByRole('button', { name: /create your first agent/i }),
    )

    expect(
      await screen.findByText(/no models available/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^create agent$/i })).toBeDisabled()
  })

  it('deletes through a styled ConfirmDialog and cascades agent-DM references to null', async () => {
    const seeded = await seedAgentRow({ displayName: 'Doomed' })
    // Simulate an agent-DM by setting parentChats.agentId to the seeded
    // agent. We construct the row directly to keep the test focused on the
    // page behavior — the agent-DM creation flow is U3/U4's concern.
    const now = Date.now()
    await db.parentChats.add({
      id: 'chat-agent-dm',
      title: 'Agent DM',
      model: null,
      kind: 'dm',
      agentId: seeded.id,
      createdAt: now,
      updatedAt: now,
      draft: '',
      lastActivityPreview: '',
    })

    renderPage()

    expect(await screen.findByText(/· 1 chat/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    const dialog = await screen.findByRole('dialog', {
      name: /delete "doomed"/i,
    })
    expect(
      within(dialog).getByText(/1 chat references this agent/i),
    ).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: /delete agent/i }))

    await waitFor(async () => {
      const all = await listAgents()
      expect(all).toEqual([])
    })
    const orphaned = await db.parentChats.get('chat-agent-dm')
    expect(orphaned?.agentId).toBeNull()
  })

  it('lists multiple agents in repository order', async () => {
    const a = await seedAgentRow({ displayName: 'Alpha' })
    const b = await seedAgentRow({ displayName: 'Beta' })

    renderPage()

    // findAllByRole retries until both rows have rendered.
    await screen.findByRole('heading', { name: /^alpha$/i })
    await screen.findByRole('heading', { name: /^beta$/i })
    const names = screen
      .getAllByRole('heading', { level: 3 })
      .map((node) => node.textContent ?? '')
    expect(names.indexOf('Alpha')).toBeLessThan(names.indexOf('Beta'))
    expect(a.createdAt).toBeLessThanOrEqual(b.createdAt)
  })
})

describe('AgentsPageContent helpers', () => {
  it('renders the system-prompt placeholder when an agent has none', async () => {
    const provider = await seedOpenAIProvider()
    const agent: Agent = await createAgent({
      displayName: 'Quiet',
      model: {
        providerId: provider.id,
        providerKind: 'openai',
        providerModelId: 'gpt-5.5',
      },
    })
    expect(agent.systemPrompt).toBe('')

    renderPage()
    expect(
      await screen.findByText(/no system prompt set/i),
    ).toBeInTheDocument()
  })
})
