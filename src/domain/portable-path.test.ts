import {expect, it} from 'bun:test'

import {portablePath} from './portable-path'
import {validatePathGraph} from './sync/plan'

it('AC-9 shared portable identity folds separators, Unicode, case and trailing slashes', () => {
  const canonical = '.claude/skills/café.md'
  const alias = '.CLAUDE\\\\SKILLS//CAFE\u0301.MD///'
  expect(portablePath(alias)).toBe(canonical)
  expect(() => validatePathGraph([canonical, alias])).toThrow('aliased')
})
