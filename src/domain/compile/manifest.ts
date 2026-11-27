import type {PluginHarnessId, PluginScope} from '../plugins/types'
import {canonicalDocument} from './canonical'
import type {CompileManifest, ManifestComponent} from './types'

/** The compile manifest document (spec 0005 §5): canonical JSON, no timestamps, no per-machine value. */
export function compileManifestDocument(input: {
  harness: PluginHarnessId
  scope: PluginScope
  enabled: boolean
  compiler: number
  inputs: string
  components: ManifestComponent[]
  variant: string
}): CompileManifest {
  return {
    schema: 1,
    harness: input.harness,
    scope: input.scope,
    enabled: input.enabled,
    compiler: input.compiler,
    inputs: input.inputs,
    components: input.components,
    budget: null,
    profile: null,
    variant: input.variant,
  }
}

export const serializeCompileManifest = (manifest: CompileManifest): string => canonicalDocument(manifest)
