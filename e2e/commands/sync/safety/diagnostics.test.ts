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
