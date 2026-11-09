import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {SKILL_DEPLOY} from '@e2e/fixtures/sources'
import {createBareRepo} from '@e2e/framework/git'
import {SESSION_MS} from '@e2e/framework/process'

const dir = useTmpDir('git-fixture-diagnostics')
it('AC-18,27 Git fixture failures retain exact exit/signal/timeout and both diagnostic streams', async () => {
  const error = await createBareRepo(dir(), {'skills/deploy.md': SKILL_DEPLOY}, 'invalid branch').then(
    () => null,
    (error: unknown) => error,
  )
  expect(error).toBeInstanceOf(Error)
  const message = (error as Error).message
  const match = /\nSession: ([^\n]+)\n/.exec(message)
  expect(match).not.toBeNull()
  const context = JSON.parse(match![1])
  expect(context).toMatchObject({cwd: '.', signal: null, timedOut: false, timeoutMs: SESSION_MS})
  expect(typeof context.exit).toBe('number')
  expect(context.exit).not.toBe(0)
  expect(context.command.slice(0, 2)).toEqual(['git', '-C'])
  expect(context.command).toContain('update-ref')
  expect(message).toContain('stdout:\n')
  expect(message).toContain('stderr:\n')
  expect(message).not.toContain(join(dir(), 'repo.git'))
})
