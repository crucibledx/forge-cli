import {loadersRegistry} from '../registry'
import type {SourceLoaderEntry} from '../types'
import {configure} from './configure'
import {load} from './load'
import {localSourceSchema} from './schema.types'

export const localLoader: SourceLoaderEntry = {
  alias: 'local',
  label: 'Local directory',
  configSchema: localSourceSchema,
  configure,
  load,
}

loadersRegistry.push(localLoader)

export {validateLocalPath} from './configure'
export {LocalSourceError} from './load'
export {LOCAL_SOURCE_MESSAGES} from './messages'
export {localSourceSchema} from './schema.types'
export type {LocalSourceConfig} from './types'
