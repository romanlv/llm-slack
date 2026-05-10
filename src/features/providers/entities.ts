import type { ProviderKind } from '@/features/providers/model-ref'

export interface ProviderConnection {
  id: string
  kind: ProviderKind
  label: string
  apiKey: string
  baseUrl?: string
  metadata: Record<string, string>
  createdAt: number
  updatedAt: number
}

export interface ModelPricing {
  promptPerMillion: number
  completionPerMillion: number
  currency: 'USD'
}

export type ModelModality = 'text' | 'image' | 'audio'

export interface ModelMetadata {
  name: string
  description?: string
  contextLength?: number
  pricing?: ModelPricing
  modalities?: ModelModality[]
}

export interface ModelOverride {
  id: string
  providerId: string
  providerModelId: string
  enabled: boolean
  customMetadata?: ModelMetadata
  createdAt: number
  updatedAt: number
}
