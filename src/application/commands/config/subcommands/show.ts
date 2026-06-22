import pc from 'picocolors'

import {getAllAssistants} from '@domain/assistants'
import type {ProjectConfig, Source} from '@domain/config/types'
import {SYNC_CONFIG_DEFAULTS, TELEMETRY_DEFAULTS} from '@domain/config/types'
import {describeCron} from '@domain/scheduler'
import * as renderer from '@infrastructure/cli/renderer'
import {loadProjectConfig} from '@infrastructure/config'
import io from '@infrastructure/io'

import {CONFIG_MESSAGES} from '../messages'

// ─── Messages ────────────────────────────────────────────────────────────────

export const SHOW_MESSAGES = {
  header: 'Current Configuration',
  noConfig: CONFIG_MESSAGES.noConfig,
  project: 'Project',
  assistants: 'Assistants',
  sources: 'Sources',
  sync: 'Sync Settings',
  schedule: 'Schedule',
  telemetry: 'Telemetry',
  none: 'none',
  defaultLabel: '(default)',
} as const

// ─── Formatting ──────────────────────────────────────────────────────────────

function label(text: string): string {
  return pc.bold(pc.blue(text))
}

function dim(text: string): string {
  return pc.dim(text)
}

function field(key: string, value: string, isDefault = false): void {
  const suffix = isDefault ? ` ${dim(SHOW_MESSAGES.defaultLabel)}` : ''
  console.log(`    ${dim(key + ':')} ${value}${suffix}`)
}

function section(title: string): void {
  console.log()
  console.log(`  ${label(title)}`)
}

// ─── Source display ──────────────────────────────────────────────────────────

const SOURCE_BASE_KEYS = new Set(['name', 'type', 'layout', 'include', 'exclude', 'map'])

function renderSource(source: Source): void {
  const typeHint = dim(`[${source.type}]`)
  console.log(`    ${pc.white(source.name)} ${typeHint}`)

  // Type-specific fields
  for (const [key, value] of Object.entries(source)) {
    if (SOURCE_BASE_KEYS.has(key) || value === undefined) continue
    field(key, String(value))
  }

  // Advanced options
  if (source.layout) field('layout', source.layout)
  if (source.include?.length) field('include', source.include.join(', '))
  if (source.exclude?.length) field('exclude', source.exclude.join(', '))
  if (source.map) field('map', source.map)
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function runConfigShow(): Promise<void> {
  const projectRoot = io.resolveProjectRoot()
  const config = await loadProjectConfig(projectRoot)

  if (!config) {
    renderer.renderWarning(SHOW_MESSAGES.noConfig)
    return
  }

  renderer.renderHeader(SHOW_MESSAGES.header)
  renderProjectSection(config)
  renderAssistantsSection(config)
  renderSourcesSection(config)
  renderSyncSection(config)
  renderScheduleSection(config)
  renderTelemetrySection(config)
  console.log()
}

function renderProjectSection(config: ProjectConfig): void {
  if (!config.project) return
  section(SHOW_MESSAGES.project)
  field('name', config.project.name)
  if (config.project.description) field('description', config.project.description)
}

function renderAssistantsSection(config: ProjectConfig): void {
  section(SHOW_MESSAGES.assistants)
  if (config.assistants.length === 0) {
    console.log(`    ${dim(SHOW_MESSAGES.none)}`)
    return
  }
  const registry = getAllAssistants()
  for (const a of config.assistants) {
    const def = registry.find((r) => r.id === a.id)
    const name = def?.name ?? a.id
    const status = a.enabled ? pc.green('✓') : pc.red('✗')
    console.log(`    ${status} ${pc.white(name)}`)
  }
}

function renderSourcesSection(config: ProjectConfig): void {
  section(SHOW_MESSAGES.sources)
  if (config.sources.length === 0) {
    console.log(`    ${dim(SHOW_MESSAGES.none)}`)
    return
  }
  for (const source of config.sources) {
    renderSource(source)
  }
}

function renderSyncSection(config: ProjectConfig): void {
  section(SHOW_MESSAGES.sync)
  const d = SYNC_CONFIG_DEFAULTS
  const s = config.sync ?? {}

  const srcStrategy = s.source_conflict_strategy ?? d.source_conflict_strategy
  const localStrategy = s.local_conflict_strategy ?? d.local_conflict_strategy
  const backup = s.backup ?? d.backup
  const keepLocal = s.keep_local ?? d.keep_local

  field('source conflict', srcStrategy, srcStrategy === d.source_conflict_strategy)
  field('local conflict', localStrategy, localStrategy === d.local_conflict_strategy)
  field('backup', backup ? 'on' : 'off', backup === d.backup)
  field('keep local', keepLocal ? 'on' : 'off', keepLocal === d.keep_local)
}

function renderScheduleSection(config: ProjectConfig): void {
  section(SHOW_MESSAGES.schedule)
  if (!config.sync?.schedule) {
    console.log(`    ${dim('not configured')}`)
    return
  }
  field('cron', config.sync.schedule)
  field('description', describeCron(config.sync.schedule))
}

function renderTelemetrySection(config: ProjectConfig): void {
  section(SHOW_MESSAGES.telemetry)
  const enabled = config.telemetry?.enabled ?? TELEMETRY_DEFAULTS.enabled
  const backend = config.telemetry?.backend ?? TELEMETRY_DEFAULTS.backend
  field('enabled', enabled ? 'yes' : 'no', enabled === TELEMETRY_DEFAULTS.enabled)
  field('backend', backend, backend === TELEMETRY_DEFAULTS.backend)
}
