import {createSchedulerLogger} from '@infrastructure/logger'

const logger = createSchedulerLogger()

export default {
  async scheduled() {
    await logger.info('Scheduled sync started')

    try {
      const {runSync} = await import('../sync/handler')
      await runSync({dryRun: false, verbose: false, silent: true})
      await logger.info('Scheduled sync completed successfully')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await logger.error(`Scheduled sync failed: ${message}`)
    }
  },
}
