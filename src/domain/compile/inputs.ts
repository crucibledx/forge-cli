import {createHash} from 'node:crypto'

import type {CompileConfig} from '../config/types'
import {canonicalJson} from './canonical'
import {compareIds} from './version'

export const COMPILE_INPUT_PARTS = {CONFIG: 'config', COMPILER: 'compiler', PLUGINS: 'plugins'} as const
export type CompileInputPart = (typeof COMPILE_INPUT_PARTS)[keyof typeof COMPILE_INPUT_PARTS]

export interface CompileInputs {
  /** `sha256:…` over the canonical JSON of every part; the lock's `compile[<harness>].inputs`. */
  hash: string
  /** Per-part hashes, so a later compile can name the input that changed (§5 "recompiled for"). */
  parts: Record<CompileInputPart, string>
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/**
 * The compile inputs of one unit (spec 0005 §5): the effective compile config and harness data, the detected
 * profile tags when a profile is set, the compiler version and the unit's sorted `(name, contentHash)` pairs.
 * Scope, paths, config order and time never enter it.
 */
export function compileInputs(input: {
  config: CompileConfig
  harnessData: unknown
  compilerVersion: number
  plugins: ReadonlyArray<{name: string; contentHash: string}>
  /** The detected profile tags; hashed sorted, only when the config sets a profile. Issue 7 threads them. */
  profileTags?: readonly string[]
}): CompileInputs {
  const pairs = input.plugins.map((plugin) => [plugin.name, plugin.contentHash]).sort(([a], [b]) => compareIds(a, b))
  const parts: Record<CompileInputPart, string> = {
    [COMPILE_INPUT_PARTS.CONFIG]: sha256(
      canonicalJson({
        config: input.config,
        harnessData: input.harnessData,
        ...(input.config.profile === false ? {} : {profileTags: [...(input.profileTags ?? [])].sort(compareIds)}),
      }),
    ),
    [COMPILE_INPUT_PARTS.COMPILER]: sha256(String(input.compilerVersion)),
    [COMPILE_INPUT_PARTS.PLUGINS]: sha256(canonicalJson(pairs)),
  }
  return {hash: `sha256:${sha256(canonicalJson(parts))}`, parts}
}
