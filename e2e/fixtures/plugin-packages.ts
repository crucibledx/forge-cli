import {join} from 'node:path'

export const PLUGIN_SCHEMA_ID = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'
/** Every component kind of spec 0003 §2; its expected portability report sits next to it. */
export const COVER_ALL_DIR = join(import.meta.dir, 'plugins', 'cover-all')
export const COVER_ALL_EXPECTED = join(import.meta.dir, 'plugins', 'cover-all.expected.json')

export const pluginManifest = (name: string, version: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({$schema: PLUGIN_SCHEMA_ID, name, version, ...extra}, null, 2) + '\n'

const helloPlugin = (version: string, body: string) => ({
  'plugins/hello/plugin.json': pluginManifest('hello', version),
  'plugins/hello/skills/hello/SKILL.md': `---\nname: hello\ndescription: Say hello.\n---\n\n${body}\n`,
})
/** Git fixture branches: the same plugin before and after an upstream change. */
export const HELLO_PLUGIN_V1 = helloPlugin('1.0.0', 'Hello v1')
export const HELLO_PLUGIN_V2 = helloPlugin('1.1.0', 'Hello v2')
