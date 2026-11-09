import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {delimiter, dirname, join, resolve} from 'node:path'

const runtimeKeys = [
  'PATH',
  'Path',
  'SystemRoot',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'TERM',
  'LANG',
  'LC_ALL',
]
const replayKeys = ['FC_SEED', 'FC_PATH']
let windowsScheduler: Buffer | undefined

/** Command-free fixtures need no large native executable; every command environment does. */
function ensureWindowsScheduler(root: string, env: Record<string, string>, timeoutMs = 30000): void {
  if (process.platform !== 'win32') return
  const executable = join(root, 'bin', 'schtasks.exe')
  if (existsSync(executable)) return
  if (windowsScheduler) writeFileSync(executable, windowsScheduler, {mode: 0o700})
  else {
    const result = Bun.spawnSync(
      [
        process.execPath,
        'build',
        resolve(import.meta.dir, 'fixtures/fake-scheduler.ts'),
        '--compile',
        '--outfile',
        executable,
      ],
      {
        cwd: join(root, 'project'),
        env,
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: Math.min(30000, Math.max(1, timeoutMs)),
      },
    )
    if (result.exitCode !== 0)
      throw new Error(`Cannot build isolated scheduler backend: ${new TextDecoder().decode(result.stderr)}`)
    // Cache immutable bytes, never a mutable shared executable or hardlink.
    windowsScheduler = readFileSync(executable)
  }
}

export function allowlistedEnvironment(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of [...runtimeKeys, ...replayKeys]) {
    if (process.env[key] !== undefined) env[key] = process.env[key]!
  }
  return env
}

export interface TestSandbox {
  root: string
  project: string
  env: Record<string, string>
  dispose(): void
}

/** Must run in a launcher, before importing any application or test modules. */
export function createTestSandbox(prefix = 'forge-tests-', base = tmpdir(), timeoutMs = 30000): TestSandbox {
  const root = mkdtempSync(join(base, prefix))
  try {
    const ceiling = dirname(realpathSync(root))
    if (ceiling.includes(delimiter)) throw new Error('Git ceiling path contains a list delimiter')
    const project = join(root, 'project')
    const home = join(root, 'home')
    const temp = join(root, 'tmp')
    const bin = join(root, 'bin')
    for (const path of [project, home, temp, bin]) mkdirSync(path, {mode: 0o700})
    const gitConfig = join(root, 'gitconfig')
    // Git fixtures import frozen history. Tests need no operator identity/config.
    writeFileSync(gitConfig, process.platform === 'win32' ? '[core]\nlongpaths = true\n' : '', {mode: 0o600})
    const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
    const fake = resolve(import.meta.dir, 'fixtures/fake-scheduler.ts')
    if (process.platform !== 'win32') {
      for (const command of ['launchctl', 'crontab', 'schtasks']) {
        writeFileSync(
          join(bin, command),
          `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(fake)} ${shellQuote(command)} "$@"\n`,
          {mode: 0o700},
        )
      }
    }
    const env = {
      ...allowlistedEnvironment(),
      PATH: [bin, dirname(process.execPath), process.env.PATH ?? process.env.Path ?? ''].join(delimiter),
      HOME: home,
      USERPROFILE: home,
      TMPDIR: temp,
      TMP: temp,
      TEMP: temp,
      XDG_CONFIG_HOME: join(home, '.config'),
      XDG_CACHE_HOME: join(home, '.cache'),
      XDG_DATA_HOME: join(home, '.local', 'share'),
      GIT_CONFIG_GLOBAL: gitConfig,
      GIT_CONFIG_SYSTEM: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      // Git ignores a ceiling equal to its starting cwd. Exclude the canonical
      // parent so discovery stays inside this sandbox, including from its root.
      GIT_CEILING_DIRECTORIES: ceiling,
      GIT_ATTR_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_ALLOW_PROTOCOL: 'file',
      BUN_OPTIONS: '--no-env-file',
      NO_COLOR: '1',
    }
    writeFileSync(join(root, '.forge-test-sandbox'), JSON.stringify(env), {mode: 0o600})
    return {
      root,
      project,
      get env() {
        ensureWindowsScheduler(root, env, timeoutMs)
        return env
      },
      dispose: () => rmSync(root, {recursive: true, force: true}),
    }
  } catch (error) {
    try {
      rmSync(root, {recursive: true, force: true})
    } catch (cleanup) {
      throw new Error(`${String(error)}; Sandbox setup cleanup failed: ${String(cleanup)}`)
    }
    throw error
  }
}

/** Locate a per-test sandbox, including commands invoked from nested project directories. */
export function testEnvironment(cwd: string, overrides: Record<string, string> = {}): Record<string, string> {
  let dir = resolve(cwd)
  while (true) {
    let env: Record<string, string> | undefined
    try {
      env = JSON.parse(readFileSync(join(dir, '.forge-test-sandbox'), 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (env) {
      ensureWindowsScheduler(dir, env)
      const home = overrides.HOME ?? env.HOME
      // Deliberate fixture overrides are not inherited from the operator's environment.
      return {
        ...env,
        ...overrides,
        BUN_OPTIONS: overrides.BUN_OPTIONS ? `--no-env-file ${overrides.BUN_OPTIONS}` : env.BUN_OPTIONS,
        HOME: home,
        USERPROFILE: home,
      }
    }
    const parent = dirname(dir)
    if (parent === dir) throw new Error('Test commands require a disposable test sandbox')
    dir = parent
  }
}
