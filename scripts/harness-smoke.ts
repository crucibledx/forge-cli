import {existsSync} from 'node:fs'
import {mkdir, writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'

import {repositoryRoot} from './repository-root'
import {createTestSandbox} from './test-sandbox'

/**
 * Real sync smoke: the compiled forge binary syncs forge-skills-starter into a fresh Claude Code
 * project folder and a fresh Droid project folder, then each harness CLI reports what it sees.
 * No API keys and no model calls.
 *
 * Claude Code lists discovered skills and slash commands in the `system/init` event of
 * `claude -p --output-format stream-json` before any model call, so an unauthenticated run with
 * `total_cost_usd: 0` is the assertion surface.
 *
 * Droid 1.x has no offline, non-interactive command that lists discovered skills, rules or
 * settings (the `/skills` manager and its "Import from Claude" tab are interactive), and forge
 * v0.7 has no Droid sync target yet (tracked by crucibledx/forge-cli#53 and #56). The Droid leg
 * therefore uses the closest documented non-model checks: `droid doctor --json` and
 * `droid exec --list-tools` against the synced folder, plus the synced files on disk.
 */

const STARTER_URL = 'https://github.com/crucibledx/forge-skills-starter.git'
const STARTER_BRANCH = 'main'
const CLAUDE_PACKAGE = '@anthropic-ai/claude-code@2.1.332'
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
const DIAGNOSTIC_BYTES = 800

interface RunResult {
  code: number | null
  timedOut: boolean
  stdout: string
  stderr: string
  error?: string
}

async function run(
  command: string[],
  options: {cwd?: string; env: Record<string, string>; timeoutMs: number},
): Promise<RunResult> {
  try {
    const child = Bun.spawn(command, {
      cwd: options.cwd,
      env: options.env,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, options.timeoutMs)
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    clearTimeout(timer)
    return {code: timedOut ? null : code, timedOut, stdout, stderr}
  } catch (error) {
    return {code: null, timedOut: false, stdout: '', stderr: '', error: String(error)}
  }
}

const diagnostic = (result: RunResult): string =>
  (result.error ?? `${result.stdout}\n${result.stderr}`.trim()).slice(-DIAGNOSTIC_BYTES)

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
  `    branch: "${STARTER_BRANCH}"`,
  'telemetry:',
  '  enabled: false',
  '',
].join('\n')

async function harnessSmoke(): Promise<HarnessSmokeCheck[]> {
  const checks: HarnessSmokeCheck[] = []
  const record = (command: string, correct: boolean, detail = '') => checks.push({command, correct, detail})
  const binary = resolve(repositoryRoot, process.platform === 'win32' ? 'dist/forge.exe' : 'dist/forge')
  if (!existsSync(binary)) {
    record('compiled forge binary exists (run `bun run build` first)', false, binary)
    return checks
  }
  const sandbox = createTestSandbox('forge-harness-smoke-')
  try {
    const projects = {
      claude: join(sandbox.root, 'claude-project'),
      droid: join(sandbox.root, 'droid-project'),
    }
    for (const dir of Object.values(projects)) {
      await mkdir(join(dir, '.crucible'), {recursive: true, mode: 0o700})
      await writeFile(join(dir, '.crucible', 'forge.config.yaml'), forgeConfigYaml, {mode: 0o600})
    }
    // The sandbox pins git to the file protocol; this smoke intentionally fetches the public starter.
    const forgeEnv = {...sandbox.env, GIT_ALLOW_PROTOCOL: 'file:https'}
    for (const [harness, dir] of Object.entries(projects)) {
      const sync = await run([binary, 'sync'], {cwd: dir, env: forgeEnv, timeoutMs: 180000})
      record(`forge sync (${harness} project)`, !sync.timedOut && sync.code === 0, diagnostic(sync))
      for (const file of EXPECTED_FILES)
        record(`${harness} project: ${file} synced`, existsSync(join(dir, file)), join(dir, file))
    }

    // Claude Code: the stream-json init event lists discovered skills and slash commands.
    // HOME is the disposable sandbox home, so no API key is available and no model call can happen.
    const claudeEnv = {...sandbox.env, BUN_INSTALL_CACHE_DIR: join(sandbox.root, 'bun-cache')}
    const resolve_ = await run(['bunx', '--bun', CLAUDE_PACKAGE, '--version'], {
      env: claudeEnv,
      timeoutMs: 240000,
    })
    record(
      `claude CLI pinned (${CLAUDE_PACKAGE})`,
      resolve_.code === 0 && /\d+\.\d+\.\d+/.test(resolve_.stdout),
      diagnostic(resolve_),
    )
    const probe = await run(
      [
        'bunx',
        '--bun',
        CLAUDE_PACKAGE,
        '-p',
        'sync smoke check',
        '--output-format',
        'stream-json',
        '--verbose',
        '--max-turns',
        '1',
      ],
      {cwd: projects.claude, env: claudeEnv, timeoutMs: 120000},
    )
    const events = probe.stdout.split('\n').flatMap((line): Record<string, unknown>[] => {
      try {
        return [JSON.parse(line)]
      } catch {
        return []
      }
    })
    const init = events.find((event) => event.type === 'system' && event.subtype === 'init')
    const skills = Array.isArray(init?.skills) ? (init.skills as string[]) : []
    const commands = Array.isArray(init?.slash_commands) ? (init.slash_commands as string[]) : []
    record(
      'claude lists synced starter skills',
      EXPECTED_SKILLS.every((skill) => skills.includes(skill)),
      `expected ${EXPECTED_SKILLS.join(',')} in skills: ${skills.join(',') || '(none)'}`,
    )
    record(
      'claude lists synced starter workflows as commands',
      EXPECTED_COMMANDS.every((command) => commands.includes(command)),
      `expected ${EXPECTED_COMMANDS.join(',')} in slash_commands: ${commands.join(',') || '(none)'}`,
    )
    const result = events.find((event) => event.type === 'result')
    record(
      'claude made no model call',
      result !== undefined && (result.total_cost_usd === undefined || result.total_cost_usd === 0),
      `result event: ${JSON.stringify(result ?? null)?.slice(0, DIAGNOSTIC_BYTES)}`,
    )

    // Droid: no offline listing command for skills/rules/settings exists (see header), so assert
    // the CLI operates against the synced folder; the synced files are asserted on disk above.
    const version = await run(['droid', '--version'], {env: sandbox.env, timeoutMs: 30000})
    const droidMissing = version.code !== 0 || version.error !== undefined
    record(
      'droid CLI available',
      !droidMissing,
      droidMissing ? 'install the Droid CLI (CI installs it)' : version.stdout.trim(),
    )
    if (!droidMissing) {
      const doctor = await run(['droid', 'doctor', '--checks', 'config,filesystem', '--json'], {
        cwd: projects.droid,
        env: sandbox.env,
        timeoutMs: 60000,
      })
      let doctorOk = false
      try {
        const report = JSON.parse(doctor.stdout) as {ok?: boolean; results?: {status?: string}[]}
        doctorOk =
          doctor.code === 0 &&
          report.ok === true &&
          Array.isArray(report.results) &&
          report.results.length > 0 &&
          report.results.every((entry) => entry.status === 'pass')
      } catch {
        doctorOk = false
      }
      record('droid doctor passes in the synced project', doctorOk, diagnostic(doctor))
      const tools = await run(['droid', 'exec', '--list-tools'], {
        cwd: projects.droid,
        env: sandbox.env,
        timeoutMs: 60000,
      })
      record(
        'droid exec --list-tools runs in the synced project',
        tools.code === 0 && tools.stdout.includes('Read'),
        diagnostic(tools),
      )
    }
  } finally {
    sandbox.dispose()
  }
  return checks
}

if (import.meta.main) {
  let failed = false
  for (const check of await harnessSmoke()) {
    console.log(JSON.stringify(check))
    if (!check.correct) failed = true
  }
  process.exitCode = failed ? 1 : 0
}
