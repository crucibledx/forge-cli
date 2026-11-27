import {createHash} from 'node:crypto'

import {describe, expect, it} from 'bun:test'

import {
  buildPluginLock,
  buildPluginPackage,
  computeVariants,
  decideLockAction,
  hashDelivered,
  hashPluginFiles,
  lockedSource,
  type PluginFile,
  type PluginLockEntry,
  type PluginManifest,
  portabilityReport,
} from '.'

const file = (path: string, text: string | Uint8Array): PluginFile => ({
  path,
  content: typeof text === 'string' ? Buffer.from(text) : text,
})
const manifest: PluginManifest = {name: 'demo', version: '1.0.0', forge: {}}

describe('skills-lock v2 content hash', () => {
  it('frames sorted files as path NUL length NUL content', () => {
    const expected = createHash('sha256').update('a.md\x002\x00A\n').update('b/c.md\x001\x00C').digest('hex')
    expect(hashPluginFiles([file('b/c.md', 'C'), file('a.md', 'A\n')])).toBe(expected)
  })
  it('hashes CRLF text as LF but leaves binary files untouched', () => {
    expect(hashPluginFiles([file('a.md', 'x\r\ny')])).toBe(hashPluginFiles([file('a.md', 'x\ny')]))
    const binary = Buffer.from([0, 13, 10])
    expect(hashPluginFiles([file('a.bin', binary)])).not.toBe(hashPluginFiles([file('a.bin', Buffer.from([0, 10]))]))
  })
  it('keys delivered files by scope-independent destination', () => {
    const rule = file('demo--style.md', 'rule')
    expect(hashDelivered({plugin: [], claudeRules: [rule]})).toBe(
      hashPluginFiles([file('claude-rules/demo--style.md', 'rule')]),
    )
    expect(hashDelivered({plugin: [rule]})).not.toBe(hashDelivered({plugin: [], claudeRules: [rule]}))
  })
})

describe('plugin package model', () => {
  const files = [
    file('plugin.json', '{}'),
    file('skills/hello/SKILL.md', 'hi'),
    file('skills/empty/notes.md', 'no skill file'),
    file('mcp.json', '{}'),
    file('commands/ignored.md', 'portable root has no commands'),
    file('dev.crucibledx.forge/commands/review.md', 'forge body'),
    file('dev.crucibledx.forge/rules/api.md', '---\npaths:\n  - "src/**"\n---\nrule'),
    file('dev.crucibledx.forge/notes.txt', 'stray'),
    file('com.anthropic/commands/review.md', 'claude body'),
    file('ai.factory/lsp.json', '{}'),
  ]
  const pkg = buildPluginPackage(manifest, files)
  const body = (harness: 'claude-code' | 'droid', kind: string) =>
    pkg.components[harness].filter((c) => c.kind === kind).map((c) => new TextDecoder().decode(c.files[0].content))

  it('resolves vendor folder over dev.crucibledx.forge over portable, per harness', () => {
    expect(body('claude-code', 'command')).toEqual(['claude body'])
    expect(body('droid', 'command')).toEqual(['forge body'])
    expect(pkg.components.droid.map((c) => `${c.kind}:${c.name}`)).toEqual([
      'command:review',
      'lsp:lsp',
      'mcp:mcp',
      'rule:api',
      'skill:hello',
    ])
    expect(pkg.components['claude-code'].some((c) => c.kind === 'lsp')).toBe(false)
  })
  it('warns about skills without SKILL.md, non-portable root components and unrecognized namespace files', () => {
    expect(pkg.warnings).toEqual([
      'commands/ignored.md: command is not portable; move it under dev.crucibledx.forge/ (ignored)',
      'Unrecognized file in dev.crucibledx.forge/: notes.txt (ignored)',
      'skills/empty has no SKILL.md (ignored)',
    ])
  })
  it('reports path-scoped rules as approximated for Droid and adapted for Claude Code', () => {
    const report = portabilityReport(pkg)
    expect(report['claude-code']).toEqual([
      {
        kind: 'rule',
        name: 'api',
        status: 'adapted',
        detail: 'rule file .claude/rules/demo--api.md (paths frontmatter kept)',
      },
    ])
    expect(report.droid.map((entry) => `${entry.status} ${entry.kind}`)).toEqual(['dropped lsp', 'approximated rule'])
  })
  it.each([
    ['a flow mapping', '---\n{paths: ["src/**"]}\n---\nrule'],
    ['a double-quoted key', '---\n"paths": ["src/**"]\n---\nrule'],
    ['a single-quoted key', "---\n'paths':\n  - src/**\n---\nrule"],
    ['a block mapping', '---\ndescription: API\npaths:\n  - src/**\n---\nrule'],
  ])('detects paths frontmatter written as %s', (_, text) => {
    const scoped = buildPluginPackage(manifest, [file('dev.crucibledx.forge/rules/api.md', text)])
    expect(scoped.components.droid[0].pathScoped).toBe(true)
  })
  it.each([
    ['a nested key', '---\nmeta:\n  paths: [x]\n---\nrule'],
    ['a block scalar line', '---\ndescription: |\n  paths: x\n---\nrule'],
    ['no frontmatter', 'paths: x\n'],
  ])('does not treat %s as path scope', (_, text) => {
    const scoped = buildPluginPackage(manifest, [file('dev.crucibledx.forge/rules/api.md', text)])
    expect(scoped.components.droid[0].pathScoped).toBe(false)
  })
})

describe('lock model', () => {
  const entry = (name: string, outputs: Record<string, string>): PluginLockEntry => ({
    name,
    version: '1.0.0',
    source: {type: 'local', path: name},
    contentHash: 'a'.repeat(64),
    outputs,
  })
  it('AC-5 variants follow the section 4 formula and ignore entry order', () => {
    const [a, b] = [
      entry('a', {droid: '1'.repeat(64)}),
      entry('b', {droid: '2'.repeat(64), 'claude-code': '3'.repeat(64)}),
    ]
    const lines = `a@1.0.0 ${'1'.repeat(64)}\nb@1.0.0 ${'2'.repeat(64)}\n`
    expect(computeVariants([b, a])).toEqual({
      'claude-code': `sha256:${createHash('sha256')
        .update(`b@1.0.0 ${'3'.repeat(64)}\n`)
        .digest('hex')}`,
      droid: `sha256:${createHash('sha256').update(lines).digest('hex')}`,
    })
    expect(JSON.stringify(buildPluginLock([b, a]))).toBe(JSON.stringify(buildPluginLock([a, b])))
  })
  it('AC-2 defaults ref to main and treats branch as its alias', () => {
    expect(lockedSource({type: 'git', url: 'u'})).toEqual({type: 'git', url: 'u', ref: 'main'})
    expect(lockedSource({type: 'git', url: 'u', branch: 'dev'})).toEqual({type: 'git', url: 'u', ref: 'dev'})
  })
  it('AC-4 resolves without an entry, keeps the lock on an equal descriptor, relocks on a changed one', () => {
    const locked: PluginLockEntry = {
      ...entry('p', {}),
      source: {type: 'git', url: 'u', ref: 'main'},
      resolved: 'f'.repeat(40),
    }
    const config = (source: object) => ({name: 'p', source: {type: 'git' as const, url: 'u', ...source}})
    expect(decideLockAction(config({}))).toEqual({action: 'resolve'})
    expect(decideLockAction(config({branch: 'main'}), locked)).toEqual({action: 'locked'})
    expect(decideLockAction(config({ref: 'v2'}), locked)).toEqual({
      action: 'relock',
      reason: 'source descriptor changed',
    })
  })
})
