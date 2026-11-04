import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {executeCheck} from './validation-process'

const dir = useTmpDir('validation-process')
it('AC-25,30,31 bounds a hanging command and preserves separate bounded failure diagnostics', async () => {
  const result = await executeCheck(
    [process.execPath, '-e', "process.stdout.write('out');process.stderr.write('err');setInterval(()=>{},1000)"],
    dir(),
    80,
  )
  expect(result.timed_out).toBe(true)
  expect(result.exit_code).toBeNull()
  expect(result.stdout).toBe('out')
  expect(result.stderr).toBe('err')
  expect(result.duration_ms).toBeLessThan(3000)
})
