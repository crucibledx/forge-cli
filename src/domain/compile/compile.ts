import type {CompileConfig} from '../config/types'
import type {PluginHarnessId, PluginPackage, PluginScope} from '../plugins/types'
import {linkComponents} from './link'
import type {CompileResult, ManifestComponent} from './types'
import {COMPILE_STATUSES} from './types'

/**
 * The compile unit (spec 0005 §1): one compile per (harness, scope) over everything 0003 delivers to that
 * harness. Pure: no filesystem, process or network effects. This issue ships the link pass; normalize, dedupe,
 * profile, minify, budget and guardian land in their own issues. Every component a later pass leaves alone is
 * byte-identical to v0.8's output, so `changed` is false for every package here.
 */
export function compile(input: {
  packages: PluginPackage[]
  harness: PluginHarnessId
  scope: PluginScope
  config: CompileConfig
}): CompileResult {
  const linked = linkComponents(input.packages, input.harness)
  const diagnostics = new Map(linked.map((component) => [component.id, component.diagnostics]))
  const components: ManifestComponent[] = input.packages.flatMap((pkg) =>
    pkg.components[input.harness].map((component) => {
      const id = `${pkg.manifest.name}/${component.kind}/${component.name}`
      return {
        id,
        status: COMPILE_STATUSES.LISTED,
        reasons: [],
        cost: null,
        diagnostics: diagnostics.get(id) ?? [],
      }
    }),
  )
  components.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return {
    packages: input.packages.map((pkg) => ({pkg, changed: false})),
    links: Object.fromEntries(linked.map((component) => [component.id, component.deps])),
    components,
  }
}
