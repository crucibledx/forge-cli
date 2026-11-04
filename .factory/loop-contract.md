# Loop contract

Read by the Crucible loop agents (`implement-spec`, `verifier`). Keep it accurate.

- **Install:** use the exact Bun in `.bun-version`; `bun install --frozen-lockfile`.
- **Checks** (all must pass before a PR is ready):
  `bun run format:check && bun run lint && bun run typecheck && bun run test && bun run build`
  (`bun run test` runs `src/`, `e2e/` and `scripts/` through the isolated test launcher.)
- **Focused tests:** `bun run scripts/run-tests.ts -- <paths...>`. Never run raw `bun test`; cached home/temp
  constants and legacy cache cleanup must remain in the launcher's disposable environment.
- **Modules:** `scripts/validation-lanes.ts` defines ten required independent lanes. Use `bun run check:contracts`
  and `bun run check:lanes -- --out results`. Foreign native evidence is blocked, never simulated. All lanes and
  `Deterministic gate` must pass on the exact tested merge revision; a draft toggle is not readiness.
- **Readiness:** independent exact-revision code/security review and verifier implementation checks first, including
  checker self-tests; collect authenticated sidecars/artifacts second, then `bun run check:readiness`. No prior
  readiness verdict is required. Missing provenance blocks. No agent approves its own deviations or branch settings.
- **Commit style:** `feat(v0.x.y): ...` / `fix(v0.x.y): ...`, matching `git log`.
- **Specs:** `specs/NNNN-slug.md`, see `crucibledx/hq` `specs/README.md`. Older version specs live in `docs/`.
- **Assets:** diagrams and demos live in `crucibledx/assets`; README images use raw GitHub URLs from there.
- **Release:** manual. Pushing a `v*` tag runs `release.yml` (npm, GitHub Releases, Homebrew tap, Scoop bucket). Loop
  PRs never bump versions, edit `CHANGELOG.md` release headers, or push tags.
