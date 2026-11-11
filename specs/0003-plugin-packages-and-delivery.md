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

Part of forge v0.7, together with [0002 harness model and rename](0002-harness-model-and-rename.md) (harness model,
vocabulary) and [0004 delivery verification lane](0004-plugin-delivery-verification-lane.md) (CI testing of plugins in real
harnesses). This spec owns the plugin package format, sources, versioning, and per-harness delivery.

## Problem

Forge syncs loose files from `skills/`, `rules/`, `workflows/` globs. There is no way to deliver a named, versioned
bundle (skills + commands + agents + hooks + MCP + rules) as one unit, pin its version, see what changed, or install
it into harnesses that have native plugin systems. Git sources accept a branch only; there is no tag/sha pinning, no
archive/CDN source, and no lockfile.

## Complete, don't compete

- **Agent Plugins 1.0** is the package format. Forge **vendors its Apache-2.0 JSON Schemas** (`plugin.schema.json`,
  `mcp.schema.json`) and validates with ajv, honoring the spec's two non-fatal cases (unknown top-level fields;
  non-object `extensions` in 1.0) so validation is conformant. The `dev.crucibledx.forge` extension namespace needs
  no registration (reverse-domain convention, spec §8). Forge joins the spec's open hooks PR (#89) and subagents
  Discussion (#91) with implementer evidence instead of proposing new formats.
- **Microsoft APM** owns dependency resolution, transitive deps, and org policy. Forge does not rebuild them; it
  rejects multi-plugin dependency graphs and points users at APM for that. APM's new-target admissions are frozen
  (tracker #3047, 2026-11-10: Kilo/Devin/Cline requests deferred), so upstreaming a Droid target is a post-v0.7
  revisit with forge itself as the evidence of demand. Accepting `apm.yml` as a forge source is a v0.8 candidate.
- **Vercel `skills`**: forge adopts its `skills-lock.json` v2 `computedHash` algorithm verbatim for plugin content
  hashes (stable, documented, MIT) so the ecosystems stay hash-interoperable, and uses its ~80-agent path table
  (which includes Droid and Devin) as cross-check data for the 0002 components model.
- **Vercel `plugins`** (the `npx plugins` installer; its repo is no longer public, so it is treated as a black box):
  forge's `agent-plugins` emitter output stays installable by it, so teams can mix native installers with forge.
- **add-mcp** (Apache-2.0, TS, library API, already covers Factory Droid's `mcp.json` paths) is the reference for
  per-harness MCP config locations; forge reuses its path table rather than re-deriving it.
- **`jsonc-parser`** (MIT, comment/format-preserving) powers JSONC keyed merges; **`smol-toml`** (BSD-3) powers TOML
  merges. SKILL.md frontmatter validation ports the small Apache-2.0 `skills-ref` rules to TS (the official Python
  validator is demo-only; a Python runtime dependency is not acceptable).
- Harness marketplaces stay the vendors'; forge reads their catalogs and generates all four formats for producers
  (section 4) instead of running a registry. The official `agent-plugins-conformance` plugins are reused as
  verification fixtures (0004).
- What forge adds that nobody has: delivery into Droid, Kilo, OpenCode and Cline; pinned, scheduled, transactional
  installs with drift and rollback; and the cross-harness verification lane.

## Goals

- Deliver an Agent Plugins 1.0 package, versioned and pinned, into every tier-1 harness.
- Use each harness's native plugin system where it exists; manage a pseudo-plugin where it doesn't.
- Source plugins from git (any host, with ref/tag/sha and semver ranges), local folders, HTTPS archives/private CDNs,
  and marketplace catalogs.
- Record exactly what was installed in a committed lockfile; support update, outdated, and drift reporting.
- Keep every write inside the safety contract, including keyed merges into harness settings files.
- Leave seams for the future compiler (per-harness emit stage), without designing it.

## Non-goals

- No registry, marketplace hosting, or package-manager features (dependency resolution, transitive deps). APM's territory.
- No plugin signing, attestation, or evidence tooling.
- No npm plugin source (v0.8).
- No `forge plugin import` converter (v0.8).
- No hooks on code-only-plugin harnesses (Kilo, OpenCode, Cline) beyond documented fallbacks.
- Website copy (after v0.7, per 0002).

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
    settings.json                #   default settings (opt-in keyed merge only — never auto-applied, see §7)
    lsp.json                     #   LSP servers (Claude/Copilot only)
  com.github.copilot/ …          # optional vendor-native overrides, passed through only to that harness
  com.openai/ …
  tests/                         # optional behavioural tests (0004)
```

- The reverse-domain folder layout follows the Agent Plugins extension convention; `extensions["dev.crucibledx.forge"]`
  in `plugin.json` declares forge metadata: `minForgeVersion`, `harnesses` (supported list), per-harness opt-outs.
- **Precedence per harness:** the harness's own vendor folder → `dev.crucibledx.forge/` → portable components.
  Harnesses reading Agent Plugins natively receive the package as-is plus their vendor folder plus translated
  forge-namespace components.
- A package is the unit of versioning, testing, and installation. A repo may hold several packages (monorepo) at
  declared `path`s.

### 2. Resource coverage

Resource kinds are the 0002 `COMPONENT_KINDS`. Full per-cell notes live in the research brief; the design rules:

| Kind | Native in plugin | Adapted (translation / files / keyed merge) | Not deliverable |
|---|---|---|---|
| skill | Claude, Droid, Codex, Copilot, Cursor, Devin, Antigravity | OpenCode + Kilo (shim plugin or files), Cline (files) | — |
| rule (always-on) | Copilot, Cursor, Devin, Antigravity | Claude (`.claude/rules/` files or SessionStart hook), Droid + Codex (AGENTS.md marker block or SessionStart hook), OpenCode + Kilo (shim `context`/`instructions`), Cline (files) | — |
| rule (path-scoped) | Copilot, Cursor, Devin, Antigravity, Cline, Claude (files w/ `paths:`) | hook-emulated | Droid, Codex, OpenCode, Kilo (approximate only; reported) |
| command | Claude, Droid, Copilot, Cursor | Codex + Devin + Antigravity (converted to skills), OpenCode + Kilo (shim), Cline (workflows) | — |
| agent | Claude, Droid, Copilot, Cursor, Antigravity, Devin (CLI/Desktop only) | Codex (TOML `~/.codex/agents/`), OpenCode + Kilo (files/shim) | Devin cloud sessions; Cline (unverified) |
| hook | Claude, Droid, Copilot, Cursor, Devin, Antigravity | OpenCode + Kilo (generated shim), Cline (event-named scripts; macOS/Linux only) | Codex hooks need user trust |
| mcp | Claude, Droid, Codex, Copilot, Cursor, Devin, Antigravity | OpenCode + Kilo (keyed merge or shim), Cline (**user scope only**) | Cline project scope |
| code tool (non-MCP) | Claude (`bin/`), Copilot CLI (experimental JS extensions), Cline CLI/SDK | rewrap as stdio MCP everywhere else | Droid, Codex, Cursor, Devin, Antigravity, Cline IDE |
| lsp | Claude, Copilot CLI | OpenCode + Kilo (config key) | Codex, Cursor, Cline, Antigravity; Droid/Devin unverified |
| output-style | Claude, Droid | always-on rule (semantic change: reported) | everywhere else |
| settings (defaults) | — | **opt-in keyed merge** per harness (section 7). Claude drops all plugin settings except `agent`/`subagentStatusLine` by design; merge into `.claude/settings.json` only with explicit opt-in and a shown diff | Cline (no config file found) |
| reference docs | all (bundled files) | `${PLUGIN_ROOT}` expands only in MCP/hooks on most harnesses — bodies use skill-relative paths. **Cursor expands nothing**: stdio MCP must be remote, `npx`, or use forge-written absolute paths in pseudo mode | — |

Every adaptation and every drop appears in the portability report at validate/sync time, per harness.

### 3. Sources

| Source type | Config | Pinning | Auth |
|---|---|---|---|
| `git` (existing, extended) | `url`, `path` (monorepo subdir), and at most one of `ref` / `tag` / `sha` / `version` (semver range over tags) | Range resolves to a concrete tag at lock time; `ref` resolves to a SHA | User's own git: ssh-agent or credential helper, non-interactive (`GIT_TERMINAL_PROMPT=0` contract). `GH_TOKEN` works through the `gh` credential helper |
| `local` (existing) | `path` | Resolved by content hash | — |
| `archive` (new) | `url`, required `sha256`, optional `header_env` (name of an env var holding an Authorization header) | sha256 | HTTPS only; the env var is never written to config, lock, logs, or reports |
| `marketplace` (new, section 4) | `plugin@marketplace` | Resolves to one of the above, then pinned | Same as the resolved source |

Git source key reconciliation (the existing schema has `branch` plus `layout`/`include`/`exclude`/`map`):

- `branch` stays as a deprecated alias for `ref` (with a warning); combining `branch` with any of `ref`/`tag`/`sha`/
  `version` is a named error, as is combining any two of the four pin keys.
- For plugin sources, `layout`/`include`/`exclude`/`map` are rejected with a named error — a plugin package is
  self-describing, so source-side remapping makes the lock unverifiable.
- Exactly one pin is in effect per plugin: a pin key on the source **or** the plugin-level `version:` (section 5).
  Both present is a named error telling the user which to keep.

npm plugin sources are v0.8 (all of Claude, Droid, Codex, Kilo, OpenCode accept npm natively; forge's own npm fetch
with integrity pinning is a separate piece of work).

### 4. Marketplaces as sources

A marketplace is an **indirection layer**, not a package format. `forge plugin add foo@acme-tools`:

1. Resolve `acme-tools` from the `marketplaces:` section of forge config (name → catalog location: git URL, local
   path, or hosted `marketplace.json` URL).
2. Fetch the catalog with the user's own credentials (same git contract as sources).
3. Parse any of the four catalog schemas and normalize:
   - **Claude schema** `.claude-plugin/marketplace.json` — also used by Droid (fallback), Copilot (`.plugin/`,
     `.github/plugin/`), Codex (legacy), APM. Sources: relative path, `github`, `url`, `git-subdir`, `npm`, `archive`,
     `command`.
   - **Droid schema** `.factory-plugin/marketplace.json` — same fields, no `archive`/`command`; npm with
     `authTokenEnvVar`.
   - **Codex schema** `.agents/plugins/marketplace.json` — `policy.installation`/`policy.authentication` fields;
     string or object sources.
   - **Cursor schema** `.cursor-plugin/marketplace.json` — relative sources only.
4. Resolve the entry's `source` into a forge source (section 3): git URL + ref/sha, git-subdir, or archive.
   - **`command` sources and inline `settings` catalogs are rejected** with a clear error (unpinnable, unsafe).
   - npm entries are rejected in v0.7 with a "supported in v0.8" message.
   - Floating `ref`s resolve to a SHA at lock time.
5. Fetch, verify, lock, and install like any other source. The marketplace never participates after resolution.

This design means **forge owns authentication once**: harnesses install from forge's local copy (section 6) and never
need marketplace credentials — sidestepping Copilot's sign-in-only auth, Codex's undocumented CLI git auth, Cursor's
dashboard-only imports, and headless CI with no credential helper.

Producer side: `forge marketplace emit` generates `.claude-plugin/`, `.factory-plugin/`, `.agents/plugins/`,
`.cursor-plugin/`, and `.github/plugin/` catalogs from one forge manifest, using relative-path sources (the only
universally supported entry type). A forge-built plugin repo is then installable by native harness flows even without
forge. (Deferred if it pushes v0.7 over scope; marked optional in the rollout.)

### 5. Versioning and lockfile

- **Plugin version:** `plugin.json` `version`, required by forge to be semver even though the standard makes it
  optional. A release is an annotated git tag: `v<semver>` (single-plugin repo) or `<name>@<semver>` (monorepo).
  `forge plugin validate` fails when tag and manifest disagree.
- **Consumer config:**

  ```yaml
  plugins:
    - name: crucible-loop
      source: {type: git, url: git@github.com:crucibledx/factory-loop.git, path: plugins/crucible-loop}
      version: ^0.4          # semver range | exact | ref | sha; default: latest release tag
      harnesses: [claude-code, droid, codex]   # optional; default = enabled harnesses
      scope: project         # project | user
      settings: allow        # optional; the only config way to accept §7 settings non-interactively
  ```

- **Lockfile** `.crucible/forge.lock` (committed; per-project) and `~/.crucible/forge/forge.lock` (user scope).
  Per plugin: name, resolved version, source descriptor, resolved commit SHA / archive sha256 / content hash,
  per-harness emitted-output hashes, and `previous:` (the last replaced resolution — name, version, SHA — so
  `forge plugin revert` has a data source; one level deep, updated on every relock).
  - `forge sync` installs exactly the lock; `forge plugin update [name]` moves within the range;
    `forge plugin outdated` lists newer tags; `forge plugin revert <name>` restores the `previous:` resolution.
  - `forge status` / `forge health` report drift between lock, installed copy, and harness state.
  - Native registrations pin the same SHA / local copy, so a harness's own auto-update cannot move away from
    the lock (Droid registers `marketplace@<sha12>` — the 12-char cache key Droid documents, Claude entries pin
    `sha`, Codex/Copilot pin `sha`).
- Out of scope: transitive dependencies (APM's territory), signing/attestation, registry.

### 6. Delivery: emitters and registrars

**Emitters** (domain, pure): `PluginPackage` × harness → output files + a **portability report** (what was
translated, adapted, or dropped, and why). Emitters: `agent-plugins` (passthrough: Codex, Copilot, Devin), `claude`
(Claude Code), `factory` (Droid: `.factory-plugin/`, `droids/`, `mcp.json`, `${DROID_PLUGIN_ROOT}`), `cursor`
(`.cursor-plugin/`), `antigravity`, `shim` (a generated JS plugin for OpenCode v2 `@opencode/plugin` and Kilo `@kilocode/plugin`
carrying skills, commands, MCP, references, and defaults through their transform APIs), and `pseudo` (data-driven
placement via the 0002 `components` model: Cline, Cursor project scope, custom harnesses, and as the fallback when a
shim can't express a component). Cline is always files — its plugins don't run in the VS Code/JetBrains extensions.

**Custom-harness capability.** 0002's `HarnessPluginCapability` is:

```ts
interface HarnessPluginCapability { mode: 'native' | 'pseudo'; emit?: EmitterId; register?: RegistrarId }
```

For `mode: pseudo`, `emit` defaults to `pseudo` and `register` is derived from the harness's `components`, so a
custom harness can declare just `plugin: {mode: pseudo}`. `mode: native` requires both fields.

`mode: native` is allowed only with the **data-only** emitters `agent-plugins`, `claude`, `pseudo` and the
**data-only** registrars `dropIn` (write the package into a declared folder) and `settings-keys` (declared keyed
merge into a declared file). Anything else needs code forge cannot infer from a definition file, so it is rejected
at load (0002 §4).

**Where bytes live:** forge copies each resolved plugin to `.crucible/plugins/<name>/<version>/` (project) or
`~/.crucible/forge/plugins/<name>/<version>/` (user). These directories are **gitignored caches**, never committed —
the lockfile is the source of truth. On a cache miss, `forge sync` re-fetches from the locked SHA/sha256 before any
planning; if the fetch fails (offline, private host unreachable) the sync aborts before any write with a source
error naming the plugin (BR-01 discipline). Native harnesses install from a forge-generated local marketplace
pointing at that copy, so the installed bytes are the tested bytes, CDN/archive sources work for every harness, and
auth happens once in forge.

**Registrars** (infrastructure) — prefer documented declarative files; harness CLIs only as fallback. v0.7
registrars are file-only wherever a declarative mechanism exists. The one exception is Claude Code at project scope
for plugins that carry MCP servers: the `.claude/skills/<n>/` drop-in (the default) cannot register MCP, so when the
plugin carries MCP the registrar falls back to `claude plugin install --json -s project`, and says so in the plan.
Any CLI invocation is a **post-commit step**: it runs only after the file transaction commits and before the state
write, each step carries a compensating action (`claude plugin uninstall …`), and a failed step runs compensation
and leaves state unwritten so the next sync re-plans cleanly. If the compensation itself fails, the step reports
through the existing recovery-required path: minimal stderr naming the orphaned harness-side registration and the
exact manual command to remove it (e.g. `claude plugin uninstall …`) — the contract forbids claiming recovery
completed when it did not. Registrar steps never run arbitrary plugin code; they
invoke the harness CLI with fixed arguments — pinned in CI (0004), and locally the user's installed CLI, with the
plan recording the version found.

| Harness | Project scope | User scope |
|---|---|---|
| Droid | `.factory/settings.json` `extraKnownMarketplaces` + `enabledPlugins` (auto-installs) | same keys, `~/.factory/settings.json` |
| Claude Code | `.claude/skills/<n>/` drop-in (default; warns MCP skipped); CLI install only when the plugin carries MCP | `~/.claude/skills/<n>/` drop-in (CLI optional) |
| Codex | `.agents/plugins/marketplace.json` + `.codex/config.toml` enable | `~/.agents/plugins/marketplace.json` + `~/.codex/config.toml` |
| Copilot | `.github/copilot/settings.json` `extraKnownMarketplaces` + `enabledPlugins` (cloud agent reads this file) | `~/.copilot/settings` (CLI optional, needs sign-in) |
| Devin | `.devin/config.json` `requiredPlugins` pinned to git SHA, or pseudo `.devin/*` | pseudo (`devin plugins install` needs login) |
| Cursor | pseudo (`.cursor/{rules,skills,agents,hooks.json,mcp.json}`) | `~/.cursor/plugins/local/<n>` |
| Antigravity | `.agents/plugins/<n>/` drop-in | `~/.gemini/config/plugins/<n>/` |
| OpenCode | shim plugin entry in `opencode.json` (exact-version pinned), or pseudo files + keyed merges | same at user scope |
| Kilo | shim plugin entry in `kilo.jsonc`, or pseudo files + keyed merges | same at user scope |
| Cline | pseudo (files in `.cline/`/`.clinerules/`; **MCP is user-scope only**) | pseudo (global paths + `cline_mcp_settings.json` keyed merge) |

Dropped/downgraded components are always reported (portability report in `forge sync` output and `forge status`).

### 7. Safety: keyed-merge mutation and settings opt-in

**New mutation kind.** `KEYED_MERGE` joins `MUTATION_TYPES` (today a closed 4-kind union consumed by the transaction
layer and the safety ledger). The M4 PR series therefore amends the frozen contract in the open: spec 0001,
`docs/safety-contract.md`, and `scripts/safety-ledger.ts` gain the keyed-merge rows (key-level ownership extends
BR-02; cleanup removes owned keys only, BR-03; state persistence, BR-04; snapshot/rollback of the whole file,
BR-06), and `bun run check:contracts` must pass. Keyed-merge cases also join the native-macos/native-windows lanes
in M4 — the existing lanes cover only the four file-level mutation kinds.

- Forge owns specific key paths only: `extraKnownMarketplaces["<name>"]`, `enabledPlugins["<id>"]`, `mcpServers["<n>"]`,
  `plugins[...]` array entries, etc. Sibling user keys are never touched.
- Planning rejects a merge when a forge-owned key was modified externally without `--force` (drift error, like file
  drift today), and when the file is unparseable. Backups cover the whole file; rollback restores the snapshot.
- Libraries (new dependencies, checked per engineering standards): `jsonc-parser` (Microsoft, MIT) for JSONC with
  comment/format preservation; TOML: `smol-toml` or equivalent with round-trip editing — final pick at
  implementation, must preserve user formatting. Codex `config.toml` merges use dotted-key paths only.

**State v3.** State entries gain `ownedKeys`: a record of key path → sha256 of the merged value (same algorithm state v2 uses
for file hashes), so uninstall removes
exactly forge's keys and drift detection compares values, not just files. Migration mirrors the v2 rules
(`src/infrastructure/config/state.ts`): the v2→v3 upgrade happens only inside a committed transaction; the schema
parses strictly; a v3 file is refused by older CLIs at state parse (the existing strict schema already rejects
unknown versions); the v3 CLI adds a named downgrade-refusal error for any version greater than 3, so the same
protection applies to future versions. A v2 file reads and upgrades transparently. `version: 3` files record `ownedKeys` per merged file; v2 entries upgrade with an
empty `ownedKeys`.

**`--force`.** New flag on `forge sync`, `forge plugin add`, and `forge plugin update`: permits overwriting
externally-modified forge-owned keys and files (drift), and nothing else. The plan always lists what `--force`
overrode. `--force` wins for the run over any configured conflict strategy (`sync.local_conflict_strategy`,
`keep_local`), which applies only when `--force` is absent. `--yes` (non-interactive confirm, section 8) is
independent and never implies `--force`.

**Settings opt-in.** A plugin's `settings.json` defaults are applied only when the user explicitly accepts them:
per plugin via `settings: allow` in config, or per command via `--accept-settings` on `plugin add`/`update`.
Interactive runs show the planned settings diff and ask; non-interactive runs without acceptance **skip** settings,
report the skip in the portability report, and still exit 0. `--yes` never implies settings acceptance.

### 8. Commands and config

New commands (all with `--json`, `--yes`, and full flag equivalents; cancel exits non-zero):

| Command | Purpose |
|---|---|
| `forge plugin add <name\|name@marketplace> [--source git:<url> [--path …]] [--version …] [--scope …] [--accept-settings] [--force]` | Resolve, validate, fetch, lock, plan + install. `--source` adds a plugin that is in no configured marketplace and records the source in config — the first-run entry point |
| `forge plugin list [--json]` | Installed plugins, versions, per-harness status |
| `forge plugin remove <name>` | Remove registrations and files (owned keys/files only) |
| `forge plugin update [name]` / `outdated` / `revert <name>` | Lockfile lifecycle |
| `forge plugin validate [path]` | Static validation + per-harness portability report (also runs pre-install) |
| `forge plugin pack --harness <id> --out <dir>` | Emit exact per-harness output (dev + golden snapshots); `agent-plugins` output stays installable by `npx plugins` |
| `forge marketplace emit` | Generate all catalog formats for a producer repo (optional, see rollout) |

`forge sync` installs/updates everything in `plugins:` per the lockfile, and `forge status`/`health` include plugin
drift. Validation failure aborts before any write (BR-01 discipline).

### 9. Compiler seam

Emitters consume an intermediate `PluginPackage` record (parsed manifest + components + resolved assets), not raw
files. The future compiler ([hq research](https://github.com/crucibledx/hq/blob/main/research/forge-compiler-research.md))
plugs in between parse and emit — optimizing, tree-shaking, and ordering components before the same emitters run —
without any adapter changes. The lockfile's per-harness output hashes double as the compiler's change-detection
input. No compiler work is in this spec.

## Rollout

Milestones, each shipped as small PRs (dependency order):

- **M1:** package parser + `forge plugin validate` (vendored schemas, ajv, forge namespace, portability report v0) +
  the `cover-all` fixture plugin with expected adaptations/drops encoded as data (0004 consumes it from here).
- **M2:** git pinning (`ref`/`tag`/`sha`/semver ranges, `branch` alias, key reconciliation) + the `archive` source.
- **M3:** lockfile (with `previous:`) + `plugins:` config + `plugin add/list/remove/update/outdated/revert`
  (agent-native from day one).
- **M4:** keyed-merge mutation (JSONC via `jsonc-parser`, TOML via `smol-toml`) with key ownership, drift, rollback —
  including the spec 0001 / safety-contract / safety-ledger amendments, state v3, and keyed-merge cases in the
  native-macos/native-windows lanes.
- **M5:** `agent-plugins`, `claude`, `factory` emitters + Droid, Claude, Codex registrars (post-commit CLI step for
  Claude MCP-carrying plugins).
- **M6:** `cursor` emitter + Copilot, Cursor, Devin registrars; `antigravity` emitter + registrar only if the
  conditional Antigravity scope (0002 Goals) lands.
- **M7:** `pseudo` emitter (Kilo, Cline, Cursor project scope, custom harnesses) + `shim` emitter (OpenCode, Kilo).
- **M8 (optional):** marketplace catalogs as a source + `forge marketplace emit` for producers. Ships only if M1–M7
  land early; otherwise v0.8. If it ships, AC-6 gains the producer direction (emitted catalogs parse with each
  vendor's own tooling).
- Repo-root `SKILL.md` (forge's agent surface) ships with M3. Docs per milestone; web repo after v0.7 (0002).

**De-scope fallback (no estimates, ordering only).** If milestones slip, v0.7a is M1–M5 plus the `pseudo` emitter
from M7: rename, model, package, sources, lockfile, and delivery into Droid, Claude, Codex, Cline and custom
harnesses. The first candidates to move to v0.7b are the M6 registrars (Copilot, Cursor, Devin), then the `shim`
emitter, then the conditional Antigravity scope. M8 is always the first cut.

## Open questions

- Should `forge marketplace emit` (producer catalogs in all four formats) be in v0.7 scope or deferred to v0.8? Recommended: defer unless M1–M7 finish early; it is marked M8-optional above.
- Registrar details marked UNVERIFIED in the research (Claude reading Agent Plugins natively, Droid `portableOnly`, Cursor/Devin cache layouts, which file `kilo plugin` writes) are engineering spikes during M5–M7, not product decisions.

## Acceptance contract

| ID | Behavior that must be true | Check (type) | How to run / evidence |
|------|----------------------------|--------------|-----------------------|
| AC-1 | `forge plugin validate` accepts a conformant Agent Plugins 1.0 package; rejects missing `$schema`/`name` and non-semver `version`; unknown top-level fields warn, never fail | test | validator unit tests + conformance fixtures |
| AC-2 | A git tag that disagrees with the manifest `version` fails validation, for both tag schemes (`v<semver>` and monorepo `<name>@<semver>`) | test | validator fixtures, both schemes |
| AC-3 | A git source with a semver range resolves to the highest matching tag and locks its SHA | test | git resolver unit test with a fixture bundle |
| AC-4 | `ref`/`tag`/`sha` pins resolve exactly; combining two pin keys, `branch` plus a pin key, a source pin plus plugin `version:`, or plugin sources with `layout`/`include`/`exclude`/`map` each fails with a named error | test | git resolver + config schema unit tests |
| AC-5 | The archive source verifies `sha256`, refuses mismatches, and never persists the auth env value in config, lock, logs, or reports | test + e2e | archive loader tests + redaction grep |
| AC-6 | A marketplace entry from each of the four catalog schemas resolves to a forge source; `command` sources and inline `settings` catalogs are rejected with a named error; npm entries are rejected with a "v0.8" message | test | catalog parser fixtures (4 schemas + reject cases) |
| AC-7 | The lockfile records name, resolved version, source descriptor, resolved SHA/sha256, content hash (skills-lock v2 algorithm), per-harness output hashes, and `previous:`; `forge sync` installs exactly the locked content | test + e2e | lockfile unit tests + sync e2e |
| AC-8 | `plugin update` moves within the range, `outdated` lists newer tags, `revert` restores the `previous:` locked version | e2e | plugin lifecycle e2e |
| AC-9 | Every emitter (`agent-plugins`, `claude`, `factory`, `cursor`, `pseudo`; `shim` unless the de-scope fallback moves it to v0.7b; `antigravity` if its scope lands) reproduces its golden output from the `cover-all` fixture | test | golden snapshot suite per emitter |
| AC-10 | The portability report names every adaptation and drop per harness at validate and at sync | cli snapshot | `forge plugin validate` output on the fixture |
| AC-11 | Droid registration writes `extraKnownMarketplaces` + `enabledPlugins` pinned to the locked SHA in `.factory/settings.json`; a harness auto-update cannot move the install off the lock | e2e | Droid registration e2e |
| AC-12 | Claude Code registration defaults to the `.claude/skills/<n>/` drop-in with the MCP-skipped warning, and uses the post-commit `claude plugin install` step only for MCP-carrying plugins; a failed CLI step runs its compensating uninstall and leaves state unwritten; a failed compensation reports the orphaned registration and the manual removal command | e2e | Claude registration e2e, both paths + injected CLI failure + injected compensation failure |
| AC-13 | Codex registration writes `.agents/plugins/marketplace.json` and enables the plugin in `.codex/config.toml` pinned to the locked SHA | e2e | Codex registration e2e |
| AC-14 | Copilot registration writes `.github/copilot/settings.json` (`extraKnownMarketplaces` + `enabledPlugins`) pinned to the locked SHA | e2e | Copilot registration e2e |
| AC-15 | Devin registration writes `requiredPlugins` pinned to the locked SHA in `.devin/config.json` | e2e | Devin registration e2e |
| AC-16 | Cursor installs at user scope to `~/.cursor/plugins/local/<n>/` and at project scope as pseudo files | e2e | Cursor e2e, both scopes |
| AC-17 | (Conditional, with the Antigravity scope) Antigravity installs as the `.agents/plugins/<n>/` drop-in | e2e | Antigravity e2e |
| AC-18 | OpenCode and Kilo receive the generated shim plugin (exact-version pinned) carrying skills/commands/MCP/defaults; Cline receives files with MCP at user scope only | e2e | shim + cline e2e |
| AC-19 | Keyed merges preserve comments, formatting, and user sibling keys; external edits to a forge-owned key block the sync without `--force`; an unparseable settings file blocks with a named error; `--force` overrides drift and the plan lists what it overrode | test | jsonc/toml merge unit tests + drift/force cases |
| AC-20 | `forge plugin remove` and `forge uninstall` delete exactly the forge-owned keys and files recorded in state v3, nothing else | e2e | removal e2e with pre-seeded user keys |
| AC-21 | Settings delivery is opt-in: applied with `--accept-settings` or `settings: allow`, shown as a diff interactively, skipped-and-reported otherwise; `--yes` never implies acceptance | cli snapshot + e2e | `plugin add` output on a settings-carrying fixture; non-interactive skip case |
| AC-22 | Every plugin command supports `--json`, `--yes`, full flag equivalents, and exits non-zero on cancel; `plugin list` and `plugin pack` produce the documented output | e2e | agent-mode command e2e |
| AC-23 | The repo-root `SKILL.md` validates against the ported skills-ref rules and describes the plugin workflow | test | skill validation test |
| AC-24 | A plugin that fails validation aborts the sync before any write (BR-01 discipline); a missing plugin cache with an unreachable source also aborts before any write with a source error naming the plugin | e2e | failing-validation + offline-cache-miss sync e2e |
| AC-25 | A failed install rolls back the pre-run snapshot, including keyed-merged settings files; `check:contracts` passes with the amended ledger | e2e + contract | rollback e2e with injected apply failure; `bun run check:contracts` |
| AC-26 | State v2 files upgrade to v3 inside a committed transaction with empty `ownedKeys`; a v3 file read by an older CLI fails with the named "upgrade forge" error; a v2 file still reads correctly | test | state migration unit tests (upgrade, legacy read, downgrade refusal) |
| AC-27 | `forge status` and `forge health` report drift between lock, installed copy, and harness state (including keyed-merge drift) | e2e | status/health e2e with seeded drift |
| AC-28 | `forge plugin pack --harness agent-plugins` output installs with `npx plugins` | e2e | pack + install round-trip |
| AC-29 | A custom harness with `plugin.mode: native` using a data-only emitter (`agent-plugins`/`claude`/`pseudo`) and registrar (`dropIn`/`settings-keys`) is accepted; any other combination is rejected at load with a named error | test | definition registry validation tests |

## Sources

- Agent Plugins 1.0 spec, schemas, governance, and open hooks/subagents work: https://agent-plugins.org/specification, https://github.com/agentplugins/agent-plugins-spec (accessed 2026-11-11).
- Marketplace catalog formats and auth per vendor: code.claude.com/docs/en/plugins/marketplace-reference.md, docs.factory.com/harness/plugins, developers.openai.com/plugins/build/plugins.md, docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference, cursor.com/docs/reference/plugins.md, docs.devin.ai/cli/extensibility/plugins/overview (accessed 2026-11-11).
- Resource coverage per harness: vendor plugin docs as listed in the research brief (accessed 2026-11-11).
- Reused tooling: https://github.com/vercel-labs/skills (lock hash v2), https://github.com/neon-solutions/add-mcp, https://www.npmjs.com/package/jsonc-parser, https://www.npmjs.com/package/smol-toml, https://github.com/microsoft/apm + OpenAPM spec (accessed 2026-11-11).
