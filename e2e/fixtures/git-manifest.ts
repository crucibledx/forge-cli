import {RULE_WITH_PATHS, SKILL_DEPLOY} from './sources'

/** Frozen history generation and lookup share these exact branch/content mappings. */
export const gitFixtures: ReadonlyArray<readonly [string, Readonly<Record<string, string>>]> = [
  ['fixture-skills', {'skills/deploy.md': SKILL_DEPLOY}],
  ['fixture-rules', {'rules/api.md': RULE_WITH_PATHS}],
  ['fixture-feature', {'skills/feature.md': '# Feature branch skill'}],
  ['fixture-team', {'skills/review.md': '# Review skill'}],
]
