import {schedulersRegistry} from './registry'
import {titleFor} from './shared'
import type {PlatformScheduler} from './types'

export function crontabMarker(title: string): string {
  return `# ${title}`
}

export function readCrontab(): string {
  const proc = Bun.spawnSync(['crontab', '-l'], {stdout: 'pipe', stderr: 'pipe'})
  if (proc.exitCode !== 0) return ''
  return new TextDecoder().decode(proc.stdout)
}

export function writeCrontab(content: string): void {
  const proc = Bun.spawnSync(['crontab', '-'], {
    stdin: new TextEncoder().encode(content),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (proc.exitCode !== 0) {
    const stderr = new TextDecoder().decode(proc.stderr)
    throw new Error(`crontab write failed: ${stderr.trim()}`)
  }
}

export function removeCrontabEntry(content: string, marker: string): string {
  const lines = content.split('\n')
  const filtered: string[] = []

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(marker)) {
      i++ // skip the entry line after the marker
      continue
    }
    filtered.push(lines[i])
  }

  return filtered.join('\n')
}

export function buildCrontabEntry(title: string, projectRoot: string, schedule: string, command: string): string {
  const marker = crontabMarker(title)
  const entry = `${schedule} cd "${projectRoot}" && ${command}`
  return `${marker}\n${entry}`
}

const crontabScheduler: PlatformScheduler = {
  platform: 'linux',

  install(projectRoot, schedule, command) {
    const title = titleFor(projectRoot)
    const marker = crontabMarker(title)

    const existing = removeCrontabEntry(readCrontab(), marker).replace(/\n{3,}/g, '\n\n')

    const entry = buildCrontabEntry(title, projectRoot, schedule, command)
    const newCrontab = `${existing.trimEnd()}\n${entry}\n`
    writeCrontab(newCrontab)
  },

  uninstall(projectRoot) {
    writeCrontab(removeCrontabEntry(readCrontab(), crontabMarker(titleFor(projectRoot))))
  },

  isInstalled(projectRoot) {
    return readCrontab().includes(crontabMarker(titleFor(projectRoot)))
  },

  getJobTitle: titleFor,
}

schedulersRegistry.push(crontabScheduler)
