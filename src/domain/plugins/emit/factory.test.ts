import {dirname, join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {COVER_ALL_DIR} from '@e2e/fixtures/plugin-packages'

import {buildPluginPackage} from '../package'
import type {PluginFile, PluginManifest, PluginPackage} from '../types'
import {emitCanonical} from '.'
import {emitFactory, FACTORY_RULES_FILE} from './factory'

/** Golden output of the `factory` emitter for `cover-all`: file path to text. */
const COVER_ALL_FACTORY = join(dirname(COVER_ALL_DIR), 'cover-all.factory.json')

const decoder = new TextDecoder()
const file = (path: string, text: string): PluginFile => ({path, content: new TextEncoder().encode(text)})
const texts = (files: PluginFile[] = []) => Object.fromEntries(files.map((f) => [f.path, decoder.decode(f.content)]))
const manifest: PluginManifest = {name: 'demo', version: '1.0.0', forge: {}}

async function coverAll(): Promise<PluginPackage> {
  const files: PluginFile[] = []
  for await (const path of new Bun.Glob('**/*').scan({cwd: COVER_ALL_DIR, dot: true}))
    files.push({path: path.replaceAll('\\', '/'), content: await Bun.file(join(COVER_ALL_DIR, path)).bytes()})
  const raw = (await Bun.file(join(COVER_ALL_DIR, 'plugin.json')).json()) as PluginManifest
  return buildPluginPackage({name: raw.name, version: raw.version, description: raw.description, forge: {}}, files)
}

describe('AC-8 factory emitter', () => {
  it('reproduces its golden output from cover-all', async () => {
    const delivered = emitFactory(await coverAll())
    expect(delivered.claudeRules).toBeUndefined()
    expect(texts(delivered.plugin)).toEqual(await Bun.file(COVER_ALL_FACTORY).json())
  })

  it('emits no absolute path', async () => {
    for (const text of Object.values(texts(emitFactory(await coverAll()).plugin))) {
      expect(text).not.toContain(COVER_ALL_DIR)
      expect(text).not.toMatch(/(^|[\s"'=])(\/(Users|home|tmp|var|private)\/|[A-Za-z]:[\\/])/)
    }
  })

  it('is the canonical layout plus the rules hook, merged into the package hooks', async () => {
    const pkg = await coverAll()
    const factory = texts(emitFactory(pkg).plugin)
    const canonical = texts(emitCanonical(pkg, 'droid'))
    const hooks = JSON.parse(factory['hooks/hooks.json']) as {hooks: {SessionStart: unknown[]}}
    const original = JSON.parse(canonical['hooks/hooks.json']) as {hooks: {SessionStart: unknown[]}}
    expect(hooks.hooks.SessionStart.slice(0, -1)).toEqual(original.hooks.SessionStart)
    expect(JSON.stringify(hooks.hooks.SessionStart.at(-1))).toContain(FACTORY_RULES_FILE)
    delete factory['hooks/hooks.json']
    delete factory[FACTORY_RULES_FILE]
    delete canonical['hooks/hooks.json']
    expect(factory).toEqual(canonical)
  })

  it('creates the hooks file when the package has none, and prints every rule without frontmatter', () => {
    const pkg = buildPluginPackage(manifest, [
      file('plugin.json', '{}'),
      file('dev.crucibledx.forge/rules/api.md', "---\npaths:\n  - 'src/**'\n---\n\nUse schemas.\n"),
      file('dev.crucibledx.forge/rules/style.md', 'Be brief.\n'),
    ])
    const out = texts(emitFactory(pkg).plugin)
    expect(Object.keys(out)).toEqual(['.claude-plugin/plugin.json', FACTORY_RULES_FILE, 'hooks/hooks.json'])
    expect(out[FACTORY_RULES_FILE]).toBe(
      '# Rules from the demo plugin\n\n## api\n\nUse schemas.\n\n## style\n\nBe brief.\n',
    )
    expect(JSON.parse(out['hooks/hooks.json']).hooks.SessionStart).toHaveLength(1)
  })

  it('adds nothing to a package without rules', () => {
    const pkg = buildPluginPackage(manifest, [file('plugin.json', '{}'), file('skills/a/SKILL.md', 'a')])
    expect(emitFactory(pkg).plugin).toEqual(emitCanonical(pkg, 'droid'))
  })
})
