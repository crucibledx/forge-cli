import './crontab'
import './launchd'
import './schtasks'

import {getSchedulerForPlatform} from './registry'

export type {SchedulerBackend} from './types'

export function getSchedulerBackend() {
  return getSchedulerForPlatform()
}
