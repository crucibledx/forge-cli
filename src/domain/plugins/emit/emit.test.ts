import {dirname, join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {COVER_ALL_DIR} from '@e2e/fixtures/plugin-packages'

import {buildPluginPackage} from '../package'
import type {PluginFile, PluginManifest, PluginPackage} from '../types'
import {emitCanonical, emitClaude, mapPluginVariables} from '.'

/** Golden output of each emitter for `cover-all`: file path to text, per delivered location. */
const COVER_ALL_CLAUDE = join(dirname(COVER_ALL_DIR), 'cover-all.claude.json')

const decoder = new TextDecoder()
const file = (path: string, text: string, executable?: boolean): PluginFile => ({
  path,
  content: new TextEncoder().encode(text),
  ...(executable ? {executable} : {}),
})
const texts = (files: PluginFile[] = []) => Object.fromEntries(files.map((f) => [f.path, decoder.decode(f.content)]))
const manifest: PluginManifest = {name: 'demo', version: '1.0.0', forge: {}}
const braced = (name: string) => '${' + name + '}'

async function coverAll(): Promise<PluginPackage> {
  const files: PluginFile[] = []
  for await (const path of new Bun.Glob('**/*').scan({cwd: COVER_ALL_DIR, dot: true}))
    files.push({path: path.replaceAll('\\', '/'), content: await Bun.file(join(COVER_ALL_DIR, path)).bytes()})
  const raw = (await Bun.file(join(COVER_ALL_DIR, 'plugin.json')).json()) as PluginManifest
  return buildPluginPackage({name: raw.name, version: raw.version, description: raw.description, forge: {}}, files)
}

describe('AC-8 claude emitter', () => {
  it('reproduces its golden output from cover-all', async () => {
    const delivered = emitClaude(await coverAll())
    expect({plugin: texts(delivered.plugin), claudeRules: texts(delivered.claudeRules)}).toEqual(
      await Bun.file(COVER_ALL_CLAUDE).json(),
    )
  })

  it('emits no absolute path and no Agent Plugins variable', async () => {
    const delivered = emitClaude(await coverAll())
    for (const text of Object.values({...texts(delivered.plugin), ...texts(delivered.claudeRules)})) {
      expect(text).not.toContain(COVER_ALL_DIR)
      expect(text).not.toMatch(/(^|[\s"'=])(\/(Users|home|tmp|var|private)\/|[A-Za-z]:[\\/])/)
      expect(text).not.toContain(braced('PLUGIN_ROOT'))
      expect(text).not.toContain(braced('PLUGIN_DATA'))
    }
  })

  it('shares the canonical layout with Droid apart from LSP servers', async () => {
    const pkg = await coverAll()
    const claude = texts(emitClaude(pkg).plugin)
    delete claude['.lsp.json']
    expect(texts(emitCanonical(pkg, 'droid'))).toEqual(claude)
  })
})

describe('canonical layout', () => {
  const pkg = buildPluginPackage({...manifest, description: 'Demo'}, [
    file('plugin.json', '{}'),
    file('README.md', 'readme'),
    file('bin/tool', '#!/bin/sh', true),
    file('tests/case.md', 'not delivered'),
    file('commands/stray.md', 'portable root has no commands'),
    file('skills/hello/SKILL.md', 'hello'),
    file('skills/hello/scripts/run.sh', 'run', true),
    file('dev.crucibledx.forge/commands/review.md', 'forge body'),
    file('com.anthropic/commands/review.md', 'claude body'),
    file('ai.factory/commands/review.md', 'droid body'),
    file('dev.crucibledx.forge/hooks/hooks.json', `{"command": "${braced('PLUGIN_ROOT')}/hooks/check.sh"}`),
    file('dev.crucibledx.forge/hooks/check.sh', 'check', true),
    file('dev.crucibledx.forge/rules/style.md', 'rule'),
    file('dev.crucibledx.forge/settings.json', '{}'),
  ])

  it('places each harness view, ships assets as is and leaves package metadata out', () => {
    const claude = emitCanonical(pkg, 'claude-code')
    expect(claude.map((f) => f.path)).toEqual([
      '.claude-plugin/plugin.json',
      'README.md',
      'bin/tool',
      'commands/review.md',
      'hooks/check.sh',
      'hooks/hooks.json',
      'skills/hello/SKILL.md',
      'skills/hello/scripts/run.sh',
    ])
    expect(texts(claude)['commands/review.md']).toBe('claude body')
    expect(texts(emitCanonical(pkg, 'droid'))['commands/review.md']).toBe('droid body')
    expect(JSON.parse(texts(claude)['.claude-plugin/plugin.json'])).toEqual({
      name: 'demo',
      version: '1.0.0',
      description: 'Demo',
    })
  })

  it('keeps the executable bit of assets, skill and hook files', () => {
    const executable = emitCanonical(pkg, 'claude-code').filter((f) => f.executable)
    expect(executable.map((f) => f.path)).toEqual(['bin/tool', 'hooks/check.sh', 'skills/hello/scripts/run.sh'])
  })

  it('maps plugin-root variables in hook commands', () => {
    expect(texts(emitCanonical(pkg, 'claude-code'))['hooks/hooks.json']).toBe(
      `{"command": "${braced('CLAUDE_PLUGIN_ROOT')}/hooks/check.sh"}`,
    )
    expect(mapPluginVariables(`${braced('PLUGIN_DATA')} ${braced('CLAUDE_PLUGIN_ROOT')}`)).toBe(
      `${braced('CLAUDE_PLUGIN_DATA')} ${braced('CLAUDE_PLUGIN_ROOT')}`,
    )
  })

  it('delivers Claude rules outside the plugin, named after the plugin', () => {
    const delivered = emitClaude(pkg)
    expect(texts(delivered.claudeRules)).toEqual({'demo--style.md': 'rule'})
    expect(delivered.plugin.some((f) => f.path.includes('style') || f.path.includes('settings'))).toBe(false)
  })
})
