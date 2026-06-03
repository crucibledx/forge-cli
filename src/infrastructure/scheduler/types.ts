export interface SchedulerBackend {
  install: (projectRoot: string, schedule: string, workerPath: string) => Promise<void>
  uninstall: (projectRoot: string) => Promise<void>
  isInstalled: (projectRoot: string) => Promise<boolean>
  getJobTitle: (projectRoot: string) => string
}
