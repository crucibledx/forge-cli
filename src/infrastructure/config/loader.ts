import {existsSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

import {parse as parseYaml} from 'yaml'

import {projectConfigSchema} from './schema'
import type {GetProjectConfigPathFunction, LoadProjectConfigFunction, ProjectConfigExistsFunction} from './types'

const CRUCIBLE_DIR = '.crucible'
const CONFIG_FILE = 'forge.config.yaml'

export const loadProjectConfig: LoadProjectConfigFunction = async (projectRoot) => {
  const configPath = getProjectConfigPath(projectRoot)

  if (!existsSync(configPath)) {
    return null
  }

  const raw = await readFile(configPath, 'utf-8')
  const parsed = parseYaml(raw)
  return projectConfigSchema.parse(parsed)
}

export const getProjectConfigPath: GetProjectConfigPathFunction = (projectRoot) => {
  return join(projectRoot, CRUCIBLE_DIR, CONFIG_FILE)
}

export const projectConfigExists: ProjectConfigExistsFunction = (projectRoot) => {
  return existsSync(getProjectConfigPath(projectRoot))
}
