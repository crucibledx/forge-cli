import {describe, expect, it} from 'bun:test'

import {findUndelivered} from './coverage'
import {droid} from './droid'
import {getAllHarnesses} from './registry'

describe('findUndelivered', () => {
  it('reports source rules as not delivered to Droid', () => {
    expect(findUndelivered(['skills/a.md', 'rules/b.md', 'workflows/c.md'], [droid])).toEqual([
      {harnessId: 'droid', sourceGlob: 'rules/**'},
    ])
  })

  it('reports nothing for folders the source does not have', () => {
    expect(findUndelivered(['skills/a.md', 'README.md', '.claude/rules/x.md'], [droid])).toEqual([])
  })

  it('reports only the gaps of each harness', () => {
    const gaps = findUndelivered(['rules/b.md', 'workflows/c.md'], getAllHarnesses())
    expect(gaps).toEqual([
      {harnessId: 'copilot', sourceGlob: 'workflows/**'},
      {harnessId: 'droid', sourceGlob: 'rules/**'},
    ])
  })
})
