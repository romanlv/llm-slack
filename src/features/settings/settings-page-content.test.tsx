/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { getSettings } from './settings-repository'
import { SettingsPageContent } from './settings-page-content'

afterEach(() => {
  cleanup()
})

describe('SettingsPageContent', () => {
  it('saves provider settings from the settings form', async () => {
    render(<SettingsPageContent />)

    const apiKeyInput = await screen.findByLabelText(/openrouter api key/i)
    await userEvent.clear(apiKeyInput)
    await userEvent.type(apiKeyInput, 'sk-test')
    await userEvent.click(screen.getByRole('button', { name: /save settings/i }))

    await waitFor(async () => {
      await expect(getSettings()).resolves.toMatchObject({ openRouterApiKey: 'sk-test' })
    })
  })
})
