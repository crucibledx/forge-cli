import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'
import {parse, stringify} from 'yaml'

import {CLI_ENTRY} from '@e2e/framework/constants'
import {runPipe} from '@e2e/framework/pipe'

import {testEnvironment} from '../../../../scripts/test-sandbox'
import {command, config, readTree} from './helpers'

const dir = useTmpDir('raw-diagnostics')
it.each(
  ['osc52', 'osc-title', 'erase-screen', 'c1-osc'].flatMap((kind) => [false, true].map((preview) => ({kind, preview}))),
)(
  'AC-15,30 retained state path controls are inert in actual raw output: $kind, preview=$preview',
  async ({kind, preview}) => {
    const root = dir(),
      source = join(root, 'empty-upstream')
    await mkdir(source)
    await config(root, [{name: 'empty', type: 'local', path: source}], {keep_local: true})
    const controls: Record<string, string> = {
      osc52: '\x1b]52;c;YXR0YWNrZXI=\x07',
      'osc-title': '\x1b]0;untrusted-title\x1b\\',
      'erase-screen': '\x1b[2J',
      'c1-osc': '\x9d52;c;YXR0YWNrZXI=\x9c',
    }
    const path = 'unknown/visible-é' + controls[kind] + '.md'
    const statePath = join(root, '.crucible/sync-state.json')
    const original = JSON.stringify({
      version: 2,
      lastSync: '2026-11-07T00:00:00.000Z',
      files: {[path]: {hash: '0'.repeat(64), sourceName: 'empty', baseline: 'installed'}},
    })
    await writeFile(statePath, original)
    const configPath = join(root, '.crucible/forge.config.yaml'),
      beforeConfig = await readFile(configPath, 'utf8')
    let raw = ''
    const result = await runPipe(root, [process.execPath, CLI_ENTRY, 'sync', ...(preview ? ['--dry-run'] : [])], {
      inspectRaw: (stdout, stderr) => {
        raw = stdout + stderr
      },
    })
    expect(result.exitCode).toBe(0)
    expect(raw).toContain('Retaining tracked path')
    expect(raw).toContain('unknown/visible-é')
    expect(raw.includes(controls[kind])).toBe(false)
    expect(raw).toContain(kind === 'c1-osc' ? '\\u009d' : '\\u001b')
    const after = await readFile(statePath, 'utf8')
    const retainedPath = preview ? path : path.replaceAll('\\', '/')
    expect(Object.keys(JSON.parse(after).files)).toEqual([retainedPath])
    expect(JSON.parse(after).files[retainedPath]).toEqual(JSON.parse(original).files[path])
    if (preview) {
      expect(after).toBe(original)
      expect(await readFile(configPath, 'utf8')).toBe(beforeConfig)
    }
  },
)
it.each([
  'https://user:X_PERSISTED_PRIVATE',
  'https://X_PERSISTED_PRIVATE',
  'https://fixture.invalid?to\x1b[31mken=X_PERSISTED_PRIVATE&visible=yes',
])(
  'AC-15,30 actual handler stdout/latest/history/logs retain no unfinished/formatted credential: %s',
  async (value) => {
    const root = dir(),
      home = testEnvironment(root).HOME
    const program = `
    import {handlerFixture,protectedBytes} from ${JSON.stringify(join(import.meta.dir, '../../../../src/test-helpers/sync-fixture.ts'))};
    import {runSyncWithDependencies} from ${JSON.stringify(join(import.meta.dir, '../../../../src/application/commands/sync/handler.ts'))};
    const f=await handlerFixture(process.cwd()), before=await protectedBytes(process.cwd());
    await runSyncWithDependencies({dryRun:false,verbose:false,silent:false},{
      io:f.dependencies.io,loadSource:async()=>{throw new Error(${JSON.stringify('Git clone failed early: ' + value)})}
    });
    console.log('PROTECTED_UNCHANGED='+(JSON.stringify(before)===JSON.stringify(await protectedBytes(process.cwd()))));
  `
    let raw = ''
    const result = await runPipe(root, [process.execPath, '-e', program], {
      inspectRaw: (stdout, stderr) => {
        raw = stdout + stderr
      },
    })
    expect(result.exitCode).toBe(1)
    expect(raw).toContain('PROTECTED_UNCHANGED=true')
    const artifacts = raw + (await readTree(join(home, '.crucible/forge')))
    expect(artifacts).not.toContain('X_PERSISTED_PRIVATE')
    expect(artifacts).toContain('[redacted]')
    if (value.includes('visible=yes')) expect(artifacts).toContain('visible=yes')
    const latest = JSON.parse(await readFile(join(home, '.crucible/forge/reports/latest.json'), 'utf8'))
    expect(latest.success).toBe(false)
    expect(latest.files.synced).toBe(0)
  },
)
it.each(['https', 'ftp', 'ftps'].flatMap((scheme) => [false, true].map((silent) => ({scheme, silent}))))(
  'BR-01/06 raw streams/logs/reports redact $scheme credentials, silent=$silent, without harness masking (C4, AC-15)',
  async ({scheme, silent}) => {
    const root = dir(),
      home = testEnvironment(root).HOME
    await config(root, [
      {
        name: 'credential-source',
        type: 'git',
        url: `${scheme}://user:credential-sentinel@invalid.example/repo?token=query-sentinel`,
        branch: 'main',
      },
    ])
    let raw = ''
    const result = await runPipe(
      root,
      [process.execPath, CLI_ENTRY, '--log-level', 'debug', 'sync', ...(silent ? ['--silent'] : [])],
      {
        inspectRaw: (stdout, stderr) => {
          raw = stdout + stderr
        },
      },
    )
    expect(result.exitCode).toBe(1)
    if (silent) expect(raw).toBe('')
    const artifacts = raw + (await readTree(join(home, '.crucible/forge')))
    expect(artifacts).toContain('[redacted]')
    expect(artifacts).not.toContain('credential-sentinel')
    expect(artifacts).not.toContain('query-sentinel')
    const latest = JSON.parse(await readFile(join(home, '.crucible/forge/reports/latest.json'), 'utf8'))
    expect(latest.success).toBe(false)
    expect(latest.files.synced).toBe(0)
    expect(latest.error).toContain('credential-source')
  },
)
it('BR-06 report/log/telemetry storage errors preserve committed and failed exits, including silent mode (AC-15)', async () => {
  const root = dir(),
    home = testEnvironment(root).HOME,
    source = join(root, 'upstream')
  await mkdir(join(source, 'skills'), {recursive: true})
  await writeFile(join(source, 'skills/a.md'), '# A')
  await config(root, [{name: 'source', type: 'local', path: source}])
  const file = join(root, '.crucible/forge.config.yaml')
  const cfg = parse(await readFile(file, 'utf8'))
  cfg.telemetry = {enabled: true, backend: 'local'}
  await writeFile(file, stringify(cfg))
  await mkdir(join(home, '.crucible/forge'), {recursive: true})
  for (const name of ['logs', 'reports', 'telemetry'])
    await writeFile(join(home, '.crucible/forge', name), 'storage blocked')
  for (const silent of [false, true]) {
    const args = ['sync', ...(silent ? ['--silent'] : [])]
    const result = await command(root, args)
    expect(result.exitCode).toBe(0)
    expect(await readFile(join(root, '.claude/skills/a.md'), 'utf8')).toBe('# A')
    expect(result.stdout + result.stderr).not.toContain('Rollback')
    if (silent) {
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('')
    }
    const broken = parse(await readFile(file, 'utf8'))
    broken.sources[0].path = join(root, 'missing')
    await writeFile(file, stringify(broken))
    const failure = await command(root, args)
    expect(failure.exitCode).toBe(1)
    if (silent) {
      expect(failure.stdout).toBe('')
      expect(failure.stderr).toBe('')
    } else expect(failure.stdout + failure.stderr).toContain('source')
    await writeFile(file, stringify(cfg))
  }
})
