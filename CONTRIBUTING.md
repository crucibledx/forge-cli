# Contributing to Forge CLI

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Prerequisites

- [Bun](https://bun.sh), exact version in `.bun-version` (currently 1.4.2)
- Node.js 20+ (for some tooling)
- Git

## Setup

```bash
git clone https://github.com/crucibledx/forge-cli.git
cd forge-cli
bun install --frozen-lockfile
```

## Development

```bash
bun run dev -- <command>   # run locally (e.g. bun run dev -- sync)
bun run build              # compile to single binary at dist/forge
```

## Testing

```bash
bun run test               # all tests (unit + e2e)
bun run test:unit          # unit tests only (src/)
bun run test:e2e           # e2e tests only (e2e/)
bun run test:properties    # four 100-case properties, fixed replay seed
bun run test:human         # persisted PTY wizard journeys
bun run test:agent         # closed stdin, separate streams
bun run test:security      # offline attack/rollback/redaction checks
bun run check:security-audit # public advisory metadata, 60-second bound
bun run test:performance   # offline 10/1000-target correctness and advisory timings
bun run test:platform      # current OS only; native Windows/macOS CI evidence is separate
bun run check:contracts    # ledger, registry, workflow/toolchain boundaries
bun run check:lanes -- --out results # all outcomes, at most two active commands
```

Named suite membership is maintained in `scripts/registry/suites.ts`; package scripts only select a suite.
Tests remain co-located under `src/` or in `e2e/`. Security/platform selections intentionally overlap those files.
`test:platform` adds native OS checks; portable tests and the independent Linux build already validate Linux.

- Unit tests mock at the infrastructure boundary, never at the file level.
- E2e tests use temp directories and spawn the real CLI.
- Use the isolated launcher for focused tests:
  `bun run scripts/run-tests.ts -- e2e/framework/contracts/`.
  It sets disposable home/temp/cache roots before any test import and replaces scheduler commands with offline fakes.
  Bun dotenv autoload is disabled before preloads, including nested `bun run` children. Explicit fixture preloads
  remain supported without restoring repository `.env` credentials. Shared sandbox environments bound Git discovery
  before the canonical sandbox parent, including commands starting at its root and symlink/junction placements.
  Explicit `git -C` access to fixture repositories still works without reading the enclosing checkout's config.
  A canonical sandbox parent containing the native Git path-list delimiter is rejected with cleanup, not passed
  as an ambiguous ceiling list. Native fixture identity uses unique bytes, not equivalent8.3/full path spelling.
  Sessions have a 10-second total deadline and a 20-second runner budget. For a 30-second session, select
  `--timeout-ms 40000` before `--`. PTY output is a transcript, not a terminal screen.
  Full/checker/platform entrypoints select40 seconds for the bounded native compiler probe; ordinary session
  deadlines remain10 seconds. Windows compiles the isolated fake scheduler once per sandbox tree, before test
  imports: nested launchers, validators and test processes reuse the nearest enclosing sandbox's build. A fixture
  materializes its independent file copy when its command environment is requested, never for pure filesystem
  setup and never through a shared mutable executable. Both `sandbox.env` and `testEnvironment()` prepare it before use.
- Never run raw `bun test`: legacy cache-cleanup tests must not use the operator's temp/cache roots.
- `check:lanes` exits 1 on failure, otherwise 2 on incomplete/foreign-native evidence. A successful local build is
  not a native Windows/macOS substitute. CI runs all ten independent lanes and an always-run `Deterministic gate`;
  seven-day sanitized artifacts include failures. See the [safety contract](docs/safety-contract.md).
- A PR is ready to merge when every lane and `Deterministic gate` pass, the hosted `review` check passes with no
  unresolved blocking findings, and the code owner approves. There is no separate evidence or attestation command.
  Required branch rules/reviews are configured by the owner only; agents report enforcement evidence or access blockers.

## Before You Submit

Run the full pre-commit checklist:

```bash
bun run format             # prettier
bun run lint:fix           # eslint auto-fix
bun run typecheck          # tsc --noEmit, must exit 0
bun run test               # all tests must pass
```

## Architecture

DDD with three layers:

- **`domain/`** — pure types, logic, schemas. No I/O, no framework deps. Imports nothing outside itself.
- **`application/`** — command handlers that orchestrate domain + infrastructure. Imports from both.
- **`infrastructure/`** — all I/O: filesystem, git, CLI prompts, config parsing. Imports from domain only.

### Adding Things

| What            | Where                               | How                                                                        |
|-----------------|-------------------------------------|----------------------------------------------------------------------------|
| New assistant   | `domain/assistants/<name>/index.ts` | Create file, add to `registry.ts`                                          |
| New source type | `infrastructure/source/<type>/`     | `messages.ts` + `loader.ts` + `index.ts`, add to `source/index.ts`         |
| New command     | `application/commands/<name>/`      | `index.ts` (definition) + `handler.ts` (logic), add to `commands/index.ts` |
| New transform   | `domain/transforms/<name>/index.ts` | Create file, add to `registry.ts`                                          |

Zero changes to existing commands or handlers required.

### Import Rules

- **Cross-layer**: use path aliases (`@domain/*`, `@application/*`, `@infrastructure/*`)
- **Within a layer**: use relative imports
- Domain must never import from application or infrastructure
- Infrastructure must never import from application

## Code Style

- **Functions, not classes** — plain functions and object literals. Classes only for custom errors.
- **Maps over switch/case** — `Record<string, Handler>` for dispatch.
- **Const objects for union types** — define a `const` object, derive the union with `typeof OBJ[keyof typeof OBJ]`:
  ```ts
  export const SYNC_FILE_STATUSES = { NEW: 'new', UPDATE: 'update' } as const
  export type SyncFileStatus = (typeof SYNC_FILE_STATUSES)[keyof typeof SYNC_FILE_STATUSES]
  ```
- **Formatting** — Prettier handles it. No semicolons, single quotes, trailing commas.
- **Linting** — ESLint for code quality. `simple-import-sort` for import ordering.

## Commit Messages

Format: `type(version): description`

```
feat(v0.6.5): global destination resolution for assistant target mappings
fix: rename 'Config drift' to 'Sync drift' in health report
docs: update README with install instructions
```

Version tags use annotated tags: `git tag -a v0.6.5 -m "v0.6.5"`

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
