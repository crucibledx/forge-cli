import {platform} from 'node:os'

import type {PlatformScheduler} from './types'

export const schedulersRegistry: PlatformScheduler[] = []

export function getSchedulerForPlatform(): PlatformScheduler {
  const os = platform()
  const scheduler = schedulersRegistry.find((s) => s.platform === os)
  if (!scheduler) {
    // Fallback to linux (crontab) for unknown platforms
    const fallback = schedulersRegistry.find((s) => s.platform === 'linux')
    if (!fallback) throw new Error(`No scheduler registered for platform "${os}"`)
    return fallback
  }
  return scheduler
}
