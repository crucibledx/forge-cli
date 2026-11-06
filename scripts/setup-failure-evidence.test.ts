import {existsSync} from 'node:fs'
import {copyFile, mkdir} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {SKILL_DEPLOY} from '../e2e/fixtures/sources'
import {createBareRepo} from '../e2e/framework/git'
import {runPipe} from '../e2e/framework/pipe'
import {contractInputs, validateContracts} from './check-contracts'
import {contextSchema} from './evidence-schema'
import {repositoryRoot} from './validation-context'
import {assessLane} from './validation-policy'

const dir = useTmpDir('setup-failure')
it('AC-25 preserves original blocked check/context/lane evidence without installed packages', async () => {
  const repository = await createBareRepo(dir(), {'skills/deploy.md': SKILL_DEPLOY})
  const root = join(dir(), 'no-dependencies')
  expect((await runPipe(dir(), ['git', 'clone', repository, root])).exitCode).toBe(0)
  await mkdir(join(root, 'scripts/registry'), {recursive: true})
  for (const file of [
    'setup-failure-evidence.ts',
    'validation-identity.ts',
    'validation-lanes.ts',
    'validation-evidence.ts',
    'registry/suites.ts',
  ])
    await copyFile(join(repositoryRoot, 'scripts', file), join(root, 'scripts', file))
  await copyFile(join(repositoryRoot, '.bun-version'), join(root, '.bun-version'))
  expect(existsSync(join(root, 'node_modules'))).toBe(false)
  const result = await runPipe(root, [process.execPath, 'scripts/setup-failure-evidence.ts', '--lane', 'business'], {
    env: {GITHUB_ACTIONS: 'false'},
  })
  expect(result.exitCode).toBe(0)
  const context = contextSchema.parse(await Bun.file(join(root, 'results/context.json')).json())
  const lane = assessLane(await Bun.file(join(root, 'results/business.json')).json(), context, Bun.version)
  expect(lane.status).toBe('blocked')
  expect(lane.checks).toHaveLength(4)
  for (const check of lane.checks) {
    expect(check.exit_code).toBeNull()
    expect(await Bun.file(join(root, 'results', check.evidence[0])).text()).toContain('not executed')
  }
  expect(existsSync(join(root, 'node_modules'))).toBe(false)
})
it('AC-25 rejects removal of the installation-failure evidence path', () => {
  const input = contractInputs()
  input.ci.jobs.lanes.steps = input.ci.jobs.lanes.steps.filter(
    (step: {name?: string}) => step.name !== 'Preserve installation-failure evidence',
  )
  expect(validateContracts(input)).toContain('Dependency-free installation-failure evidence missing')
})
it.each([false, true])(
  'AC-25,27 gate setup fallback persists ten blocked rows without dependencies, invalid-context=%s',
  async (invalid) => {
    const repository = await createBareRepo(dir(), {'skills/deploy.md': SKILL_DEPLOY})
    const root = join(dir(), 'no-gate-dependencies')
    expect((await runPipe(dir(), ['git', 'clone', repository, root])).exitCode).toBe(0)
    await mkdir(join(root, 'scripts'))
    for (const file of ['gate-setup-failure.ts', 'gate-summary.ts', 'validation-identity.ts', 'validation-lanes.ts'])
      await copyFile(join(repositoryRoot, 'scripts', file), join(root, 'scripts', file))
    const event = join(root, 'event.json')
    await Bun.write(event, JSON.stringify({repository: {full_name: 'wrong/repository'}}))
    const result = await runPipe(root, [process.execPath, 'scripts/gate-setup-failure.ts'], {
      env: invalid
        ? {GITHUB_ACTIONS: 'true', GITHUB_EVENT_PATH: event, GITHUB_REPOSITORY: 'crucibledx/forge-cli'}
        : {GITHUB_ACTIONS: 'false'},
    })
    expect(result.exitCode).toBe(1)
    expect(existsSync(join(root, 'node_modules'))).toBe(false)
    const summary = await Bun.file(join(root, 'results/gate-summary.json')).json()
    if (invalid) expect(summary.context).toBeNull()
    else expect(contextSchema.parse(summary.context).kind).toBe('local')
    expect(summary.conclusion).toBe('failure')
    expect(summary.lanes).toHaveLength(10)
    expect(summary.lanes.every((lane: {status: string}) => lane.status === 'blocked')).toBe(true)
    expect(result.stderr).toContain('installation failed')
  },
)
it('AC-25,27 rejects removal of the dependency-free gate setup fallback', () => {
  const input = contractInputs()
  input.ci.jobs.gate.steps = input.ci.jobs.gate.steps.filter(
    (step: {name?: string}) => step.name !== 'Preserve gate installation-failure evidence',
  )
  expect(validateContracts(input)).toContain('Dependency-free gate installation-failure evidence missing')
})
