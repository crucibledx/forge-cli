import type {Source} from '@domain/config/types'

export interface LocalSourceConfig extends Source {
  type: 'local'
  path: string
}
