import {existsSync} from 'node:fs'
import {homedir} from 'node:os'
import {join} from 'node:path'

import type {SchedulerBackend} from './types'

export type {SchedulerBackend} from './types'

const TITLE_PREFIX = 'crucible-forge-sync'

function titleFor(projectRoot: string): string {
  const slug = projectRoot
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return `${TITLE_PREFIX}-${slug}`
}

function plistPathFor(title: string): string {
  return join(homedir(), 'Library', 'LaunchAgents', `bun.cron.${title}.plist`)
}

function crontabHasTitle(title: string): boolean {
  try {
    const proc = Bun.spawnSync(['crontab', '-l'], {stdout: 'pipe', stderr: 'pipe'})
    const output = new TextDecoder().decode(proc.stdout)
    return output.includes(title)
  } catch {
    return false
  }
}

function schtasksHasTitle(title: string): boolean {
  try {
    const taskName = `bun-cron-${title}`
    const proc = Bun.spawnSync(['schtasks', '/query', '/tn', taskName], {stdout: 'pipe', stderr: 'pipe'})
    return proc.exitCode === 0
  } catch {
    return false
  }
}

const bunCronBackend: SchedulerBackend = {
  async install(_projectRoot, schedule, workerPath) {
    const title = titleFor(_projectRoot)
    await Bun.cron(workerPath, schedule, title)
  },

  async uninstall(projectRoot) {
    const title = titleFor(projectRoot)
    await Bun.cron.remove(title)
  },

  async isInstalled(projectRoot) {
    const title = titleFor(projectRoot)
    // Bun.cron registers OS-level jobs per platform:
    // macOS  → ~/Library/LaunchAgents/bun.cron.<title>.plist
    // Linux  → crontab entry with title marker
    // Windows → schtasks with name bun-cron-<title>
    if (existsSync(plistPathFor(title))) return true
    if (crontabHasTitle(title)) return true
    return schtasksHasTitle(title)
  },

  getJobTitle(projectRoot) {
    return titleFor(projectRoot)
  },
}

export function getSchedulerBackend(): SchedulerBackend {
  return bunCronBackend
}
