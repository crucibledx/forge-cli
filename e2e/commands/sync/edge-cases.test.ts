/**
 * E2E tests for `forge sync` edge cases and error handling.
 *
 * Covers: missing config, disabled assistants, nonexistent source path,
 * special characters in filenames, large file counts.
 */

import {readdirSync} from 'node:fs'
import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {buildConfigYaml, readTarget, setupLocalSync, writeConfig} from '../../fixtures'
import {runSync, useTmpDir} from '../../framework'

const getDir = useTmpDir('forge-sync-edge')

// ─── Helpers ─────────────────────────────────────────────────────────────────

function countFilesRecursive(dir: string): number {
  let count = 0
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    if (entry.isDirectory()) count += countFilesRecursive(join(dir, entry.name))
    else count++
  }
  return count
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('forge sync — edge cases', () => {
  // ─── Missing / invalid config ────────────────────────────────────────────

  it('exits with error when no config file exists', async () => {
    const dir = getDir()
    const {exitCode} = await runSync(dir)
    expect(exitCode).not.toBe(0)
  })

  it('exits with error when no sources are configured', async () => {
    const dir = getDir()
    await writeConfig(dir, buildConfigYaml({assistants: ['claude-code']}))

    const {exitCode, output} = await runSync(dir)
    expect(exitCode).not.toBe(0)
    expect(output).toContain('No source')
  })

  it('exits with error when all assistants are disabled', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')
    const yaml = [
      'version: "1"',
      'assistants:',
      '  - id: claude-code',
      '    enabled: false',
      'sources:',
      '  - name: s',
      '    type: local',
      `    path: "${sourceDir}"`,
      '',
    ].join('\n')
    await writeConfig(dir, yaml)

    const {exitCode, output} = await runSync(dir)
    expect(exitCode).not.toBe(0)
    expect(output).toContain('No assistants')
  })

  it('handles nonexistent source path gracefully', async () => {
    const dir = getDir()
    await writeConfig(
      dir,
      buildConfigYaml({assistants: ['claude-code'], localSource: {path: join(dir, 'does-not-exist')}}),
    )

    const {exitCode} = await runSync(dir)
    expect(exitCode).toBe(0)
  })

  // ─── Special characters ──────────────────────────────────────────────────

  it('syncs files with spaces in filenames', async () => {
    const dir = getDir()
    await setupLocalSync(dir, ['claude-code'], {skills: {'my skill.md': '# Spaced'}})

    await runSync(dir)

    expect(await readTarget(dir, '.claude/skills/my skill.md')).toBe('# Spaced')
  })

  it('syncs files in nested subdirectories', async () => {
    const dir = getDir()
    await setupLocalSync(dir, ['claude-code'], {skills: {'cloud/aws/deploy.md': '# AWS Deploy'}})

    await runSync(dir)

    expect(await readTarget(dir, '.claude/skills/cloud/aws/deploy.md')).toBe('# AWS Deploy')
  })

  // ─── Performance ─────────────────────────────────────────────────────────

  it('syncs 50 files without timeout', async () => {
    const dir = getDir()
    const skills: Record<string, string> = {}
    for (let i = 0; i < 50; i++) {
      skills[`skill-${i}.md`] = `# Skill ${i}`
    }
    await setupLocalSync(dir, ['claude-code'], {skills})

    const {exitCode, output} = await runSync(dir)
    expect(exitCode).toBe(0)
    expect(output).toContain('50 files synced')

    const filesOnDisk = countFilesRecursive(join(dir, '.claude/skills'))
    expect(filesOnDisk).toBe(50)
  })
})
