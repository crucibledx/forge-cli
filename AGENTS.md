# Forge CLI: agent guide

How to work in this repo and where to find things. The linked documents are canonical; this file does not repeat them.

## Where to find information

| Need                                                     | Read                                                                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| What Forge does, install, commands                       | [`README.md`](README.md)                                                                                        |
| Org context, delivery loop, approval boundaries          | `crucibledx/hq` `AGENTS.md`                                                                                     |
| Org engineering standards                                | `engineering-standards` skill (`crucibledx/factory-loop` `plugins/crucible-loop/skills/engineering-standards/`) |
| Architecture, layer and import rules, code style         | [`CONTRIBUTING.md`](CONTRIBUTING.md)                                                                            |
| Adding an assistant, source, command, section, transform | `docs/how-to-add-*.md`                                                                                          |
| PR checks, merge gate, commit style, release limits      | [`.factory/loop-contract.md`](.factory/loop-contract.md)                                                        |
| Sync safety rules, validation, merge readiness           | [`docs/safety-contract.md`](docs/safety-contract.md)                                                            |
| Approved specs and acceptance contracts                  | [`specs/`](specs/)                                                                                              |
| Config file reference                                    | [`docs/forge.config.yaml`](docs/forge.config.yaml)                                                              |

On conflict, this repo's rules win over the org standards, as the standards themselves state. New work starts from a
spec in `specs/`. `docs/forge-v0.*.md` are older per-version specs. Open PRs, draft branches and uncommitted docs are
not approved direction.

## How to work

```bash
bun install --frozen-lockfile                # Bun must match .bun-version exactly
bun run scripts/run-tests.ts -- <paths...>   # focused tests while you work, e.g. -- src/domain/sync/
bun run format:check && bun run lint && bun run typecheck && bun run test && bun run build   # before a PR is ready
```

- **Never run raw `bun test`.** The launcher (`scripts/run-tests.ts`) gives tests disposable home, temp and cache roots
  and offline scheduler fakes; raw `bun test` can touch the operator's real home, caches and scheduler.
- Run only the current OS's checks locally. CI's ten lanes and `Deterministic gate` are the record; a local run does
  not replace another OS's lane.
- Put tests next to the code (`*.test.ts`) or in `e2e/`; `src/`, `e2e/` and `scripts/` are picked up automatically.
  A test that belongs to a named suite (`security`, `platform`, ...) must also be listed in `scripts/registry/suites.ts`.

## Where the docs disagree

- **`infrastructure` importing `application`.** `CONTRIBUTING.md` forbids it, the org standards allow types only, and
  `src/infrastructure/cli/parser.ts` imports the runtime `CommandError` as well as types. Unresolved (crucibledx/hq#5).
  Do not add new imports of this kind, and do not change `parser.ts` as a side effect of unrelated work.
- **"Domain has no I/O."** It means no filesystem, process or network effects. Deterministic Bun/Node helpers already
  used in `src/domain/` (`Bun.Glob`, `node:path`, `node:crypto`) are computation, not I/O.

## Boundaries

- Never push to `main`, force push or merge. Nazar's code-owner approval is the merge gate.
- Never change repository settings or branch rules, and never edit an approved acceptance contract; propose changes in
  the PR.
- No version bumps, `CHANGELOG.md` release headers, tags or publishing in agent PRs. Releases are manual.
- Diagrams and demo recordings live in `crucibledx/assets`.
