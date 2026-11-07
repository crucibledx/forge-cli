import {expect, it} from 'bun:test'

import {portablePath} from './portable-path'
import {validatePathGraph} from './sync/plan'

it('AC-9 shared portable identity folds separators, Unicode, case and trailing slashes', () => {
  const canonical = '.claude/skills/café.md'
  const alias = '.CLAUDE\\\\SKILLS//CAFE\u0301.MD///'
  expect(portablePath(alias)).toBe(canonical)
  expect(() => validatePathGraph([canonical, alias])).toThrow('aliased')
})
it.each([
  ['σ.md', 'ς.md'],
  ['Σ.md', 'ς.md'],
  ['ſ.md', 's.md'],
  ['ı.md', 'i.md'],
  ['ß.md', 'ẞ.md'],
  ['ß.md', 'ss.md'],
  ['ﬀ.md', 'ff.md'],
])('AC-9 native Unicode case equivalents compete without rewriting paths: %s / %s', (a, b) => {
  expect(portablePath(a)).toBe(portablePath(b))
  expect(portablePath(portablePath(a))).toBe(portablePath(a))
  expect(() => validatePathGraph([`rules/${a}`, `rules/${b}`])).toThrow('aliased')
})
it('AC-9 ordinary distinct Unicode destinations remain distinct', () => {
  expect(() => validatePathGraph(['rules/ä.md', 'rules/a.md', 'rules/東京.md', 'rules/👩‍💻.md'])).not.toThrow()
})
