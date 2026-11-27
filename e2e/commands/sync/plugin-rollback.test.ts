/**
 * E2E test for keyed-merge rollback (spec 0003 §5, AC-14): a real `forge sync` plugin install whose commit fails
 * after the forge-owned cache and lock writes leaves the project exactly as before, keyed settings merge included.
 *
 * The planning-level half lives in src/application/commands/sync/keyed-rollback.test.ts.
 */

import {chmod, mkdir, readdir, readFile, stat, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {buildConfigYaml, writeConfig, writeSourceTree} from '@e2e/fixtures'
import {pluginManifest} from '@e2e/fixtures/plugin-packages'
import {runCommand, useTmpDir} from '@e2e/framework'

const getDir = useTmpDir('forge-sync-plugin-rollback')

/** Content and POSIX mode of every file under root, for a full before/after comparison. */
async function snapshot(root: string): Promise<Record<string, {content: string; mode: number}>> {
  const files: Record<string, {content: string; mode: number}> = {}
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, {withFileTypes: true}).catch(() => [])) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile())
        files[path.slice(root.length + 1)] = {
          content: await readFile(path, 'utf8'),
          mode: (await stat(path)).mode & 0o777,
        }
    }
  }
  await walk(root)
  return files
}

describe('AC-14 rollback of a real plugin sync', () => {
  // Injected commit failure: FORGE_TEST_FAIL_COMMIT makes the named directory unwritable after the transaction
  // passed its write-feasibility pre-checks, so the keyed settings merge fails mid-commit, after the cache and
  // lockfile writes have already landed. POSIX modes only.
  it.skipIf(process.platform === 'win32')(
    'rolls every write back, keyed settings merge included, when a late commit step fails',
    async () => {
      const dir = getDir()
      const proj = join(dir, 'proj')
      const plugin = join(dir, 'plugin')
      await writeSourceTree(plugin, {
        'plugin.json': pluginManifest('hello', '1.0.0'),
        skills: {hello: {'SKILL.md': '---\nname: hello\ndescription: Say hello.\n---\n\nHello v1\n'}},
      })
      await writeConfig(
        proj,
        buildConfigYaml({assistants: ['droid']}) +
          `plugins:\n  - name: hello\n    source: {type: local, path: ${JSON.stringify(plugin)}}\n`,
      )
      await mkdir(join(proj, '.factory'), {recursive: true})
      await writeFile(join(proj, '.factory/settings.local.json'), '{\n  "model": "small"\n}\n')
      // A private 0700 install directory: the injection must restore this exact mode, not an assumed one.
      await chmod(join(proj, '.factory'), 0o700)
      const before = await snapshot(proj)

      const result = await runCommand(proj, 'sync', [], {FORGE_TEST_FAIL_COMMIT: '.factory'})
      expect(result.exitCode).toBe(1)
      expect(await snapshot(proj)).toEqual(before)
      expect((await stat(join(proj, '.factory'))).mode & 0o777).toBe(0o700)
    },
  )

  it.skipIf(process.platform === 'win32')(
    'refuses an injection target outside the sync root and changes nothing',
    async () => {
      const dir = getDir()
      const proj = join(dir, 'proj')
      const sibling = join(dir, 'sibling')
      await mkdir(sibling, {recursive: true})
      await writeFile(join(sibling, 'sentinel'), 'outside the sync root\n')
      await writeSourceTree(join(dir, 'src'), {skills: {'deploy.md': '# Deploy'}})
      await writeConfig(proj, buildConfigYaml({assistants: ['droid'], localSource: {path: join(dir, 'src')}}))
      const before = await snapshot(proj)
      const siblingMode = (await stat(sibling)).mode & 0o777

      const result = await runCommand(proj, 'sync', [], {FORGE_TEST_FAIL_COMMIT: '../sibling'})
      expect(result.exitCode).toBe(1)
      expect(result.output).toContain('Unsafe path')
      expect(await readFile(join(sibling, 'sentinel'), 'utf8')).toBe('outside the sync root\n')
      expect((await stat(sibling)).mode & 0o777).toBe(siblingMode)
      expect(await snapshot(proj)).toEqual(before)
    },
  )
})
