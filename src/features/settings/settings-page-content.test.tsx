/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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

import {
  createProvider,
  listProviders,
} from '@/features/providers/providers-repository'
import { db } from '@/features/chat/database'
import { createParentChat } from '@/features/chat/repository'
import { saveSettings, getSettings } from '@/features/settings/settings-repository'

import { SettingsPageContent } from './settings-page-content'

afterEach(() => {
  cleanup()
})

function renderWithRouter() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings',
    component: SettingsPageContent,
  })
  const modelsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings/models',
    component: () => <div>models placeholder</div>,
  })
  const providersRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings/providers',
    component: () => <div>providers</div>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([settingsRoute, modelsRoute, providersRoute]),
    history: createMemoryHistory({ initialEntries: ['/settings'] }),
  })
  return render(<RouterProvider router={router} />)
}

async function selectOpenAIInModal() {
  const openaiOption = await screen.findByRole('button', {
    name: /openai.*use your existing chatgpt plan/i,
  })
  await userEvent.click(openaiOption)
}

describe('SettingsPageContent', () => {
  it('shows an empty state when no connections exist and opens the Add modal', async () => {
    renderWithRouter()

    expect(
      await screen.findByText(/no providers connected/i),
    ).toBeInTheDocument()

    // The empty state CTA opens the same modal as the section's Add button.
    const ctas = await screen.findAllByRole('button', { name: /add provider/i })
    await userEvent.click(ctas[0])

    expect(await screen.findByRole('heading', { name: /add a provider/i })).toBeInTheDocument()
  })

  it('connects an OpenAI key via the Add modal', async () => {
    renderWithRouter()

    const ctas = await screen.findAllByRole('button', { name: /add provider/i })
    await userEvent.click(ctas[0])

    await selectOpenAIInModal()

    const apiKeyInput = (await screen.findByPlaceholderText(
      /sk-proj-/i,
    )) as HTMLInputElement
    await userEvent.clear(apiKeyInput)
    await userEvent.type(apiKeyInput, 'sk-proj-test-key')

    const form = apiKeyInput.closest('form') as HTMLFormElement
    await userEvent.click(
      form.querySelector('button[type="submit"]') as HTMLButtonElement,
    )

    await waitFor(async () => {
      const all = await listProviders()
      const openai = all.find((p) => p.kind === 'openai')
      expect(openai?.apiKey).toBe('sk-proj-test-key')
    })
  })

  it('auto-suffixes the label when adding a second connection of the same kind', async () => {
    await createProvider({ kind: 'openai', apiKey: 'sk-proj-first' })
    renderWithRouter()

    // First connection's row renders with its default label.
    expect(await screen.findByRole('heading', { name: /^openai$/i })).toBeInTheDocument()

    // Add a second OpenAI connection through the modal.
    const ctas = await screen.findAllByRole('button', { name: /add provider/i })
    await userEvent.click(ctas[0])
    await selectOpenAIInModal()

    const apiKeyInput = (await screen.findByPlaceholderText(
      /sk-proj-/i,
    )) as HTMLInputElement
    await userEvent.type(apiKeyInput, 'sk-proj-second')
    const form = apiKeyInput.closest('form') as HTMLFormElement
    await userEvent.click(
      form.querySelector('button[type="submit"]') as HTMLButtonElement,
    )

    // Both rows render, with the second auto-suffixed.
    expect(await screen.findByRole('heading', { name: /^openai \(2\)$/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^openai$/i })).toBeInTheDocument()
  })

  it('rotates an existing key through the Edit modal', async () => {
    const seeded = await createProvider({
      kind: 'openai',
      apiKey: 'sk-proj-original',
    })

    renderWithRouter()
    const editButton = await screen.findByRole('button', { name: /^edit$/i })
    await userEvent.click(editButton)

    // Edit modal intentionally does not prefill the stored key — the
    // placeholder masks it, and we only PUT a new value if the user types
    // one. Find the api-key input by its name= attribute.
    const apiKeyInput = (await screen.findByPlaceholderText(/•{3,}/)) as HTMLInputElement
    await userEvent.type(apiKeyInput, 'sk-proj-rotated')

    const form = apiKeyInput.closest('form') as HTMLFormElement
    await userEvent.click(
      form.querySelector('button[type="submit"]') as HTMLButtonElement,
    )

    await waitFor(async () => {
      const all = await listProviders()
      const openai = all.find((p) => p.id === seeded.id)
      expect(openai?.apiKey).toBe('sk-proj-rotated')
    })
  })

  it('shows the API-key-only Claude card with explicit setup steps inside the Add modal', async () => {
    renderWithRouter()

    const ctas = await screen.findAllByRole('button', { name: /add provider/i })
    await userEvent.click(ctas[0])

    const claudeOption = await screen.findByRole('button', {
      name: /claude.*anthropic.*billed from your console balance/i,
    })
    await userEvent.click(claudeOption)

    expect(
      await screen.findByText(/Allow CORS requests from a browser/i),
    ).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/sk-ant-api03-/i)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/sk-ant-oat01-/i)).toBeNull()
  })

  it('adds a custom OpenAI-compatible endpoint with label + baseUrl', async () => {
    renderWithRouter()

    const ctas = await screen.findAllByRole('button', { name: /add provider/i })
    await userEvent.click(ctas[0])

    const customOption = await screen.findByRole('button', {
      name: /openai-compatible endpoint/i,
    })
    await userEvent.click(customOption)

    const labelInput = (await screen.findByPlaceholderText(
      /ollama \(laptop\)/i,
    )) as HTMLInputElement
    await userEvent.type(labelInput, 'Ollama dev')

    const baseUrlInput = (await screen.findByPlaceholderText(
      /localhost:11434/i,
    )) as HTMLInputElement
    await userEvent.type(baseUrlInput, 'http://localhost:11434/v1')

    const modelInput = (await screen.findByPlaceholderText(
      /llama3\.1:70b/i,
    )) as HTMLInputElement
    await userEvent.type(modelInput, 'llama3.1:70b')

    // API key is optional for local endpoints — submit without typing one.
    const form = labelInput.closest('form') as HTMLFormElement
    await userEvent.click(
      form.querySelector('button[type="submit"]') as HTMLButtonElement,
    )

    await waitFor(async () => {
      const all = await listProviders()
      const custom = all.find((p) => p.kind === 'openai-compatible')
      expect(custom).toBeDefined()
      expect(custom?.label).toBe('Ollama dev')
      expect(custom?.baseUrl).toBe('http://localhost:11434/v1')
      expect(custom?.metadata.modelId).toBe('llama3.1:70b')
    })
  })

  it('points the Manage models link at the placeholder models page', async () => {
    await createProvider({ kind: 'openrouter', apiKey: 'sk-or-v1-test' })

    renderWithRouter()
    const link = await screen.findByRole('link', { name: /manage models/i })
    expect(link.getAttribute('href')).toBe('/settings/models')
  })

  it('disconnects through a styled ConfirmDialog (not window.confirm)', async () => {
    const seeded = await createProvider({ kind: 'openai', apiKey: 'sk-proj-x' })
    renderWithRouter()

    const disconnectButton = await screen.findByRole('button', { name: /disconnect/i })
    await userEvent.click(disconnectButton)

    // The styled dialog renders the connection label and a destructive
    // Disconnect button — the native browser confirm() would not produce
    // these accessible roles.
    expect(
      await screen.findByRole('dialog', { name: new RegExp(`disconnect "${seeded.label}"`, 'i') }),
    ).toBeInTheDocument()

    const confirm = screen.getAllByRole('button', { name: /^disconnect$/i })
    // The row's Disconnect button is now hidden behind the dialog overlay,
    // but both buttons share the same accessible name. Click the one inside
    // the dialog (last in the DOM).
    await userEvent.click(confirm[confirm.length - 1])

    await waitFor(async () => {
      const all = await listProviders()
      expect(all.find((p) => p.id === seeded.id)).toBeUndefined()
    })
  })

  it('clears settings.defaultModel and chat model snapshots when disconnecting the last same-kind provider', async () => {
    const seeded = await createProvider({ kind: 'openai', apiKey: 'sk-proj-x' })
    await saveSettings({
      defaultModel: {
        providerId: seeded.id,
        providerKind: 'openai',
        providerModelId: 'gpt-5.5',
      },
    })
    const parent = await createParentChat({
      title: 'pinned-to-provider',
      model: {
        providerId: seeded.id,
        providerKind: 'openai',
        providerModelId: 'gpt-5.5',
      },
    })

    renderWithRouter()
    const disconnect = await screen.findByRole('button', { name: /disconnect/i })
    await userEvent.click(disconnect)
    const confirms = await screen.findAllByRole('button', { name: /^disconnect$/i })
    await userEvent.click(confirms[confirms.length - 1])

    await waitFor(async () => {
      const settings = await getSettings()
      expect(settings.defaultModel).toBeNull()
    })

    const refreshed = await db.parentChats.get(parent.id)
    expect(refreshed?.model?.providerId).toBeUndefined()
  })
})
