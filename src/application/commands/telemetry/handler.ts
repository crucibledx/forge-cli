import {homedir} from 'node:os'

import * as renderer from '@infrastructure/cli/renderer'
import {loadProjectConfig} from '@infrastructure/config'
import io from '@infrastructure/io'
import {createTelemetryService, resolveTelemetryConfig} from '@infrastructure/telemetry'

import {TELEMETRY_MESSAGES as M} from './messages'

export async function runTelemetryReset(): Promise<void> {
  const service = await createTelemetryService()
  const count = await service.eventCount()

  if (count === 0) {
    renderer.renderDim(M.reset.nothingToClear)
    return
  }

  await service.clear()
  renderer.renderSuccess(M.reset.cleared(count))
}

export async function runTelemetryStatus(): Promise<void> {
  const projectRoot = io.resolveProjectRoot()
  const globalRoot = homedir()

  const globalConfig = await loadProjectConfig(globalRoot)
  const projectConfig = projectRoot !== globalRoot ? await loadProjectConfig(projectRoot) : null

  const config = resolveTelemetryConfig(globalConfig, projectConfig)
  const service = await createTelemetryService()

  // Header
  renderer.renderInfo(M.status.header)
  renderer.renderNewline()

  // Effective status
  if (config.enabled) {
    renderer.renderSuccess(M.status.enabled)
  } else {
    renderer.renderDim(M.status.disabled)
  }

  // Config resolution breakdown
  renderer.renderNewline()
  if (globalConfig?.telemetry?.enabled) {
    renderer.renderDim(M.status.globalEnabled)
  } else {
    renderer.renderDim(M.status.globalDisabled)
  }

  if (projectConfig) {
    if (projectConfig.telemetry?.enabled !== undefined) {
      renderer.renderDim(projectConfig.telemetry.enabled ? M.status.projectEnabled : M.status.projectDisabled)
    } else {
      renderer.renderDim(M.status.projectNotSet)
    }
  }

  // Event stats
  renderer.renderNewline()
  const count = await service.eventCount()
  if (count === 0) {
    renderer.renderDim(M.status.noEvents)
  } else {
    renderer.renderDim(M.status.eventCount(count))
  }
  renderer.renderDim(M.status.storageDir(service.getStorageDir()))

  // What we collect
  renderer.renderNewline()
  renderer.renderInfo(M.collected.header)
  for (const item of M.collected.items) {
    renderer.renderDim(`  • ${item}`)
  }
  renderer.renderNewline()
  renderer.renderDim(M.collected.localOnly)
  renderer.renderWarning(M.collected.notCollected)

  // How to configure
  renderer.renderNewline()
  renderer.renderDim(M.howTo.toggle)
  renderer.renderDim(M.howTo.projectOverride)
}
