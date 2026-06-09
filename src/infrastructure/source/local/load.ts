import {existsSync} from 'node:fs'
import {homedir} from 'node:os'

import {createFileLogger} from '@infrastructure/logger'

import type {SourceLoaderEntry} from '../types'
import type {LocalSourceConfig} from './types'

export const load: SourceLoaderEntry['load'] = async (source) => {
  const logger = createFileLogger()
  const local = source as LocalSourceConfig
  const resolvedPath = local.path.replace(/^~/, homedir())

  if (!existsSync(resolvedPath)) {
    logger.error('local source: path not found', {path: resolvedPath})
    throw new LocalSourceError(`Local source path does not exist: "${resolvedPath}"`)
  }

  logger.debug('local source: loaded', {path: resolvedPath})
  return {localPath: resolvedPath, fresh: true}
}

export class LocalSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LocalSourceError'
  }
}
