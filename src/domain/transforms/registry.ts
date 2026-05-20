import type {TransformerEntry} from './types'

export const transformersRegistry: TransformerEntry[] = []

export function getTransformer(id: string): TransformerEntry | undefined {
  return transformersRegistry.find((t) => t.id === id)
}
