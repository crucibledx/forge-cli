import {mkdirSync, mkdtempSync, renameSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {
  catalogDropped,
  claudeInitPlugins,
  droidListed,
  droidListShows,
  fixtureRules,
  layoutChecks,
  selectJobs,
  sessionChecks,
  settingsChecks,
  settingsOf,
} from './plugin-load-check'
import {pluginLoadCheckJobs} from './validation-lanes'

const MARKETPLACE = 'crucible-forge-user'

/** A forge-shaped cache root holding one emitted cover-all tree for the harness, and the settings that point at it. */
function delivery(harness: 'claude-code' | 'droid') {
  const root = mkdtempSync(join(tmpdir(), 'load-check-layout-'))
  const tree = join(root, 'cover-all', '1.0.0', harness)
  mkdirSync(join(tree, '.claude-plugin'), {recursive: true})
  writeFileSync(join(tree, '.claude-plugin', 'plugin.json'), JSON.stringify({name: 'cover-all', version: '1.0.0'}))
  const catalogDir = join(root, harness === 'droid' ? '.factory-plugin' : '.claude-plugin')
  mkdirSync(catalogDir, {recursive: true})
  const catalog = {
    name: MARKETPLACE,
    plugins: [{name: 'cover-all', version: '1.0.0', source: `./cover-all/1.0.0/${harness}`}],
  }
  writeFileSync(join(catalogDir, 'marketplace.json'), JSON.stringify(catalog))
  const settings = {
    extraKnownMarketplaces: {
      [MARKETPLACE]: {source: {source: harness === 'droid' ? 'local' : 'directory', path: root}},
    },
    enabledPlugins: {[`cover-all@${MARKETPLACE}`]: true},
  }
  return {root, tree, catalogDir, catalog, settings}
}

const failing = (checks: {check: string; ok: boolean}[]) => checks.filter((item) => !item.ok).map((item) => item.check)

describe('plugin load check (spec 0004)', () => {
  it('0004-AC-1 runs one job per harness and scope, selectable from the CI matrix env', () => {
    expect(selectJobs({})).toEqual([...pluginLoadCheckJobs])
    expect(selectJobs({LOAD_CHECK_HARNESS: 'droid', LOAD_CHECK_SCOPE: 'project'})).toEqual([
      {harness: 'droid', scope: 'project'},
    ])
    expect(() => selectJobs({LOAD_CHECK_HARNESS: 'cursor'})).toThrow('No load-check job')
  })

  for (const harness of ['claude-code', 'droid'] as const)
    it(`0004-AC-4,7 fallback layout walk accepts a valid ${harness} delivery and rejects a wrong manifest path`, async () => {
      const {tree, settings} = delivery(harness)
      expect(failing(settingsChecks(settings, harness, MARKETPLACE, true))).toEqual([])
      expect(failing(await layoutChecks(settings, harness, MARKETPLACE, '1.0.0'))).toEqual([])
      expect(failing(await layoutChecks(settings, harness, MARKETPLACE, '2.0.0'))).toHaveLength(1)

      renameSync(join(tree, '.claude-plugin', 'plugin.json'), join(tree, 'plugin.json'))
      expect(failing(await layoutChecks(settings, harness, MARKETPLACE, '1.0.0'))).toEqual([
        `layout: ${join(tree, '.claude-plugin', 'plugin.json')} names cover-all 1.0.0`,
      ])
    })

  it('0004-AC-4 fallback fails closed on wrong settings, a foreign catalog or a misdirected entry', async () => {
    const {root, catalogDir, catalog, settings} = delivery('droid')
    // A Claude Code directory source is not the Droid local source forge writes.
    expect(failing(settingsChecks(settings, 'claude-code', MARKETPLACE, true))).toHaveLength(1)
    expect(failing(settingsChecks({}, 'droid', MARKETPLACE, true))).toHaveLength(2)
    expect(failing(await layoutChecks({}, 'droid', MARKETPLACE, '1.0.0'))).toHaveLength(1)
    // Droid reads .factory-plugin/; a Claude Code catalog alone is not a Droid delivery.
    expect(failing(await layoutChecks(settings, 'claude-code', MARKETPLACE, '1.0.0'))).toHaveLength(1)

    writeFileSync(join(catalogDir, 'marketplace.json'), JSON.stringify({...catalog, name: 'other'}))
    expect(failing(await layoutChecks(settings, 'droid', MARKETPLACE, '1.0.0'))).toEqual([
      `layout: catalog is named ${MARKETPLACE}`,
    ])
    const misdirected = {...catalog, plugins: [{...catalog.plugins[0], source: './cover-all/1.0.0/claude-code'}]}
    writeFileSync(join(catalogDir, 'marketplace.json'), JSON.stringify(misdirected))
    expect(failing(await layoutChecks(settings, 'droid', MARKETPLACE, '1.0.0'))).toHaveLength(1)
    expect((await catalogDropped(root, 'droid')).ok).toBe(false)
    writeFileSync(join(catalogDir, 'marketplace.json'), JSON.stringify({...catalog, plugins: []}))
    expect((await catalogDropped(root, 'droid')).ok).toBe(true)
    // A corrupt catalog is not a dropped entry.
    writeFileSync(join(catalogDir, 'marketplace.json'), '{"name":')
    expect((await catalogDropped(root, 'droid')).ok).toBe(false)
  })

  it('0004-AC-6 a missing settings file counts as removed, a corrupt one fails', () => {
    expect(settingsOf({state: 'missing'}, 'settings.json')).toEqual({settings: {}})
    expect(settingsOf({state: 'ok', value: {a: 1}}, 'settings.json')).toEqual({settings: {a: 1}})
    expect(settingsOf({state: 'invalid', error: 'SyntaxError'}, 'settings.json').problem).toEqual({
      check: 'settings.json is readable JSON',
      ok: false,
      detail: 'SyntaxError',
    })
  })

  it('0004-AC-6 removal requires the settings keys to be gone', () => {
    const {settings} = delivery('claude-code')
    expect(failing(settingsChecks(settings, 'claude-code', MARKETPLACE, false))).toHaveLength(2)
    expect(failing(settingsChecks({model: 'sonnet'}, 'claude-code', MARKETPLACE, false))).toEqual([])
  })

  it('0004-AC-4 reads the plugins a Claude Code session loaded and the Droid plugin list', () => {
    const init = {
      type: 'system',
      subtype: 'init',
      plugins: [{name: 'cover-all', source: 'cover-all@m', version: '1.0.0'}],
    }
    expect(claudeInitPlugins([{type: 'result'}, init])).toEqual([{source: 'cover-all@m', version: '1.0.0'}])
    expect(claudeInitPlugins([{type: 'result'}])).toBeUndefined()

    const list =
      'Installed plugins (project):\n\n  cover-all@m\n    Version: 1.0.0\n    Status: Enabled\n\n  other@m\n    Status: Disabled\n'
    expect(droidListShows(list, 'cover-all@m', '1.0.0')).toBe(true)
    expect(droidListShows(list, 'cover-all@m', '1.1.0')).toBe(false)
    expect(droidListShows(list.replace('Enabled', 'Disabled'), 'cover-all@m', '1.0.0')).toBe(false)
    expect(droidListShows('No plugins installed in project scope.', 'cover-all@m', '1.0.0')).toBe(false)
    // Whole fields only: a longer id or a version that merely contains the locked one does not match.
    expect(droidListShows(list.replace('1.0.0', '11.0.0'), 'cover-all@m', '1.0.0')).toBe(false)
    expect(droidListShows(list.replace('cover-all@m', 'cover-all@m-2'), 'cover-all@m', '1.0.0')).toBe(false)
    expect(droidListShows('cover-all@m (v1.0.0) Enabled', 'cover-all@m', '1.0.0')).toBe(true)

    const ran = {code: 0, timedOut: false, stdout: list, stderr: ''}
    expect(droidListed(ran, 'cover-all@m', '1.0.0')).toBe(true)
    expect(droidListed({...ran, code: 1}, 'cover-all@m', '1.0.0')).toBe(false)
    expect(droidListed({...ran, error: 'Cleanup failed'}, 'cover-all@m', '1.0.0')).toBe(false)
  })

  it('0004-AC-2,4 a Claude session counts only when it ran to completion, even with valid output', () => {
    const events = [
      {type: 'assistant', message: {model: '<synthetic>'}},
      {type: 'result', total_cost_usd: 0, duration_api_ms: 0, modelUsage: {}},
    ]
    // The credential-less run exits 1 by design.
    const ran = {code: 1, timedOut: false, stdout: '', stderr: ''}
    expect(failing(sessionChecks('session', ran, events))).toEqual([])
    expect(failing(sessionChecks('session', {...ran, error: 'Cleanup failed: EPERM'}, events))).toEqual([
      'session ran to completion',
    ])
    expect(failing(sessionChecks('session', {...ran, code: null, timedOut: true}, events))).toEqual([
      'session ran to completion',
    ])
    expect(failing(sessionChecks('session', ran, events.slice(0, 1)))).toEqual(['session made no model call'])
  })

  it('0004-AC-6 takes the expected rule text from the fixture, without frontmatter', async () => {
    expect(await fixtureRules()).toEqual({
      api: 'Validate every request body with a schema.',
      style: 'Write comments that explain why, not what.',
    })
  })
})
