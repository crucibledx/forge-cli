import {COMPONENT_KINDS as K} from '../../harnesses/types'
import type {DeliveredFiles, PluginFile, PluginPackage} from '../types'
import {PLUGIN_HARNESSES} from '../types'
import {emitCanonical, mapPluginVariables, sortPluginFiles, textFile} from './canonical'

/** The forge-owned rule file a Claude Code plugin rule becomes, in `.claude/rules/` or `~/.claude/rules/`. */
export const claudeRuleFileName = (plugin: string, rule: string) => `${plugin}--${rule}.md`

/**
 * The `claude` emitter: the canonical layout plus `.lsp.json`, with rules delivered as rule files outside the plugin
 * (`paths` frontmatter kept) and settings dropped.
 */
export function emitClaude(pkg: PluginPackage): DeliveredFiles {
  const components = pkg.components[PLUGIN_HARNESSES.CLAUDE_CODE]
  const lsp = components
    .filter((component) => component.kind === K.LSP)
    .map((component) => textFile('.lsp.json', mapPluginVariables(new TextDecoder().decode(component.files[0].content))))
  const claudeRules = components
    .filter((component) => component.kind === K.RULE)
    .map((rule): PluginFile => ({
      path: claudeRuleFileName(pkg.manifest.name, rule.name),
      content: rule.files[0].content,
    }))
  return {
    plugin: sortPluginFiles([...emitCanonical(pkg, PLUGIN_HARNESSES.CLAUDE_CODE), ...lsp]),
    claudeRules: sortPluginFiles(claudeRules),
  }
}
