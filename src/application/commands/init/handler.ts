import {basename, relative} from 'node:path'

import type {ProjectConfig, Source} from '@domain/config/types'
import * as prompts from '@infrastructure/cli/prompts'
import * as renderer from '@infrastructure/cli/renderer'
import {projectConfigExists, writeProjectConfig} from '@infrastructure/config'
import io from '@infrastructure/io'

import {promptAssistantSelection, runAssistantScan} from '../shared/assistant.prompt'
import {promptNewSource} from '../shared/source.prompt'
import {INIT_MESSAGES as M} from './messages'
import type {InitCommandAction} from './types'

export const runInit: InitCommandAction = async (options) => {
  let configVersion = 0

  const projectRoot = io.resolveProjectRoot()
  prompts.intro(M.intro)

  // 1. Abort immediately if config already exists — no overwrite in init
  if (projectConfigExists(projectRoot)) {
    renderer.renderWarning(M.configExists)
    prompts.outro(M.outroCancelled)
    return
  }

  // 2. Scan for existing AI configs
  const scan = runAssistantScan(projectRoot)

  renderer.renderNewline()
  renderer.renderInfo(M.detected)
  renderer.renderDetectionResults(scan.detectionResults)
  renderer.renderNewline()

  // 3. Ask which assistants to enable — detected ones pre-selected
  const detectedIds = scan.detectionResults.filter((r) => r.detected).map((r) => r.id)
  const assistants = await promptAssistantSelection(scan, detectedIds)

  // 4. Ask for sources — loop until user declines
  const sources: Source[] = []

  let addMore = await prompts.confirm({
    message: M.source.addSource,
    initialValue: true,
  })

  while (addMore) {
    sources.push(await promptNewSource(sources.length))

    addMore = await prompts.confirm({
      message: M.source.addAnother,
      initialValue: false,
    })
  }

  // 5. Build and write config
  const config: ProjectConfig = {
    version: `${++configVersion}`,
    project: {
      name: basename(projectRoot),
    },
    assistants,
    sources,
  }

  const configPath = await writeProjectConfig(projectRoot, config)

  renderer.renderNewline()
  renderer.renderSuccess(M.configWrittenTo(relative(projectRoot, configPath)))
  renderer.renderNewline()

  // 6. Offer to sync now
  if (sources.length > 0) {
    const syncNow = await prompts.confirm({
      message: M.sync.runNow,
      initialValue: true,
    })

    if (syncNow) {
      const {syncCommand} = await import('../sync')
      await syncCommand.action({dryRun: false, verbose: options.verbose})
      return
    }
  }

  prompts.outro(sources.length > 0 ? M.outro : M.outroNoSource)
}
