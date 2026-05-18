import {existsSync, statSync} from 'node:fs'
import {homedir} from 'node:os'

import * as prompts from '@infrastructure/cli/prompts'

import {DEFAULT_SOURCE_NAME} from '../constants'
import type {SourceLoaderEntry} from '../types'
import {LOCAL_SOURCE_MESSAGES} from './messages'
import {localSourceSchema} from './schema.types'
import type {LocalSourceConfig} from './types'

export {localSourceSchema}

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

export const configure: SourceLoaderEntry['configure'] = async () => {
  const path = await prompts.text({
    message: LOCAL_SOURCE_MESSAGES.path.message,
    placeholder: LOCAL_SOURCE_MESSAGES.path.placeholder,
    validate: validateLocalPath,
  })
  return {
    name: DEFAULT_SOURCE_NAME,
    type: 'local',
    path: path.trim(),
  } as LocalSourceConfig
}
