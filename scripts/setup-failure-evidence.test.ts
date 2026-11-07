import {existsSync} from 'node:fs'
import {copyFile, mkdir, readdir, readFile, symlink, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'

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
async function withoutDependencies(name: string) {
  const repository = await createBareRepo(dir(), {'skills/deploy.md': SKILL_DEPLOY})
  const root = join(dir(), name)
  expect((await runPipe(dir(), ['git', 'clone', repository, root])).exitCode).toBe(0)
  for (const file of [
    '.bun-version',
    'package.json',
    'scripts/setup-failure-evidence.ts',
    'scripts/gate-setup-failure.ts',
    'scripts/gate-summary.ts',
    'scripts/evidence-io.ts',
    'scripts/validation-identity.ts',
    'scripts/validation-lanes.ts',
    'scripts/validation-evidence.ts',
    'src/domain/portable-path.ts',
    'src/infrastructure/fs/confinement.ts',
  ]) {
    await mkdir(dirname(join(root, file)), {recursive: true})
    await copyFile(join(repositoryRoot, file), join(root, file))
  }
  expect(existsSync(join(root, 'node_modules'))).toBe(false)
  return root
}
it('AC-25 preserves original blocked check/context/lane evidence without installed packages', async () => {
  const root = await withoutDependencies('no-dependencies')
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
it('AC-25 dependency-free local identity follows package repository metadata', async () => {
  const root = await withoutDependencies('relocated-package')
  const file = join(root, 'package.json'),
    metadata = JSON.parse(await readFile(file, 'utf8'))
  metadata.repository.url = 'git+https://github.com/relocated-owner/relocated-forge.git'
  await writeFile(file, JSON.stringify(metadata))
  const result = await runPipe(root, [process.execPath, 'scripts/setup-failure-evidence.ts', '--lane', 'business'], {
    env: {GITHUB_ACTIONS: 'false'},
  })
  expect(result.exitCode).toBe(0)
  expect((await Bun.file(join(root, 'results/context.json')).json()).repository).toBe('relocated-owner/relocated-forge')
  expect(existsSync(join(root, 'node_modules'))).toBe(false)
})
it.each([false, true])(
  'AC-25,27 gate setup fallback persists ten blocked rows without dependencies, invalid-context=%s',
  async (invalid) => {
    const root = await withoutDependencies('no-gate-dependencies')
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
it.each([
  {entry: 'setup-failure-evidence.ts', link: 'results'},
  {entry: 'setup-failure-evidence.ts', link: 'results/checks'},
  {entry: 'setup-failure-evidence.ts', link: 'results/checks/security'},
  {entry: 'gate-setup-failure.ts', link: 'results'},
])('AC-25,26 fallback $entry rejects native junction $link without ANY outside writes', async ({entry, link}) => {
  const root = await withoutDependencies('linked-fallback'),
    outside = join(dir(), 'outside'),
    sentinel = join(outside, 'sentinel')
  await mkdir(outside)
  await writeFile(sentinel, 'outside sentinel')
  await mkdir(dirname(join(root, link)), {recursive: true})
  await symlink(outside, join(root, link), 'junction')
  const before = await readdir(outside)
  const result = await runPipe(
    root,
    [process.execPath, `scripts/${entry}`, ...(entry === 'setup-failure-evidence.ts' ? ['--lane', 'security'] : [])],
    {env: {GITHUB_ACTIONS: 'false'}},
  )
  expect(result.exitCode).not.toBe(0)
  expect(await readdir(outside)).toEqual(before)
  expect(await readFile(sentinel, 'utf8')).toBe('outside sentinel')
  expect(existsSync(join(outside, 'security'))).toBe(false)
  expect(existsSync(join(root, 'node_modules'))).toBe(false)
})
it.each([
  'results/checks/security/test-security.log',
  'results/context.json',
  'results/security.json',
  'results/gate-summary.json',
])('AC-25,26 dependency-free fallback preserves existing evidence exclusively: %s', async (path) => {
  const root = await withoutDependencies('exclusive-fallback'),
    existing = join(root, path)
  await mkdir(dirname(existing), {recursive: true})
  await writeFile(existing, 'original evidence sentinel')
  const gate = path.endsWith('gate-summary.json')
  const result = await runPipe(
    root,
    [
      process.execPath,
      gate ? 'scripts/gate-setup-failure.ts' : 'scripts/setup-failure-evidence.ts',
      ...(gate ? [] : ['--lane', 'security']),
    ],
    {env: {GITHUB_ACTIONS: 'false'}},
  )
  expect(result.exitCode).not.toBe(0)
  expect(await readFile(existing, 'utf8')).toBe('original evidence sentinel')
  expect(existsSync(join(root, 'node_modules'))).toBe(false)
})
