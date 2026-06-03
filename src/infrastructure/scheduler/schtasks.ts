import {schedulersRegistry} from './registry'
import {titleFor} from './shared'
import type {PlatformScheduler} from './types'

const WEEKDAY_MAP: Record<string, string> = {
  '0': 'SUN',
  '1': 'MON',
  '2': 'TUE',
  '3': 'WED',
  '4': 'THU',
  '5': 'FRI',
  '6': 'SAT',
  '7': 'SUN',
}

export function cronToSchtasksArgs(cron: string): string[] {
  const [minute, hour, day, month, weekday] = cron.split(/\s+/)

  const pad2 = (v: string) => v.padStart(2, '0')

  // Every N minutes: */N * * * *
  if (minute.startsWith('*/') && hour === '*' && day === '*' && month === '*' && weekday === '*') {
    return ['/sc', 'MINUTE', '/mo', minute.slice(2)]
  }

  // Every N hours: 0 */N * * *
  if (minute === '0' && hour.startsWith('*/') && day === '*' && month === '*' && weekday === '*') {
    return ['/sc', 'HOURLY', '/mo', hour.slice(2)]
  }

  // Daily at specific time: M H * * *
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && day === '*' && month === '*' && weekday === '*') {
    return ['/sc', 'DAILY', '/st', `${pad2(hour)}:${pad2(minute)}`]
  }

  // Weekly on specific days: M H * * D[,D...]
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && day === '*' && month === '*' && weekday !== '*') {
    const days = weekday
      .split(',')
      .map((d) => WEEKDAY_MAP[d] ?? d.toUpperCase())
      .join(',')
    return ['/sc', 'WEEKLY', '/d', days, '/st', `${pad2(hour)}:${pad2(minute)}`]
  }

  throw new Error(
    `Cron expression "${cron}" cannot be mapped to Windows Task Scheduler. ` +
      'Use a simpler pattern: daily (M H * * *), weekly (M H * * D), or interval (*/N * * * *).',
  )
}

const schtasksScheduler: PlatformScheduler = {
  platform: 'win32',

  install(projectRoot, schedule, command) {
    const title = titleFor(projectRoot)
    const scheduleArgs = cronToSchtasksArgs(schedule)
    const commandParts = command.split(/\s+/)
    const quotedArgs = commandParts.map((a) => `"${a}"`).join(' ')

    // Remove existing task if present
    Bun.spawnSync(['schtasks', '/delete', '/tn', title, '/f'], {stdout: 'pipe', stderr: 'pipe'})

    const result = Bun.spawnSync(['schtasks', '/create', '/tn', title, '/tr', quotedArgs, ...scheduleArgs, '/f'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })

    if (result.exitCode !== 0) {
      const stderr = new TextDecoder().decode(result.stderr)
      throw new Error(`schtasks create failed: ${stderr.trim()}`)
    }
  },

  uninstall(projectRoot) {
    Bun.spawnSync(['schtasks', '/delete', '/tn', titleFor(projectRoot), '/f'], {stdout: 'pipe', stderr: 'pipe'})
  },

  isInstalled(projectRoot) {
    const proc = Bun.spawnSync(['schtasks', '/query', '/tn', titleFor(projectRoot)], {stdout: 'pipe', stderr: 'pipe'})
    return proc.exitCode === 0
  },

  getJobTitle: titleFor,
}

schedulersRegistry.push(schtasksScheduler)
