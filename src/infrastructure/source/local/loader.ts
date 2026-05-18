import {existsSync, statSync} from 'node:fs'
import {homedir} from 'node:os'

import type {LocalSource} from '@domain/config/types'
import * as prompts from '@infrastructure/cli/prompts'

import {DEFAULT_SOURCE_NAME} from '../constants'
import type {SourceLoaderEntry} from '../types'
import {LOCAL_SOURCE_MESSAGES} from './messages'

export function validateLocalPath(val: string | undefined): string | undefined {
  if (!val?.trim()) return LOCAL_SOURCE_MESSAGES.path.required
  const resolved = val.trim().replace(/^~/, homedir())
  if (!existsSync(resolved)) return LOCAL_SOURCE_MESSAGES.path.notFound
  try {
    if (!statSync(resolved).isDirectory()) return LOCAL_SOURCE_MESSAGES.path.notDirectory
  } catch {
    return LOCAL_SOURCE_MESSAGES.path.notFound
  }
  return undefined
}

export const localLoader: SourceLoaderEntry = {
  alias: 'local',
  label: 'Local directory',
  configure: async () => {
    const path = await prompts.text({
      message: LOCAL_SOURCE_MESSAGES.path.message,
      placeholder: LOCAL_SOURCE_MESSAGES.path.placeholder,
      validate: validateLocalPath,
    })
    return {
      name: DEFAULT_SOURCE_NAME,
      type: 'local',
      path: path.trim(),
    } as LocalSource
  },
  load: async (source) => {
    const local = source as LocalSource
    const resolvedPath = local.path.replace(/^~/, homedir())

    if (!existsSync(resolvedPath)) {
      throw new LocalSourceError(`Local source path does not exist: "${resolvedPath}"`)
    }

    return {localPath: resolvedPath, fresh: true}
  },
}

export class LocalSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LocalSourceError'
  }
}
