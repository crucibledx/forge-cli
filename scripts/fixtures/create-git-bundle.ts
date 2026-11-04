// Manual fixture maintenance, never part of validation. Uses the operator's
// existing Git identity, without changing config or overriding author/committer.
import {existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'

import {RULE_WITH_PATHS, SKILL_DEPLOY} from '../../e2e/fixtures/sources'

const root = mkdtempSync(join(tmpdir(), 'forge-fixture-authoring-'))
const output = resolve(import.meta.dir, '../../e2e/fixtures/git-history.bundle')
function git(...args: string[]) {
  const result = Bun.spawnSync(['git', ...args], {cwd: root, stdout: 'pipe', stderr: 'pipe'})
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr))
}
try {
  git('init', '--initial-branch=fixture-skills')
  git('var', 'GIT_AUTHOR_IDENT')
  git('var', 'GIT_COMMITTER_IDENT')
  const fixtures = [
    ['fixture-skills', {'skills/deploy.md': SKILL_DEPLOY}],
    ['fixture-rules', {'rules/api.md': RULE_WITH_PATHS}],
    ['fixture-feature', {'skills/feature.md': '# Feature branch skill'}],
    ['fixture-team', {'skills/review.md': '# Review skill'}],
  ] as const
  for (let i = 0; i < fixtures.length; i++) {
    const [branch, files] = fixtures[i]
    if (i) {
      git('checkout', '--orphan', branch)
      git('rm', '-r', '--cached', '--ignore-unmatch', '.')
      for (const [, previous] of fixtures)
        for (const path of Object.keys(previous)) {
          if (existsSync(join(root, path))) unlinkSync(join(root, path))
        }
    }
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), {recursive: true})
      writeFileSync(join(root, path), content)
    }
    git('add', '.')
    git('commit', '-m', 'Local source fixture')
  }
  git('bundle', 'create', output, '--all')
} finally {
  rmSync(root, {recursive: true, force: true})
}
