import {COMPONENT_KINDS as K} from '../../harnesses/types'
import type {DeliveredFiles, PluginFile, PluginPackage} from '../types'
import {PLUGIN_HARNESSES} from '../types'
import {emitCanonical, sortPluginFiles, textFile} from './canonical'

/** The plugin file the generated `SessionStart` hook prints; Droid adds a hook's plain stdout to the session context. */
export const FACTORY_RULES_FILE = 'forge/rules.md'
const HOOKS_FILE = 'hooks/hooks.json'
const RULES_HOOK = {hooks: [{type: 'command', command: 'cat "${CLAUDE_PLUGIN_ROOT}/' + FACTORY_RULES_FILE + '"'}]}

const decoder = new TextDecoder()
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/

function rulesText(pkg: PluginPackage): string | null {
  const rules = pkg.components[PLUGIN_HARNESSES.DROID].filter((component) => component.kind === K.RULE)
  if (!rules.length) return null
  const sections = rules.map(
    (rule) => `## ${rule.name}\n\n${decoder.decode(rule.files[0].content).replace(FRONTMATTER, '').trim()}\n`,
  )
  return `# Rules from the ${pkg.manifest.name} plugin\n\n${sections.join('\n')}`
}

function withRulesHook(hooks: PluginFile | undefined): PluginFile {
  const config = (hooks ? JSON.parse(decoder.decode(hooks.content)) : {}) as {hooks?: Record<string, unknown[]>}
  const events = (config.hooks ??= {})
  events.SessionStart = [...(events.SessionStart ?? []), RULES_HOOK]
  return textFile(HOOKS_FILE, JSON.stringify(config, null, 2) + '\n')
}

/**
 * The `factory` emitter (spec 0003 §5): the canonical layout, which Droid translates on install, plus the rules as a
 * generated `SessionStart` hook. Path-scoped rules become always-on; LSP servers and settings are dropped.
 */
export function emitFactory(pkg: PluginPackage): DeliveredFiles {
  const canonical = emitCanonical(pkg, PLUGIN_HARNESSES.DROID)
  const rules = rulesText(pkg)
  if (rules === null) return {plugin: canonical}
  const hooks = canonical.find((file) => file.path === HOOKS_FILE)
  return {
    plugin: sortPluginFiles([
      ...canonical.filter((file) => file !== hooks),
      withRulesHook(hooks),
      textFile(FACTORY_RULES_FILE, rules),
    ]),
  }
}
