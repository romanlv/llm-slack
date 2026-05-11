// Shared helper: forwards an external AbortSignal into provider fetch calls
// and, when no external signal is supplied, applies an internal connect-phase
// timeout so a hung provider can't pin a request forever. Callers must invoke
// `disarmTimeout()` once the fetch headers have arrived; reading the response
// body uses the same `signal` so a downstream caller can still cancel mid-stream.

const DEFAULT_CONNECT_TIMEOUT_MS = 30_000

export function composeSignal(external?: AbortSignal, timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS) {
  if (external) {
    return { signal: external, disarmTimeout: () => {} }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('Provider connect timeout')), timeoutMs)
  return {
    signal: controller.signal,
    disarmTimeout: () => clearTimeout(timer),
  }
}
