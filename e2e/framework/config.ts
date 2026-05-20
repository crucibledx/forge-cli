import {readFile} from 'node:fs/promises'

import {configFilePath} from '@test-helpers/tmp'
import {parse as parseYaml} from 'yaml'

import type {ProjectConfig} from '@domain/config/types'

export async function readConfig(projectRoot: string): Promise<ProjectConfig> {
  return parseYaml(await readConfigRaw(projectRoot)) as ProjectConfig
}

export async function readConfigRaw(projectRoot: string): Promise<string> {
  return await readFile(configFilePath(projectRoot), 'utf-8')
}
