import {expect, it} from 'bun:test'

import {contractInputs, validateContracts} from './check-contracts'

it('AC-1,24,25,27,28 validates the real ledger, pin, workflows and boundaries', () => {
  expect(validateContracts(contractInputs())).toEqual([])
})
it.each(['removed', 'late', 'changed'])('AC-25,27 rejects a %s job budget anchor', (kind) => {
  const original = contractInputs()
  const input = {...original, ci: structuredClone(original.ci)}
  const steps = input.ci.jobs.lanes.steps
  if (kind === 'removed') steps.shift()
  if (kind === 'late') steps.push(steps.shift())
  if (kind === 'changed') steps[0].run = 'echo ignored'
  expect(validateContracts(input)).toContain(
    'CI deadline must start before setup and reserve evidence/cleanup headroom',
  )
})
it.each([
  ['native-macos', 'ubuntu-latest'],
  ['native-macos', 'macos-latest'],
  ['native-windows', 'ubuntu-latest'],
])('AC-26 rejects runner drift for %s to %s', (lane, os) => {
  const original = contractInputs()
  const input = {...original, ci: structuredClone(original.ci)}
  input.ci.jobs.lanes.strategy.matrix.include.find((row: {lane: string}) => row.lane === lane).os = os
  expect(validateContracts(input)).toContain(
    'Native jobs must use the selected native hosted runners (no cross-compilation)',
  )
})
it.each([
  'pin',
  'minimum',
  'lock',
  'rule',
  'layer',
  'path',
  'lane',
  'workflow',
  'fail-fast',
  'retention',
  'timeout',
  'release',
])('rejects malformed %s contracts', (kind) => {
  const original = contractInputs(),
    input = {
      ...original,
      ledger: structuredClone(original.ledger),
      lanes: structuredClone(original.lanes),
      ci: structuredClone(original.ci),
      release: structuredClone(original.release),
      package: structuredClone(original.package),
    }
  if (kind === 'pin') input.pin = 'latest'
  if (kind === 'minimum') input.package.engines.bun = '>=1.0.0'
  if (kind === 'lock') input.lock = ''
  if (kind === 'rule') input.ledger[0].id = 'BR-99'
  if (kind === 'layer') Object.assign(input.ledger[0], {layer: 'invalid-layer'})
  if (kind === 'path') input.ledger[0].tests = ['missing.test.ts']
  if (kind === 'lane') input.lanes = input.lanes.slice(0, -1)
  if (kind === 'workflow') input.ci.on.pull_request.paths = ['src/**']
  if (kind === 'fail-fast') input.ci.jobs.lanes.strategy['fail-fast'] = true
  if (kind === 'retention')
    input.ci.jobs.lanes.steps.find((step: {uses?: string}) => step.uses?.startsWith('actions/upload-artifact@')).with[
      'retention-days'
    ] = 1
  if (kind === 'timeout') input.ci.jobs.gate['timeout-minutes'] = 99
  if (kind === 'release')
    input.release.jobs.quality.steps.find((step: {run?: string}) => step.run === 'bun install --frozen-lockfile').run =
      'bun install'
  expect(validateContracts(input).length).toBeGreaterThan(0)
})
it.each([
  'release-setup-removed',
  'ci-setup-removed',
  'release-job-removed',
  'check-command',
  'gate-command',
  'ci-alias',
])('AC-24,25 fails closed for %s even when the guarded step is removed', (kind) => {
  const original = contractInputs()
  const input = {
    ...original,
    ci: structuredClone(original.ci),
    release: structuredClone(original.release),
    package: structuredClone(original.package),
  }
  if (kind === 'release-setup-removed')
    for (const job of Object.values(input.release.jobs) as {steps: {uses?: string; run?: string}[]}[]) {
      job.steps = job.steps.filter((step) => !step.uses?.startsWith('oven-sh/setup-bun@'))
      for (const step of job.steps) if (step.run === 'bun install --frozen-lockfile') step.run = 'bun install'
    }
  if (kind === 'ci-setup-removed')
    input.ci.jobs.lanes.steps = input.ci.jobs.lanes.steps.filter(
      (step: {uses?: string}) => !step.uses?.startsWith('oven-sh/setup-bun@'),
    )
  if (kind === 'release-job-removed') delete input.release.jobs.build
  if (kind === 'check-command')
    input.ci.jobs.lanes.steps.find((step: {name?: string}) => step.name === 'Independent check 1').run = 'echo passed'
  if (kind === 'gate-command')
    input.ci.jobs.gate.steps.find(
      (step: {name?: string}) => step.name === 'All-results summary and fail-closed gate',
    ).run = 'echo passed'
  if (kind === 'ci-alias') input.package.scripts['ci:gate'] = 'echo passed'
  expect(validateContracts(input).length).toBeGreaterThan(0)
})
it.each(['missing-suite-path', 'unmapped-suite-file', 'uncovered-native-ac', 'uncovered-security-ac'])(
  'AC-25 rejects curated suite drift: %s',
  (kind) => {
    const original = contractInputs()
    const input = {...original, suites: structuredClone(original.suites), lanes: structuredClone(original.lanes)}
    if (kind === 'missing-suite-path') input.suites.security = ['does-not-exist.test.ts']
    if (kind === 'unmapped-suite-file') input.suites.security = [...input.suites.security, 'e2e/commands/help.test.ts']
    if (kind === 'uncovered-native-ac') input.lanes.find((lane) => lane.id === 'native-windows')!.ac_ids.push('AC-32')
    if (kind === 'uncovered-security-ac') input.lanes.find((lane) => lane.id === 'security')!.ac_ids.push('AC-32')
    expect(validateContracts(input).length).toBeGreaterThan(0)
  },
)
