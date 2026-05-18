import {existsSync} from 'node:fs'
import {homedir} from 'node:os'

import type {SourceLoaderEntry} from '../types'
import type {LocalSourceConfig} from './types'

export const load: SourceLoaderEntry['load'] = async (source) => {
  const local = source as LocalSourceConfig
  const resolvedPath = local.path.replace(/^~/, homedir())

  if (!existsSync(resolvedPath)) {
    throw new LocalSourceError(`Local source path does not exist: "${resolvedPath}"`)
  }

  return {localPath: resolvedPath, fresh: true}
}

export class LocalSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LocalSourceError'
  }
}
