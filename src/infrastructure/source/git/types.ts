import type {Source} from '@domain/config/types'

export interface GitSourceConfig extends Source {
  type: 'git'
  url: string
  branch: string
  path?: string
  auth?: {
    type: 'ssh-key' | 'token'
    keyPath?: string
    token?: string
  }
}
