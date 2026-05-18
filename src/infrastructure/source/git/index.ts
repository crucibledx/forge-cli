import {loadersRegistry} from '../registry'
import type {SourceLoaderEntry} from '../types'
import {configure} from './configure'
import {load} from './load'
import {gitSourceSchema} from './schema.types'

export const gitLoader: SourceLoaderEntry = {
  alias: 'git',
  label: 'Git (SSH / HTTPS)',
  configSchema: gitSourceSchema,
  configure,
  load,
}

loadersRegistry.push(gitLoader)

export {verifyGitSource} from './configure'
export {cleanupAllCaches, cleanupCache, GitError} from './load'
export {GIT_SOURCE_MESSAGES} from './messages'
export {gitSourceSchema} from './schema.types'
export type {GitSourceConfig} from './types'
