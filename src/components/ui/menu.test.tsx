/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Menu, MenuItem } from './menu'

function Harness({ onSelect }: { onSelect?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <span data-testid="outside">outside</span>
      <Menu
        onOpenChange={setOpen}
        open={open}
        trigger={(triggerProps) => (
          <button
            aria-expanded={triggerProps['aria-expanded']}
            aria-haspopup={triggerProps['aria-haspopup']}
            onClick={triggerProps.onClick}
            ref={triggerProps.ref}
            type="button"
          >
            open
          </button>
        )}
      >
        {({ close }) => (
          <MenuItem
            onSelect={() => {
              onSelect?.()
              close()
            }}
          >
            Copy
          </MenuItem>
        )}
      </Menu>
    </div>
  )
}

afterEach(() => {
  cleanup()
})

describe('Menu', () => {
  it('opens on trigger click and exposes the menu items', async () => {
    render(<Harness />)

    const trigger = screen.getByRole('button', { name: 'open' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menuitem', { name: /copy/i })).toBeInTheDocument()
  })

  it('runs the onSelect handler and closes the menu when an item is chosen', async () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)

    await userEvent.click(screen.getByRole('button', { name: 'open' }))
    await userEvent.click(screen.getByRole('menuitem', { name: /copy/i }))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
  })

  it('closes when the Escape key is pressed', async () => {
    render(<Harness />)

    await userEvent.click(screen.getByRole('button', { name: 'open' }))
    expect(screen.getByRole('menuitem')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
  })

  it('closes on a pointer event outside the trigger and the menu', async () => {
    render(<Harness />)

    await userEvent.click(screen.getByRole('button', { name: 'open' }))
    expect(screen.getByRole('menuitem')).toBeInTheDocument()

    await userEvent.click(screen.getByTestId('outside'))

    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
  })
})
