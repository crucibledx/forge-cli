import {createHash} from 'node:crypto'

import {COMPILE_CONFIG_DEFAULTS} from '../config/types'
import {getHarness} from '../harnesses'
import {PLUGIN_EMITTERS} from '../plugins/emitters'
import {hashDelivered} from '../plugins/hash'
import type {DeliveredFiles, PluginComponent, PluginPackage} from '../plugins/types'
import {PLUGIN_HARNESS_IDS} from '../plugins/types'
import {compile} from './compile'
import {COMPILE_SUPPORT} from './harness-data'
import {COMPILE_INPUT_PARTS, compileInputs} from './inputs'
import {compileManifestDocument} from './manifest'
import {applyEmittedVersion, COMPILER_VERSION, emittedVersion, versionSuffix} from './version'

const enc = (text: string) => new TextEncoder().encode(text)

const component = (
  kind: PluginComponent['kind'],
  name: string,
  text: string,
  root: string,
  path: string,
): PluginComponent => ({kind, name, origin: '', root, files: [{path, content: enc(text)}]})

const deploySkill = () =>
  component(
    'skill',
    'deploy',
    '---\nname: deploy\ndescription: Deploy.\nrequires: [setup]\n---\n\nRun /setup first.\n',
    'skills/deploy',
    'skills/deploy/SKILL.md',
  )
const setupAgent = () =>
  component(
    'agent',
    'setup',
    '---\nname: setup\ndescription: Set up.\n---\n\nSetup.\n',
    'agents/setup.md',
    'agents/setup.md',
  )
const buildCommand = () =>
  component(
    'command',
    'build',
    '---\nname: build\ndescription: Build.\n---\n\nBuild it.\n',
    'commands/build.md',
    'commands/build.md',
  )

/**
 * The fixed compile input of the COMPILER_VERSION guard (compile.test.ts): any change to the bytes compile and
 * emit produce shows up in the golden compiled from this fixture, so the guard fails until COMPILER_VERSION is
 * bumped and the golden regenerated (`bun scripts/gen-compile-golden.ts`).
 */
export const GOLDEN_PACKAGES: PluginPackage[] = [
  {
    manifest: {name: 'bravo', version: '2.1.0', forge: {}},
    files: [deploySkill().files[0], setupAgent().files[0]],
    components: {
      droid: [deploySkill(), setupAgent()],
      'claude-code': [deploySkill(), setupAgent()],
    },
    warnings: [],
  },
  {
    manifest: {name: 'alpha', version: '1.0.0+vendor.1', forge: {}},
    files: [buildCommand().files[0]],
    components: {
      droid: [buildCommand()],
      'claude-code': [buildCommand()],
    },
    warnings: [],
  },
]

/** The golden document's manifest: the droid unit's manifest over the golden packages, with the real inputs hash. */
export function goldenManifestDocument() {
  const result = compile({
    packages: GOLDEN_PACKAGES,
    harness: 'droid',
    scope: 'project',
    config: COMPILE_CONFIG_DEFAULTS,
  })
  const inputs = compileInputs({
    config: COMPILE_CONFIG_DEFAULTS,
    harnessData: COMPILE_SUPPORT.droid,
    compilerVersion: COMPILER_VERSION,
    plugins: GOLDEN_PACKAGES.map((pkg) => ({name: pkg.manifest.name, contentHash: '0'.repeat(64)})),
  })
  if (
    Object.keys(inputs.parts).sort().join(',') !==
    [COMPILE_INPUT_PARTS.COMPILER, COMPILE_INPUT_PARTS.CONFIG, COMPILE_INPUT_PARTS.PLUGINS].sort().join(',')
  )
    throw new Error('compile input parts drifted from the documented table')
  return compileManifestDocument({
    harness: 'droid',
    scope: 'project',
    enabled: true,
    compiler: COMPILER_VERSION,
    inputs: inputs.hash,
    components: result.components,
    variant: 'sha256:' + '0'.repeat(64),
  })
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** Canonical `path sha256` lines of a delivered tree: plugin files under plugin/, Claude rules under rules/. */
const treeLines = (delivered: DeliveredFiles) =>
  [
    ...delivered.plugin.map((file) => `plugin/${file.path} ${sha256(file.content)}`),
    ...(delivered.claudeRules ?? []).map((file) => `rules/${file.path} ${sha256(file.content)}`),
  ].sort()

/**
 * The document the COMPILER_VERSION guard compares against the golden: the droid unit's manifest plus, for every
 * harness with compile support, the canonical bytes of each golden package's emitted tree — unstamped, and with
 * the emitted version stamped the way the engine does when a compile changes bytes. Any change to the bytes
 * compile and emit produce changes this document, failing the guard until COMPILER_VERSION is bumped (§5).
 */
export function goldenGuardDocument() {
  const trees: Record<string, unknown> = {}
  for (const harness of PLUGIN_HARNESS_IDS) {
    const support = COMPILE_SUPPORT[harness]
    const emitterName = getHarness(harness).plugin?.emit
    if (!support || !emitterName) continue
    const emitter = PLUGIN_EMITTERS[emitterName]
    trees[harness] = GOLDEN_PACKAGES.map((pkg) => {
      const delivered = emitter(pkg)
      const emitted = emittedVersion(
        pkg.manifest.version,
        versionSuffix(hashDelivered(delivered)),
        support.versionSuffix,
      )
      return {
        name: pkg.manifest.name,
        unstamped: treeLines(delivered),
        stamped: {
          version: emitted,
          files: treeLines({...delivered, plugin: applyEmittedVersion(delivered.plugin, emitted)}),
        },
      }
    })
  }
  return {compiler: COMPILER_VERSION, manifest: goldenManifestDocument(), trees}
}
