import {existsSync, readFileSync} from 'node:fs'
import {resolve} from 'node:path'

import {parse} from 'yaml'

import {safetyLedger} from './safety-ledger'
import {repositoryRoot} from './validation-context'
import {acceptanceIds, businessRuleIds, validationLanes} from './validation-lanes'

export function contractInputs(root = repositoryRoot) {
  const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
  return {
    pin: read('.bun-version').trim(),
    lock: read('bun.lock'),
    package: JSON.parse(read('package.json')),
    ci: parse(read('.github/workflows/ci.yml')),
    release: parse(read('.github/workflows/release.yml')),
    ledger: safetyLedger,
    lanes: validationLanes,
    docs: ['README.md', 'CONTRIBUTING.md', '.factory/loop-contract.md', 'docs/safety-contract.md'].map((path) => ({
      path,
      text: read(path),
    })),
    exists: (path: string) => existsSync(resolve(root, path)),
  }
}
export function validateContracts(input: ReturnType<typeof contractInputs>): string[] {
  const errors: string[] = []
  const require = (condition: unknown, message: string) => {
    if (!condition) errors.push(message)
  }
  require(/^\d+\.\d+\.\d+$/.test(input.pin), 'Bun pin must be an exact stable patch')
  require(input.package.engines?.bun === `>=${input.pin}`, 'Runtime minimum differs from tested Bun pin')
  require(input.lock.includes('"lockfileVersion"') &&
    input.lock.includes('"fast-check"'), 'Committed frozen lock/property dependency missing')
  require(input.package.devDependencies?.['fast-check'] === '4.4.0', 'Property generator must remain pinned')
  require(input.ledger.length === 10 &&
    new Set(input.ledger.map((rule) => rule.id)).size === 10 &&
    businessRuleIds.every((id) =>
      input.ledger.some((rule) => rule.id === id),
    ), 'Ledger must cover BR-01..10 exactly once')
  const covered = new Set<string>()
  for (const rule of input.ledger) {
    require(['domain', 'application', 'infrastructure', 'harness'].includes(rule.layer) &&
      rule.example.trim() &&
      rule.counterexample.trim(), `${rule.id}: missing layer/example/counterexample`)
    require(rule.tests.length && rule.tests.every(input.exists), `${rule.id}: test mapping does not exist`)
    require(rule.ac_ids.length &&
      rule.ac_ids.every((id) => acceptanceIds.includes(id)), `${rule.id}: invalid AC mapping`)
    rule.ac_ids.forEach((id) => covered.add(id))
  }
  require(acceptanceIds.every((id) => covered.has(id)), 'Ledger does not cover every acceptance ID')
  const required = [
    'quality',
    'business',
    'e2e',
    'human-dx',
    'agent-cli',
    'security',
    'performance',
    'native-macos',
    'native-windows',
    'build',
  ]
  require(input.lanes.length === required.length &&
    new Set(input.lanes.map((lane) => lane.id)).size === required.length &&
    required.every((id) => input.lanes.some((lane) => lane.id === id && lane.required)), 'Required module set changed')
  for (const lane of input.lanes) {
    require(lane.timeout_ms > 0 &&
      lane.timeout_ms <= 600000 &&
      lane.fixture_scope.trim(), `${lane.id}: invalid timeout/scope`)
    require(lane.checks.length &&
      lane.checks.every(
        (check) =>
          check.command.length === 3 &&
          check.command[0] === 'bun' &&
          check.command[1] === 'run' &&
          input.package.scripts[check.command[2]],
      ), `${lane.id}: missing command entrypoint`)
    require(lane.ac_ids.every((id) => acceptanceIds.includes(id)) &&
      lane.br_ids.every((id) => businessRuleIds.includes(id)), `${lane.id}: unknown AC/BR`)
  }
  const ci = input.ci
  require(ci.on?.pull_request &&
    !ci.on.pull_request.paths &&
    !ci.on.pull_request['paths-ignore'], 'Every PR must run every module without path skips')
  require(ci.jobs?.lanes?.strategy?.['fail-fast'] === false &&
    !ci.jobs.lanes.needs, 'Modules must be independent with fail-fast disabled')
  const matrix = ci.jobs?.lanes?.strategy?.matrix?.include ?? []
  require(matrix.length === required.length &&
    required.every(
      (id) => matrix.filter((row: {lane: string}) => row.lane === id).length === 1,
    ), 'Workflow matrix differs from registry')
  require(matrix.find((row: {lane: string}) => row.lane === 'native-windows')?.os === 'windows-latest' &&
    matrix.find((row: {lane: string}) => row.lane === 'native-macos')?.os ===
      'macos-latest', 'Native jobs cannot use cross-compilation as execution evidence')
  require(ci.jobs?.lanes?.['timeout-minutes'] <= 10 &&
    ci.jobs?.gate?.['timeout-minutes'] <= 5, 'Feedback execution budgets missing')
  require(ci.jobs?.gate?.name === 'Deterministic gate' &&
    ci.jobs.gate.if === 'always()' &&
    ci.jobs.gate.needs?.includes('lanes'), 'Always-run aggregate gate missing')
  for (const job of Object.values(ci.jobs ?? {}) as {steps?: Record<string, unknown>[]}[]) {
    const steps = job.steps ?? []
    require(steps.some((step) =>
      String(step.run).includes('bun install --frozen-lockfile'),
    ), 'CI frozen install missing')
    require(steps
      .filter((step) => String(step.uses).startsWith('actions/checkout@'))
      .every(
        (step) => (step.with as Record<string, unknown>)?.ref === '${{ github.sha }}',
      ), 'CI must check out the exact tested SHA')
    const uploads = steps.filter((step) => String(step.uses).startsWith('actions/upload-artifact@'))
    require(uploads.length &&
      uploads.every(
        (step) => step.if === 'always()' && (step.with as Record<string, unknown>)?.['retention-days'] === 7,
      ), 'Always-upload seven-day evidence missing')
    require(steps
      .filter((step) => String(step.uses).startsWith('oven-sh/setup-bun@'))
      .every(
        (step) => (step.with as Record<string, unknown>)?.['bun-version-file'] === '.bun-version',
      ), 'CI Bun pin differs')
  }
  const checks =
    ci.jobs?.lanes?.steps?.filter((step: {name?: string}) => step.name?.startsWith('Independent check')) ?? []
  require(checks.length === 4 &&
    checks.every((step: {if?: string}) =>
      step.if?.startsWith('always()'),
    ), 'Independent checks must continue after early failures')
  for (const job of Object.values(input.release.jobs ?? {}) as {steps?: Record<string, unknown>[]}[]) {
    const steps = job.steps ?? []
    if (steps.some((step) => String(step.uses).startsWith('oven-sh/setup-bun@'))) {
      require(steps.some((step) => step.run === 'bun install --frozen-lockfile'), 'Release frozen install missing')
      require(steps
        .filter((step) => String(step.uses).startsWith('oven-sh/setup-bun@'))
        .every(
          (step) => (step.with as Record<string, unknown>)?.['bun-version-file'] === '.bun-version',
        ), 'Release Bun pin differs')
    }
  }
  const safety = input.docs.find((doc) => doc.path === 'docs/safety-contract.md')?.text ?? ''
  require(businessRuleIds.every((id) => safety.includes(id)), 'Documented safety ledger incomplete')
  require([
    'Serialize sync',
    'legacy-unknown',
    'Do not downgrade',
    'separate approved contracts',
    'MCP',
    'owner',
    'untrusted',
  ].every((term) => safety.includes(term)), 'Migration/future-interface/owner boundaries missing')
  return errors
}
if (import.meta.main) {
  try {
    const errors = validateContracts(contractInputs())
    for (const error of errors) console.error(error)
    process.exitCode = errors.length ? 1 : 0
  } catch {
    console.error('Contract inputs unavailable or malformed')
    process.exitCode = 1
  }
}
