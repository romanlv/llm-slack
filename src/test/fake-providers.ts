import { SILENCE_SENTINEL } from '@/features/chat/decide-to-respond'
import type { ProviderConnection } from '@/features/providers/entities'
import type { ModelRef } from '@/features/providers/model-ref'
import type {
  StreamChatInput,
  StreamChatResult,
} from '@/features/providers/provider-contract'

export { SILENCE_SENTINEL }

export interface FakeProviderCall {
  connection: ProviderConnection
  model: ModelRef
  input: StreamChatInput
  systemPrompt: string | null
  userText: string | null
}

export type FakeScriptOutput =
  | StreamChatResult
  | { silent: true }
  | { content: string; usage?: StreamChatResult['usage'] }
  | { error: Error }

export type FakeScript = (
  call: FakeProviderCall,
) => FakeScriptOutput | Promise<FakeScriptOutput>

export type FakeScripts = Record<string, FakeScript | undefined> & {
  /** Fallback when no other key matches. */
  default?: FakeScript
}

export interface InstalledFakes {
  /** Every recorded streamChat call, in order. */
  calls: FakeProviderCall[]
  /** Filter the recorded calls. */
  callsFor(predicate: (call: FakeProviderCall) => boolean): FakeProviderCall[]
  /** Convenience accessor for the most recent call (throws if none). */
  lastCall(): FakeProviderCall
}

export interface CreateFakeStreamChatInput {
  scripts: FakeScripts
  fakes: InstalledFakes
  idSeed?: string
}

/**
 * Build a streamChat implementation that routes calls through `scripts`.
 *
 * Typical use:
 *   vi.mock('@/features/providers/adapters/openrouter', ...stub-with-vi.fn)
 *   vi.mocked(openrouterAdapter.streamChat).mockImplementation(
 *     createFakeStreamChat({ scripts, fakes })
 *   )
 */
export function installFakeProviders(): InstalledFakes {
  const calls: FakeProviderCall[] = []
  return {
    calls,
    callsFor: (predicate) => calls.filter(predicate),
    lastCall: () => {
      const last = calls[calls.length - 1]
      if (!last) throw new Error('No fake provider calls recorded yet.')
      return last
    },
  }
}

export function createFakeStreamChat({
  scripts,
  fakes,
  idSeed = 'fake',
}: CreateFakeStreamChatInput) {
  let counter = 0
  return async (
    connection: ProviderConnection,
    model: ModelRef,
    input: StreamChatInput,
  ): Promise<StreamChatResult> => {
    const call: FakeProviderCall = {
      connection,
      model,
      input,
      systemPrompt:
        input.messages.find((m) => m.role === 'system')?.content ?? null,
      userText:
        [...input.messages].reverse().find((m) => m.role === 'user')?.content ?? null,
    }
    fakes.calls.push(call)

    if (input.signal?.aborted) {
      throw new DOMException('Aborted before script', 'AbortError')
    }

    const script = scripts[model.providerModelId] ?? scripts.default
    if (!script) {
      throw new Error(
        `No fake script registered for providerModelId "${model.providerModelId}" (and no default).`,
      )
    }

    const output = await script(call)
    if (input.signal?.aborted) {
      throw new DOMException('Aborted after script', 'AbortError')
    }

    if ('error' in output) {
      throw output.error
    }
    if ('silent' in output) {
      const content = SILENCE_SENTINEL
      input.onChunk(content)
      const id = `${idSeed}-${counter++}`
      input.onMessageId?.(id)
      return { content, id }
    }
    if ('id' in output) {
      // Full StreamChatResult — emit content as one chunk for parity with adapters.
      input.onChunk(output.content)
      input.onMessageId?.(output.id)
      return output
    }
    // Bare {content, usage}
    const id = `${idSeed}-${counter++}`
    input.onChunk(output.content)
    input.onMessageId?.(id)
    return { content: output.content, id, ...(output.usage ? { usage: output.usage } : {}) }
  }
}
