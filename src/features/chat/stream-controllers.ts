// Module-scoped registry of in-flight send AbortControllers, keyed by
// conversationId. Lives outside send-turn.ts so other features (e.g.
// providers-repository.deleteProvider) can cancel running streams without
// importing the entire send pipeline.

const activeStreams = new Map<string, AbortController>()

export function registerStreamController(conversationId: string): AbortController {
  const existing = activeStreams.get(conversationId)
  if (existing) {
    existing.abort()
  }
  const controller = new AbortController()
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
