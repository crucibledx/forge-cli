import {existsSync} from 'node:fs'
import {mkdir, writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'

import {z} from 'zod'

import {
  CLAUDE_VERSION,
  claudeCli,
  claudeMadeNoModelCall,
  diagnostic,
  DROID_VERSION,
  droidCli,
  parseEvents,
  run,
  succeeded,
} from './harness-cli'
import {repositoryRoot} from './repository-root'
import {createTestSandbox} from './test-sandbox'

/**
 * Real sync smoke: the compiled forge binary syncs a pinned forge-skills-starter release into a fresh
 * Claude Code project folder and a fresh Droid project folder, then each harness CLI reports what it
 * sees. Both CLIs are pinned npm packages run through bunx inside a disposable sandbox, so local and CI
 * runs use the same versions. No API keys and no model calls. The syncs share one git cache, so the smoke
 * covers both the first clone of the tag and re-syncing it from the warm cache.
 *
 * Claude Code lists discovered skills and slash commands in the `system/init` event of
 * `claude -p --output-format stream-json`. Without credentials the run stops at a synthetic
 * "Not logged in" reply with zero API time and cost, which proves no model call happened.
 *
 * Droid has no offline, non-interactive command that lists discovered skills, rules or settings
 * (the `/skills` manager and its "Import from Claude" tab are interactive), and forge has no Droid
 * sync target yet. The Droid leg therefore uses the closest documented non-model checks,
 * `droid doctor --json` and `droid exec --list-tools` in the synced folder, plus the synced files on disk.
 */

const STARTER_URL = 'https://github.com/crucibledx/forge-skills-starter.git'
// A release tag, not a branch: the expected items below are a contract with this exact starter content.
const STARTER_REF = 'v0.7.1'
// One canonical skill, one canonical workflow-as-command and one pre-structured passthrough skill,
// so both source layouts of the starter are covered.
const EXPECTED_SKILLS = ['detect-stack', 'review-pr', 'create-resource']
const EXPECTED_COMMANDS = ['document-project']
const EXPECTED_FILES = [
  '.claude/skills/detect-stack/SKILL.md',
  '.claude/skills/create-resource/SKILL.md',
  '.claude/rules/code-style.md',
  '.claude/commands/document-project.md',
]
// The CI lane has 10 minutes including checkout, install and build; leave room for those and cleanup.
const SMOKE_BUDGET_MS = 7 * 60 * 1000
const DIAGNOSTIC_CHARS = 800

const initEvent = z.object({
  type: z.literal('system'),
  subtype: z.literal('init'),
  skills: z.array(z.string()),
  slash_commands: z.array(z.string()),
})
const doctorReport = z.object({
  ok: z.literal(true),
  results: z.array(z.object({status: z.literal('pass')})).min(1),
})

interface HarnessSmokeCheck {
  command: string
  correct: boolean
  detail: string
}

const forgeConfigYaml = [
  'version: "1"',
  'assistants:',
  '  - id: claude-code',
  '    enabled: true',
  'sources:',
  '  - name: forge-skills-starter',
  '    type: git',
  `    url: "${STARTER_URL}"`,
  `    branch: "${STARTER_REF}"`,
  'telemetry:',
  '  enabled: false',
  '',
].join('\n')

async function harnessSmoke(): Promise<HarnessSmokeCheck[]> {
  const deadline = performance.now() + SMOKE_BUDGET_MS
  const checks: HarnessSmokeCheck[] = []
  const record = (command: string, correct: boolean, detail = '') => checks.push({command, correct, detail})
  const binary = resolve(repositoryRoot, process.platform === 'win32' ? 'dist/forge.exe' : 'dist/forge')
  if (!existsSync(binary)) {
    record('compiled forge binary exists (run `bun run build` first)', false, binary)
    return checks
  }
  const sandbox = createTestSandbox('forge-harness-smoke-')
  try {
    const env = sandbox.env
    const projects = {claude: join(sandbox.root, 'claude-project'), droid: join(sandbox.root, 'droid-project')}
    for (const dir of Object.values(projects)) {
      await mkdir(join(dir, '.crucible'), {recursive: true, mode: 0o700})
      await writeFile(join(dir, '.crucible', 'forge.config.yaml'), forgeConfigYaml, {mode: 0o600})
    }
    // The sandbox pins git to the file protocol; this smoke intentionally fetches the public starter.
    const forgeEnv = {...env, GIT_ALLOW_PROTOCOL: 'file:https'}
    const gitCache = join(env.TMPDIR, 'forge-cache')
    // All syncs share the sandbox's git cache: the first clones the tag, every later one re-syncs it from the
    // warm cache, the path that once failed for tag-pinned sources.
    const syncs: [label: string, dir: string, warm: boolean][] = [
      ['claude project, cold cache', projects.claude, false],
      ['droid project, warm cache', projects.droid, true],
      ['claude project again, warm cache', projects.claude, true],
    ]
    for (const [label, dir, warm] of syncs) {
      const cacheState =
        existsSync(gitCache) === warm ? '' : `expected git cache ${warm ? 'present' : 'absent'}: ${gitCache}`
      const sync = await run([binary, 'sync'], dir, forgeEnv, deadline, 90000)
      record(
        `forge sync (${label})`,
        succeeded(sync) && !cacheState,
        [cacheState, diagnostic(sync)].filter(Boolean).join('\n'),
      )
      for (const file of EXPECTED_FILES) record(`${label}: ${file} synced`, existsSync(join(dir, file)))
    }

    // Package caches stay inside the sandbox, so each run fetches exactly the pinned versions.
    const cliEnv = {...env, BUN_INSTALL_CACHE_DIR: join(sandbox.root, 'bun-cache')}
    const claude = claudeCli
    const droid = droidCli

    // Claude Code: the init event lists discovered skills and slash commands.
    const claudeVersion = await run([...claude, '--version'], projects.claude, cliEnv, deadline, 180000)
    record(
      `claude --version is ${CLAUDE_VERSION}`,
      succeeded(claudeVersion) && claudeVersion.stdout.trim().split(/\s/)[0] === CLAUDE_VERSION,
      diagnostic(claudeVersion),
    )
    const probe = await run(
      [...claude, '-p', 'sync smoke check', '--output-format', 'stream-json', '--verbose', '--max-turns', '1'],
      projects.claude,
      cliEnv,
      deadline,
      90000,
    )
    const events = parseEvents(probe.stdout)
    const init = events.map((event) => initEvent.safeParse(event)).find((parsed) => parsed.success)?.data
    const completed = !probe.timedOut && !probe.error && probe.code !== null
    record('claude probe finished within its deadline', completed, diagnostic(probe))
    record(
      'claude lists synced starter skills',
      completed && EXPECTED_SKILLS.every((skill) => init?.skills.includes(skill)),
      `expected ${EXPECTED_SKILLS.join(',')} in skills: ${init?.skills.join(',') ?? '(no init event)'}`,
    )
    record(
      'claude lists synced starter workflows as commands',
      completed && EXPECTED_COMMANDS.every((command) => init?.slash_commands.includes(command)),
      `expected ${EXPECTED_COMMANDS.join(',')} in slash_commands: ${init?.slash_commands.join(',') ?? '(no init event)'}`,
    )
    const noModel = claudeMadeNoModelCall(events)
    record('claude made no model call', completed && noModel.ok, noModel.detail)

    // Droid: no offline listing command exists (see header); the synced files are asserted on disk above.
    const droidVersion = await run([...droid, '--version'], projects.droid, cliEnv, deadline, 180000)
    record(
      `droid --version is ${DROID_VERSION}`,
      succeeded(droidVersion) && droidVersion.stdout.trim() === DROID_VERSION,
      diagnostic(droidVersion),
    )
    const doctor = await run(
      [...droid, 'doctor', '--checks', 'config,filesystem', '--json'],
      projects.droid,
      cliEnv,
      deadline,
      60000,
    )
    let report: unknown
    try {
      report = JSON.parse(doctor.stdout)
    } catch {
      report = undefined
    }
    record(
      'droid doctor passes in the synced project',
      succeeded(doctor) && doctorReport.safeParse(report).success,
      diagnostic(doctor),
    )
    const listing = await run([...droid, 'exec', '--list-tools'], projects.droid, cliEnv, deadline, 60000)
    record(
      'droid exec --list-tools runs in the synced project',
      succeeded(listing) && /^\s*• Read\b/m.test(listing.stdout),
      diagnostic(listing),
    )
  } finally {
    sandbox.dispose()
  }
  return checks
}

if (import.meta.main) {
  let checks: HarnessSmokeCheck[]
  try {
    checks = await harnessSmoke()
  } catch (error) {
    checks = [{command: 'harness smoke setup', correct: false, detail: String(error).slice(-DIAGNOSTIC_CHARS)}]
  }
  for (const check of checks) console.log(JSON.stringify(check))
  process.exitCode = checks.every((check) => check.correct) ? 0 : 1
}
