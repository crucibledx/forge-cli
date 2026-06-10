import type {Source} from '@domain/config/types'
import {deleteSourceFiles, getFilesForSource, removeSourceFromState} from '@application/commands/shared/source.cleanup'
import {configureSource, promptNewSource, SOURCE_PROMPT_MESSAGES} from '@application/commands/shared/source.prompt'
import * as prompts from '@infrastructure/cli/prompts'
import * as renderer from '@infrastructure/cli/renderer'
import {loadSyncState, writeSyncState} from '@infrastructure/config'

import {sectionsRegistry} from './registry'
import type {ConfigSectionEntry} from './types'

// ─── Messages ────────────────────────────────────────────────────────────────

export const SOURCE_MESSAGES = {
  action: 'What would you like to do?',
  actionAdd: 'Add a new source',
  actionEdit: 'Edit an existing source',
  actionRemove: 'Remove a source',
  actionDone: 'Done',
  addType: SOURCE_PROMPT_MESSAGES.selectType,
  editWhich: 'Which source to edit?',
  removeWhich: 'Which source to remove?',
  confirmRemove: (name: string) => `Remove source "${name}"?`,
  removed: (name: string) => `Removed source "${name}".`,
  added: (name: string) => `Source "${name}" added.`,
  updated: (name: string) => `Source "${name}" updated.`,
  cleanFiles: (count: number) => `Clean ${count} synced file(s) from this source?`,
  cleaned: (count: number) => `Cleaned ${count} file(s).`,
  hintNone: 'none configured',
} as const

// ─── Actions ─────────────────────────────────────────────────────────────────

const ACTION_ADD = 'add'
const ACTION_EDIT = 'edit'
const ACTION_REMOVE = 'remove'
const ACTION_DONE = 'done'

// ─── Section entry ───────────────────────────────────────────────────────────

export const sourceSection: ConfigSectionEntry = {
  id: 'sources',
  label: 'Sources',

  hint: (config) => {
    const count = config.sources.length
    if (count === 0) return SOURCE_MESSAGES.hintNone
    const names = config.sources.map((s) => s.name).join(', ')
    return `${count} configured: ${names}`
  },

  edit: async (config, projectRoot) => {
    const M = SOURCE_MESSAGES
    let sources = [...config.sources]

    while (true) {
      const options: Array<{value: string; label: string}> = [
        {value: ACTION_ADD, label: M.actionAdd},
        {value: ACTION_DONE, label: M.actionDone},
      ]
      if (sources.length > 0) {
        options.push({value: ACTION_EDIT, label: M.actionEdit}, {value: ACTION_REMOVE, label: M.actionRemove})
      }

      const action = await prompts.select({message: M.action, options})

      const handler = actionHandlers[action]
      if (!handler) break
      sources = await handler(sources, projectRoot)
    }

    return {...config, sources}
  },
}

// ─── Actions Handlers ────────────────────────────────────────────────────────

type ActionHandler = (sources: Source[], projectRoot: string) => Promise<Source[]>

const addSource: ActionHandler = async (sources: Source[]): Promise<Source[]> => {
  const source = await promptNewSource(sources.map((s) => s.name))
  renderer.renderSuccess(SOURCE_MESSAGES.added(source.name))
  return [...sources, source]
}

const editSource: ActionHandler = async (sources: Source[]): Promise<Source[]> => {
  const M = SOURCE_MESSAGES
  const sourceName = await prompts.select({
    message: M.editWhich,
    options: sources.map((s) => ({value: s.name, label: s.name, hint: s.type})),
  })
  const idx = sources.findIndex((s) => s.name === sourceName)
  const existing = sources[idx]
  const updated = await configureSource()
  updated.name = existing.name
  const next = [...sources]
  next[idx] = updated
  renderer.renderSuccess(M.updated(updated.name))
  return next
}

const removeSource: ActionHandler = async (sources: Source[], projectRoot: string): Promise<Source[]> => {
  const M = SOURCE_MESSAGES
  const sourceName = await prompts.select({
    message: M.removeWhich,
    options: sources.map((s) => ({value: s.name, label: s.name, hint: s.type})),
  })
  const confirmed = await prompts.confirm({
    message: M.confirmRemove(sourceName),
    initialValue: false,
  })
  if (!confirmed) return sources

  await cleanupSourceFiles(projectRoot, sourceName)

  renderer.renderSuccess(M.removed(sourceName))
  return sources.filter((s) => s.name !== sourceName)
}

async function cleanupSourceFiles(projectRoot: string, sourceName: string): Promise<void> {
  const M = SOURCE_MESSAGES
  const syncState = await loadSyncState(projectRoot)
  const filePaths = getFilesForSource(syncState, sourceName)

  if (filePaths.length === 0) return

  const shouldClean = await prompts.confirm({
    message: M.cleanFiles(filePaths.length),
    initialValue: true,
  })

  if (!shouldClean) return

  const {cleaned} = await deleteSourceFiles(projectRoot, filePaths)
  const updatedState = removeSourceFromState(syncState, sourceName)
  await writeSyncState(projectRoot, updatedState)
  renderer.renderSuccess(M.cleaned(cleaned))
}

const actionHandlers: Record<string, ActionHandler> = {
  [ACTION_ADD]: addSource,
  [ACTION_EDIT]: editSource,
  [ACTION_REMOVE]: removeSource,
}

sectionsRegistry.push(sourceSection)
