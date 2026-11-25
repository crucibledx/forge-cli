---
id: "0003"
title: "Plugin packages and delivery"
status: approved
scope: project
target_repos: [forge-cli]
assets: none
size: mission
idea_issue: "crucibledx/hq#14"
created: 2026-11-11
---

# 0003: Plugin packages and delivery

Part of forge v0.8, together with [0002 harness model and rename](0002-harness-model-and-rename.md) (harness model,
vocabulary) and [0004 plugin load check](0004-plugin-load-check.md) (does the harness load what forge installed).
This spec owns the plugin package format, sources, the lockfile, and delivery. v0.8 delivers plugins into **Droid and
Claude Code**; every other harness, source type and marketplace feature from the original plan has a place in
section 9. **Release boundary:** v0.8.0 is #53 (0002), #54 (§6), #55 (§1–§4) and #56/#57 (§5); the remaining v0.8
items (the §7 plugin commands, §8 marketplace emit, the 0004 load check) land as v0.8.x before v0.9 work starts.

## Problem

Forge syncs loose files from `skills/`, `rules/`, `workflows/` globs. There is no way to deliver a named, versioned
bundle (skills + commands + agents + hooks + MCP + rules) as one unit, pin what was installed, see what changed, or
install it into a harness's own plugin system. Benchmarks and Ember also have no stable tag for "which content was
installed", so a before/after comparison cannot name its arms.

## Complete, don't compete

- **Agent Plugins 1.0** is the package format. Forge **vendors its Apache-2.0 JSON Schemas** (`plugin.schema.json`,
  `mcp.schema.json`) and validates with ajv, honoring the spec's two non-fatal cases (unknown top-level fields;
  non-object `extensions` in 1.0). The `dev.crucibledx.forge` namespace needs no registration (spec §8).
- **Microsoft APM** owns dependency resolution, transitive deps, and org policy; forge rejects multi-plugin dependency
  graphs and points users there.
- **Vercel `skills`**: forge adopts its `skills-lock.json` v2 `computedHash` algorithm verbatim for content hashes
  (MIT).
- **Droid and Claude Code plugin systems** do the loading. Droid accepts Claude Code plugin layouts and translates
  them as it copies a plugin into its cache (renames `.claude-plugin/` → `.factory-plugin/`, merges `agents/` into
  `droids/`, maps `.mcp.json` → `mcp.json`, provides both `DROID_PLUGIN_ROOT` and `CLAUDE_PLUGIN_ROOT`), so forge
  emits **one canonical layout** and never reimplements Droid's translation. Registration uses the settings keys
  both vendors document for team distribution (`extraKnownMarketplaces`, `enabledPlugins`); registrars run no
  harness CLI. **`jsonc-parser`** (MIT, comment-preserving) powers the keyed merges.
- Harness marketplaces stay the vendors'; forge emits catalogs for producers (section 8) instead of running a registry.
- What forge adds: one source package delivered into both harnesses, pinned, locked, transactional, with drift
  reporting and a content tag (`variant`) that Ember and benchmarks share.

## Goals (v0.8)

- Deliver an Agent Plugins 1.0 package, pinned and locked, into Droid and Claude Code through their native plugin
  systems.
- Source plugins from local folders and git (any host, pinned to a resolved commit).
- Record exactly what was installed in a committed lockfile, with content hashes and a per-harness `variant` tag.
- Keep every write inside the safety contract, including keyed merges into harness settings files.
- Let a producer repo publish Droid and Claude Code marketplace catalogs (`forge marketplace emit`, v0.8.x).
- Leave seams for the compiler (spec 0005, planned for v0.9): emitters consume a parsed `PluginPackage`, not raw files.

## Non-goals

- Plugin delivery into any harness other than Droid and Claude Code (section 9).
- No registry, marketplace hosting, or package-manager features (dependency resolution, transitive deps).
- No plugin signing, attestation, or evidence tooling.
- Archive, npm and marketplace-catalog sources; semver ranges; `outdated`/`revert` (section 9).
- Plugin default settings (`dev.crucibledx.forge/settings.json`) are not applied in v0.8; they are reported as
  dropped (section 9).
- Website copy (after v0.8, per 0002).

## Design

### 1. Plugin package

The source of truth is an **Agent Plugins 1.0** package ([spec](https://agent-plugins.org/specification)):

```
my-plugin/
  plugin.json                    # $schema + name required; forge additionally REQUIRES semver `version`
  skills/<name>/SKILL.md         # portable (Agent Skills)
  mcp.json                       # portable (Agent Plugins MCP schema; ${PLUGIN_ROOT}/${PLUGIN_DATA})
  dev.crucibledx.forge/          # forge extension namespace for components the standard doesn't cover
    agents/<name>.md             #   subagents (canonical Claude agent format)
    commands/<name>.md           #   slash commands
    rules/<name>.md              #   rules/instructions (frontmatter `paths` for scoping)
    hooks/hooks.json             #   hooks (Claude event names canonical)
    output-styles/<name>.md      #   output styles
    lsp.json                     #   LSP servers
    settings.json                #   default settings (not applied in v0.8; reported)
  tests/                         # optional, ignored by delivery
```

- `extensions["dev.crucibledx.forge"]` in `plugin.json` declares forge metadata: `minForgeVersion` and `harnesses`
  (supported list).
- **Precedence per harness:** a vendor folder for that harness (`com.anthropic/`, `ai.factory/`) when present →
  `dev.crucibledx.forge/` → portable components.
- A package is the unit of versioning and installation. A repo may hold several packages at declared `path`s.
- The parsed form is a `PluginPackage` record (manifest, components by 0002 kind, resolved assets). Emitters read only
  this record.

### 2. Resource coverage (Droid and Claude Code)

| Kind | Claude Code | Droid |
|---|---|---|
| skill | native (`skills/`) | native (`skills/`) |
| command | native (`commands/`) | native (`commands/`) |
| agent | native (`agents/`) | native (Droid merges `agents/` into `droids/` on install) |
| hook | native (`hooks/hooks.json`, `${CLAUDE_PLUGIN_ROOT}`) | native (same file; Droid provides both `${CLAUDE_PLUGIN_ROOT}` and `${DROID_PLUGIN_ROOT}`) |
| mcp | native (`.mcp.json`) | native (same file, mapped to `mcp.json` on install) |
| output-style | native (`output-styles/`) | native (`output-styles/`) |
| rule (always-on) | adapted: forge-owned files `.claude/rules/<plugin>--<name>.md` (user scope `~/.claude/rules/`) | adapted: a generated `SessionStart` hook in the plugin that prints the rule text |
| rule (path-scoped) | adapted: same files, `paths` frontmatter kept | approximated as always-on (reported) |
| lsp | native (`lspServers`) | dropped (reported) |
| settings (defaults) | dropped in v0.8 (reported) | dropped in v0.8 (reported) |
| reference docs | bundled; bodies use skill-relative paths | bundled; bodies use skill-relative paths |

Reference docs ride inside skills (bundled files a skill points at); they are not a 0002 component kind. Emitted
plugin output never contains absolute paths (plugin-root variables only), so output hashes are machine-independent.
Every adaptation and every drop appears in the **portability report**, per harness, at validate and at sync time.

### 3. Sources

| Source type | Config | Pinning |
|---|---|---|
| `local` (existing) | `path` | Content hash |
| `git` (extended for plugins) | `url`, `path` (package subdir), `ref` (branch, tag or SHA) | `ref` resolves to a commit SHA at lock time |

- `ref` and the `branch` deprecation apply to **plugin sources only** in v0.8; loose-resource git sources keep their
  existing schema untouched.
- With neither `ref` nor `branch` given, the existing default applies (`branch: 'main'`). An explicitly written
  `branch` warns as a deprecated alias for `ref`. `branch` explicitly written **together with** `ref` is a named
  error; the check runs on the raw config before the schema default is applied, so a `ref`-only config never
  misfires.
- For plugin sources, `layout`/`include`/`exclude`/`map` are rejected with a named error: a plugin package is
  self-describing, so source-side remapping would make the lock unverifiable.
- Git uses the user's own credentials, non-interactively (`GIT_TERMINAL_PROMPT=0` contract); `GH_TOKEN` works through
  the `gh` credential helper.

### 4. Lockfile and variant

```yaml
plugins:
  - name: crucible-loop
    source: {type: git, url: git@github.com:crucibledx/factory-loop.git, path: plugins/crucible-loop, ref: main}
    harnesses: [claude-code, droid]   # optional; default: every enabled harness with plugin support
    scope: project                    # project | user
```

- **Lockfile** `.crucible/forge.lock` (project, committed) and `~/.crucible/forge/forge.lock` (user). Per plugin:
  name, manifest `version`, source descriptor, resolved commit SHA (git), `contentHash` (skills-lock v2 algorithm over
  the package files), and `outputs[<harness>]`: the same hash over **everything forge delivers to that harness for
  the plugin**, i.e. the emitted plugin directory plus any loose files placed outside it (Claude rule files), each
  keyed by a scope-independent relative destination (`plugin/<path>`, `claude-rules/<file>`). Registrar settings
  keys are not part of it: they carry machine paths and no plugin content.
- **Sync lock discipline (v0.8.0).** `forge sync` is the only locking command until the §7 commands land. For each
  `plugins:` entry: no lock entry → resolve, lock, install. Lock entry present and the source descriptor in config
  is unchanged → install the locked content verbatim. Source descriptor changed (different `url`/`path`/`ref`/
  `scope`) → re-resolve, relock, install. For a `local` source, whose pin is content, sync also relocks when the
  folder's current content hash differs from the locked one and reports the relock; a `local` path that does not
  exist aborts before any write with a source error naming the plugin. A git branch moving upstream does not change
  what sync installs.
- **Variant.** The lockfile has a top-level `variants` map, one entry per harness:
  `variants[<harness>] = "sha256:" + hex(sha256(lines))`, where `lines` is `<name>@<version> <outputHash>\n` for every
  plugin installed into that harness, sorted by name. Both scopes compute it; the **project-scope** variant is what
  Ember's resource resolver and `forge bench` record as `crucible.variant`. It changes when any delivered byte
  changes and never because of config order, paths or timestamps. No separate manifest file is written.
- **Cache.** Forge copies each resolved package and its emitted outputs to `.crucible/plugins/<name>/<version>/`
  (project) or `~/.crucible/forge/plugins/<name>/<version>/` (user), and writes `.crucible/plugins/.gitignore`
  containing `*`: the cache is never committed, the lock is the source of truth. On a cache miss, `forge sync`
  re-fetches (git: the locked SHA; local: re-copies the locked path) before any planning; if the fetch fails, the
  sync aborts before any write with a source error naming the plugin (BR-01 discipline). A successful sync prunes
  cache versions no longer referenced by the lock; removing a plugin removes all its cached versions.
- **Report.** `forge sync` ends its report with the installed plugin set, per-harness status, and the `variants`
  values, so the variant tag is visible without a wave-2 command.

### 5. Delivery: emitters and registrars

**Emitters** (domain, pure): `PluginPackage` × harness → output files + portability report. v0.8 has two:
`claude` (the canonical Claude Code layout: `.claude-plugin/plugin.json`, `skills/`, `commands/`, `agents/`,
`hooks/`, `.mcp.json`, `output-styles/`) and `factory` (the **same canonical layout** plus the generated
`SessionStart` rule hook; Droid translates the layout on install per the Complete-don't-compete section). Output
goes to `<cache>/<name>/<version>/<harness>/`.

**Capability.** 0002's `HarnessPluginCapability` is `{emit: EmitterId; register: RegistrarId}`. The field lands
unset in 0002; #56 sets it on `droid` (`factory`, `droid-settings`) and #57 on `claude-code` (`claude`,
`claude-settings`). An enabled harness without a capability (Cursor, Copilot, Cline, Windsurf today) keeps its
loose-resource sync and gets one report line per plugin: "plugins are not supported for <harness> yet".

**Local marketplace.** Each cache root is a forge-owned marketplace with its own name: `crucible-forge-user` for
the user cache, and `crucible-forge-<id>` for a project cache, where `<id>` is the first 12 hex characters of the
sha256 of the project root's canonical absolute path. Distinct names are required: Claude Code resolves a
same-name `extraKnownMarketplaces` entry from the highest-precedence settings file whole, and its marketplace state
is user-wide, so a shared name would let a project entry shadow the user catalog or another project's. Forge writes
both catalog files — `.claude-plugin/marketplace.json` (read by Claude Code) and
`.factory-plugin/marketplace.json` (read by Droid) — each with one entry per installed plugin carrying the plugin's
`name`, `version` and a relative-path `source` pointing at its emitted output. Forge rewrites these files whole on
every install; they are cache files, not user files. Because the harness installs from forge's copy of the locked
bytes, the installed bytes are the locked bytes and a harness's own update cannot move off the lock.

**Registrars** (infrastructure) are file-only and run no harness CLI. Each writes two keyed entries (section 6):
`extraKnownMarketplaces["<marketplace>"]` (source: the cache root, an absolute path) and
`enabledPlugins["<name>@<marketplace>"] = true`, with `<marketplace>` the scope's name above. The sync report prints
the marketplace name and plugin IDs.

| Harness | Project scope | User scope | Rules |
|---|---|---|---|
| Claude Code | `.claude/settings.local.json` (`directory` source) | `~/.claude/settings.json` | files in `.claude/rules/` (user: `~/.claude/rules/`) |
| Droid | `.factory/settings.local.json` (local-path source) | `~/.factory/settings.json` | generated `SessionStart` hook in the plugin |

Project scope writes the harness's local settings file, not the shared one, because the marketplace path is absolute
and the cache is per machine. Both harnesses install settings-declared plugins themselves (on next start; Claude Code
only once the user trusts the folder); the plan says so. Uninstall removes exactly the two keys per plugin, the
plugin's rule files, and its cache entry; the marketplace key goes when the last plugin in that scope goes.

### 6. Safety: keyed-merge mutation

**New mutation kind.** `KEYED_MERGE` joins `MUTATION_TYPES` (today a closed 4-kind union consumed by the transaction
layer and the safety ledger). Its PR amends the frozen contract in the open with **new keyed-merge behavior rows**
rather than re-scoping existing ones: spec 0001, `docs/safety-contract.md`, and `scripts/safety-ledger.ts` gain
BR-11 rows (key-level ownership; cleanup removes owned keys only; state persistence; whole-file snapshot/rollback),
and `bun run check:contracts` must pass. Keyed-merge cases join the native-macos/native-windows lanes.

- Forge owns specific key paths only, never whole files: object members (`extraKnownMarketplaces["<name>"]`,
  `enabledPlugins["<id>"]`) and array entries. Sibling user keys are never touched.
- **Arrays merge by identity key, not by index.** Each owned array path declares its identity: a field
  (`plugins[].name` in catalogs) or, for arrays of strings, the value itself. Forge finds the entries it owns
  (recorded in state) by identity and replaces each one whole, never deep-merging user fields into it; it keeps
  existing order, appends new entries, and on removal deletes exactly its own. A user entry with a forge-owned
  identity is a drift conflict; duplicate or missing identities in an owned array are a named error. The approach
  follows the `mergeByKey` helper in
  [AdaptUI](https://github.com/NazarUsik/AdaptUI/blob/main/src/utils/object/merge.ts) (MIT): same semantics, not the
  code, which rebuilds objects through lodash (dropping comments), uses one key at every depth, folds keyless entries
  into one, and cannot delete. Forge applies each change as a targeted `jsonc-parser` edit.
- A missing target file is created with only forge's keys. Planning rejects a merge when a forge-owned key was
  modified externally without `--force` (drift error, like file drift today), and when the file is unparseable.
  Backups cover the whole file; rollback restores the snapshot.
- JSON/JSONC only in v0.8. TOML (Codex) comes with the v0.10 harness wave (section 9).

**State v3.** State entries gain `ownedKeys`: key path (array entries by identity, e.g. `plugins[name=foo]`) → sha256
of the merged value (the algorithm state v2 uses for file hashes), so uninstall removes exactly forge's keys and drift
detection compares values. Migration mirrors the v2 rules (`src/infrastructure/config/state.ts`): the v2→v3 upgrade
happens only inside a committed transaction; the schema parses strictly; older CLIs refuse a v3 file at state parse
(the existing strict schema already rejects unknown versions); the v3 CLI adds a named downgrade-refusal error for
any version greater than 3. A v2 file reads and upgrades transparently, with empty `ownedKeys`.

**`--force`.** New flag on `forge sync`, `forge plugin add`, and `forge plugin update`: permits overwriting
externally modified forge-owned keys and files (drift), and nothing else. The plan always lists what `--force`
overrode. `--force` wins for the run over any configured conflict strategy (`sync.local_conflict_strategy`,
`keep_local`). `--yes` (non-interactive confirm) never implies `--force`.

### 7. Commands

Every new command supports `--json` and full flag equivalents; mutating commands also support `--yes`, and cancel
exits non-zero.

| Command | Purpose | Issue |
|---|---|---|
| `forge plugin validate [path]` | Static validation + per-harness portability report (also runs before every install) | #55 |
| `forge sync` | Resolves, locks, emits and installs everything in `plugins:` per the §4 lock discipline | #55, #56, #57 |
| `forge plugin add <name> --source local:<path>\|git:<url> [--path …] [--ref …] [--scope …] [--force]` | Record the plugin in config, resolve, lock, install | wave 2 (v0.8.x) |
| `forge plugin remove <name>` / `forge plugin update [name]` | Remove owned keys and files / re-resolve `ref` and relock | wave 2 (v0.8.x) |
| `forge plugin list [--json]` | Installed plugins, versions, per-harness status and `variants` | wave 2 (v0.8.x) |
| `forge marketplace emit [--check]` | Producer catalogs (section 8) | wave 2 (v0.8.x) |

`forge status` and `forge health` report plugin drift between lock, cache, and harness settings (wave 2, with
`plugin list`). The repo-root `SKILL.md` (forge's agent surface) describes the plugin workflow and ships with
`plugin add`, together with the skills-ref validation port (moved out of #55 to keep it under the size limit).
`docs/plugins.md` (the first-run how-to: config block, what sync writes, the restart/folder-trust step) ships with
#56.

### 8. Marketplace emit (producer side, v0.8.x)

`forge marketplace emit` turns a repo of plugin packages into a marketplace that Droid and Claude Code can install
from without forge. Input is a `marketplace:` section in the producer's forge config (`name`, `owner`, `plugins:`,
a list of package paths, and `output:`, a repo-relative directory, default `dist/plugins/`). Neither harness reads
the Agent Plugins source layout directly (the `dev.crucibledx.forge/` namespace, portable `mcp.json`), so emit
**publishes harness-ready packages**: it runs the §5 emitter for each package into `<output>/<name>/` and points the
catalogs at those trees, never at the source packages. One tree serves both harnesses (Droid translates the Claude
layout). Because no forge runs on the consumer side to place loose files, rules in a published package always use
the generated `SessionStart` rule hook (Claude Code also adds `SessionStart` hook output to context); path-scoped
rules are approximated as always-on and reported. Output is the emitted trees plus
`.claude-plugin/marketplace.json` and `.factory-plugin/marketplace.json`, one entry per declared package with its
manifest `name`, `version` and a relative-path source pointing at `<output>/<name>/`. Producers commit all of it.

- Every declared package passes `forge plugin validate` first; one failure aborts emit before any write.
- Forge owns `<output>/<name>/` for each declared package whole and rewrites it on every emit.
- Catalogs are written through the keyed-merge mutation (section 6). Forge owns only the `plugins[]` entries for the
  packages it declares, plus top-level fields when it creates the file; hand-written entries survive.
- `--check` writes nothing and exits non-zero, naming each stale catalog or emitted tree, when the files differ from
  what emit would write. Producers run it in CI.

### 9. Later releases

| Item from the original plan | Where it goes |
|---|---|
| Codex and Copilot delivery (`agent-plugins` emitter, Codex/Copilot registrars, TOML keyed merge, their load checks, marketplace catalogs as a source and the Codex/Copilot emit locations) | v0.10 harness wave, after the v0.9 compile release |
| Cursor (`cursor` emitter) and Devin registrar | v0.11 harness wave |
| OpenCode and Kilo (`shim` emitter: a generated JS plugin carrying components through their transform APIs) | v0.11 harness wave |
| Cline and custom harnesses (`pseudo` emitter: data-driven placement via the 0002 `components` model) | v0.11 harness wave |
| Antigravity | Backlog, conditional on owner capacity |
| Semver ranges over tags, tag/manifest version check, `forge plugin outdated` / `revert`, lockfile `previous:` | v0.10 harness wave, with the source work |
| Archive (HTTPS + sha256) and npm sources, `forge plugin import`, `apm.yml` as a source | Backlog, not scheduled |
| Plugin default settings (opt-in keyed merge, `--accept-settings`, `settings: allow`) | v0.10 harness wave |
| `forge plugin pack`, `npx plugins` interop | Backlog, not scheduled |

### 10. Direction: from delivery to artifact management

With this spec, forge stops being a file sync and becomes a package manager for coding harnesses. A plugin is an
artifact: named, versioned, content-hashed, fetched from a repository, pinned in a lockfile, and installed into
targets. The consumer side reads like npm, but the closer model is the Maven/Gradle family: one declarative source, a
fixed lifecycle (validate → resolve → emit → install), and one output variant per target. That is why the lockfile
records per-harness output hashes and a `variant` per harness: the compile step (spec 0005, planned for v0.9) changes
outputs, not sources, and benchmarks compare variants. Boundaries stay: no transitive dependency resolution (APM),
no registry hosting, and no compiler work in this spec.

## Rollout

v0.8.0 is the first four steps; the rest lands as v0.8.x before v0.9 work starts. Each step is one issue and one PR
(under ~1,500 changed lines), in dependency order:

- **crucibledx/forge-cli#55** (needs 0002 PR 1): package parser, vendored schemas, `forge plugin validate`, portability
  report types, `plugins:` config, `local`/`git` sources per §3, cache, lockfile with `contentHash`/`outputs`/
  `variants`, and the `cover-all` fixture (`e2e/fixtures/plugins/cover-all/`: every kind in section 2, with expected
  adaptations and drops per harness as data). The skills-ref SKILL.md validation port is **not** here; it ships with
  the wave-2 SKILL.md issue.
- **crucibledx/forge-cli#54**: keyed-merge mutation (JSONC), state v3, `--force`, the BR-11 contract and ledger
  amendments, native-lane cases.
- **crucibledx/forge-cli#56** (needs #53, #54, #55): `factory` emitter, local marketplace, Droid registrar, the
  plugin steps in `forge sync` planning, the `droid` capability, and `docs/plugins.md`.
- **crucibledx/forge-cli#57** (needs #53, #54, #55; rebases on #56's sync wiring if it lands first): `claude` emitter,
  Claude Code registrar, rule files, and the `claude-code` capability.
- **Wave 2 (v0.8.x):** `plugin add/remove/update`; `plugin list` with status/health drift and the repo-root
  `SKILL.md` (+ skills-ref port); `forge marketplace emit` and `--check`; the 0004 load check. Docs per step; web
  repo after v0.8 (0002).

## Open questions

- Droid's settings-declared local-path marketplace source shape and its `SessionStart` hook output contract are
  spikes in #56 against the pinned Droid CLI. If Droid cannot declare a local-directory marketplace in settings, #56
  proposes the alternative as a spec change in its PR; it does not invent one. If the `SessionStart` output contract
  fails, v0.8 reports Droid plugin rules as not delivered, the portability report says so, and rule delivery for
  Droid moves to a follow-up.

## Acceptance contract

| ID | Wave | Behavior that must be true | Check (type) | How to run / evidence |
|------|------|----------------------------|--------------|-----------------------|
| AC-1 | v0.8.0 | `forge plugin validate` accepts a conformant Agent Plugins 1.0 package; rejects missing `$schema`/`name` and non-semver `version`; unknown top-level fields warn, never fail | test | validator unit tests + conformance fixtures |
| AC-2 | v0.8.0 | A git plugin source's `ref` (branch, tag or SHA) resolves to a commit SHA that is locked; with neither `ref` nor `branch`, `main` is assumed; an explicit `branch` warns; `branch` explicitly written with `ref` (checked before the schema default), and plugin sources with `layout`/`include`/`exclude`/`map`, each fail with a named error | test | git resolver + config schema unit tests |
| AC-3 | v0.8.0 | The lockfile records name, version, source descriptor, resolved SHA, `contentHash` (skills-lock v2 algorithm) and per-harness `outputs`; `forge sync` installs exactly the locked content even after the source branch moves | test + e2e | lockfile unit tests + sync e2e with an advanced fixture branch |
| AC-4 | v0.8.0 | Sync follows the §4 lock discipline: creates a lock entry when missing, installs the lock verbatim when the source descriptor is unchanged, relocks on a descriptor change or a changed `local` content hash (and reports it), and aborts before any write when a `local` path does not exist | test + e2e | sync e2e per branch of the discipline |
| AC-5 | v0.8.0 | `outputs[<harness>]` covers the plugin directory and loose rule files; `variants[<harness>]` follows the section 4 formula: identical for the same delivered bytes regardless of config order, project path, scope or time, and different when any delivered byte for that harness changes, including an edit to rule text only | test | variant unit tests: two project roots, reordered config, one-byte change in the plugin, rule-text-only change with an unchanged manifest version |
| AC-6 | v0.8.0 | A plugin that fails validation aborts the sync before any write; a cache miss with an unreachable source aborts before any write with a source error naming the plugin | e2e | failing-validation + offline-cache-miss sync e2e |
| AC-7 | v0.8.0 | The portability report names every adaptation and drop in section 2 per harness, at validate and at sync | cli snapshot | `forge plugin validate` and `forge sync` output on the `cover-all` fixture |
| AC-8 | v0.8.0 | The `claude` and `factory` emitters reproduce their golden output from the `cover-all` fixture (same canonical layout; `factory` adds the `SessionStart` hook), with no absolute paths in it | test | golden snapshot suite per emitter + absolute-path grep |
| AC-9 | v0.8.0 | Droid registration writes `extraKnownMarketplaces["<marketplace>"]` and `enabledPlugins["<name>@<marketplace>"]` (marketplace names per §5) into `.factory/settings.local.json` (project) or `~/.factory/settings.json` (user), invokes no harness CLI, and the local marketplace lists the locked version | e2e | Droid registration e2e, both scopes; process-spawn assertion |
| AC-10 | v0.8.0 | Claude Code registration writes the same keys into `.claude/settings.local.json` (project) or `~/.claude/settings.json` (user) with a `directory` source, writes rules as `.claude/rules/<plugin>--<name>.md`, invokes no harness CLI, and the plan notes the folder-trust requirement | e2e | Claude registration e2e, both scopes; process-spawn assertion |
| AC-11 | v0.8.0 | Keyed merges preserve comments, formatting, and user sibling keys; external edits to a forge-owned key block the sync without `--force`; an unparseable settings file blocks with a named error; `--force` overrides drift and the plan lists what it overrode | test | jsonc merge unit tests + drift/force cases |
| AC-12 | v0.8.0 | Keyed merges into arrays match entries by the declared identity key, not index: with user entries before, between and after forge's entries (including arrays of strings), a re-run neither duplicates nor drops entries and keeps user order; removal deletes only forge's entries; a duplicate identity or a keyless entry in an owned array fails with a named error | test | array-merge unit tests on catalog and string-array fixtures |
| AC-13 | v0.8.0 | Removing a plugin from `plugins:` and syncing deletes exactly the forge-owned keys, rule files and cache entries recorded in state v3, in both scopes; `forge uninstall` does the same for project-scope installs | e2e | removal e2e per scope with pre-seeded user keys |
| AC-14 | v0.8.0 | A failed install rolls back the pre-run snapshot, including keyed-merged settings files; `check:contracts` passes with the amended ledger | e2e + contract | rollback e2e with injected apply failure; `bun run check:contracts` |
| AC-15 | v0.8.0 | State v2 files upgrade to v3 inside a committed transaction with empty `ownedKeys`; a v3 file read by an older CLI fails at strict state parse; a state file with a version greater than 3 read by the v3 CLI fails with the named "upgrade forge" error | test | state migration unit tests (upgrade, legacy read, strict-parse refusal, named error on a v4 fixture) |
| AC-16 | v0.8.0 | The cache lives under `.crucible/plugins/` (project) or `~/.crucible/forge/plugins/` (user) with a `.gitignore` of `*`; both local marketplace catalogs list exactly the installed plugins with name, version and relative-path source; a successful sync prunes unreferenced cache versions | e2e | sync e2e, both scopes |
| AC-17 | v0.8.0 | `forge sync` ends its report with the installed plugin set, per-harness status, and the `variants` values | cli snapshot | sync e2e report snapshot |
| AC-18 | v0.8.0 | Only `droid` and `claude-code` declare a plugin capability after #56/#57; an enabled harness without one gets one "not supported yet" report line per plugin, and its loose-resource sync is unchanged | e2e | sync e2e with cursor enabled next to droid; registry unit test |
| AC-19 | v0.8.x | `plugin add`, `remove`, `update` and `list` support `--json` and full flag equivalents, mutating ones support `--yes`, and cancel exits non-zero; `update` relocks a moved `ref` to its new SHA; `list --json` includes `variants` | e2e | agent-mode plugin command e2e |
| AC-20 | v0.8.x | `forge status` and `forge health` report drift between lock, cache and harness settings, including keyed-merge drift | e2e | status/health e2e with seeded drift |
| AC-21 | v0.8.x | The repo-root `SKILL.md` validates against the ported skills-ref rules and describes the plugin workflow | test | skill validation test |
| AC-22 | v0.8.x | `forge marketplace emit` writes the emitted harness-ready tree `<output>/<name>/` per declared package (rules as the `SessionStart` hook) and `.claude-plugin/marketplace.json` and `.factory-plugin/marketplace.json` from the `marketplace:` config, one entry per package with its manifest `name`, `version` and a relative-path source pointing at the emitted tree, never the source package; a rerun is byte-identical | test | golden snapshot per catalog and tree from a two-package producer fixture + rerun diff |
| AC-23 | v0.8.x | Emit preserves hand-written entries and top-level fields; a declared package that fails validation aborts emit before any write; `--check` writes nothing, exits non-zero naming each stale catalog or emitted tree, and exits 0 when current | e2e | emit e2e: pre-seeded catalog, invalid package, stale and current check cases |
| AC-24 | v0.8.0 | Marketplace identities are distinct per cache root: with a user-scope and a project-scope plugin installed together, and with two projects on one machine, each settings file names its own marketplace, every enabled plugin ID resolves against the catalog that contains it, and removing one scope's or project's plugin leaves the others' keys untouched | e2e | registration e2e: simultaneous scopes, two project roots, both harnesses |
| AC-25 | v0.8.x | A published producer tree installs without forge: each harness's own `plugin marketplace add <dir>` + `plugin install <name>@<marketplace>` lists the plugin enabled at the manifest version, and `claude plugin validate` passes on each emitted tree | e2e | producer case in the 0004 load-check jobs (added by whichever of emit and the load check lands second) |

## Sources

- Agent Plugins 1.0 spec and schemas: https://agent-plugins.org/specification, https://github.com/agentplugins/agent-plugins-spec (accessed 2026-11-11).
- Claude Code plugins, marketplaces, settings (`extraKnownMarketplaces` `directory` source, `enabledPlugins`, folder trust) and rules: https://code.claude.com/docs/en/plugins-reference.md, https://code.claude.com/docs/en/plugins/create-marketplace.md, https://code.claude.com/docs/en/settings-reference.md, https://code.claude.com/docs/en/memory.md (accessed 2026-11-25).
- Factory Droid plugins and settings (`extraKnownMarketplaces`, `enabledPlugins`, `settings.local.json`, local marketplaces, Claude-layout translation, plugin-root variables): https://docs.factory.com/harness/plugins, https://docs.factory.com/droid-cli/settings (accessed 2026-11-25).
- Reused tooling: https://github.com/vercel-labs/skills (lock hash v2), https://www.npmjs.com/package/jsonc-parser, https://github.com/microsoft/apm (accessed 2026-11-11).
