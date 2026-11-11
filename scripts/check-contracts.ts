import {existsSync, readFileSync} from 'node:fs'
import {resolve} from 'node:path'

import {parse} from 'yaml'

import {testSuites} from './registry/suites'
import {SAFETY_LAYERS, safetyLedger} from './safety-ledger'
import {repositoryRoot} from './validation-context'
import {
  acceptanceIds,
  businessRuleIds,
  CI_EVIDENCE_RESERVE_MS,
  LANE_BUDGET_MS,
  validationLanes,
} from './validation-lanes'

export function contractInputs() {
  const read = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8')
  return {
    pin: read('.bun-version').trim(),
    lock: read('bun.lock'),
    package: JSON.parse(read('package.json')),
    ci: parse(read('.github/workflows/ci.yml')),
    release: parse(read('.github/workflows/release.yml')),
    ledger: safetyLedger,
    lanes: validationLanes,
    suites: testSuites as Record<string, readonly string[]>,
    testText: read,
    docs: ['docs/safety-contract.md'].map((path) => ({
      path,
      text: read(path),
    })),
    exists: (path: string) => existsSync(resolve(repositoryRoot, path)),
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
    require(Object.values(SAFETY_LAYERS).includes(rule.layer) &&
      rule.example.trim() &&
      rule.counterexample.trim(), `${rule.id}: missing layer/example/counterexample`)
    require(rule.tests.length && rule.tests.every(input.exists), `${rule.id}: test mapping does not exist`)
    require(rule.ac_ids.length &&
      rule.ac_ids.every((id) => acceptanceIds.includes(id)), `${rule.id}: invalid AC mapping`)
    rule.ac_ids.forEach((id) => covered.add(id))
  }
  require(acceptanceIds.every((id) => covered.has(id)), 'Ledger does not cover every acceptance ID')
  // Frozen policy is independent of the mutable execution registry being checked.
  const requiredChecks: Record<string, readonly string[]> = {
    quality: ['format:check', 'lint', 'typecheck'],
    business: ['test:unit', 'test:properties', 'check:contracts', 'test:checkers'],
    e2e: ['test:e2e'],
    'human-dx': ['test:human'],
    'agent-cli': ['test:agent'],
    security: ['test:security', 'check:security-audit'],
    performance: ['test:performance'],
    'native-macos': ['build', 'test:platform', 'test:compiled'],
    'native-windows': ['build', 'test:platform', 'test:compiled'],
    build: ['build', 'test:compiled'],
  }
  const required = Object.keys(requiredChecks)
  require(input.lanes.length === required.length &&
    new Set(input.lanes.map((lane) => lane.id)).size === required.length &&
    required.every((id) => input.lanes.some((lane) => lane.id === id)), 'Required module set changed')
  for (const [name, paths] of Object.entries(input.suites))
    require(paths.length && paths.every(input.exists), `${name}: suite path missing`)
  // Labels prevent registry drift, not a substitute for reviewing the assertions.
  for (const lane of input.lanes.filter((lane) => lane.id === 'security' || lane.id.startsWith('native-'))) {
    const suite = lane.id === 'security' ? 'security' : 'platform'
    const labels = new Set<string>()
    for (const path of input.suites[suite] ?? []) {
      if (!input.exists(path)) continue
      const ids = [...input.testText(path).matchAll(/\bAC-(\d+(?:[–-]\d+)?(?:,\d+(?:[–-]\d+)?)*)/g)].flatMap((match) =>
        match[1].split(',').flatMap((part) => {
          const [start, end = start] = part.split(/[–-]/).map(Number)
          return Array.from({length: Math.max(0, end - start + 1)}, (_, i) => `AC-${start + i}`)
        }),
      )
      ids.forEach((id) => labels.add(id))
      require(ids.some((id) => lane.ac_ids.includes(id)), `${lane.id}: ${path} asserts no declared lane acceptance ID`)
    }
    require(lane.ac_ids.every((id) => labels.has(id)), `${lane.id}: declared lane acceptance IDs lack test labels`)
  }
  for (const lane of input.lanes) {
    const expected = requiredChecks[lane.id] ?? []
    require(lane.checks.length === expected.length &&
      lane.checks.every((check, index) => {
        const id = expected[index]
        const blocked = (id?.startsWith('test:') && id !== 'test:compiled') || id === 'check:security-audit'
        return (
          check.id === id &&
          JSON.stringify(check.command) === JSON.stringify(['bun', 'run', id]) &&
          JSON.stringify(check.blocked_exits ?? []) === JSON.stringify(blocked ? [2] : [])
        )
      }), `${lane.id}: required ordered check contract changed`)
    require(lane.fixture_scope.trim(), `${lane.id}: invalid scope`)
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
      'macos-15-intel', 'Native jobs must use the selected native hosted runners (no cross-compilation)')
  require(ci.jobs?.lanes?.['timeout-minutes'] <= 10 &&
    ci.jobs?.gate?.['timeout-minutes'] <= 5, 'Feedback execution budgets missing')
  const startBudget = ci.jobs?.lanes?.steps?.[0]
  require(LANE_BUDGET_MS > 0 &&
    LANE_BUDGET_MS <= 600000 &&
    ci.jobs?.lanes?.['timeout-minutes'] * 60000 === LANE_BUDGET_MS &&
    CI_EVIDENCE_RESERVE_MS >= 60000 &&
    startBudget?.name === 'Start lane budget' &&
    startBudget.shell === 'bash' &&
    startBudget.run ===
      'echo "FORGE_LANE_STARTED_AT=$(date +%s)" >> "$GITHUB_ENV"', 'CI deadline must start before setup and reserve evidence/cleanup headroom')
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
    const setups = steps.filter((step) => String(step.uses).startsWith('oven-sh/setup-bun@'))
    require(setups.length === 1 &&
      setups.every(
        (step) => (step.with as Record<string, unknown>)?.['bun-version-file'] === '.bun-version',
      ), 'CI Bun pin differs')
  }
  const checks =
    ci.jobs?.lanes?.steps?.filter((step: {name?: string}) => step.name?.startsWith('Independent check')) ?? []
  require(checks.length === 4 &&
    checks.every((step: {if?: string}) =>
      step.if?.startsWith('always()'),
    ), 'Independent checks must continue after early failures')
  checks.forEach((step: {run?: string}, index: number) =>
    require(step.run ===
      `bun run check:lanes -- --lane "\${{ matrix.lane }}" --check-index ${index}`, 'CI check commands must use the registered package entrypoint'),
  )
  require(ci.jobs.lanes.steps.find((step: {name?: string}) => step.name === 'Assemble lane evidence')?.run ===
    'bun run check:lanes -- --lane "${{ matrix.lane }}" --assemble', 'CI lane assembly entrypoint differs')
  const setupFailure = ci.jobs.lanes.steps.find(
    (step: {name?: string}) => step.name === 'Preserve installation-failure evidence',
  )
  require(setupFailure?.if === "always() && steps.install.outcome != 'success'" &&
    setupFailure?.run ===
      'bun scripts/setup-failure-evidence.ts --lane "${{ matrix.lane }}"', 'Dependency-free installation-failure evidence missing')
  require(ci.jobs.gate.steps.find((step: {name?: string}) => step.name === 'All-results summary and fail-closed gate')
    ?.run === 'bun run ci:gate', 'CI gate entrypoint differs')
  const gateSetupFailure = ci.jobs.gate.steps.find(
    (step: {name?: string}) => step.name === 'Preserve gate installation-failure evidence',
  )
  require(gateSetupFailure?.if === "always() && steps.install.outcome != 'success'" &&
    gateSetupFailure?.run === 'bun scripts/gate-setup-failure.ts' &&
    ci.jobs.gate.steps.find((step: {name?: string}) => step.name === 'All-results summary and fail-closed gate')?.if ===
      "always() && steps.install.outcome == 'success'" &&
    ci.jobs.gate.steps.some(
      (step: {id?: string; run?: string}) => step.id === 'install' && step.run === 'bun install --frozen-lockfile',
    ), 'Dependency-free gate installation-failure evidence missing')
  require(input.package.scripts['check:lanes'] === 'bun run scripts/check-lanes.ts' &&
    input.package.scripts['ci:gate'] === 'bun run scripts/gate.ts', 'CI package entrypoints differ')
  // The requirement cannot be conditional on the very setup step an edit can remove.
  for (const id of ['quality', 'test', 'build', 'publish-npm']) {
    const job = input.release.jobs?.[id] as {steps?: Record<string, unknown>[]} | undefined
    require(job, `Required release job missing: ${id}`)
    const steps = job?.steps ?? []
    const setups = steps.filter((step) => String(step.uses).startsWith('oven-sh/setup-bun@'))
    require(steps.some((step) => step.run === 'bun install --frozen-lockfile'), 'Release frozen install missing')
    require(setups.length === 1 &&
      setups.every(
        (step) => (step.with as Record<string, unknown>)?.['bun-version-file'] === '.bun-version',
      ), 'Release Bun pin differs')
  }
  const releaseJobs = (input.release.jobs ?? {}) as Record<
    string,
    {needs?: string | string[]; steps?: Record<string, unknown>[]}
  >
  const releaseNeeds = (id: string) => [releaseJobs[id]?.needs ?? []].flat()
  require(releaseJobs['ci-gate']?.steps?.some((step) =>
    String(step.run).includes('"Deterministic gate"'),
  ), 'Release CI gate missing')
  require(releaseJobs.build?.steps?.some((step) =>
    String(step.run).includes('dist/forge-linux-x64 --version'),
  ), 'Release binary smoke test missing')
  require(['ci-gate', 'build'].every((id) =>
    releaseNeeds('publish-npm').includes(id),
  ), 'npm must publish after the CI gate and the binary smoke test')
  require(releaseNeeds('github-release').includes('publish-npm'), 'GitHub release must wait for npm')
  require(['homebrew', 'scoop'].every((id) =>
    releaseNeeds(id).includes('github-release'),
  ), 'Homebrew and Scoop must wait for the GitHub release')
  require(input.release.on?.workflow_dispatch?.inputs?.dry_run?.type === 'boolean', 'Release dry_run input missing')
  for (const job of Object.values(releaseJobs))
    for (const step of job.steps ?? [])
      if (
        ['softprops/action-gh-release@', 'actions/create-github-app-token@'].some((action) =>
          String(step.uses).startsWith(action),
        ) ||
        String(step.run).includes('git push')
      )
        require(step.if === '${{ !inputs.dry_run }}', 'Release publish step must be skipped in a dry run')
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
