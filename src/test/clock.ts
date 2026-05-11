import { vi } from 'vitest'

export interface FrozenClock {
  now(): number
  advance(ms: number): number
  set(timestamp: number): number
}

export function withFrozenClock<T>(timestamp: number, fn: (clock: FrozenClock) => Promise<T>): Promise<T>
export function withFrozenClock<T>(timestamp: number, fn: (clock: FrozenClock) => T): T
export function withFrozenClock<T>(
  timestamp: number,
  fn: (clock: FrozenClock) => T | Promise<T>,
): T | Promise<T> {
  const spy = vi.spyOn(Date, 'now')
  let current = timestamp
  spy.mockReturnValue(current)

  const clock: FrozenClock = {
    now: () => current,
    advance: (ms) => {
      current += ms
      spy.mockReturnValue(current)
      return current
    },
    set: (timestamp) => {
      current = timestamp
      spy.mockReturnValue(current)
      return current
    },
  }

  try {
    const result = fn(clock)
    if (result instanceof Promise) {
      return result.finally(() => spy.mockRestore())
    }
    spy.mockRestore()
    return result
  } catch (error) {
    spy.mockRestore()
    throw error
  }
}

export function withDeterministicIds<T>(
  seed: string,
  fn: (next: () => string) => Promise<T>,
): Promise<T>
export function withDeterministicIds<T>(seed: string, fn: (next: () => string) => T): T
export function withDeterministicIds<T>(
  seed: string,
  fn: (next: () => string) => T | Promise<T>,
): T | Promise<T> {
  let counter = 0
  const next = () => `${seed}-${(counter++).toString().padStart(4, '0')}`
  const spy = vi.spyOn(crypto, 'randomUUID')
  spy.mockImplementation(() => next() as ReturnType<typeof crypto.randomUUID>)

  try {
    const result = fn(next)
    if (result instanceof Promise) {
      return result.finally(() => spy.mockRestore())
    }
    spy.mockRestore()
    return result
  } catch (error) {
    spy.mockRestore()
    throw error
  }
}
