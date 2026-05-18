import type {z} from 'zod'

import type {Source} from '@domain/config/types'

export interface SourceLoadResult {
  localPath: string
  fresh: boolean
}

export interface SourceLoaderEntry {
  alias: string
  label: string
  configSchema: z.ZodTypeAny
  configure: () => Promise<Source>
  load: (source: Source) => Promise<SourceLoadResult>
}
