import {chmod, mkdir, rename, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import type {Source} from '@domain/config/types'
import {hashContent} from '@domain/sync/state'
import {SKILL_DEPLOY} from '@e2e/fixtures'
import {createBareRepo} from '@e2e/framework/git'

import {testEnvironment} from '../../../../scripts/test-sandbox'
import {command, config, protectedBytes} from './helpers'

const dir = useTmpDir('source-failure-matrix')
for (const kind of [
  'local-missing',
  'local-file',
  'git-clone',
  'git-branch',
  'git-subdir-missing',
  'git-subdir-file',
  'git-fetch',
  'git-read',
  'local-read',
])
  for (const mode of ['alone', 'all-failed', 'changed-neighbor'])
    it(`BR-01 real ${kind} ${mode} preserves protected bytes and collects every outcome (AC-2)`, async () => {
      const root = dir(),
        good = join(root, 'good'),
        denied = join(root, 'denied'),
        file = join(root, 'file')
      await mkdir(join(good, 'skills'), {recursive: true})
      await mkdir(join(denied, 'skills'), {recursive: true})
      await writeFile(join(good, 'skills/b.md'), '# Before')
      await writeFile(join(denied, 'skills/a.md'), '# Denied')
      await writeFile(file, 'not a directory')
      const goodSource = {name: 'good', type: 'local', path: good}
      await config(root, [goodSource])
      expect((await command(root)).exitCode).toBe(0)
      const repo = kind.startsWith('git-') ? await createBareRepo(root, {'skills/deploy.md': SKILL_DEPLOY}) : ''
      const bad: Source = kind.startsWith('local-')
        ? {
            name: 'alpha',
            type: 'local',
            path: kind === 'local-file' ? file : kind === 'local-read' ? denied : join(root, 'missing'),
          }
        : {
            name: 'alpha',
            type: 'git',
            url: kind === 'git-clone' ? join(root, 'no-repo.git') : repo,
            branch: kind === 'git-branch' ? 'no-branch' : 'main',
            ...(kind === 'git-subdir-file'
              ? {path: 'skills/deploy.md'}
              : kind === 'git-subdir-missing'
                ? {path: 'missing'}
                : {}),
          }
      if (kind === 'git-fetch' || kind === 'git-read') {
        await config(root, [bad])
        expect((await command(root)).exitCode).toBe(0)
        if (kind === 'git-fetch') await rename(repo, repo + '-unavailable')
      }
      await writeFile(join(good, 'skills/b.md'), '# Changed neighbor')
      const sources = [
        bad,
        ...(mode === 'all-failed'
          ? [{name: 'beta', type: 'local', path: join(root, 'also-missing')}]
          : mode === 'changed-neighbor'
            ? [goodSource]
            : []),
      ]
      await config(root, sources)
      const before = await protectedBytes(root)
      if (kind === 'local-read') await chmod(denied, 0)
      const cached = join(testEnvironment(root).TMPDIR, 'forge-cache', hashContent(`${repo}#main`), 'read-denied')
      if (kind === 'git-read') {
        // Untracked cache content survives reset --hard, so this genuinely tests
        // source scanning rather than chmod that Git legitimately repairs.
        await mkdir(cached)
        await writeFile(join(cached, 'fixture.md'), 'unreadable cache fixture')
        await chmod(cached, 0)
      }
      try {
        const result = await command(root)
        expect(result.exitCode).toBe(1)
        expect(result.stdout).toMatch(/Failed to fetch source "alpha": .+/)
        const start = result.stdout.indexOf('Failed to fetch source "alpha":')
        const next = result.stdout.indexOf('Syncing from source:', start)
        const diagnostic = result.stdout.slice(start, next < 0 ? undefined : next)
        const causes: Record<string, RegExp> = {
          'local-missing': /does not exist/i,
          'local-file': /not a directory/i,
          'local-read': /EACCES|Permission denied/i,
          'git-read': /EACCES|Permission denied/i,
          'git-clone': /clone|repository|not exist/i,
          'git-fetch': /fetch/i,
          'git-branch': /branch|no-branch/i,
          'git-subdir-missing': /directory|ENOENT|not exist/i,
          'git-subdir-file': /directory/i,
        }
        expect(diagnostic).toMatch(causes[kind])
        expect(result.stdout).toContain('dry-run')
        if (kind === 'git-fetch') expect(result.stdout).toContain('fetch')
        if (kind === 'local-read' || kind === 'git-read') expect(result.stdout).toMatch(/EACCES|Permission denied/i)
        if (mode === 'all-failed')
          expect(result.stdout).toMatch(/Failed to fetch source "beta": Local source path does not exist:/)
        if (mode === 'changed-neighbor') {
          expect(result.stdout).toContain('Acquired "good"')
          expect(result.stdout).toContain('not yet installed')
        }
        expect(await protectedBytes(root)).toEqual(before)
      } finally {
        if (kind === 'local-read') await chmod(denied, 0o700)
        if (kind === 'git-read') await chmod(cached, 0o700)
      }
    })
