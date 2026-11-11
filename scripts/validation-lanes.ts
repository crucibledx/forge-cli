export interface ValidationCheck {
  id: string
  command: string[]
}
export interface ValidationLane {
  id: string
  fixture_scope: string
  ac_ids: string[]
  br_ids: string[]
  checks: ValidationCheck[]
}
const run = (id: string): ValidationCheck => ({id, command: ['bun', 'run', id]})
export const LANE_BUDGET_MS = 10 * 60 * 1000
export const validationLanes: readonly ValidationLane[] = [
  {
    id: 'quality',
    fixture_scope: 'repository, no runtime fixtures',
    ac_ids: ['AC-24'],
    br_ids: ['BR-10'],
    checks: ['format:check', 'lint', 'typecheck'].map((id) => run(id)),
  },
  {
    id: 'business',
    fixture_scope: 'disposable process/per-test roots',
    ac_ids: [
      'AC-1',
      'AC-2',
      'AC-4',
      'AC-6',
      'AC-9',
      'AC-10',
      'AC-11',
      'AC-12',
      'AC-20',
      'AC-24',
      'AC-25',
      'AC-27',
      'AC-28',
      'AC-32',
    ],
    br_ids: ['BR-01', 'BR-02', 'BR-03', 'BR-04', 'BR-06', 'BR-07', 'BR-10'],
    checks: [run('test:unit'), run('test:properties'), run('check:contracts'), run('test:checkers')],
  },
  {
    id: 'e2e',
    fixture_scope: 'isolated CLI, local sources/fake schedulers only',
    ac_ids: [
      'AC-2',
      'AC-3',
      'AC-4',
      'AC-5',
      'AC-7',
      'AC-8',
      'AC-13',
      'AC-14',
      'AC-15',
      'AC-16',
      'AC-17',
      'AC-18',
      'AC-19',
      'AC-23',
    ],
    br_ids: ['BR-01', 'BR-02', 'BR-03', 'BR-04', 'BR-05', 'BR-06', 'BR-07', 'BR-08', 'BR-09', 'BR-10'],
    checks: [run('test:e2e')],
  },
  {
    id: 'human-dx',
    fixture_scope: 'real POSIX PTYs, disposable persisted configuration',
    ac_ids: ['AC-22', 'AC-29'],
    br_ids: ['BR-09', 'BR-10'],
    checks: [run('test:human')],
  },
  {
    id: 'agent-cli',
    fixture_scope: 'closed stdin, separate pipes, local configuration',
    ac_ids: ['AC-21', 'AC-23', 'AC-29'],
    br_ids: ['BR-05', 'BR-08', 'BR-09', 'BR-10'],
    checks: [run('test:agent')],
  },
  {
    id: 'security',
    fixture_scope: 'offline attack sentinels; public advisory metadata is the only network exception',
    ac_ids: ['AC-9', 'AC-10', 'AC-11', 'AC-12', 'AC-13', 'AC-15', 'AC-23', 'AC-25', 'AC-30'],
    br_ids: ['BR-02', 'BR-06', 'BR-07', 'BR-08', 'BR-10'],
    checks: [run('test:security'), run('check:security-audit')],
  },
  {
    id: 'performance',
    fixture_scope: 'fixed offline 10/1000-target fixtures; advisory latency',
    ac_ids: ['AC-31'],
    br_ids: ['BR-08', 'BR-09', 'BR-10'],
    checks: [run('test:performance')],
  },
  {
    id: 'native-macos',
    fixture_scope: 'native macOS project/global roots and compiled executable',
    ac_ids: ['AC-2', 'AC-4', 'AC-6', 'AC-7', 'AC-9', 'AC-10', 'AC-12', 'AC-13', 'AC-19', 'AC-26'],
    br_ids: ['BR-02', 'BR-06', 'BR-07', 'BR-09', 'BR-10'],
    checks: [run('build'), run('test:platform'), run('test:compiled')],
  },
  {
    id: 'native-windows',
    fixture_scope: 'native Windows project/global roots, access controls, Job Objects and compiled executable',
    ac_ids: ['AC-2', 'AC-4', 'AC-6', 'AC-7', 'AC-9', 'AC-10', 'AC-12', 'AC-13', 'AC-19', 'AC-26'],
    br_ids: ['BR-02', 'BR-06', 'BR-07', 'BR-09', 'BR-10'],
    checks: [run('build'), run('test:platform'), run('test:compiled')],
  },
  {
    id: 'build',
    fixture_scope: 'independent native Linux build and compiled help/version',
    ac_ids: ['AC-26'],
    br_ids: ['BR-09', 'BR-10'],
    checks: [run('build'), run('test:compiled')],
  },
]
export const acceptanceIds = [
  'AC-1',
  'AC-2',
  'AC-3',
  'AC-4',
  'AC-5',
  'AC-6',
  'AC-7',
  'AC-8',
  'AC-9',
  'AC-10',
  'AC-11',
  'AC-12',
  'AC-13',
  'AC-14',
  'AC-15',
  'AC-16',
  'AC-17',
  'AC-18',
  'AC-19',
  'AC-20',
  'AC-21',
  'AC-22',
  'AC-23',
  'AC-24',
  'AC-25',
  'AC-26',
  'AC-27',
  'AC-28',
  'AC-29',
  'AC-30',
  'AC-31',
  'AC-32',
]
export const businessRuleIds = Array.from({length: 10}, (_, i) => `BR-${String(i + 1).padStart(2, '0')}`)
