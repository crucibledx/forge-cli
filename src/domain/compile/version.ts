import {compare} from '../plugins/package'

/** Covers every byte compile and emit produce for a compiled harness; bump when either changes (§5). */
export const COMPILER_VERSION = 1

/** SemVer 2.0.0 with the optional prerelease and build groups captured (same shape as SEMVER in the plugin schema). */
const SEMVER_PARSE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

export const VERSION_SUFFIX_STYLES = {BUILD: 'build', PRERELEASE: 'prerelease'} as const
export type VersionSuffixStyle = (typeof VERSION_SUFFIX_STYLES)[keyof typeof VERSION_SUFFIX_STYLES]

/**
 * The emitted version of a compiled plugin (spec 0005 §5): the source version rebuilt from parsed SemVer fields
 * with the compile suffix appended. Build style keeps precedence: `1.2.3` → `1.2.3+c.deadbee5`,
 * `1.2.3+vendor.1` → `1.2.3+vendor.1.c.deadbee5`. Prerelease style appends to the prerelease instead and keeps
 * source build metadata: `1.2.3` → `1.2.3-c.deadbee5`, `1.2.3-rc.1+vendor.1` → `1.2.3-rc.1.c.deadbee5+vendor.1`.
 */
export function emittedVersion(source: string, suffix: string, style: VersionSuffixStyle): string {
  const parsed = SEMVER_PARSE.exec(source)
  if (!parsed) throw new Error(`Cannot build an emitted version from non-SemVer source version: ${source}`)
  const [, major, minor, patch, prerelease, build] = parsed
  const tag = `c.${suffix}`
  const pre = style === VERSION_SUFFIX_STYLES.PRERELEASE ? (prerelease ? `${prerelease}.${tag}` : tag) : prerelease
  const meta = style === VERSION_SUFFIX_STYLES.BUILD ? (build ? `${build}.${tag}` : tag) : build
  return `${major}.${minor}.${patch}${pre ? `-${pre}` : ''}${meta ? `+${meta}` : ''}`
}

/** First 8 hex of a hash, the emitted-version suffix (spec 0005 §5). */
export const versionSuffix = (hash: string): string => hash.slice(0, 8)

/** Deterministic ordering for compile records. */
export const compareIds = compare
// appended to src/domain/compile/version.ts

const decoder = new TextDecoder()
const encoder = new TextEncoder()
const CANONICAL_MANIFEST = '.claude-plugin/plugin.json'

/**
 * Stamps the emitted version into a delivered tree (spec 0005 §5): the canonical manifest is the only file that
 * carries the version. `outputs[<harness>]` is then hashed over these final bytes.
 */
export function applyEmittedVersion(
  files: readonly {path: string; content: Uint8Array; executable?: boolean}[],
  version: string,
) {
  return files.map((file) => {
    if (file.path !== CANONICAL_MANIFEST) return file
    const manifest = JSON.parse(decoder.decode(file.content)) as Record<string, unknown>
    manifest.version = version
    return {...file, content: encoder.encode(JSON.stringify(manifest, null, 2) + '\n')}
  })
}
