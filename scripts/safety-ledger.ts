export interface SafetyRule {
  id: string
  layer: 'domain' | 'application' | 'infrastructure' | 'harness'
  example: string
  counterexample: string
  ac_ids: string[]
  tests: string[]
}
export const safetyLedger: SafetyRule[] = [
  {
    id: 'BR-01',
    layer: 'application',
    example: 'Collect all acquisition outcomes before planning',
    counterexample: 'A failed source becomes successful empty input',
    ac_ids: ['AC-2', 'AC-3'],
    tests: ['src/application/commands/sync/safety.test.ts', 'e2e/commands/sync/safety.test.ts'],
  },
  {
    id: 'BR-02',
    layer: 'domain',
    example: 'Retain disabled, unknown and ambiguous owners in both scopes',
    counterexample: 'A project-only prefix guesses a global owner',
    ac_ids: ['AC-4', 'AC-26'],
    tests: ['src/application/commands/sync/safety.test.ts', 'e2e/contracts/platform.test.ts'],
  },
  {
    id: 'BR-03',
    layer: 'application',
    example: 'Clean only eligible tracked stale targets',
    counterexample: 'Delete an untracked sibling or generated backup',
    ac_ids: ['AC-3', 'AC-5', 'AC-9'],
    tests: ['src/application/commands/sync/safety.test.ts', 'e2e/commands/sync/safety.test.ts'],
  },
  {
    id: 'BR-04',
    layer: 'domain',
    example: 'Only installation or equal bytes establish an installed baseline',
    counterexample: 'Promote legacy desired hashes or skipped targets to installed',
    ac_ids: ['AC-6', 'AC-7', 'AC-20'],
    tests: [
      'src/domain/sync/state-upgrade.test.ts',
      'src/domain/sync/safety.property.test.ts',
      'src/application/commands/sync/outcome.test.ts',
    ],
  },
  {
    id: 'BR-05',
    layer: 'application',
    example: 'Preview validates but does not persist protected bytes or reports',
    counterexample: 'Preview updates lastSync or latest report',
    ac_ids: ['AC-8', 'AC-21'],
    tests: ['e2e/commands/sync/safety.test.ts', 'e2e/contracts/existing-cli.test.ts'],
  },
  {
    id: 'BR-06',
    layer: 'infrastructure',
    example: 'Compensate every touched operation including metadata and partial writes',
    counterexample: 'Infer recovery data from a source filename ending in .bak',
    ac_ids: ['AC-10', 'AC-11'],
    tests: ['src/infrastructure/fs/transaction.test.ts', 'src/application/commands/sync/transaction.test.ts'],
  },
  {
    id: 'BR-07',
    layer: 'infrastructure',
    example: 'Canonicalize the chosen root and reject links below it',
    counterexample: 'Follow a metadata/backup symlink or a sibling-prefix path',
    ac_ids: ['AC-9', 'AC-12', 'AC-13'],
    tests: ['src/infrastructure/fs/confinement.test.ts', 'e2e/commands/sync/safety.test.ts'],
  },
  {
    id: 'BR-08',
    layer: 'application',
    example: 'Repeat preserves bytes; silent changes presentation only',
    counterexample: 'Report storage failure reverses an already committed result',
    ac_ids: ['AC-14', 'AC-15', 'AC-23'],
    tests: ['src/application/commands/sync/outcome.test.ts', 'e2e/contracts/existing-cli.test.ts'],
  },
  {
    id: 'BR-09',
    layer: 'harness',
    example: 'Own the total deadline, pipes, terminal and descendants',
    counterexample: 'An exited leader leaves a descendant alive or old text satisfies a new wait',
    ac_ids: ['AC-16', 'AC-17', 'AC-18', 'AC-21', 'AC-22', 'AC-29', 'AC-31'],
    tests: [
      'e2e/framework/contracts/pipe.test.ts',
      'e2e/framework/contracts/pty.test.ts',
      'e2e/framework/contracts/lifecycle.test.ts',
      'e2e/contracts/performance.test.ts',
    ],
  },
  {
    id: 'BR-10',
    layer: 'harness',
    example: 'Disposable homes, frozen tools, independent evidence and offline fixtures',
    counterexample: 'Inherit credentials, query the real scheduler or trust a self-declared ready verdict',
    ac_ids: ['AC-1', 'AC-19', 'AC-24', 'AC-25', 'AC-27', 'AC-28', 'AC-29', 'AC-30', 'AC-32'],
    tests: [
      'e2e/framework/contracts/isolation.test.ts',
      'scripts/run-tests.test.ts',
      'scripts/check-lanes.test.ts',
      'scripts/security-audit.test.ts',
    ],
  },
]
