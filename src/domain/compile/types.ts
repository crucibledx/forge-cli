import type {PluginHarnessId, PluginPackage, PluginScope} from '../plugins/types'

export const COMPILE_STATUSES = {LISTED: 'listed', DEFERRED: 'deferred', PRUNED: 'pruned', INVALID: 'invalid'} as const
export type CompileStatus = (typeof COMPILE_STATUSES)[keyof typeof COMPILE_STATUSES]

/**
 * The closed diagnostic code table (docs/schemas/compile-manifest.v1.json). This issue ships the link pass;
 * later passes add their codes here and to the schema in the same PR.
 */
export const DIAGNOSTIC_CODES = {LINK_UNRESOLVED: 'link-unresolved'} as const
export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[keyof typeof DIAGNOSTIC_CODES]

export interface CompileDiagnostic {
  code: DiagnosticCode
  severity: 'error' | 'warning'
  message: string
}

/** One manifest row: a component of the unit with its compile outcome. */
export interface ManifestComponent {
  /** `<plugin>/<kind>/<name>`, stable across scopes and machines. */
  id: string
  status: CompileStatus
  reasons: string[]
  /** Listing entry cost in characters; null until the budget pass (issue 4) prices the listing. */
  cost: number | null
  diagnostics: CompileDiagnostic[]
}

/** The manifest document sync writes to `.crucible/compile/<harness>.json` (spec 0005 §5). */
export interface CompileManifest {
  schema: 1
  harness: PluginHarnessId
  scope: PluginScope
  enabled: boolean
  compiler: number
  /** `sha256:…` over the compile inputs (spec 0005 §5). */
  inputs: string
  components: ManifestComponent[]
  /** Budget outcome; null until issue 4. */
  budget: {used: number; limit: number | null; measuredCap: number | null} | null
  /** Profile evidence; null until issue 7. */
  profile: unknown | null
  /** The lock's `variants[<harness>]` this compile produced. */
  variant: string
}

/** A package after compile, with whether compile changed any byte of its output for the harness. */
export interface CompiledPackage {
  pkg: PluginPackage
  changed: boolean
}

export interface CompileResult {
  packages: CompiledPackage[]
  /** Dependency edges from the link pass: component id → the ids it depends on, sorted. */
  links: Record<string, string[]>
  components: ManifestComponent[]
}
