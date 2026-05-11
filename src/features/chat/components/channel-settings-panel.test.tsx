/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createChannel,
  getChannelSettings,
} from '@/features/chat/repository'

import { ChannelSettingsPanel } from './channel-settings-panel'

afterEach(() => {
  cleanup()
})

describe('ChannelSettingsPanel', () => {
  it('seeds the form from existing settings and persists edits to maxChainedSubTurns', async () => {
    const channel = await createChannel({ title: 'launch' })

    render(<ChannelSettingsPanel chatId={channel.id} />)

    const subTurnsInput = (await screen.findByLabelText(
      /max chained sub-turns/i,
    )) as HTMLInputElement
    await waitFor(() => expect(subTurnsInput.value).toBe('3'))

    await userEvent.tripleClick(subTurnsInput)
    await userEvent.keyboard('7')
    expect(subTurnsInput.value).toBe('7')
    await userEvent.click(
      screen.getByRole('button', { name: /save settings/i }),
    )

    await waitFor(async () => {
      const settings = await getChannelSettings(channel.id)
      expect(settings?.maxChainedSubTurns).toBe(7)
    })
  })

  it('toggles allowAgentThreading off and persists', async () => {
    const channel = await createChannel({ title: 'no-threads' })

    render(<ChannelSettingsPanel chatId={channel.id} />)

    const toggle = (await screen.findByLabelText(
      /agents may open threads/i,
    )) as HTMLInputElement
    await waitFor(() => expect(toggle.checked).toBe(true))

    await userEvent.click(toggle)
    await userEvent.click(
      screen.getByRole('button', { name: /save settings/i }),
    )

    await waitFor(async () => {
      const settings = await getChannelSettings(channel.id)
      expect(settings?.allowAgentThreading).toBe(false)
    })
  })

  it('rejects negative caps with a visible error', async () => {
    const channel = await createChannel({ title: 'bad-caps' })

    render(<ChannelSettingsPanel chatId={channel.id} />)

    const subTurnsInput = (await screen.findByLabelText(
      /max chained sub-turns/i,
    )) as HTMLInputElement
    await waitFor(() => expect(subTurnsInput.value).toBe('3'))

    await userEvent.tripleClick(subTurnsInput)
    await userEvent.keyboard('-1')
    expect(subTurnsInput.value).toBe('-1')
    await userEvent.click(
      screen.getByRole('button', { name: /save settings/i }),
    )

    expect(
      await screen.findByText(/non-negative integers/i),
    ).toBeInTheDocument()
    const settings = await getChannelSettings(channel.id)
    // Untouched.
    expect(settings?.maxChainedSubTurns).toBe(3)
  })

  it('changes the defaultParticipationMode through the select', async () => {
    const channel = await createChannel({ title: 'mode-switch' })

    render(<ChannelSettingsPanel chatId={channel.id} />)

    const modeSelect = (await screen.findByLabelText(
      /default participation mode/i,
    )) as HTMLSelectElement
    await waitFor(() => expect(modeSelect.value).toBe('auto-decide'))

    await userEvent.selectOptions(modeSelect, 'mention-only')
    await userEvent.click(
      screen.getByRole('button', { name: /save settings/i }),
    )

    await waitFor(async () => {
      const settings = await getChannelSettings(channel.id)
      expect(settings?.defaultParticipationMode).toBe('mention-only')
    })
  })
})
