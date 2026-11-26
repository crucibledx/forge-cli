import {existsSync} from 'node:fs'
import {mkdir, writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'

import {z} from 'zod'

import {spawnOwnedPipe} from '../e2e/framework/owned-pipe'
import {terminateTree} from '../e2e/framework/process'
import {repositoryRoot} from './repository-root'
import {createTestSandbox} from './test-sandbox'

/**
 * Real sync smoke: the compiled forge binary syncs a pinned forge-skills-starter release into a fresh
 * Claude Code project folder and a fresh Droid project folder, then each harness CLI reports what it
 * sees. Both CLIs are pinned npm packages run through bunx inside a disposable sandbox, so local and CI
 * runs use the same versions. No API keys and no model calls.
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
const CLAUDE_VERSION = '2.1.332'
const DROID_VERSION = '1.20.0'
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
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024
const DIAGNOSTIC_CHARS = 800

interface RunResult {
  code: number | null
  timedOut: boolean
  stdout: string
  stderr: string
  error?: string
}

async function drain(stream: ReadableStream<Uint8Array>, readers: ReadableStreamDefaultReader<Uint8Array>[]) {
  const reader = stream.getReader()
  readers.push(reader)
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const {done, value} = await reader.read()
    if (done) return Buffer.concat(chunks).toString('utf8')
    if (size + value.byteLength <= MAX_OUTPUT_BYTES) chunks.push(value)
    size += value.byteLength
  }
}

/** Owned process group (Job Object on Windows): a timeout or failure terminates every descendant. */
async function run(
  command: string[],
  cwd: string,
  env: Record<string, string>,
  deadline: number,
  capMs: number,
): Promise<RunResult> {
  const timeoutMs = Math.min(capMs, deadline - performance.now())
  if (timeoutMs <= 0) return {code: null, timedOut: true, stdout: '', stderr: '', error: 'Smoke deadline exceeded'}
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = []
  const output = {stdout: '', stderr: ''}
  let child: Awaited<ReturnType<typeof spawnOwnedPipe>> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let code: number | null = null
  let timedOut = false
  const errors: string[] = []
  try {
    child = await spawnOwnedPipe(command, cwd, env)
    const started = child
    await Promise.race([
      Promise.all([
        drain(started.stdout, readers).then((text) => (output.stdout = text)),
        drain(started.stderr, readers).then((text) => (output.stderr = text)),
        started.exited.then((exit) => (code = exit)),
      ]),
      new Promise<void>((done) => {
        timer = setTimeout(() => {
          timedOut = true
          done()
        }, timeoutMs)
      }),
    ])
  } catch (error) {
    errors.push(String(error))
  } finally {
    clearTimeout(timer)
    try {
      if (child) await terminateTree(child, env)
    } catch (error) {
      errors.push(`Cleanup failed: ${String(error)}`)
    }
    await Promise.allSettled(readers.map((reader) => reader.cancel()))
  }
  return {
    code: timedOut ? null : code,
    timedOut,
    ...output,
    ...(errors.length ? {error: errors.join('; ')} : {}),
  }
}

const diagnostic = (result: RunResult): string =>
  [result.timedOut ? 'timed out' : `exit ${result.code}`, result.error, result.stdout, result.stderr]
    .filter(Boolean)
    .join('\n')
    .trim()
    .slice(-DIAGNOSTIC_CHARS)

const succeeded = (result: RunResult) => !result.timedOut && !result.error && result.code === 0

const initEvent = z.object({
  type: z.literal('system'),
  subtype: z.literal('init'),
  skills: z.array(z.string()),
  slash_commands: z.array(z.string()),
})
const resultEvent = z.object({
  type: z.literal('result'),
  total_cost_usd: z.number(),
  duration_api_ms: z.number(),
  modelUsage: z.record(z.string(), z.unknown()),
})
const assistantEvent = z.object({type: z.literal('assistant'), message: z.object({model: z.string()})})

function parseEvents(stdout: string): unknown[] {
  return stdout.split('\n').flatMap((line) => {
    try {
      return [JSON.parse(line) as unknown]
    } catch {
      return []
    }
  })
}

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
    for (const [harness, dir] of Object.entries(projects)) {
      // Each project gets its own temp root, so its git cache is a fresh clone like a first install.
      // A shared cache would take forge's fetch path, which cannot reset to a tag ref.
      const temp = join(sandbox.root, `tmp-${harness}`)
      await mkdir(temp, {mode: 0o700})
      // The sandbox pins git to the file protocol; this smoke intentionally fetches the public starter.
      const forgeEnv = {...env, GIT_ALLOW_PROTOCOL: 'file:https', TMPDIR: temp, TMP: temp, TEMP: temp}
      const sync = await run([binary, 'sync'], dir, forgeEnv, deadline, 90000)
      record(`forge sync (${harness} project)`, succeeded(sync), diagnostic(sync))
      for (const file of EXPECTED_FILES) record(`${harness} project: ${file} synced`, existsSync(join(dir, file)))
    }

    // Package caches stay inside the sandbox, so each run fetches exactly the pinned versions.
    const cliEnv = {...env, BUN_INSTALL_CACHE_DIR: join(sandbox.root, 'bun-cache')}
    const claude = ['bunx', `@anthropic-ai/claude-code@${CLAUDE_VERSION}`]
    const droid = ['bunx', `droid@${DROID_VERSION}`]

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
    const result = events.map((event) => resultEvent.safeParse(event)).find((parsed) => parsed.success)?.data
    const models = events.flatMap((event) => {
      const parsed = assistantEvent.safeParse(event)
      return parsed.success ? [parsed.data.message.model] : []
    })
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
    record(
      'claude made no model call',
      completed &&
        result !== undefined &&
        result.total_cost_usd === 0 &&
        result.duration_api_ms === 0 &&
        Object.keys(result.modelUsage).length === 0 &&
        models.every((model) => model === '<synthetic>'),
      `result: ${JSON.stringify(result ?? null)}; assistant models: ${models.join(',') || '(none)'}`,
    )

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
