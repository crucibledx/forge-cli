# Loop contract

Read by the Crucible loop agents (`implement-spec`, `verifier`). Keep it accurate.

- **Install:** use the exact Bun in `.bun-version`; `bun install --frozen-lockfile`.
- **Checks** (all must pass before a PR is ready):
  `bun run format:check && bun run lint && bun run typecheck && bun run test && bun run build`
  (`bun run test` runs `src/`, `e2e/` and `scripts/` through the isolated test launcher.)
- **Focused tests:** `bun run scripts/run-tests.ts -- <paths...>`. Never run raw `bun test`; cached home/temp
  constants and legacy cache cleanup must remain in the launcher's disposable environment.
- **Modules:** `scripts/validation-lanes.ts` defines ten required independent lanes; `bun run check:contracts`
  keeps the CI matrix equal to it. A native lane's checks run locally only on its own OS; another OS's native lane is
  never emulated, and a local run does not replace the CI lane. All lanes and `Deterministic gate` must pass on the
  exact tested merge revision; a draft toggle does not make a PR ready.
- **Merge gate:** the ten lanes, `Deterministic gate`, the hosted `review` check and Nazar's code-owner approval.
  There is no repository-local evidence or attestation step. No agent approves its own deviations or branch settings.
- **Commit style:** `feat(v0.x.y): ...` / `fix(v0.x.y): ...`, matching `git log`.
- **Specs:** `specs/NNNN-slug.md`, see `crucibledx/hq` `specs/README.md`. Older version specs live in `docs/`.
- **Assets:** diagrams and demos live in `crucibledx/assets`; README images use raw GitHub URLs from there.
- **Release:** manual. Pushing a `v*` tag runs `release.yml`: it waits for a green `Deterministic gate` on the tagged
  commit, builds and smoke-tests the binary, then publishes npm first, then GitHub Releases, then the Homebrew tap and
  Scoop bucket. Re-runs skip an npm version that is already published. A `workflow_dispatch` with `dry_run: true` runs
  every check and build but publishes nothing. Loop PRs never bump versions, edit `CHANGELOG.md` release headers, or
  push tags.
