import {expect, it} from 'bun:test'

import {contractInputs, validateContracts} from './check-contracts'
import {validationLanes} from './validation-lanes'

it.each(validationLanes.flatMap((lane) => lane.checks.map((check) => [lane.id, check.id])))(
  'AC-25 mandatory %s/%s cannot disappear from the execution registry',
  (id, checkId) => {
    const original = contractInputs()
    const input = {...original, lanes: structuredClone(original.lanes)}
    const lane = input.lanes.find((lane) => lane.id === id)!
    lane.checks = lane.checks.filter((check) => check.id !== checkId)
    expect(validateContracts(input)).toContain(`${id}: required ordered check contract changed`)
  },
)
it.each(['id', 'command', 'duplicate', 'reorder'])('AC-25 complete command contracts reject %s drift', (kind) => {
  const original = contractInputs()
  const input = {...original, lanes: structuredClone(original.lanes)}
  const lane = input.lanes.find((lane) => lane.id === 'quality')!
  if (kind === 'id') lane.checks[0].id = 'lint'
  if (kind === 'command') lane.checks[0].command = ['bun', 'run', 'lint']
  if (kind === 'duplicate') lane.checks.push(structuredClone(lane.checks[0]))
  if (kind === 'reorder') lane.checks.reverse()
  expect(validateContracts(input)).toContain(`${lane.id}: required ordered check contract changed`)
})
it('AC-28 documentation inputs contain only the document actually validated', () => {
  expect(contractInputs().docs.map((doc) => doc.path)).toEqual(['docs/safety-contract.md'])
})

it('AC-1,24,25,27,28 validates the real ledger, pin, workflows and boundaries', () => {
  expect(validateContracts(contractInputs())).toEqual([])
})
type WorkflowStep = {if?: string; run?: string; env?: Record<string, string>; 'continue-on-error'?: boolean}
const workflowDrift: Record<string, [string, (ci: ReturnType<typeof contractInputs>['ci']) => void]> = {
  'matrix-unregistered-lane': [
    'Workflow matrix differs from registry',
    (ci) => ci.jobs.lanes.strategy.matrix.include.push({lane: 'unregistered', os: 'ubuntu-latest', checks: ['lint']}),
  ],
  'matrix-missing-lane': ['Workflow matrix differs from registry', (ci) => ci.jobs.lanes.strategy.matrix.include.pop()],
  'matrix-check-dropped': [
    'Workflow matrix checks differ from registry',
    (ci) => ci.jobs.lanes.strategy.matrix.include.find((row: {lane: string}) => row.lane === 'business').checks.pop(),
  ],
  'fail-fast': [
    'Modules must be independent with fail-fast disabled',
    (ci) => {
      ci.jobs.lanes.strategy['fail-fast'] = true
    },
  ],
  'path-filter': [
    'Every PR must run every module without path skips',
    (ci) => {
      ci.on.pull_request.paths = ['src/**']
    },
  ],
  'check-step-removed': [
    'Every registered check must run as its own step, even after an earlier failure',
    (ci) => {
      ci.jobs.lanes.steps = ci.jobs.lanes.steps.filter((step: WorkflowStep) => !step.run?.includes('matrix.checks[3]'))
    },
  ],
  'check-step-short-circuits': [
    'Every registered check must run as its own step, even after an earlier failure',
    (ci) => {
      const step = ci.jobs.lanes.steps.find((step: WorkflowStep) => step.run?.includes('matrix.checks[1]'))
      step.if = 'matrix.checks[1]'
    },
  ],
  'gate-not-always': [
    'Always-run gate must require every lane to succeed',
    (ci) => {
      delete ci.jobs.gate.if
    },
  ],
  'gate-without-needs': [
    'Always-run gate must require every lane to succeed',
    (ci) => {
      delete ci.jobs.gate.needs
    },
  ],
  'gate-ignores-lane-result': [
    'Always-run gate must require every lane to succeed',
    (ci) => {
      ci.jobs.gate.steps = [{run: 'echo passed'}]
    },
  ],
  'gate-step-conditional': [
    'Always-run gate must require every lane to succeed',
    (ci) => {
      ci.jobs.gate.steps[0].if = "needs.lanes.result == 'success'"
    },
  ],
  'gate-result-not-compared': [
    'Always-run gate must require every lane to succeed',
    (ci) => {
      ci.jobs.gate.steps = [{env: {LANES: '${{ needs.lanes.result }}'}, run: 'echo "$LANES"'} satisfies WorkflowStep]
    },
  ],
  'gate-result-neutralized': [
    'Always-run gate must require every lane to succeed',
    (ci) => {
      ci.jobs.gate.steps[0].run = ci.jobs.gate.steps[0].run.replace(
        'test "$LANES" = success',
        'test "$LANES" = success || true',
      )
    },
  ],
  'lane-step-continue-on-error': [
    'Lane and gate failures must not be tolerated',
    (ci) => {
      ci.jobs.lanes.steps.find((step: WorkflowStep) => step.run?.includes('matrix.checks[0]'))['continue-on-error'] =
        true
    },
  ],
  'lane-job-continue-on-error': [
    'Lane and gate failures must not be tolerated',
    (ci) => {
      ci.jobs.lanes['continue-on-error'] = true
    },
  ],
  'gate-step-continue-on-error': [
    'Lane and gate failures must not be tolerated',
    (ci) => {
      ci.jobs.gate.steps[0]['continue-on-error'] = true
    },
  ],
  'write-permission': [
    'CI token must stay read-only',
    (ci) => {
      ci.permissions.actions = 'write'
    },
  ],
  'gate-renamed': [
    'Always-run gate must require every lane to succeed',
    (ci) => {
      ci.jobs.gate.name = 'gate'
    },
  ],
}
it.each(Object.keys(workflowDrift))('AC-25,27,32 rejects workflow drift: %s', (kind) => {
  const original = contractInputs()
  const input = {...original, ci: structuredClone(original.ci)}
  const [message, mutate] = workflowDrift[kind]
  mutate(input.ci)
  expect(validateContracts(input)).toContain(message)
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
it.each(['pin', 'minimum', 'lock', 'rule', 'layer', 'path', 'lane', 'timeout', 'release'])(
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
    if (kind === 'layer') Object.assign(input.ledger[0], {layer: 'invalid-layer'})
    if (kind === 'path') input.ledger[0].tests = ['missing.test.ts']
    if (kind === 'lane') input.lanes = input.lanes.slice(0, -1)
    if (kind === 'timeout') input.ci.jobs.gate['timeout-minutes'] = 99
    if (kind === 'release')
      input.release.jobs.quality.steps.find(
        (step: {run?: string}) => step.run === 'bun install --frozen-lockfile',
      ).run = 'bun install'
    expect(validateContracts(input).length).toBeGreaterThan(0)
  },
)
it.each(['release-setup-removed', 'ci-setup-removed', 'release-job-removed', 'check-command'])(
  'AC-24,25 fails closed for %s even when the guarded step is removed',
  (kind) => {
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
      input.ci.jobs.lanes.steps.find((step: {run?: string}) => step.run?.includes('matrix.checks[0]')).run =
        'echo passed'
    expect(validateContracts(input).length).toBeGreaterThan(0)
  },
)
type ReleaseStep = {uses?: string; run?: string; if?: string}
type ReleaseWorkflow = {
  on: {workflow_dispatch: {inputs: Record<string, unknown>}}
  jobs: Record<string, {needs?: string | string[]; steps: ReleaseStep[]}>
}
const findStep = (release: ReleaseWorkflow, job: string, match: (step: ReleaseStep) => boolean) =>
  release.jobs[job].steps.find(match)!
const releaseDrift: Record<string, [string, (release: ReleaseWorkflow) => void]> = {
  'npm-before-build': [
    'npm must publish after the CI gate and the binary smoke test',
    (release) => {
      release.jobs['publish-npm'].needs = ['ci-gate', 'quality', 'test']
    },
  ],
  'npm-without-ci-gate': [
    'npm must publish after the CI gate and the binary smoke test',
    (release) => {
      release.jobs['publish-npm'].needs = ['quality', 'test', 'build']
    },
  ],
  'github-release-before-npm': [
    'GitHub release must wait for npm',
    (release) => {
      release.jobs['github-release'].needs = 'build'
    },
  ],
  'homebrew-before-github-release': [
    'Homebrew and Scoop must wait for the GitHub release',
    (release) => {
      release.jobs.homebrew.needs = 'build'
    },
  ],
  'scoop-before-github-release': [
    'Homebrew and Scoop must wait for the GitHub release',
    (release) => {
      release.jobs.scoop.needs = 'build'
    },
  ],
  'ci-gate-removed': [
    'Release CI gate missing',
    (release) => {
      delete release.jobs['ci-gate']
    },
  ],
  'smoke-test-removed': [
    'Release binary smoke test missing',
    (release) => {
      release.jobs.build.steps = release.jobs.build.steps.filter((step) => !step.run?.includes('--version'))
    },
  ],
  'dry-run-input-removed': [
    'Release dry_run input missing',
    (release) => {
      delete release.on.workflow_dispatch.inputs.dry_run
    },
  ],
  'github-release-unguarded': [
    'Release publish step must be skipped in a dry run',
    (release) => {
      delete findStep(release, 'github-release', (step) => !!step.uses?.startsWith('softprops/action-gh-release@')).if
    },
  ],
  'tap-token-unguarded': [
    'Release publish step must be skipped in a dry run',
    (release) => {
      delete findStep(release, 'homebrew', (step) => !!step.uses?.startsWith('actions/create-github-app-token@')).if
    },
  ],
  'bucket-push-unguarded': [
    'Release publish step must be skipped in a dry run',
    (release) => {
      delete findStep(release, 'scoop', (step) => !!step.run?.includes('git push')).if
    },
  ],
  'npm-publish-unguarded': [
    'Release publish step must be skipped in a dry run',
    (release) => {
      delete findStep(
        release,
        'publish-npm',
        (step) => !!step.run?.includes('npm publish --access public --provenance'),
      ).if
    },
  ],
  'npm-publish-guard-bypassed': [
    'Release publish step must be skipped in a dry run',
    (release) => {
      findStep(release, 'publish-npm', (step) => !!step.run?.includes('npm publish --access public --provenance')).if =
        '${{ !inputs.dry_run || true }}'
    },
  ],
  'npm-publish-guard-prefixed-bypass': [
    'Release publish step must be skipped in a dry run',
    (release) => {
      findStep(release, 'publish-npm', (step) => !!step.run?.includes('npm publish --access public --provenance')).if =
        "${{ !inputs.dry_run && steps.npm-version.outputs.published != 'true' || true }}"
    },
  ],
}
it.each(Object.keys(releaseDrift))('release ordering and dry-run guards: rejects %s', (kind) => {
  const original = contractInputs()
  const input = {...original, release: structuredClone(original.release)}
  const [message, mutate] = releaseDrift[kind]
  mutate(input.release)
  expect(validateContracts(input)).toContain(message)
})
it.each(['missing-suite-path', 'unmapped-suite-file', 'uncovered-native-ac', 'uncovered-security-ac'])(
  'AC-25 rejects curated suite drift: %s',
  (kind) => {
    const original = contractInputs()
    const input = {...original, suites: structuredClone(original.suites), lanes: structuredClone(original.lanes)}
    if (kind === 'missing-suite-path') input.suites.security = ['does-not-exist.test.ts']
    if (kind === 'unmapped-suite-file') input.suites.security = [...input.suites.security, 'e2e/commands/help.test.ts']
    if (kind === 'uncovered-native-ac') input.lanes.find((lane) => lane.id === 'native-windows')!.ac_ids.push('AC-28')
    if (kind === 'uncovered-security-ac') input.lanes.find((lane) => lane.id === 'security')!.ac_ids.push('AC-28')
    expect(validateContracts(input).length).toBeGreaterThan(0)
  },
)
