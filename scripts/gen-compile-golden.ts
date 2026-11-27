/**
 * Regenerates the COMPILER_VERSION guard golden (src/domain/compile/golden/compiler-<version>.json) from the
 * fixed fixture in src/domain/compile/golden-fixture.ts. Run after bumping COMPILER_VERSION for an intended
 * compile-output change; the guard test in src/domain/compile/compile.test.ts compares against this file.
 */
import {mkdir, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'

import {canonicalDocument} from '../src/domain/compile/canonical'
import {goldenGuardDocument} from '../src/domain/compile/golden-fixture'
import {COMPILER_VERSION} from '../src/domain/compile/version'

const path = join(import.meta.dir, '..', 'src', 'domain', 'compile', 'golden', `compiler-${COMPILER_VERSION}.json`)
await mkdir(dirname(path), {recursive: true})
await writeFile(path, canonicalDocument(goldenGuardDocument()))
console.log(`wrote ${path}`)
