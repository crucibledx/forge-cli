import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'

import {protectedBytes} from '@test-helpers/sync-fixture'
import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'
import {parse, stringify} from 'yaml'

import {CLI_ENTRY} from '@e2e/framework/constants'
import {runPipe} from '@e2e/framework/pipe'

import {testEnvironment} from '../../../../scripts/test-sandbox'
import {command, config, readTree} from './helpers'

const dir = useTmpDir('raw-diagnostics')
it.each(
  ['private_token', 'client_secret', '%61pi_key'].flatMap((key) =>
    ['apply', 'silent', 'preview', 'silent-preview'].map((mode) => ({key, mode})),
  ),
)('AC-15,30 actual offline Git $key values cannot leak to debug/raw/report artifacts: $mode', async ({key, mode}) => {
  const root = dir(),
    secret = 'COMPOUND_OFFLINE_GIT_PRIVATE'
  await config(root, [
    {
      name: 'compound-credential-source',
      type: 'git',
      url: pathToFileURL(join(root, 'missing-local-bare')).href + `?${key}=${secret}`,
      branch: 'main',
    },
  ])
  const before = await protectedBytes(root)
  let raw = ''
  const result = await runPipe(
    root,
    [
      process.execPath,
      CLI_ENTRY,
      '--log-level',
      'debug',
      'sync',
      ...(mode.includes('silent') ? ['--silent'] : []),
      ...(mode.includes('preview') ? ['--dry-run'] : []),
    ],
    {
      inspectRaw: (stdout, stderr) => {
        raw = stdout + stderr
      },
    },
  )
  expect(result.exitCode).toBe(1)
  expect(await protectedBytes(root)).toEqual(before)
  if (mode.includes('silent')) expect(raw).toBe('')
  const home = testEnvironment(root).HOME
  expect(raw + (await readTree(join(home, '.crucible/forge')))).not.toContain(secret)
  if (mode.includes('preview')) expect(await readTree(join(home, '.crucible/forge/reports'))).toBe('')
  else {
    const latest = JSON.parse(await readFile(join(home, '.crucible/forge/reports/latest.json'), 'utf8'))
    expect(latest.success).toBe(false)
    expect(latest.synced ?? latest.files.synced).toBe(0)
  }
})
it.each(['apply', 'silent', 'preview', 'silent-preview'])(
  'AC-15,30 real offline Git double-quote query credentials stay private in every stream and artifact: %s',
  async (mode) => {
    const root = dir()
    await config(root, [
      {
        name: 'offline-credential-source',
        type: 'git',
        url: pathToFileURL(join(root, 'missing-bare')).href + '?token=prefix"DOUBLE_QUOTE_GIT_SUFFIX',
        branch: 'main',
      },
    ])
    const before = await protectedBytes(root)
    let raw = ''
    const result = await runPipe(
      root,
      [
        process.execPath,
        CLI_ENTRY,
        'sync',
        ...(mode.includes('silent') ? ['--silent'] : []),
        ...(mode.includes('preview') ? ['--dry-run'] : []),
      ],
      {
        inspectRaw: (stdout, stderr) => {
          raw = stdout + stderr
        },
      },
    )
    expect(result.exitCode).toBe(1)
    expect(await protectedBytes(root)).toEqual(before)
    if (mode.includes('silent')) expect(raw).toBe('')
    const artifacts = await readTree(join(testEnvironment(root).HOME, '.crucible/forge'))
    expect(raw + artifacts).not.toContain('DOUBLE_QUOTE_GIT_SUFFIX')
  },
)
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
