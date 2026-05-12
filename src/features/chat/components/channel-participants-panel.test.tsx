/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAgent } from '@/features/agents/agents-repository'
import { db } from '@/features/chat/database'
import { createProvider } from '@/features/providers/providers-repository'
import {
  createChannel,
  listChannelParticipants,
} from '@/features/chat/repository'

import { ChannelParticipantsPanel } from './channel-participants-panel'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

afterEach(() => {
  cleanup()
})

async function seedChannelWithAgents() {
  const a = await createAgent({
    displayName: 'Alpha',
    model: { providerKind: 'openrouter', providerModelId: 'm' },
  })
  const b = await createAgent({
    displayName: 'Beta',
    model: { providerKind: 'openrouter', providerModelId: 'm' },
  })
  const channel = await createChannel({
    title: 'launch',
    participants: [
      { agentId: a.id, mode: 'auto-decide' },
      { agentId: b.id, mode: 'mention-only' },
    ],
  })
  return { channel, a, b }
}

describe('ChannelParticipantsPanel', () => {
  it('lists current participants with their mode and removes a participant when the trash button is clicked', async () => {
    const { channel, b } = await seedChannelWithAgents()
    render(<ChannelParticipantsPanel chatId={channel.id} />)

    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('button', { name: /remove alpha from channel/i }),
    )
    await waitFor(async () => {
      const participants = await listChannelParticipants(channel.id)
      expect(participants.map((p) => p.agentId)).toEqual([b.id])
    })
  })

  it('changes a participant mode through the inline select', async () => {
    const { channel, a } = await seedChannelWithAgents()
    render(<ChannelParticipantsPanel chatId={channel.id} />)

    // The first ModeSelect belongs to Alpha (auto-decide). Switch to mention-only.
    await screen.findByText('Alpha')
    const selects = screen
      .getAllByRole('combobox')
      .filter((el) => el.tagName === 'SELECT') as HTMLSelectElement[]
    const alphaModeSelect = selects[0]!
    expect(alphaModeSelect.value).toBe('auto-decide')
    await userEvent.selectOptions(alphaModeSelect, 'mention-only')

    await waitFor(async () => {
      const participants = await listChannelParticipants(channel.id)
      const alpha = participants.find((p) => p.agentId === a.id)
      expect(alpha?.mode).toBe('mention-only')
    })
  })

  it('adds an agent from the library through the Add control', async () => {
    const { channel } = await seedChannelWithAgents()
    const c = await createAgent({
      displayName: 'Gamma',
      model: { providerKind: 'openrouter', providerModelId: 'm' },
    })

    render(<ChannelParticipantsPanel chatId={channel.id} />)

    // The Gamma agent is not in the channel yet — it appears in the add dropdown.
    const addSelect = (await screen.findByLabelText(
      /add agent/i,
    )) as HTMLSelectElement
    await userEvent.selectOptions(addSelect, c.id)
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))

    await waitFor(async () => {
      const participants = await listChannelParticipants(channel.id)
      expect(participants.map((p) => p.agentId)).toContain(c.id)
    })
  })

  it('creates a new agent via the inline editor and adds it to the channel', async () => {
    const { channel } = await seedChannelWithAgents()
    // The agent editor needs a connected provider so its model dropdown
    // has something to pick. The bundled OpenRouter catalog supplies the
    // models without an extra fetch.
    await createProvider({ kind: 'openrouter', label: 'OR', apiKey: 'k' })

    render(<ChannelParticipantsPanel chatId={channel.id} />)

    // Open the editor via the secondary "Create new agent" affordance that
    // sits below the existing-agent picker.
    await screen.findByText('Alpha')
    await userEvent.click(
      screen.getAllByRole('button', { name: /create new agent/i })[0]!,
    )

    // Fill the editor and submit. The editor renders in a portal but still
    // queryable from screen.
    const nameInput = await screen.findByLabelText(/display name/i)
    await userEvent.type(nameInput, 'Delta')
    await userEvent.click(screen.getByRole('button', { name: /create agent/i }))

    await waitFor(async () => {
      const participants = await listChannelParticipants(channel.id)
      const agents = await db.agents.toArray()
      const delta = agents.find((a) => a.displayName === 'Delta')
      expect(delta).toBeDefined()
      expect(participants.map((p) => p.agentId)).toContain(delta!.id)
    })
  })

  it('renders a "Removed from library" hint when a participant references a deleted agent', async () => {
    const channel = await createChannel({ title: 'orphans' })
    // Bypass addChannelParticipant to seed the orphan condition directly:
    // its validator would reject a missing-agent row, so we write to Dexie
    // straight to reproduce the runtime state we want to render.
    await db.chatParticipants.add({
      id: 'orphan-1',
      chatId: channel.id,
      agentId: 'ghost-agent',
      mode: 'auto-decide',
      sortKey: Date.now(),
      createdAt: Date.now(),
    })

    render(<ChannelParticipantsPanel chatId={channel.id} />)
    expect(await screen.findByText(/removed from library/i)).toBeInTheDocument()
  })
})
