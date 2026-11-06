import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
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
export function createTestSandbox(prefix = 'forge-tests-', base = tmpdir()): TestSandbox {
  const root = mkdtempSync(join(base, prefix))
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
    GIT_ATTR_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ALLOW_PROTOCOL: 'file',
    NO_COLOR: '1',
  }
  if (process.platform === 'win32') {
    const executable = join(bin, 'schtasks.exe')
    if (windowsScheduler) writeFileSync(executable, windowsScheduler, {mode: 0o700})
    else {
      // Compile once with isolated env/cwd. Cache bytes, never a mutable shared
      // file/hardlink: disposing or modifying one fixture cannot affect another.
      const result = Bun.spawnSync([process.execPath, 'build', fake, '--compile', '--outfile', executable], {
        cwd: project,
        env,
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 30000,
      })
      if (result.exitCode !== 0) {
        rmSync(root, {recursive: true, force: true})
        throw new Error('Cannot build isolated scheduler backend')
      }
      windowsScheduler = readFileSync(executable)
    }
  }
  writeFileSync(join(root, '.forge-test-sandbox'), JSON.stringify(env), {mode: 0o600})
  return {root, project, env, dispose: () => rmSync(root, {recursive: true, force: true})}
}

/** Locate a per-test sandbox, including commands invoked from nested project directories. */
export function testEnvironment(cwd: string, overrides: Record<string, string> = {}): Record<string, string> {
  let dir = resolve(cwd)
  while (true) {
    try {
      const env: Record<string, string> = JSON.parse(readFileSync(join(dir, '.forge-test-sandbox'), 'utf8'))
      const home = overrides.HOME ?? env.HOME
      // Deliberate fixture overrides are not inherited from the operator's environment.
      return {...env, ...overrides, HOME: home, USERPROFILE: home}
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const parent = dirname(dir)
    if (parent === dir) throw new Error('Test commands require a disposable test sandbox')
    dir = parent
  }
}
