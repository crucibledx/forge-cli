# Forge CLI — Agent Context

> AI dev environment setup & config sync CLI. The main product of Crucible.

## Identity

- **Package:** `@crucibledx/forge-cli` (npm) · **Binary:** `forge` · **GitHub:** `crucibledx/forge-cli`
- **Version:** see `package.json` and `CHANGELOG.md`
- **Stack:** TypeScript + Bun, compiled to a single native binary via `bun build --compile`
- **Config:** `.crucible/forge.config.yaml` (project), `~/.crucible/forge.config.yaml` (global). Annotated example:
  `docs/forge.config.yaml`
- **npm package ships source, not a binary:** `bin/forge.mjs` is `#!/usr/bin/env bun` + `import '../src/main.ts'`, so
  npm installs require Bun. Native binaries come from GitHub Releases / brew / scoop.

## What It Does

Syncs shared AI assistant configurations (skills, rules, workflows) from a central source to every AI tool's expected
location, in the right format.

### Commands (9 top-level)

| Command | Purpose |
|---------|---------|
| `forge init` | Interactive wizard — detect AI tools, configure sources, write config |
| `forge sync` | Fetch from all sources, resolve targets, place files per assistant |
| `forge status` | Show drift between last sync state and current filesystem |
| `forge health` | SLI dashboard — last sync, frequency, drift, reachability |
| `forge config` | Interactive config editor (`forge config show` prints current config) |
| `forge source` | `list` / `add` / `remove` / `edit` configured sources |
| `forge scheduler` | `install` / `uninstall` / `status` OS-level auto-sync (launchd/crontab/schtasks) |
| `forge telemetry` | Show telemetry status (`forge telemetry reset`) |
| `forge uninstall` | Remove `.crucible`, scheduler, all synced files |

### Supported AI Assistants (5)

Defined in `src/domain/assistants/<name>/index.ts`. Only two transformers exist: `rename` and `frontmatter-rename`
(`src/domain/transforms/`).

| Assistant | Transforms on rules |
|-----------|---------------------|
| Claude Code | None (passthrough) |
| Cursor | `rename` `.md` → `.mdc`, `frontmatter-rename` `paths` → `globs` |
| Windsurf | `frontmatter-rename` `paths` → `globs` |
| GitHub Copilot | `rename` `.md` → `.instructions.md`, `frontmatter-rename` `paths` → `applyTo` |
| Cline | None (passthrough) |

Target paths (project and global) live in each assistant definition — read it rather than relying on a copy here.

## Architecture — DDD Layering

```
src/
├── main.ts                              ← entry: imports commands + createProgram
├── domain/                              ← pure types, logic, schemas. NO I/O
│   ├── assistants/<name>/index.ts       ← AssistantDefinition per assistant (+ registry.ts)
│   ├── config/  sync/  scheduler/  scope/  format/  protocol/
│   └── transforms/                      ← rename/, frontmatter-rename/, registry.ts
├── application/                         ← command orchestration
│   ├── commands/<name>/index.ts         ← CommandDefinition, self-registers into registry
│   ├── commands/<name>/handler.ts       ← handler logic
│   ├── commands/config/sections/        ← `forge config` sections (side-effect imports + registry.ts)
│   ├── commands/shared/                 ← reusable prompts (assistant, source)
│   ├── commands/registry.ts             ← commandsRegistry: CommandDefinition[]
│   ├── commands/index.ts                ← side-effect imports of each command, re-exports registry as `commands`
│   ├── program.ts  hooks.ts
├── infrastructure/                      ← all I/O
│   ├── cli/  config/  fs/  io/  logger/  report/  scheduler/  telemetry/
│   └── source/                          ← git/, local/ loaders + registry.ts
└── test-helpers/
```

**Dependency direction:** `domain` imports only `domain`. `application` imports `domain` (and infrastructure for I/O).
`infrastructure` may import `domain` and `application` types (e.g. `cli/parser.ts` uses `CommandDefinition`).
Domain never imports outward.

## Key Patterns

### Horizontal Scaling

Adding a variant = new folder + one registration. Step-by-step guides in `docs/how-to-add-*.md`.

| Add... | Where | Register | Guide |
|--------|-------|----------|-------|
| Assistant | `domain/assistants/<name>/index.ts` | `domain/assistants/registry.ts` | `how-to-add-assistant.md` |
| Source type | `infrastructure/source/<type>/` | `infrastructure/source/registry.ts` | `how-to-add-source.md` |
| Command | `application/commands/<name>/` (index.ts + handler.ts) | side-effect import in `commands/index.ts` | `how-to-add-command.md` |
| Config section | `application/commands/config/sections/<name>.ts` | import in `sections/index.ts` | `how-to-add-config-section.md` |
| Transformer | `domain/transforms/<name>/index.ts` | `domain/transforms/registry.ts` | `how-to-add-transformer.md` |

### Conventions

- `Record<string, Handler>` maps over switch/case for dispatch.
- Plain functions and object literals; classes only for custom Error subclasses.
- Const objects for union types:

```typescript
export const SYNC_FILE_STATUSES = {NEW: 'new', UPDATE: 'update'} as const
export type SyncFileStatus = (typeof SYNC_FILE_STATUSES)[keyof typeof SYNC_FILE_STATUSES]
```

## Code Style

- **Prettier** (`.prettierrc`): `semi: false`, `singleQuote: true`, `tabWidth: 2`, `bracketSpacing: false`
  (`{a}` not `{ a }`), `trailingComma: all`, `printWidth: 120`, `arrowParens: always`
- **ESLint:** `simple-import-sort`, `consistent-type-imports`
- **Imports:** path aliases cross-layer (`@domain/*`, `@application/*`, `@infrastructure/*`), relative within a layer
- **Libraries:** `commander`, `@clack/prompts`, `zod`, `yaml`, `lodash-es`, `picocolors`, `strip-ansi`, `pino`,
  `cron-parser`, `cronstrue`

## Development

```bash
bun install
bun run dev -- <command>      # run src/main.ts
bun run test                  # unit + e2e (bun test src/ e2e/)
bun run test:unit             # src/ only
bun run test:e2e              # e2e/ only
bun run format                # prettier --write   (format:check in CI)
bun run lint                  # eslint            (lint:fix to auto-fix)
bun run typecheck             # tsc --noEmit
bun run build                 # dist/forge binary, then `clean` removes *.bun-build
```

- Unit tests mock at the infrastructure boundary; source `configure()` tests mock `@infrastructure/cli/prompts` via
  `mock.module`. E2e tests use temp dirs and spawn the real CLI.
- Before committing: format, lint, typecheck, test all clean.

## CI/CD

- **`ci.yml`** (push/PR to `main`): `quality` (format:check, lint, typecheck), `test` (unit + e2e with JUnit reports),
  `build` (compile + `./dist/forge --version`).
- **`release.yml`** (`v*` tag or manual dispatch), jobs by dependency:
  - `quality` (format:check, lint, typecheck) and `test` run first.
  - `build` (cross-compile `linux-x64`, `linux-arm64`, `darwin-arm64`, `darwin-x64`, `windows-x64`, package,
    checksums) and `publish-npm` (`npm publish` with `NPM_TOKEN`, a granular token; OIDC Trusted Publishing was tried
    in 0.6.23 and reverted in 0.6.24) both need `[quality, test]` and run in parallel.
  - `github-release` needs `build` (GitHub Release with CHANGELOG notes and binaries).
  - `homebrew` and `scoop` need `github-release`; they regenerate and push the `crucibledx/homebrew-tap` formula and
    the `crucibledx/scoop-bucket` manifest.

**Release steps:** bump `package.json` version, add the `CHANGELOG.md` entry, commit `feat|fix(v0.x.y): ...`, create an
annotated `v0.x.y` tag, push the tag.

## Docs and Roadmap

`docs/` (a reorganization into `docs/archived/` is currently uncommitted in the working tree):

- `compiler-roadmap.md` — roadmap for the v0.7 skill compiler and beyond; the source of truth for what is next
- `forge-v0.7*.md` … `forge-v0.13.md` — upcoming version specs
- `archived/` — shipped specs (v0.1–v0.6) and the old v0.1 config example
- `forge.config.yaml` — annotated config reference
- `how-to-add-{assistant,command,config-section,source,transformer}.md` — extension guides

## File Map

| File | Purpose |
|------|---------|
| `package.json` | Scripts, deps, version |
| `tsconfig.json` | Path aliases |
| `eslint.config.js`, `.prettierrc` | Lint/format config |
| `CHANGELOG.md`, `CONTRIBUTING.md`, `README.md` | Release notes, contributor guide, public README |
| `e2e/` | End-to-end tests |
| `scripts/install.sh` | curl install script (only script) |
| `bin/forge.mjs` | npm bin entry (runs source via Bun) |
