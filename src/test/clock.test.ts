import { describe, expect, it } from 'vitest'

import { withDeterministicIds, withFrozenClock } from '@/test/clock'

describe('withFrozenClock', () => {
  it('pins Date.now to the given timestamp for the duration of the callback', () => {
    const before = Date.now()
    withFrozenClock(1000, (clock) => {
      expect(Date.now()).toBe(1000)
      expect(clock.now()).toBe(1000)
    })
    // After the callback, Date.now() is no longer pinned.
    expect(Date.now()).not.toBe(1000)
    expect(Date.now()).toBeGreaterThanOrEqual(before)
  })

  it('supports advancing the clock via the passed stepper', () => {
    withFrozenClock(500, (clock) => {
      expect(Date.now()).toBe(500)
      clock.advance(50)
      expect(Date.now()).toBe(550)
      clock.set(2000)
      expect(Date.now()).toBe(2000)
    })
  })

  it('restores the spy even when the callback throws', () => {
    expect(() =>
      withFrozenClock(7, () => {
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(Date.now()).not.toBe(7)
  })

  it('awaits async callbacks and restores afterwards', async () => {
    await withFrozenClock(1234, async () => {
      await Promise.resolve()
      expect(Date.now()).toBe(1234)
    })
    expect(Date.now()).not.toBe(1234)
  })
})

describe('withDeterministicIds', () => {
  it('returns stable, sequenced ids inside the callback', () => {
    withDeterministicIds('test', (next) => {
      expect(next()).toBe('test-0000')
      expect(next()).toBe('test-0001')
      expect(crypto.randomUUID()).toBe('test-0002')
    })
  })

  it('restores crypto.randomUUID afterwards', () => {
    withDeterministicIds('seed', () => {
      // no-op
    })
    expect(crypto.randomUUID()).not.toMatch(/^seed-\d{4}$/)
  })

  it('isolates id sequences between callbacks', () => {
    withDeterministicIds('a', () => {
      expect(crypto.randomUUID()).toBe('a-0000')
    })
    withDeterministicIds('b', () => {
      expect(crypto.randomUUID()).toBe('b-0000')
    })
  })

  it('composes with withFrozenClock', async () => {
    await withFrozenClock(42, () =>
      withDeterministicIds('c', async () => {
        expect(Date.now()).toBe(42)
        expect(crypto.randomUUID()).toBe('c-0000')
      }),
    )
  })
})
