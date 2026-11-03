# Loop contract

Read by the Crucible loop agents (`implement-spec`, `verifier`). Keep it accurate.

- **Install:** `bun install`
- **Checks** (all must pass before a PR is ready):
  `bun run format:check && bun run lint && bun run typecheck && bun run test && bun run build`
  (`bun run test` runs unit tests in `src/` and e2e tests in `e2e/`.)
- **Commit style:** `feat(v0.x.y): ...` / `fix(v0.x.y): ...`, matching `git log`.
- **Specs:** `specs/NNNN-slug.md`, see `crucibledx/hq` `specs/README.md`. Older version specs live in `docs/`.
- **Assets:** diagrams and demos live in `crucibledx/assets`; README images use raw GitHub URLs from there.
- **Release:** manual. Pushing a `v*` tag runs `release.yml` (npm, GitHub Releases, Homebrew tap, Scoop bucket). Loop
  PRs never bump versions, edit `CHANGELOG.md` release headers, or push tags.
