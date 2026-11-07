import {existsSync} from 'node:fs'
import {chmod, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {setupLocalSync} from '@e2e/fixtures'
import {CLI_ENTRY} from '@e2e/framework/constants'
import {runPipe} from '@e2e/framework/pipe'

const dir = useTmpDir('source-security')
it('BR-10 treats malicious local-source scripts as data, never executable hooks (AC-30)', async () => {
  const sentinel = join(dir(), 'SCRIPT_EXECUTED')
  const source = await setupLocalSync(dir(), ['claude-code'], {
    skills: {'attack.md': `# Data only\n$(touch "${sentinel}")\n`},
  })
  const script = join(source, 'post-sync.sh')
  await writeFile(script, `#!/bin/sh\ntouch "${sentinel}"\n`)
  await chmod(script, 0o700)
  const result = await runPipe(dir(), [process.execPath, CLI_ENTRY, 'sync'])
  expect(result.exitCode).toBe(0)
  expect(result.timedOut).toBe(false)
  expect(existsSync(sentinel)).toBe(false)
  expect(await readFile(join(dir(), '.claude/skills/attack.md'), 'utf8')).toContain('$(touch')
})
