import type {PluginHarnessId} from '../plugins/types'
import {PLUGIN_HARNESSES} from '../plugins/types'
import type {VersionSuffixStyle} from './version'
import {VERSION_SUFFIX_STYLES} from './version'

export interface CompileHarnessData {
  /** How the emitted version carries the compile suffix (spec 0005 §5, issue 1 spike). */
  versionSuffix: VersionSuffixStyle
}

/**
 * Harnesses with compile support. An enabled plugin harness missing here gets the
 * "compile is not supported for `<harness>` yet" report line and v0.8-identical output.
 *
 * Version-suffix spike (issue 1, recorded in the PR): Droid 1.12.1 re-installs a plugin when only the build
 * metadata of its version changes (verified with `droid plugin update` over a local marketplace), so the build
 * style refreshes it. No Claude Code CLI was available to spike; the prerelease style is precedence-significant,
 * so a compile suffix always refreshes there, and it keeps source build metadata intact.
 */
export const COMPILE_SUPPORT: Readonly<Partial<Record<PluginHarnessId, CompileHarnessData>>> = {
  [PLUGIN_HARNESSES.DROID]: {versionSuffix: VERSION_SUFFIX_STYLES.BUILD},
  [PLUGIN_HARNESSES.CLAUDE_CODE]: {versionSuffix: VERSION_SUFFIX_STYLES.PRERELEASE},
}
