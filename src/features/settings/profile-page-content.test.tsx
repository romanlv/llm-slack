/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { getSettings } from './settings-repository'
import { ProfilePageContent } from './profile-page-content'

afterEach(() => {
  cleanup()
})

describe('ProfilePageContent', () => {
  it('saves the local profile name', async () => {
    render(<ProfilePageContent />)

    const userNameInput = await screen.findByLabelText(/user name/i)
    await userEvent.clear(userNameInput)
    await userEvent.type(userNameInput, 'Grace Hopper')
    await userEvent.click(screen.getByRole('button', { name: /save profile/i }))

    await waitFor(async () => {
      await expect(getSettings()).resolves.toMatchObject({ userName: 'Grace Hopper' })
    })
  })

  it('stores and removes a profile picture', async () => {
    render(<ProfilePageContent />)

    const file = new File(['avatar'], 'avatar.png', { type: 'image/png' })
    const input = await screen.findByLabelText(/change picture/i)

    await userEvent.upload(input, file)

    await waitFor(async () => {
      const settings = await getSettings()
      expect(settings.avatarDataUrl).toMatch(/^data:image\/png;base64,/)
    })

    await userEvent.click(screen.getByRole('button', { name: /remove picture/i }))

    await waitFor(async () => {
      const settings = await getSettings()
      expect(settings.avatarDataUrl).toBeUndefined()
    })
  })
})
