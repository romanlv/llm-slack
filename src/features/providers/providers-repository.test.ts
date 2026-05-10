import { describe, expect, it } from 'vitest'

import { db } from '@/features/chat/database'
import {
  createProvider,
  deleteProvider,
  upsertSingletonOpenRouter,
} from '@/features/providers/providers-repository'
import { upsertOverride } from '@/features/providers/model-overrides-repository'
import { saveSettings } from '@/features/settings/settings-repository'

const OPENROUTER_BUNDLED_ID = 'anthropic/claude-sonnet-4.6'

async function seedSnapshot(providerId: string, providerModelId = 'model-x') {
  const ref = {
    providerId,
    providerKind: 'openrouter' as const,
    providerModelId,
  }
  await db.parentChats.add({
    id: 'pc1',
    title: 'chat',
    model: ref,
    createdAt: 1,
    updatedAt: 1,
    draft: '',
    lastActivityPreview: '',
  })
  await db.threads.add({
    id: 't1',
    parentChatId: 'pc1',
    rootMessageId: 'm-root',
    depth: 1,
    draft: '',
    model: ref,
    createdAt: 1,
    updatedAt: 1,
  })
  await db.messages.add({
    id: 'm1',
    conversationType: 'parent',
    conversationId: 'pc1',
    parentChatId: 'pc1',
    role: 'user',
    content: 'hi',
    createdAt: 1,
    status: 'complete',
    directReplyCount: 0,
    model: ref,
  })
}

describe('providers repository cascade delete', () => {
  it('strips providerId from every snapshot and removes the provider with its overrides', async () => {
    const provider = await createProvider({ kind: 'openrouter', label: 'OR', apiKey: 'key' })
    await upsertOverride(
      { providerId: provider.id, providerModelId: 'custom-x', enabled: true, customMetadata: { name: 'X' } },
      { isBundled: false },
    )
    await seedSnapshot(provider.id, 'custom-x')

    await deleteProvider(provider.id)

    await expect(db.providers.get(provider.id)).resolves.toBeUndefined()
    await expect(db.modelOverrides.where('providerId').equals(provider.id).count()).resolves.toBe(0)
    const chat = await db.parentChats.get('pc1')
    expect(chat?.model).toEqual({ providerKind: 'openrouter', providerModelId: 'custom-x' })
    const thread = await db.threads.get('t1')
    expect(thread?.model).toEqual({ providerKind: 'openrouter', providerModelId: 'custom-x' })
    const message = await db.messages.get('m1')
    expect(message?.model).toEqual({ providerKind: 'openrouter', providerModelId: 'custom-x' })
  })

  it('repoints settings.defaultModel to another same-kind connection that serves the model', async () => {
    const a = await createProvider({ kind: 'openrouter', label: 'A', apiKey: 'a-key' })
    const b = await createProvider({ kind: 'openrouter', label: 'B', apiKey: 'b-key' })
    await saveSettings({
      defaultModel: {
        providerId: a.id,
        providerKind: 'openrouter',
        providerModelId: OPENROUTER_BUNDLED_ID,
      },
    })

    await deleteProvider(a.id)

    const settings = await db.settings.get('app')
    expect(settings?.defaultModel).toEqual({
      providerId: b.id,
      providerKind: 'openrouter',
      providerModelId: OPENROUTER_BUNDLED_ID,
    })
  })

  it('nulls settings.defaultModel when no same-kind connection remains', async () => {
    const only = await upsertSingletonOpenRouter({ apiKey: 'k' })
    await saveSettings({
      defaultModel: {
        providerId: only.id,
        providerKind: 'openrouter',
        providerModelId: OPENROUTER_BUNDLED_ID,
      },
    })

    await deleteProvider(only.id)

    const settings = await db.settings.get('app')
    expect(settings?.defaultModel).toBeNull()
  })
})
