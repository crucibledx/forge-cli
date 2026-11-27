import {existsSync, readdirSync} from 'node:fs'
import {readFile, realpath, rename, writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'

import {z} from 'zod'

import {
  CLAUDE_VERSION,
  claudeCli,
  claudeMadeNoModelCall,
  completed,
  diagnostic,
  DROID_VERSION,
  droidCli,
  parseEvents,
  run,
  type RunResult,
  succeeded,
} from './harness-cli'
import {repositoryRoot} from './repository-root'
import {createTestSandbox} from './test-sandbox'
import {type PluginLoadCheckJob, pluginLoadCheckJobs} from './validation-lanes'

/**
 * Plugin load check (spec 0004): the compiled forge binary installs the cover-all fixture as a local plugin for one
 * harness and scope in a disposable HOME and project, then the pinned harness CLI is asked whether it loaded it, the
 * rule delivery is checked, the plugin is removed and the harness is asked again. No API keys and no model calls.
 *
 * Neither CLI lists a settings-declared plugin before a session has registered its marketplace:
 * - Claude Code registers it when a session starts. `claude -p` without credentials is that trigger: it starts a
 *   session, prints the loaded plugins in its `system/init` event and stops at a synthetic "Not logged in" reply.
 *   `claude plugin list` omits plugins from directory marketplaces, so the init event is the harness's listing.
 * - Droid registers it only in a logged-in session, so without credentials the job falls back (see `fallback`).
 *
 * The settings keys and the offline layout walk (settings marketplace source → catalog → entry source → manifest)
 * run in both modes: Claude Code accepts a plugin without a manifest, so only the walk and the validator's manifest
 * line tell the broken fixture variant from a valid delivery.
 *
 * Env: LOAD_CHECK_HARNESS / LOAD_CHECK_SCOPE select one job (default: all four), LOAD_CHECK_FORCE_FALLBACK=1 forces
 * fallback mode, LOAD_CHECK_FIXTURE=broken-manifest-path moves the delivered manifest to a wrong path after sync.
 * POSIX only (the lane runs on ubuntu-latest): shell-form hooks run through `sh -c`, and Droid's rule hook needs node.
 */

type Harness = PluginLoadCheckJob['harness']
export type Fixture = 'cover-all' | 'broken-manifest-path'

const PLUGIN = 'cover-all'
const FIXTURE_DIR = resolve(repositoryRoot, 'e2e/fixtures/plugins', PLUGIN)
const MANIFEST = '.claude-plugin/plugin.json'
// The CI lane has 10 minutes including checkout, install and build; leave room for those and cleanup.
const JOB_BUDGET_MS = 7 * 60 * 1000
const TRANSCRIPT_CHARS = 4000

export const harnessLayout = {
  'claude-code': {
    tree: 'claude-code',
    catalog: '.claude-plugin/marketplace.json',
    source: 'directory',
    settings: {project: '.claude/settings.local.json', user: '.claude/settings.json'},
  },
  droid: {
    tree: 'droid',
    catalog: '.factory-plugin/marketplace.json',
    source: 'local',
    settings: {project: '.factory/settings.local.json', user: '.factory/settings.json'},
  },
} as const

export interface Check {
  check: string
  ok: boolean
  detail?: string
}

export interface LoadCheckReport {
  job: PluginLoadCheckJob
  mode: string
  checks: Check[]
  transcript: {label: string; text: string}[]
}

const check = (name: string, ok: boolean, detail?: string): Check => ({check: name, ok, ...(detail ? {detail} : {})})

export type JsonFile = {state: 'missing'} | {state: 'invalid'; error: string} | {state: 'ok'; value: unknown}

async function readJsonFile(path: string): Promise<JsonFile> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {state: 'missing'}
    return {state: 'invalid', error: String(error)}
  }
  try {
    return {state: 'ok', value: JSON.parse(text)}
  } catch (error) {
    return {state: 'invalid', error: String(error)}
  }
}

async function readJson(path: string): Promise<unknown> {
  const file = await readJsonFile(path)
  return file.state === 'ok' ? file.value : undefined
}

/**
 * Settings for the checks: a missing file is empty settings (valid after removal), an unreadable or corrupt one
 * fails, so a removal that leaves a broken settings file never counts as removed.
 */
export function settingsOf(file: JsonFile, label: string): {settings: unknown; problem?: Check} {
  if (file.state === 'ok') return {settings: file.value}
  if (file.state === 'missing') return {settings: {}}
  return {settings: {}, problem: check(`${label} is readable JSON`, false, file.error)}
}

const settingsSchema = z.object({
  extraKnownMarketplaces: z
    .record(z.string(), z.object({source: z.object({source: z.string(), path: z.string()})}))
    .optional(),
  enabledPlugins: z.record(z.string(), z.unknown()).optional(),
})

/** The forge-written settings keys: present and pointing at a marketplace source while installed, gone after removal. */
export function settingsChecks(settings: unknown, harness: Harness, marketplace: string, installed: boolean): Check[] {
  const parsed = settingsSchema.safeParse(settings ?? {})
  const id = `${PLUGIN}@${marketplace}`
  if (!parsed.success) return [check('settings file parses', false, parsed.error.message)]
  const known = parsed.data.extraKnownMarketplaces?.[marketplace]
  const enabled = parsed.data.enabledPlugins?.[id]
  if (!installed)
    return [
      check(`settings no longer enable ${id}`, enabled === undefined),
      check(`settings no longer declare marketplace ${marketplace}`, known === undefined),
    ]
  return [
    check(`settings enable ${id}`, enabled === true, `enabledPlugins[${id}] = ${JSON.stringify(enabled)}`),
    check(
      `settings declare marketplace ${marketplace} as a ${harnessLayout[harness].source} source`,
      known?.source.source === harnessLayout[harness].source && known.source.path.length > 0,
      JSON.stringify(known ?? null),
    ),
  ]
}

const catalogSchema = z.object({
  name: z.string(),
  plugins: z.array(z.object({name: z.string(), version: z.string().optional(), source: z.string()})),
})
const manifestSchema = z.object({name: z.string(), version: z.string()})

/**
 * Follows the path the harness takes from the settings key to the plugin: marketplace source directory → its catalog
 * → the entry's source → a directory whose manifest names the locked plugin and version.
 */
export async function layoutChecks(
  settings: unknown,
  harness: Harness,
  marketplace: string,
  version: string,
): Promise<Check[]> {
  const source = settingsSchema.safeParse(settings ?? {}).data?.extraKnownMarketplaces?.[marketplace]?.source.path
  if (!source) return [check('layout: settings name a marketplace source directory', false)]
  const catalogPath = join(source, harnessLayout[harness].catalog)
  const catalog = catalogSchema.safeParse(await readJson(catalogPath))
  if (!catalog.success) return [check(`layout: ${catalogPath} is a marketplace catalog`, false, catalog.error.message)]
  const entry = catalog.data.plugins.find((plugin) => plugin.name === PLUGIN)
  const checks = [
    check(`layout: catalog is named ${marketplace}`, catalog.data.name === marketplace, catalog.data.name),
    check(`layout: catalog lists ${PLUGIN}`, entry !== undefined, JSON.stringify(catalog.data.plugins)),
  ]
  if (!entry) return checks
  const manifestPath = join(resolve(source, entry.source), MANIFEST)
  const manifest = manifestSchema.safeParse(await readJson(manifestPath))
  checks.push(
    check(
      `layout: ${manifestPath} names ${PLUGIN} ${version}`,
      manifest.success && manifest.data.name === PLUGIN && manifest.data.version === version,
      manifest.success ? JSON.stringify(manifest.data) : 'manifest missing or invalid',
    ),
  )
  return checks
}

/** After removal the catalog, if still there, no longer lists the plugin. */
export async function catalogDropped(source: string, harness: Harness): Promise<Check> {
  const name = `catalog no longer lists ${PLUGIN}`
  const file = await readJsonFile(join(source, harnessLayout[harness].catalog))
  if (file.state === 'missing') return check(name, true)
  if (file.state === 'invalid') return check(name, false, file.error)
  const catalog = catalogSchema.safeParse(file.value)
  return check(
    name,
    catalog.success && catalog.data.plugins.every((plugin) => plugin.name !== PLUGIN),
    catalog.success ? undefined : catalog.error.message,
  )
}

/** Each fixture rule's text without its frontmatter, keyed by rule name. */
export async function fixtureRules(fixture = FIXTURE_DIR): Promise<Record<string, string>> {
  const dir = join(fixture, 'dev.crucibledx.forge', 'rules')
  const rules: Record<string, string> = {}
  for (const file of readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort())
    rules[file.slice(0, -3)] = (await readFile(join(dir, file), 'utf8'))
      .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
      .trim()
  return rules
}

const initEvent = z.object({
  type: z.literal('system'),
  subtype: z.literal('init'),
  plugins: z.array(z.object({source: z.string(), version: z.string().optional()})),
})

/** The plugins a Claude Code session loaded, from its `system/init` event; undefined when there is no such event. */
export function claudeInitPlugins(events: unknown[]): {source: string; version?: string}[] | undefined {
  return events.map((event) => initEvent.safeParse(event)).find((parsed) => parsed.success)?.data?.plugins
}

/**
 * `droid plugin list` prints one block per plugin; one block must carry the exact plugin id, the exact version and the
 * Enabled status as whole fields, so a longer id or a version like 11.0.0 never matches.
 */
export function droidListShows(stdout: string, id: string, version: string): boolean {
  return stdout.split(/\n\s*\n/).some((block) => {
    const fields = block.split(/[\s()[\],:;|]+/).filter(Boolean)
    return (
      fields.includes(id) && fields.includes('Enabled') && fields.some((field) => field.replace(/^v/, '') === version)
    )
  })
}

/** The Droid listing counts only from a command that succeeded. */
export const droidListed = (list: RunResult, id: string, version: string) =>
  succeeded(list) && droidListShows(list.stdout, id, version)

/**
 * A credential-less session exits nonzero by design, but it must have run to completion: a timeout, a spawn error or
 * a failed process-tree cleanup fails it even when its stdout looks valid.
 */
export function sessionChecks(label: string, probe: RunResult, events: unknown[]): Check[] {
  const noModel = claudeMadeNoModelCall(events)
  return [
    check(`${label} ran to completion`, completed(probe), diagnostic(probe)),
    check(`${label} made no model call`, noModel.ok, noModel.detail),
  ]
}

const hooksSchema = z.object({
  hooks: z.object({
    SessionStart: z.array(
      z.object({
        hooks: z.array(z.object({type: z.string(), command: z.string(), args: z.array(z.string()).optional()})),
      }),
    ),
  }),
})

interface Context {
  job: PluginLoadCheckJob
  binary: string
  project: string
  home: string
  env: Record<string, string>
  cliEnv: Record<string, string>
  deadline: number
  checks: Check[]
  transcript: {label: string; text: string}[]
}

async function exec(ctx: Context, label: string, command: string[], env: Record<string, string>, capMs: number) {
  const result = await run(command, ctx.project, env, ctx.deadline, capMs)
  ctx.transcript.push({label: `${label}: ${command.join(' ')}`, text: diagnostic(result, TRANSCRIPT_CHARS)})
  return result
}

function paths(job: PluginLoadCheckJob, project: string, home: string) {
  const root = job.scope === 'project' ? project : home
  const forge = job.scope === 'project' ? join(project, '.crucible') : join(home, '.crucible', 'forge')
  return {
    config: join(root, '.crucible', 'forge.config.yaml'),
    lock: join(forge, 'forge.lock'),
    cache: join(forge, 'plugins'),
    settings: join(root, harnessLayout[job.harness].settings[job.scope]),
    rules: join(root, '.claude', 'rules'),
    sync: job.scope === 'project' ? ['sync'] : ['--global', 'sync'],
  }
}

const forgeConfig = (harness: Harness, withPlugin: boolean) =>
  [
    'version: "1"',
    'assistants:',
    `  - id: ${harness}`,
    '    enabled: true',
    'sync:',
    '  keep_local: false',
    ...(withPlugin
      ? ['plugins:', `  - name: ${PLUGIN}`, `    source: {type: local, path: ${JSON.stringify(FIXTURE_DIR)}}`]
      : []),
    'telemetry:',
    '  enabled: false',
    '',
  ].join('\n')

/** Claude Code's own listing: the init event of a session started without credentials. */
async function claudeSession(ctx: Context, label: string) {
  const probe = await exec(
    ctx,
    label,
    [...claudeCli, '-p', 'plugin load check', '--output-format', 'stream-json', '--verbose', '--max-turns', '1'],
    ctx.cliEnv,
    90000,
  )
  const events = parseEvents(probe.stdout)
  ctx.checks.push(...sessionChecks(label, probe, events))
  return {probe, events, plugins: claudeInitPlugins(events)}
}

/** Decides the mode and asserts the harness's own listing in harness mode. Returns the fallback reason, if any. */
async function harnessProof(ctx: Context, id: string, version: string, forced: boolean): Promise<string | undefined> {
  if (forced) return 'forced by LOAD_CHECK_FORCE_FALLBACK=1'
  if (ctx.job.harness === 'claude-code') {
    const session = await claudeSession(ctx, 'claude session')
    // The session listing works without credentials, so a missing init event is a failure, never a fallback.
    ctx.checks.push(
      check('claude session printed an init event', session.plugins !== undefined, diagnostic(session.probe)),
    )
    ctx.checks.push(
      check(
        `claude session loaded ${id} at ${version}`,
        session.plugins?.some((plugin) => plugin.source === id && plugin.version === version) === true,
        JSON.stringify(session.plugins ?? null),
      ),
    )
    // Today's list omits directory-marketplace plugins; should it list this one, it must agree with the session.
    const list = await exec(ctx, 'claude plugin list', [...claudeCli, 'plugin', 'list', '--json'], ctx.cliEnv, 60000)
    ctx.checks.push(check('claude plugin list --json runs', succeeded(list), diagnostic(list)))
    const listed = z
      .array(z.object({id: z.string(), version: z.string().optional(), enabled: z.boolean().optional()}))
      .safeParse(parseEvents(list.stdout.replaceAll('\n', ' '))[0])
      .data?.find((plugin) => plugin.id === id)
    if (listed)
      ctx.checks.push(
        check(
          `claude plugin list shows ${id} enabled at ${version}`,
          listed.enabled === true && listed.version === version,
        ),
      )
    return undefined
  }
  // The non-model trigger: a marketplace update. Droid 1.20.0 registers settings-declared marketplaces only when a
  // logged-in session starts, so without credentials the update finds nothing and the job falls back.
  const update = await exec(ctx, 'droid trigger', [...droidCli, 'plugin', 'marketplace', 'update'], ctx.cliEnv, 60000)
  ctx.checks.push(check('droid plugin marketplace update runs', succeeded(update), diagnostic(update)))
  const marketplaces = await exec(
    ctx,
    'droid marketplaces',
    [...droidCli, 'plugin', 'marketplace', 'list'],
    ctx.cliEnv,
    60000,
  )
  ctx.checks.push(check('droid plugin marketplace list runs', succeeded(marketplaces), diagnostic(marketplaces)))
  const marketplace = id.slice(id.indexOf('@') + 1)
  if (!succeeded(update) || !succeeded(marketplaces)) return undefined
  if (!marketplaces.stdout.includes(marketplace))
    return `droid has not registered marketplace ${marketplace} after \`droid plugin marketplace update\` (${update.stdout.trim() || 'no output'}; list: ${marketplaces.stdout.trim() || 'no output'}); it registers settings-declared marketplaces only in a logged-in session, and this job has no credentials`
  const list = await exec(
    ctx,
    'droid plugin list',
    [...droidCli, 'plugin', 'list', '--scope', ctx.job.scope],
    ctx.cliEnv,
    60000,
  )
  ctx.checks.push(
    check(`droid plugin list shows ${id} Enabled at ${version}`, droidListed(list, id, version), diagnostic(list)),
  )
  return undefined
}

async function harnessVersion(ctx: Context) {
  const [cli, pinned] = ctx.job.harness === 'claude-code' ? [claudeCli, CLAUDE_VERSION] : [droidCli, DROID_VERSION]
  const result = await exec(ctx, 'harness version', [...cli, '--version'], ctx.cliEnv, 180000)
  const reported = result.stdout.trim().split(/\s/)[0] ?? ''
  console.log(`harness version: ${ctx.job.harness} ${reported || '(none)'} (pinned ${pinned})`)
  ctx.checks.push(check(`${ctx.job.harness} --version is ${pinned}`, succeeded(result) && reported === pinned))
}

async function rulesDelivered(ctx: Context, tree: string, rulesDir: string) {
  const rules = await fixtureRules()
  if (ctx.job.harness === 'claude-code') {
    for (const [name, text] of Object.entries(rules)) {
      const file = join(rulesDir, `${PLUGIN}--${name}.md`)
      const content = existsSync(file) ? await readFile(file, 'utf8') : undefined
      ctx.checks.push(check(`rule file ${file} carries the fixture's ${name} rule`, content?.includes(text) === true))
    }
    return
  }
  const hooks = hooksSchema.safeParse(await readJson(join(tree, 'hooks', 'hooks.json')))
  if (!hooks.success) {
    ctx.checks.push(check('droid plugin hooks/hooks.json registers SessionStart hooks', false, hooks.error.message))
    return
  }
  const env = {...ctx.env, CLAUDE_PLUGIN_ROOT: tree, DROID_PLUGIN_ROOT: tree}
  const outputs: string[] = []
  for (const hook of hooks.data.hooks.SessionStart.flatMap((entry) => entry.hooks)) {
    if (hook.type !== 'command') continue
    const expand = (value: string) => value.replaceAll(/\$\{(?:CLAUDE|DROID)_PLUGIN_ROOT\}/g, tree)
    const command = hook.args ? [expand(hook.command), ...hook.args.map(expand)] : ['sh', '-c', expand(hook.command)]
    const result = await exec(ctx, 'droid SessionStart hook', command, env, 30000)
    if (succeeded(result)) outputs.push(result.stdout)
  }
  ctx.checks.push(
    check(
      "droid plugin's SessionStart hook prints every fixture rule",
      outputs.some((output) => Object.values(rules).every((text) => output.includes(text))),
      `rules: ${Object.keys(rules).join(', ')}`,
    ),
  )
}

async function claudeValidate(ctx: Context, tree: string) {
  const result = await exec(
    ctx,
    'claude plugin validate',
    [...claudeCli, 'plugin', 'validate', tree],
    ctx.cliEnv,
    60000,
  )
  // A directory without a manifest validates as loose components; the plugin manifest line proves it was found.
  ctx.checks.push(
    check(
      `claude plugin validate ${tree} passes on the plugin manifest`,
      succeeded(result) && result.stdout.includes('Validating plugin manifest'),
      diagnostic(result),
    ),
  )
}

async function loadCheckIn(ctx: Context, fixture: Fixture, forceFallback: boolean): Promise<string> {
  const {job} = ctx
  const where = paths(job, ctx.project, ctx.home)
  if (job.harness === 'claude-code' && job.scope === 'project')
    await writeFile(
      join(ctx.home, '.claude.json'),
      JSON.stringify({projects: {[ctx.project]: {hasTrustDialogAccepted: true}}}, null, 2) + '\n',
      {mode: 0o600},
    )
  await harnessVersion(ctx)
  await Bun.write(where.config, forgeConfig(job.harness, true))
  await exec(ctx, 'forge plan', [ctx.binary, ...where.sync, '--dry-run'], ctx.env, 90000)
  const sync = await exec(ctx, 'forge sync (portability report)', [ctx.binary, ...where.sync], ctx.env, 90000)
  ctx.checks.push(check('forge sync exits 0', succeeded(sync), diagnostic(sync)))
  const marketplace = new RegExp(`installed as ${PLUGIN}@(\\S+)`).exec(sync.stdout)?.[1]
  const lock = z
    .object({plugins: z.array(z.object({name: z.string(), version: z.string()}))})
    .safeParse(await readJson(where.lock))
  const version = lock.data?.plugins.find((plugin) => plugin.name === PLUGIN)?.version
  ctx.checks.push(check(`sync report names ${PLUGIN}@<marketplace>`, marketplace !== undefined))
  ctx.checks.push(check(`lock pins ${PLUGIN}`, version !== undefined, where.lock))
  if (!marketplace || !version) return 'not reached (sync did not install the plugin)'
  const id = `${PLUGIN}@${marketplace}`
  const tree = join(where.cache, PLUGIN, version, harnessLayout[job.harness].tree)
  if (fixture === 'broken-manifest-path') await rename(join(tree, MANIFEST), join(tree, 'plugin.json'))

  const reason = await harnessProof(ctx, id, version, forceFallback)
  const mode = reason
    ? `fallback (${reason})`
    : `harness (${job.harness === 'claude-code' ? 'claude session init event, started by claude -p without credentials' : 'droid plugin list'})`
  console.log(`load-check mode: ${mode}`)
  const installed = settingsOf(await readJsonFile(where.settings), where.settings)
  if (installed.problem) ctx.checks.push(installed.problem)
  const settings = installed.settings
  ctx.checks.push(...settingsChecks(settings, job.harness, marketplace, true))
  ctx.checks.push(...(await layoutChecks(settings, job.harness, marketplace, version)))
  if (job.harness === 'claude-code') await claudeValidate(ctx, tree)
  await rulesDelivered(ctx, tree, where.rules)

  await Bun.write(where.config, forgeConfig(job.harness, false))
  const removal = await exec(ctx, 'forge sync after removal', [ctx.binary, ...where.sync], ctx.env, 90000)
  ctx.checks.push(check('forge sync after removal exits 0', succeeded(removal), diagnostic(removal)))
  const removed = settingsOf(await readJsonFile(where.settings), where.settings)
  if (removed.problem) ctx.checks.push(removed.problem)
  ctx.checks.push(...settingsChecks(removed.settings, job.harness, marketplace, false))
  ctx.checks.push(check(`${PLUGIN} cache entry is gone`, !existsSync(join(where.cache, PLUGIN))))
  ctx.checks.push(await catalogDropped(where.cache, job.harness))
  if (job.harness === 'claude-code') {
    const left = existsSync(where.rules)
      ? readdirSync(where.rules).filter((name) => name.startsWith(`${PLUGIN}--`))
      : []
    ctx.checks.push(check('claude rule files are gone', left.length === 0, left.join(', ')))
  }
  if (!reason) {
    if (job.harness === 'claude-code') {
      const session = await claudeSession(ctx, 'claude session after removal')
      ctx.checks.push(
        check(
          `claude session no longer loads ${id}`,
          session.plugins !== undefined && session.plugins.every((plugin) => plugin.source !== id),
          JSON.stringify(session.plugins ?? null),
        ),
      )
    } else {
      const list = await exec(
        ctx,
        'droid plugin list after removal',
        [...droidCli, 'plugin', 'list', '--scope', job.scope],
        ctx.cliEnv,
        60000,
      )
      ctx.checks.push(check(`droid plugin list no longer shows ${id}`, succeeded(list) && !list.stdout.includes(id)))
    }
  }
  return mode
}

export async function loadCheck(
  job: PluginLoadCheckJob,
  fixture: Fixture = 'cover-all',
  forceFallback = false,
): Promise<LoadCheckReport> {
  const binary = resolve(repositoryRoot, process.platform === 'win32' ? 'dist/forge.exe' : 'dist/forge')
  const report: LoadCheckReport = {job, mode: 'not reached', checks: [], transcript: []}
  if (!existsSync(binary)) {
    report.checks.push(check('compiled forge binary exists (run `bun run build` first)', false, binary))
    return report
  }
  const sandbox = createTestSandbox('forge-load-check-')
  try {
    const env = sandbox.env
    const ctx: Context = {
      job,
      binary,
      project: await realpath(sandbox.project),
      home: await realpath(env.HOME),
      env,
      // Package caches stay inside the sandbox, so each run fetches exactly the pinned versions.
      cliEnv: {
        ...env,
        BUN_INSTALL_CACHE_DIR: join(sandbox.root, 'bun-cache'),
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        // A closed local port: even if a developer's keychain login were found, no model request leaves the machine.
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
      },
      deadline: performance.now() + JOB_BUDGET_MS,
      checks: report.checks,
      transcript: report.transcript,
    }
    report.mode = await loadCheckIn(ctx, fixture, forceFallback)
  } catch (error) {
    report.checks.push(check('load check setup', false, String(error).slice(-TRANSCRIPT_CHARS)))
  } finally {
    sandbox.dispose()
  }
  return report
}

export function selectJobs(env: Record<string, string | undefined>): PluginLoadCheckJob[] {
  const jobs = pluginLoadCheckJobs.filter(
    (job) =>
      (!env.LOAD_CHECK_HARNESS || job.harness === env.LOAD_CHECK_HARNESS) &&
      (!env.LOAD_CHECK_SCOPE || job.scope === env.LOAD_CHECK_SCOPE),
  )
  if (!jobs.length)
    throw new Error(
      `No load-check job for LOAD_CHECK_HARNESS=${env.LOAD_CHECK_HARNESS} LOAD_CHECK_SCOPE=${env.LOAD_CHECK_SCOPE}`,
    )
  return jobs
}

export const passed = (report: LoadCheckReport) => report.checks.length > 0 && report.checks.every((item) => item.ok)

if (import.meta.main) {
  const fixture = (process.env.LOAD_CHECK_FIXTURE ?? 'cover-all') as Fixture
  let ok = fixture === 'cover-all' || fixture === 'broken-manifest-path'
  if (!ok) console.error(`Unknown LOAD_CHECK_FIXTURE=${fixture}`)
  let jobs: PluginLoadCheckJob[] = []
  try {
    if (ok) jobs = selectJobs(process.env)
  } catch (error) {
    console.error((error as Error).message)
    ok = false
  }
  for (const job of jobs) {
    console.log(`== plugin load check: ${job.harness}, ${job.scope} scope, fixture ${fixture} ==`)
    const report = await loadCheck(job, fixture, process.env.LOAD_CHECK_FORCE_FALLBACK === '1')
    // Details of passing checks are noise in the job log; a failure prints its detail and the transcript.
    for (const item of report.checks) console.log(JSON.stringify(item.ok ? {check: item.check, ok: true} : item))
    if (passed(report)) {
      console.log(`PASS ${job.harness}/${job.scope} (mode: ${report.mode})`)
      continue
    }
    ok = false
    console.log(`FAIL ${job.harness}/${job.scope} (mode: ${report.mode})`)
    for (const entry of report.transcript) console.log(`--- ${entry.label}\n${entry.text}`)
  }
  process.exitCode = ok ? 0 : 1
}
