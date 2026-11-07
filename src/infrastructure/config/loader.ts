import {existsSync} from 'node:fs'
import {readFile, rm} from 'node:fs/promises'
import {join} from 'node:path'

import {parse as parseYaml} from 'yaml'

import {CONFIG_PATH, CRUCIBLE_DIR} from '@domain/config/paths'

import {createConfinement} from '../fs/confinement'
import {projectConfigSchema} from './schema'
import type {GetProjectConfigPathFunction, LoadProjectConfigFunction, ProjectConfigExistsFunction} from './types'

export const loadProjectConfig: LoadProjectConfigFunction = async (projectRoot) => {
  const configPath = await (await createConfinement(projectRoot)).resolve(CONFIG_PATH)

  if (!existsSync(configPath)) {
    return null
  }

  const raw = await readFile(configPath, 'utf-8')
  const parsed = parseYaml(raw)
  return projectConfigSchema.parse(parsed)
}

export const getProjectConfigPath: GetProjectConfigPathFunction = (projectRoot) => {
  return join(projectRoot, CONFIG_PATH)
}

export const projectConfigExists: ProjectConfigExistsFunction = (projectRoot) => {
  return existsSync(getProjectConfigPath(projectRoot))
}

export async function removeCrucibleDir(projectRoot: string): Promise<void> {
  const cruciblePath = join(projectRoot, CRUCIBLE_DIR)
  await rm(cruciblePath, {recursive: true, force: true})
}
