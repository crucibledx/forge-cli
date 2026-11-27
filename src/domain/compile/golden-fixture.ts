import {COMPILE_CONFIG_DEFAULTS} from '../config/types'
import type {PluginPackage} from '../plugins/types'
import {compile} from './compile'
import {COMPILE_SUPPORT} from './harness-data'
import {COMPILE_INPUT_PARTS, compileInputs} from './inputs'
import {compileManifestDocument} from './manifest'
import {COMPILER_VERSION} from './version'

const enc = (text: string) => new TextEncoder().encode(text)

/**
 * The fixed compile input of the COMPILER_VERSION guard (compile.test.ts): any change to the bytes compile and
 * emit produce shows up in the golden compiled from this fixture, so the guard fails until COMPILER_VERSION is
 * bumped and the golden regenerated (`bun scripts/gen-compile-golden.ts`).
 */
export const GOLDEN_PACKAGES: PluginPackage[] = [
  {
    manifest: {name: 'bravo', version: '2.1.0', forge: {}},
    files: [
      {
        path: 'skills/deploy/SKILL.md',
        content: enc('---\nname: deploy\ndescription: Deploy.\nrequires: [setup]\n---\n\nRun /setup first.\n'),
      },
      {path: 'agents/setup.md', content: enc('---\nname: setup\ndescription: Set up.\n---\n\nSetup.\n')},
    ],
    components: {
      droid: [
        {
          kind: 'skill',
          name: 'deploy',
          origin: '',
          root: 'skills/deploy',
          files: [
            {
              path: 'skills/deploy/SKILL.md',
              content: enc('---\nname: deploy\ndescription: Deploy.\nrequires: [setup]\n---\n\nRun /setup first.\n'),
            },
          ],
        },
        {
          kind: 'agent',
          name: 'setup',
          origin: '',
          root: 'agents/setup.md',
          files: [{path: 'agents/setup.md', content: enc('---\nname: setup\ndescription: Set up.\n---\n\nSetup.\n')}],
        },
      ],
      'claude-code': [],
    },
    warnings: [],
  },
  {
    manifest: {name: 'alpha', version: '1.0.0+vendor.1', forge: {}},
    files: [{path: 'commands/build.md', content: enc('---\nname: build\ndescription: Build.\n---\n\nBuild it.\n')}],
    components: {
      droid: [
        {
          kind: 'command',
          name: 'build',
          origin: '',
          root: 'commands/build.md',
          files: [
            {path: 'commands/build.md', content: enc('---\nname: build\ndescription: Build.\n---\n\nBuild it.\n')},
          ],
        },
      ],
      'claude-code': [],
    },
    warnings: [],
  },
]

/** The golden document: the droid unit's manifest over the golden packages, with the real inputs hash. */
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
