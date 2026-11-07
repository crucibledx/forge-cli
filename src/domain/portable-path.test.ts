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
it.each([
  ['Foo', 'foo'],
  ['café', 'cafe\u0301'],
  ['Σ', 'ς'],
  ['ß', 'ss'],
  ['ﬀ', 'ff'],
])('AC-8,9 intermediate directory aliases compete before writes: %s / %s', (first, second) => {
  for (const prefix of ['', '.claude/skills/', '.claude/skills/shared/']) {
    const a = `${prefix}${first}/one/a.md`,
      b = `${prefix}${second}/two/b.md`
    for (const paths of [
      [a, b],
      [b, a],
    ])
      expect(() => validatePathGraph(paths)).toThrow('aliased directories')
  }
})
it('AC-8,9 identically spelled shared parents and distinct ordinary Unicode parents remain valid', () => {
  expect(() =>
    validatePathGraph([
      '.claude/skills/Foo/a.md',
      '.claude/skills/Foo/b.md',
      '.claude/skills/café/a.md',
      '.claude/skills/東京/b.md',
    ]),
  ).not.toThrow()
})
