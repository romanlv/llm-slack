// Module-scoped registry of in-flight send AbortControllers, keyed by
// conversationId. Lives outside send-turn.ts so other features (e.g.
// providers-repository.deleteProvider) can cancel running streams without
// importing the entire send pipeline.
//
// One conversation may have at most one active stream at a time — we never
// run two concurrent DM sends on the same chat. Channel fan-out attempts
// are managed inside the turn-lifecycle attempt registry, not here.

const activeStreams = new Map<string, AbortController>()

// Register `controller` as the active stream for `conversationId`. If
// another stream is already registered there, abort it first (idempotent
// take-over). Returns the same controller for convenience.
export function registerStreamController(
  conversationId: string,
  controller: AbortController,
): AbortController {
  const existing = activeStreams.get(conversationId)
  if (existing && existing !== controller) {
    existing.abort()
  }
  activeStreams.set(conversationId, controller)
  return controller
}

export function clearStreamController(conversationId: string, controller: AbortController) {
  if (activeStreams.get(conversationId) === controller) {
    activeStreams.delete(conversationId)
  }
}

export function abortStreamsForConversation(conversationId: string) {
  const controller = activeStreams.get(conversationId)
  if (controller) controller.abort()
}

export function abortAllStreams() {
  for (const controller of activeStreams.values()) {
    controller.abort()
  }
  activeStreams.clear()
}
