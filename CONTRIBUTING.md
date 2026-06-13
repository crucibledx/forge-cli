# Contributing to Forge CLI

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Prerequisites

- [Bun](https://bun.sh) v1.1+
- Node.js 20+ (for some tooling)
- Git

## Setup

```bash
git clone https://github.com/crucibledx/forge-cli.git
cd forge-cli
bun install
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
```

- Unit tests mock at the infrastructure boundary, never at the file level.
- E2e tests use temp directories and spawn the real CLI.

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
