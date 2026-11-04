import {expect, it} from 'bun:test'

import {contractInputs, validateContracts} from './check-contracts'

it('AC-1,24,25,27,28 validates the real ledger, pin, workflows and boundaries', () => {
  expect(validateContracts(contractInputs())).toEqual([])
})
it.each(['pin', 'minimum', 'lock', 'rule', 'path', 'lane', 'workflow', 'fail-fast', 'retention', 'timeout', 'release'])(
  'rejects malformed %s contracts',
  (kind) => {
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
      input.release.jobs.quality.steps.find(
        (step: {run?: string}) => step.run === 'bun install --frozen-lockfile',
      ).run = 'bun install'
    expect(validateContracts(input).length).toBeGreaterThan(0)
  },
)
