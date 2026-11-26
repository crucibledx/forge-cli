import type {PluginComponent, PluginComponentKind, PluginHarnessId, PluginPackage} from './types'
import {PLUGIN_COMPONENT_KINDS as K, PLUGIN_HARNESS_IDS, PLUGIN_HARNESSES as H} from './types'

export const PORTABILITY_STATUSES = {ADAPTED: 'adapted', APPROXIMATED: 'approximated', DROPPED: 'dropped'} as const
export type PortabilityStatus = (typeof PORTABILITY_STATUSES)[keyof typeof PORTABILITY_STATUSES]

export interface PortabilityEntry {
  kind: PluginComponentKind
  name: string
  status: PortabilityStatus
  detail: string
}

type Adaptation = (component: PluginComponent, plugin: string) => Omit<PortabilityEntry, 'kind' | 'name'>
const S = PORTABILITY_STATUSES
const settingsDropped: Adaptation = () => ({
  status: S.DROPPED,
  detail: 'plugin default settings are not applied in v0.8',
})

/** Spec 0003 §2: every kind not listed here is native for that harness. */
const ADAPTATIONS: Record<PluginHarnessId, Partial<Record<PluginComponentKind, Adaptation>>> = {
  [H.CLAUDE_CODE]: {
    [K.RULE]: (rule, plugin) => ({
      status: S.ADAPTED,
      detail: `rule file .claude/rules/${plugin}--${rule.name}.md${rule.pathScoped ? ' (paths frontmatter kept)' : ''}`,
    }),
    [K.SETTING]: settingsDropped,
  },
  [H.DROID]: {
    [K.RULE]: (rule) =>
      rule.pathScoped
        ? {status: S.APPROXIMATED, detail: 'path-scoped rule delivered as always-on by the generated SessionStart hook'}
        : {status: S.ADAPTED, detail: 'generated SessionStart hook prints the rule text'},
    [K.LSP]: () => ({status: S.DROPPED, detail: 'Droid plugins do not load LSP servers'}),
    [K.SETTING]: settingsDropped,
  },
}

export function portabilityReport(pkg: PluginPackage): Record<PluginHarnessId, PortabilityEntry[]> {
  return Object.fromEntries(
    PLUGIN_HARNESS_IDS.map((harness) => [
      harness,
      pkg.components[harness].flatMap((component) => {
        const adapt = ADAPTATIONS[harness][component.kind]
        return adapt ? [{kind: component.kind, name: component.name, ...adapt(component, pkg.manifest.name)}] : []
      }),
    ]),
  ) as Record<PluginHarnessId, PortabilityEntry[]>
}
