export interface SchedulerBackend {
  install: (projectRoot: string, schedule: string, command: string) => void | Promise<void>
  uninstall: (projectRoot: string) => void | Promise<void>
  isInstalled: (projectRoot: string) => boolean | Promise<boolean>
  getJobTitle: (projectRoot: string) => string
}

export interface PlatformScheduler extends SchedulerBackend {
  platform: string
}
