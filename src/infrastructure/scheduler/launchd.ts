import {existsSync, mkdirSync, unlinkSync, writeFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {join} from 'node:path'

import {schedulersRegistry} from './registry'
import {titleFor} from './shared'
import type {PlatformScheduler} from './types'

export function plistPathFor(title: string): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${title}.plist`)
}

export function cronToStartInterval(cron: string): number | null {
  const [minute, hour, day, month, weekday] = cron.split(/\s+/)

  // Every N minutes: */N * * * *
  if (minute.startsWith('*/') && hour === '*' && day === '*' && month === '*' && weekday === '*') {
    return parseInt(minute.slice(2), 10) * 60
  }

  // Every N hours: 0 */N * * *
  if (minute === '0' && hour.startsWith('*/') && day === '*' && month === '*' && weekday === '*') {
    return parseInt(hour.slice(2), 10) * 3600
  }

  return null
}

export function cronToPlistCalendar(cron: string): string {
  const [minute, hour, day, month, weekday] = cron.split(/\s+/)
  const fields = [minute, hour, day, month, weekday]

  if (fields.some((f) => f.includes('/'))) {
    throw new Error(
      `Cron expression "${cron}" uses step values which launchd's StartCalendarInterval does not support. ` +
        'Use a fixed time (e.g. 0 9 * * 1) or a simple interval (*/N * * * *).',
    )
  }

  const entries: string[] = []
  const add = (key: string, val: string) => {
    if (val !== '*') entries.push(`      <key>${key}</key>\n      <integer>${val}</integer>`)
  }

  add('Minute', minute)
  add('Hour', hour)
  add('Day', day)
  add('Month', month)
  add('Weekday', weekday)

  return entries.join('\n')
}

export function buildPlist(title: string, projectRoot: string, command: string, schedule: string): string {
  const commandParts = command.split(/\s+/)
  const programArgs = commandParts.map((arg) => `    <string>${arg}</string>`).join('\n')

  const intervalSeconds = cronToStartInterval(schedule)
  const scheduleBlock = intervalSeconds
    ? `  <key>StartInterval</key>\n  <integer>${intervalSeconds}</integer>`
    : `  <key>StartCalendarInterval</key>\n  <dict>\n${cronToPlistCalendar(schedule)}\n  </dict>`

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${title}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs}
  </array>
  <key>WorkingDirectory</key>
  <string>${projectRoot}</string>
${scheduleBlock}
  <key>StandardOutPath</key>
  <string>/dev/null</string>
  <key>StandardErrorPath</key>
  <string>/dev/null</string>
</dict>
</plist>`
}

const launchdScheduler: PlatformScheduler = {
  platform: 'darwin',

  install(projectRoot, schedule, command) {
    const title = titleFor(projectRoot)
    const plistPath = plistPathFor(title)
    const agentsDir = join(homedir(), 'Library', 'LaunchAgents')

    mkdirSync(agentsDir, {recursive: true})
    writeFileSync(plistPath, buildPlist(title, projectRoot, command, schedule))

    const uid = process.getuid?.()
    const result = Bun.spawnSync(['launchctl', 'bootstrap', `gui/${uid}`, plistPath], {stdout: 'pipe', stderr: 'pipe'})
    if (result.exitCode !== 0) {
      const stderr = new TextDecoder().decode(result.stderr)
      throw new Error(`launchctl bootstrap failed: ${stderr.trim()}`)
    }
  },

  uninstall(projectRoot) {
    const title = titleFor(projectRoot)
    const plistPath = plistPathFor(title)

    if (existsSync(plistPath)) {
      const uid = process.getuid?.()
      Bun.spawnSync(['launchctl', 'bootout', `gui/${uid}/${title}`], {stdout: 'pipe', stderr: 'pipe'})
      unlinkSync(plistPath)
    }
  },

  isInstalled(projectRoot) {
    return existsSync(plistPathFor(titleFor(projectRoot)))
  },

  getJobTitle: titleFor,
}

schedulersRegistry.push(launchdScheduler)
