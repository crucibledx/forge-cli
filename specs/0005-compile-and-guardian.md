---
id: "0005"
title: "Compile and guardian"
status: approved
scope: project
target_repos: [forge-cli]
assets: needed
size: mission
idea_issue: "crucibledx/forge-cli#52"
created: 2026-11-26
---

# 0005: Compile and guardian

Forge v0.9. Builds on [0002](0002-harness-model-and-rename.md), [0003](0003-plugin-packages-and-delivery.md) and
[0004](0004-plugin-load-check.md). 0003 §10 set the boundary: compile changes what forge delivers to each harness,
never the source packages, and the lock's per-harness `outputs` and `variants` record the result. v0.9 compiles for
**Droid and Claude Code**; Codex and Copilot follow with their delivery in the v0.10 harness wave (§9). Evidence: the
[harness context budgets research](research/harness-context-budgets.md) (cited as R§n, its compile rules as "rule n")
and the compiler POC on branch `poc/forge-compiler` (read-only, never merged).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/crucibledx/assets/raw/main/forge/diagrams/dark/forge-compiler-pipeline.svg">
  <img alt="Forge compile pipeline: packages, compile passes per harness and scope, emit, lock and install" src="https://github.com/crucibledx/assets/raw/main/forge/diagrams/light/forge-compiler-pipeline.svg">
</picture>

## Problem

Every harness shows the model a capped listing of skill and agent names and descriptions; a body loads only when the
model picks it. A handful of public plugins overflows that listing, and each harness cuts by its own rule (load order,
usage, even shrinking, arrival order; R§2–R§6). None ranks by relevance to the current project, and public corpora also
carry outright breakage: duplicate agents, skills without `name`, Claude-only model aliases in Droid.

The POC measured Droid only (48 `droid exec` runs, 92 public plugins, three repetitions per cell, R§7). Copying
everything succeeded 9/12; a "compiled" arm (profile pruning on, profile matches ranked first) 12/12; a "guardian" arm
(every skill out of the listing, the hook note pasted into the prompt because `droid exec` 1.8.0 did not fire the hook)
11/12, at the lowest cost among layouts with plugins installed. The shipped defaults were not measured as such; AC-20
measures them before v0.9 ships.

Forge v0.8 delivers packages byte for byte. It knows every component it installs into each harness, so it is the one
place that can normalize them, remove duplicate noise, fill the listing deliberately and say why.

## Complete, don't compete

- Harnesses already defer tool schemas and MCP tools (Claude Code and Copilot tool search, Codex deferred MCP). Droid's
  Deferred Context Engine defers "internal tool schemas, MCP tool schemas, skills, and plugin instructions" behind a
  discover-and-promote loader (R§3). Forge builds no proxy, no per-request tool filtering, no deferral engine, and no
  prose compression of bodies (rule 11); per-request prefix rewrites lose money against prompt caching (R§7).
- Forge defers only where the harness has no native discovery for unlisted skills. That is harness data (§4), set by the
  issue 4 spike for Droid and off for Claude Code, whose own overflow keeps every name and ranks by usage. When a
  harness gains native discovery, its budget pass and guardian default to off.
- Hiding uses the documented knob: `disable-model-invocation: true` (Droid, Claude Code) keeps a skill installed and
  user-invocable but out of the model's listing (R§3, R§4).
- Delivery stays 0003's emitters, marketplace, lock and registrars; the guardian is one more generated plugin, loaded
  by each harness's own plugin system. Triggers use the Agent Skills `metadata` map, so packages stay valid elsewhere.
- The MCP server uses the official MCP TypeScript SDK (`@modelcontextprotocol/sdk`, MIT, exact version pinned, stdio
  server entry only, covered by `check:security-audit`).
- Ember owns observability: forge writes guardian events (§8); Ember's resource follow-up spec reads them (Ember 0001
  reserves `ember.resource.*`).

## Goals (v0.9)

- Compile every plugin forge delivers to Droid and Claude Code: normalize, dedupe, minify, and, where the harness
  needs it, fit the listing to a budget by user-controlled priority and defer the rest.
- Never delete by default: a deferred skill stays installed and findable through the guardian, and stays
  user-invocable where the harness honors the flag (the report says when it does not).
- Ship the guardian (a `UserPromptSubmit` hook and a stdio MCP server) as a generated plugin when skills are deferred.
- Byte-stable output recorded in the lock and the variant; compile reruns only when its inputs change; mixed-version
  teams never flip the lock.
- `forge compile` explains every decision without writing anything.
- Opt-in profile ranking and pruning from project files.
- Guardian events for Ember, without prompt text, gated per user by telemetry consent.
- Name the Codex and Copilot compile targets and destinations for v0.10.

## Non-goals

- Editing source packages, or writing anywhere other than 0003's cache, owned keys and rule files.
- Proxies, per-request tool filtering, MCP tool pruning, body compression, embeddings, or model calls (rule 11).
- Compiling v0.7 loose resources, components forge did not install, or `forge marketplace emit` output (0003 §8).
- Writing `AGENTS.md` or `CLAUDE.md` (0002 §3). Rule compile is dedupe and size reporting only.
- Ember ingestion, attribute mapping and dashboards.
- Rewriting any harness-read file mid-session (rules 6 and 12).

## Design

### 1. Where compile runs

0003's lifecycle becomes validate → resolve → **compile** → emit → install. Compile is a pure domain function:

```ts
compile(input: {
  packages: PluginPackage[]   // everything 0003 delivers to this harness in this scope, vendor overrides applied
  harness: HarnessId          // 'droid' | 'claude-code' in v0.9
  scope: Scope                // one lock per scope, so one compile unit per (harness, scope)
  config: CompileConfig       // §2, defaults applied
  profile?: Profile           // §6, only when profile is set
}): { packages: CompiledPackage[]; guardian?: PluginPackage; manifest: CompileManifest }
```

- `CompiledPackage` is a `PluginPackage` with targeted frontmatter edits, deferral flags and an emitted version (§5).
  Edits touch only the changed keys; a component compile leaves alone is byte-identical to v0.8's output.
- `compile.enabled: false`, or a harness without compile support, makes compile the identity. Enabled harnesses
  without support get one report line, "compile is not supported for `<harness>` yet".
- Passes, in order: **link → normalize → dedupe → profile → minify → budget → guardian**. Each records a status and an
  ordered reason list per component. Diagnostics carry a code from a closed table
  (`docs/schemas/compile-manifest.v1.json`) and a severity: `error` (fails `forge compile --check`) or `warning`.

| Status | Meaning | In the model listing | Emitted into its plugin | In the guardian index |
|---|---|---|---|---|
| `listed` | fits, or no budget applies | yes | yes | no |
| `deferred` | over budget, duplicate, or `compile.defer` | no | `flag` strategy: yes, with `disable-model-invocation: true`; `store` strategy: no | yes (skills), except duplicates |
| `pruned` | opt-in profile mismatch (§6) | no | no | yes (skills) |
| `invalid` | the harness would reject it | no | no | no |

Component ids are `<plugin>/<kind>/<name>`, stable across scopes and machines.

### 2. Config

```yaml
compile:
  enabled: true                 # default true for droid and claude-code (release-gated by AC-20)
  priority: [crucible-loop, testing-kit]   # plugins that fill the listing first, in this order
  keep: [testing-kit/skill/pytest-runner]  # always listed
  defer: [big-plugin/**]                   # always deferred
  profile: false                # false | rank | prune | {mode: rank|prune, include: [tags], exclude: [tags]}
  guardian: {hook: auto, mcp: auto, min_score: 6}   # each auto | on | off; `guardian: off` turns both off
  harnesses:                    # overrides of the §4 harness data
    droid: {skills: 9500, agents: 9000, skill_description: 199, agent_description: 500}
    claude-code: {skills: off, skill_description: 1536}   # a number for skills turns its budget pass on
```

- `compile:` lives in the config of the scope it compiles, like `plugins:` (0003).
- `keep` and `defer` are `Bun.Glob` patterns over whole component ids. An id matched by both is kept, with a warning;
  a `keep`, `defer` or `priority` entry that matches nothing is a warning naming it.
- **Priority** fills the listing: `keep` matches, then plugins in `compile.priority` order, then (with `profile` set)
  profile matches, then components with more in-unit dependents, then plugin name, then component name. The order of
  `plugins:` is not a signal: 0003 §4 requires the variant to ignore config order.
- When skills are deferred and `priority` is empty, `forge sync` and `forge compile` name the plugins that lost the
  most listing slots and print a ready-to-paste `compile.priority:` line.

### 3. Passes

| Pass | Does | Never |
|---|---|---|
| link | Edges inside the unit from frontmatter `requires`, `subagent_type` references and explicit `/<name>` mentions; unresolved names are warnings | crosses units |
| normalize | Applies the harness's normalize table (harness data). Droid: a skill without `name` gets its directory name; a skill or agent without `description` gets the first non-empty body line (Claude Code's documented fallback); a Claude model alias becomes `inherit`; Claude tool names map to Droid's, and an agent whose mapped list would be empty is `invalid`, because an empty list could widen access. Claude Code: a missing `description` only warns. Every edit is a diagnostic | edits bodies; adds `model:` (rule 8); widens an agent's tools |
| dedupe | Same kind and identical normalized content (every frontmatter key except `name`, the body, and every bundled file by hash) across plugins: the first by priority stays, repeating skills become `deferred` ("duplicate of `<id>`", not indexed) unless `keep` matches them, in which case they stay listed with a warning; identical Claude rule files are emitted once; duplicate agents and commands are reported and still emitted (plugins namespace them); description word-Jaccard ≥ 0.5 warns | renames anything |
| profile | §6, only when `profile` is set | runs by default |
| minify | A description (Claude Code: `description` plus `when_to_use`) over the harness cap keeps its first sentence plus its first "Use when/for …" sentence, cut at a word boundary with `…` if still over (rules 1, 7, 8) | touches bodies, or text under the cap |
| budget | Only for listings whose harness data sets a budget. Walks components in priority order, first-fit: an entry that does not fit is deferred and smaller later ones may still fit. `keep` may exceed the budget, with a warning. Commands count where the harness lists them and defer like skills where the flag applies; otherwise they are a fixed cost with a warning. Agents have no documented hide flag: past the agent budget their descriptions shrink evenly to a 120-character floor, then a warning names the overflow | removes an agent |
| guardian | Builds the guardian package (§5) when `hook` or `mcp` is `on`, or `auto` and a skill is `deferred` (not as a duplicate) or `pruned`. A part set to `off` is left out of the package (`hooks.json` or `mcp.json`). A skill in the store (`store`-deferred or pruned) has no other destination, so the package is built for its store whenever one exists, even with both parts `off` | drops a stored skill |

**Triggers.** A skill may declare `metadata.triggers`, a comma-separated string ("pytest failure, flaky test,
conftest"). The Agent Skills spec types `metadata` as a string map, so any other value warns and is ignored. Triggers
weight the guardian router (§7) and the profile matcher (§6) and never enter the emitted description.

**Reduced features.** Skills read through the guardian lose harness skill features (`allowed-tools`, `context: fork`,
`$ARGUMENTS`, `${CLAUDE_SKILL_DIR}`, `!` injection); compile warns for each deferred skill that uses one.

### 4. Harness data: budgets and strategies

Per harness and listing, in characters, costed the way the harness renders the entry (rules 3, 7, 8). Every value is
domain data overridable under `compile.harnesses`.

| Harness | Listing | Entry cost | Budget default | Description cap | Strategy |
|---|---|---|---|---|---|
| Droid | skills (and commands if listed) | `name + 3 + description` | 9,500, or off if the spike finds native discovery | 199 | `flag`, or `store` if the spike finds the flag ignored on plugin skills |
| Droid | droids | `name + 25 + description` | 9,000 | 500 | — |
| Claude Code | skills and commands | `plugin:name + 4 + description + when_to_use` | off (Claude ranks overflow by usage and scales with the window) | 1,536 (Claude's own cap; 1,024 for cross-harness parity is an override) | `flag` |
| Claude Code | subagents | `plugin:name + 4 + description` | 40,000 (Claude warns near 15,000 tokens) | 1,536 | — |

The **measured cap** per listing (Droid skills about 15,000 characters, R§3) is harness data used only for reports.
Built-ins, loose resources and other plugins share each listing: `forge compile` scans the harness's skill and droid
directories read-only and reports their cost next to forge's share and the measured cap (for Claude Code it also
points at `/context`). The scan never feeds the compile, so output never depends on machine-local files.

**Issue 4 spike (Droid, pinned CLI), recorded in the PR with evidence:** (a) whether an over-budget plugin skill is
discovered natively, with and without the flag; (b) whether `disable-model-invocation` hides plugin skills; (c) on the
route-bench fixture, name-only overflow versus hidden plus guardian. The spike sets Droid's budget default and strategy
in harness data; the acceptance rows cover both strategies.

### 5. Emit, guardian package, lock

**Emitted version.** When compile changes any byte of a plugin's output for a harness, its emitted `plugin.json`
`version`, catalog entry and cache path gain the build identifiers `c.<hex>`, where `<hex>` is the first 8 hex of the
0003 output hash computed over the emitted tree with `version` left at the source value; `outputs[harness]` is then
computed over the final bytes. The version is rebuilt from parsed SemVer fields: `1.2.3` → `1.2.3+c.<hex>`,
`1.2.3+vendor.1` → `1.2.3+vendor.1.c.<hex>`. If issue 1's spike shows a harness ignores build metadata, its emitter
appends `c.<hex>` as prerelease identifiers instead (`1.2.3-c.<hex>`, `1.2.3-rc.1.c.<hex>`), keeping source build metadata.
Cache paths become `<cache>/<name>/<emittedVersion>/<harness>/` (the source copy stays at `<name>/<version>/`); the
lock records `emitted[<harness>]` per plugin, and cache pruning keeps every source and emitted version the lock names.
Variant lines keep the source `<name>@<version>` (0003 §4).

**Deferred skills.** `flag`: the skill stays in its plugin with `disable-model-invocation: true`; the user invokes it
as `/<plugin>:<skill>` on Claude Code and by its Droid name on Droid. `store`: the skill is left out of its plugin and
lives only in the guardian store; it is no longer user-invocable, and every report that counts deferred skills says
so: "118 deferred (not user-invocable on droid; add to `compile.keep` to restore)".

**Guardian package.** One per unit, named `crucible-guardian-project` or `crucible-guardian-user` (plugin and MCP
server key alike, so both scopes coexist), version `1.<COMPILER_VERSION>.0` plus the content suffix above:

```
crucible-guardian-<scope>/
  plugin.json
  mcp.json                               # args: [guardian, mcp, --root, ${PLUGIN_ROOT}, --harness, <id>, --scope, <s>]; Windows: cmd /c forge …
  dev.crucibledx.forge/hooks/hooks.json  # UserPromptSubmit: forge guardian hook --root "${CLAUDE_PLUGIN_ROOT}" --harness <id> --scope <s>, timeout 5
  guardian/index.json                    # {schema, harness, scope, compile_inputs, tool_names, entries, bm25}
  guardian/store/<plugin>/<skill>/       # copies of deferred and pruned skill directories, bundled files included
```

The emitter maps `${PLUGIN_ROOT}` to each harness's plugin-root variable, and on Windows wraps the MCP command in
`cmd /c` so npm's `forge.cmd` shim resolves. The store copies exist because the harness installs plugins into its own
cache, whose path forge does not control; the guardian's root is known at runtime. No emitted file contains an absolute
path (0003 §2). `index.json` is canonical JSON (sorted keys and entries, trailing newline) and holds no per-user
value. `forge health` warns when `forge` is not on `PATH`.

**Lock.** Each plugin's `outputs[<harness>]` already hashes compiled bytes. Additions:

- `lockVersion: 2` (absent means 1). The guardian is a lock entry with `source: {type: generated}`, no SHA, and a
  `contentHash` over its generated tree; it is part of `variants[<harness>]`. `forge plugin remove` and `update` refuse
  `generated` entries with `GeneratedPlugin`.
- `compile[<harness>] = {enabled, inputs: "sha256:…", compiler: <COMPILER_VERSION>}`. `inputs` hashes canonical JSON of
  the effective compile config and harness data, the profile tags (when `profile` is set), `COMPILER_VERSION` and the
  unit's sorted `(name, contentHash)` pairs. `COMPILER_VERSION` is an integer covering every byte compile and emit
  produce for a compiled harness; a CI guard fails when golden compile output changes without a bump.

**Sync discipline** (extends 0003 §4). Compile adds no mutation kind: it changes bytes 0003's transaction writes, the
guardian registers with the same two keyed entries as any plugin, and the manifest is a planned write.

| Lock state | Sync does |
|---|---|
| `compile[h].compiler` greater than this forge's | refuses before any write: `LockFromNewerCompiler` ("upgrade forge") |
| `lockVersion` greater than 2 | refuses before any write: `LockFromNewerForge` |
| no `compile[h]`, compile enabled (a v0.8 lock) | compiles, relocks, and prints: "forge 0.9 compiles plugins for `<harness>`: N listed, M deferred. Set `compile.enabled: false` to keep v0.8 output. See docs/compile.md." Writing `compile[h]` makes this one-time |
| compile disabled | writes `compile[h] = {enabled: false, compiler}`, relocks `outputs` to v0.8's bytes when they differ |
| `inputs` unchanged, plugins reused | installs the locked outputs verbatim |
| `inputs` unchanged, cache miss | recompiles; the result must hash to the locked `outputs`, else aborts before any write with `CompileMismatch` naming the plugin, harness and manifest path, and "report this as a forge bug" |
| `inputs` changed | recompiles, relocks `outputs`, `compile` and `variants`, and reports "recompiled for `<harness>`: `<which input changed>`" |

An older compiler never relocks a newer lock, so mixed-version teams cannot flip it.

**Manifest.** `forge sync` writes `.crucible/compile/<harness>.json` (user scope: `~/.crucible/forge/compile/`) with a
`.gitignore` of `*`: per component its id, status, reasons, entry cost and diagnostics; budget used, limit and measured
cap; profile evidence; `inputs`; and the resulting `variants[<harness>]`. Canonical JSON, no timestamps; schema
`docs/schemas/compile-manifest.v1.json`.

### 6. Profile ranking and pruning (opt-in)

`profile: rank` adds profile matches to priority (§2); `profile: prune` also prunes. Both apply to **project scope
only**; user scope ignores them with a warning. Detection reads only git-tracked files in a git repo (so untracked
scratch never changes output; branches that add a manifest relock), else a depth-3 walk skipping dot-directories and
`node_modules`. It reads manifest and dependency names only; the vocabulary is domain data ported from POC
`poc/compiler/profile.ts`.

A component is technology-specific when its name, plugin name or triggers name a vocabulary technology; its
description counts only when those are silent, and ambiguous words ("go", "node", "sql") never count from
descriptions. Under `prune`, a specific skill, agent or command with no profile tag is `pruned` (skills into the
guardian store only); dependencies of kept components stay; `keep` wins; hooks, MCP servers, rules, output styles and
LSP are never pruned. Tags and evidence are compile inputs and appear in the manifest.

### 7. Guardian runtime

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/crucibledx/assets/raw/main/forge/diagrams/dark/forge-guardian-flow.svg">
  <img alt="Guardian flow: the harness runs the hook and MCP server from the crucible-guardian plugin; both read the compiled index and write events that Ember reads" src="https://github.com/crucibledx/assets/raw/main/forge/diagrams/light/forge-guardian-flow.svg">
</picture>

**Hook** (`forge guardian hook --root <dir> --harness <id> --scope <s>`). Reads the payload from stdin (`prompt`, `session_id`, `cwd`), loads
`<root>/guardian/index.json`, routes, prints the note and exits 0. It fails open: malformed input, a missing index, an
unknown index `schema`, or any error prints nothing, writes `guardian.failed` (if events are on, §8) and exits 0.
`CRUCIBLE_GUARDIAN=off` silences it for a session. The project root is found by walking up from `cwd` to
`.crucible/forge.lock`. Its only effect on context is output appended after the cached prefix (rule 12).

**Router** (ported from POC `poc/guardian/router.ts`). An explicit mention of a skill name wins. Otherwise BM25 over
name words (×3), triggers (×3), plugin (×1) and description (×1), with corpus statistics precomputed at compile. A hook
match needs two or more query terms and a score of at least `max(min_score, 0.6 × top)`; at most three are shown. The
hook is a hint, never a gate: a model-written query through `search_skills` routed much better in the POC (R§7). The
note names the MCP tool by the harness's own identifier (`tool_names` in `index.json`, harness data), says how to find
it when the harness defers MCP tools, and gives the raw path last, because a path in the plugin cache may need a Read
permission:

```text
[crucible-guardian] These installed skills may fit this request. They are not in your skill list.
- pytest-runner (testing-kit): Run and triage pytest failures. Use when tests fail or flake.
Load one with the <load_skill tool id> tool (search your tools for it if it is not listed), or read
/…/guardian/store/testing-kit/pytest-runner/SKILL.md. If none fit, ignore this note.
```

**MCP server** (`forge guardian mcp --root <dir> --harness <id> --scope <s>`, stdio). `search_skills {query}` uses the
router without the two-term minimum and returns up to five matches with id, name, plugin, description and path.
`load_skill {id}` takes a component id (`<plugin>/skill/<name>`), or a bare name when it is unique in the index, and
returns the SKILL.md body and the absolute paths of its bundled files; an unknown id and an ambiguous name (listing the
matching ids) are `isError` results. The hook note gives ids. Tool
descriptions state the index size.

**Debugging.** `forge guardian route "<prompt>" [--harness <id>] [--scope <s>]` prints matches, scores and thresholds
for the installed index and writes no events. Each scope's guardian searches only its own index; a prompt gets at
most one note per scope.

**Issue 5 spikes** (pinned CLIs, recorded in the PR): whether `UserPromptSubmit` fires in headless `droid exec` (R§3;
the POC saw it not fire on 1.8.0); whether reading a store path prompts for permission; the harness tool identifiers;
and whether the guardian's MCP tools stay reachable when tool search or the Deferred Context Engine defers MCP tools.
`forge compile` prints a note when the hook cannot fire headless; the MCP server works either way.

### 8. Ember event contract

Forge writes; Ember reads. Only the guardian runtime writes events. Consent is per user and never part of compiled
output: on every sync, forge writes or removes a marker `~/.crucible/forge/telemetry/guardian-<project_id|user>.on`
from that scope's resolved `telemetry.enabled` (default false, the existing forge switch). The hook and MCP server
write only when the marker for their scope exists and `CRUCIBLE_TELEMETRY` is not `off`; a hook with no project root
uses the user marker.

- Files: `~/.crucible/forge/telemetry/guardian-<YYYY-MM-DD>-<pid>.jsonl` (UTC date, one file per process, so no
  interleaving on any OS), next to forge's existing `events-*.jsonl`. One JSON object per line, at most 4 KiB: a record
  that would exceed it drops trailing `resources` and sets `truncated: true`. Sync deletes guardian files older than 7
  days; uninstalling leaves them to retention.
- No prompt text, query text, skill bodies or file paths, matching Ember's metadata-only default.
- Record v1, JSON Schema at `docs/schemas/guardian-event.v1.json`; a breaking change bumps `schema` and revises this
  spec:

| Field | Type | Meaning |
|---|---|---|
| `schema` | `"crucible.forge.guardian.v1"` | record version |
| `id` | 32 hex | truncated sha256 of `session_id`, `time`, `event` and resource ids |
| `time` | RFC 3339 UTC, milliseconds | when the guardian decided |
| `event` | `resource.suggested` \| `resource.searched` \| `resource.loaded` \| `guardian.failed` | hook note, MCP search, MCP load, fail-open error |
| `via` | `hook` \| `mcp` | entry point |
| `harness`, `scope` | `droid` \| `claude-code`; `project` \| `user` | from the command line, which compile bakes into both entry points |
| `project_id` | 12 hex \| null | 0003 §5 id of the root found from `cwd`; null when none |
| `session_id` | string \| null | from the hook payload; null for MCP calls |
| `compile_inputs` | `sha256:…` \| null | from `index.json`; the §5 manifest maps it to the variant |
| `resources` | array of `{id, kind, plugin, name, version, rank, score, reason}` | `reason`: `explicit` or `bm25`; empty on `guardian.failed` |
| `truncated` | boolean, optional | set when resources were dropped |
| `error` | `bad_input` \| `index_missing` \| `index_schema` \| `io` \| `internal`, optional | only on `guardian.failed` |

Mapping these records to `ember.resource.*` belongs to Ember's follow-up spec.

### 9. Codex and Copilot (v0.10)

Both arrive with their delivery (0003 §9: the `agent-plugins` emitter and their registrars), with acceptance rows in
that spec revision. Both default to the `store` strategy, because neither hide flag is verified to free listing budget
(R§9); each flag is added only if its v0.10 spike shows it does.

- **Codex:** Codex's plugin system at project scope, because Codex drops user-scope skills first (rule 9); 0002 §3's
  `.agents/skills/` for loose skills. Listing 8,000 characters, entry `- name: description (kind: path)`; cap 1,024 plus
  `metadata.short-description`. Guardian: MCP server (Codex defers all MCP behind `tool_search`).
- **Copilot CLI:** Copilot's plugin system; 0002 §3's `.github/skills/` for loose skills. Listing 28,000 characters in
  arrival order (whether forge controls order across plugins is a spike); cap 1,024, hard, because a longer description
  silently drops the skill (rule 2); names over 64 characters are `invalid`. Guardian: `userPromptSubmitted` hook with
  `additionalContext` plus the MCP server.

### 10. Commands and reports

- `forge compile [--harness <id>] [--scope project|user] [--json] [--check] [--strict-cap] [--explain <id>]` writes
  nothing. It plans from the current config as sync's planning does, resolving new or changed sources into a temporary
  directory, and prints per harness: listing used and budget, counts per status, diagnostics, and the foreign-listing
  estimate. Its first line is "Plan only; nothing written. Run `forge sync` to apply."; with `--json` that line goes to
  stderr and stdout is the manifest document. `--check` exits 1 when the plan differs from the lock or an `error`
  diagnostic exists; a measured-cap overrun fails only with `--strict-cap`. Teams run `forge compile --check` in CI.
  `--explain` prints one component's status, reason chain and remedy.
- `forge guardian hook|mcp --root <dir> --harness <id> --scope <s>` are internal (hidden from help); `forge guardian route` is the debug command.
- `forge sync` adds a line per harness: "droid: 42 listed, 118 deferred (9,412/9,500 chars), guardian on".
- `forge health` warns when a guardian is installed but `forge` is not on `PATH` (or only as a `.cmd` shim it cannot
  wrap), or a listing exceeds its measured cap.
- `forge uninstall` (project scope, 0003) also removes the project guardian and compile manifests; removing every
  user-scope plugin and syncing removes the user guardian.

## Rollout

Unfiled issues, each one PR under ~1,500 changed lines, in dependency order. All need v0.8 (#53–#57). Each issue adds
its own section to `docs/compile.md`. Diagrams live in `crucibledx/assets` (`forge/diagrams/`).

1. **Compile core, lock and sync** (L): config schema, compile unit, link pass, statuses, manifest and its schema,
   lock v2 with `compile[h]` and `emitted[h]`, `generated` source, emitted version and cache paths, the sync discipline
   table, the `enabled: false` identity, the `COMPILER_VERSION` guard. Spike: version refresh in both harnesses.
2. **`forge compile` command** (M, needs 1): planning from config, report, `--json`, `--check`, `--strict-cap`,
   `--explain`, foreign scan, sync and health lines.
3. **Normalize and dedupe** (L, needs 1): normalize tables, dedupe, overlap warnings, the `compile-corpus` fixture.
4. **Listing budgets** (L, needs 3): minify, harness data and overrides, priority, first-fit budget, both strategies,
   triggers, reduced-feature warnings, the priority hint. Spike: §4 (Droid).
5. **Guardian** (L, needs 4): package, index, `forge guardian hook|mcp|route`, frozen route-bench fixture, latency
   check. Spikes: §7.
6. **Guardian events** (S, needs 5): consent markers, writer, retention, `docs/schemas/guardian-event.v1.json`.
7. **Profile rank and prune** (M, needs 4; store from 5).
8. **Compile load check** (M, needs 5): extends the 0004 jobs (no model calls).
9. **Release eval** (S, needs 5 and 7): the manual, keyed runs for AC-20 and AC-27.

v0.10, with their delivery issues: **Codex compile target** (M), **Copilot compile target** (M).

## Open questions

- Droid's listing caps and drop order are measured, not documented (R§9); the defaults are harness data and move when
  Factory documents them.
- Whether the v0.8 lock parser (#55) rejects unknown `lockVersion` values; if not, a v0.8.x CLI could rewrite a v2
  lock without `compile`. Issue 1 asks #55's owner to add the check before v0.8.0 ships.

## Acceptance contract

Rows tagged with a strategy run for the strategy the issue 4 spike records for Droid, and always for Claude Code's
`flag`.

| ID | Issue | Behavior that must be true | Check (type) | How to run / evidence |
|------|------|----------------------------|--------------|-----------------------|
| AC-1 | 1 | With `compile.enabled: false`, and with compile on but no component changed, emitted trees and lock `outputs` for `cover-all` are byte-identical to v0.8; an enabled harness without compile support gets the "not supported" line | test + cli snapshot | golden comparison against the 0003 emitter snapshots; report snapshot |
| AC-2 | 1 | Compiled trees, manifest, `outputs` and `variants` are identical across two runs, two project roots, a reordered `plugins:` list, and two users whose telemetry settings differ | test | determinism unit tests |
| AC-3 | 1 | Each row of the §5 sync discipline table holds, including the one-time v0.8 upgrade message, the compile-disabled row, both refusals before any write, `CompileMismatch` before any write, and the exact "recompiled for" text; a golden change without a `COMPILER_VERSION` bump fails the guard | e2e + cli snapshot | sync e2e per row with filesystem snapshots; guard test |
| AC-4 | 1 | When compile changes a plugin's bytes, its emitted version, catalog entry and cache path carry the suffix computed with the source version in place, and stay valid SemVer for source versions with prerelease and build metadata; the lock records `emitted[h]`; pruning keeps referenced source and emitted versions; after changing only `compile.priority`, both harnesses serve the new bytes | test + e2e | emitter and cache unit tests; 0004 job case |
| AC-5 | 1 | The manifest is written by sync only, at the §5 paths with a `.gitignore` of `*`, validates against its schema, has no timestamps, and records `inputs` and the variant | test | manifest unit and schema tests |
| AC-6 | 1 | Link edges come from `requires`, `subagent_type` and `/<name>` mentions inside the unit; unresolved names warn | test | link unit tests |
| AC-7 | 2 | `forge compile` writes nothing (also when sources changed or are uncached) and prints the plan-only line, to stderr under `--json`, where stdout validates against the manifest schema; `--check` exits 1 on config drift from the lock or an `error` diagnostic, 0 otherwise, and on a cap overrun only with `--strict-cap`; `--explain` prints the reason chain and remedy; sync prints its per-harness line; `forge health` warns when `forge` is not on `PATH` | e2e + cli snapshot | filesystem snapshots, exit-code cases including config drift, report snapshots |
| AC-8 | 2 | `forge compile` reports the foreign-listing cost, and compiled output is identical with and without foreign skills present | e2e | seeded `~/.factory/skills` and `.claude/skills` |
| AC-9 | 3 | Normalize per harness: Droid fills a missing `name` and a missing `description` from the first body line, maps model aliases and tool names, and marks an agent with no mapped tools `invalid`; Claude Code only warns on a missing `description`; no `model:` is added; no agent gains tools; every edit is a diagnostic; frontmatter edits are targeted | test | golden per harness on `compile-corpus` |
| AC-10 | 3 | Identical skills across plugins leave one `listed` and the rest `deferred` naming the kept id and absent from the index, except `keep` matches, which all stay listed with a warning; skills differing only in a bundled file or a frontmatter key such as `allowed-tools` are not duplicates; identical rule files are emitted once; duplicate agents and commands are reported and emitted; near-duplicates only warn; nothing is renamed | test | dedupe unit tests |
| AC-11 | 4 | Over-cap descriptions (Claude Code: with `when_to_use`, default cap 1,536) become first plus trigger sentence within the cap at a word boundary; under-cap text and every body are byte-unchanged; a `compile.harnesses` override changes caps and budgets, and a number turns the Claude Code budget pass on | test | minify and override unit tests; body-hash equality |
| AC-12 | 4 | With a budget set, listed entries fit it unless `keep` alone exceeds it (warning); the listed set is first-fit in the full §2 priority order, including the dependents and name tie-breaks; with no budget nothing is deferred for budget; non-`invalid`, non-`pruned` components are all present (`flag`) or in the store (`store`) | test | budget property tests over generated corpora, per strategy |
| AC-13 | 4 | `flag`: over-budget and `defer`-matched skills carry `disable-model-invocation: true` in their plugin. `store`: they are absent from their plugin and present in the guardian store and index, with reason `store`, and the upgrade message, sync line and `--explain` say they are not user-invocable and name `compile.keep` | test + cli snapshot | golden per strategy; report snapshots |
| AC-14 | 4 | Agent descriptions over the agent budget shrink evenly to no less than 120 characters, a warning names any remaining overflow, and no agent is removed | test | budget unit tests |
| AC-15 | 4 | String `metadata.triggers` is used; other types warn and are ignored; triggers never enter emitted descriptions; `keep`/`defer` glob whole ids, keep wins over defer with a warning, and unmatched entries warn; reduced-feature warnings name each feature; the priority hint prints when skills are deferred and `priority` is empty | test + cli snapshot | config and parser tests; report snapshot |
| AC-16 | 5 | The guardian exists only per the §3 rule, omits `hooks.json` or `mcp.json` when that part is `off`, and still carries the store when stored skills exist with both parts `off`; its tree matches golden output with the `${PLUGIN_ROOT}` mapping, the quoted hook root and the Windows `cmd /c` wrapper, has no absolute path or per-user value, canonical `index.json`, is locked as `generated` with a `contentHash` and changes the variant; `plugin remove`/`update` refuse it with `GeneratedPlugin`; project and user guardians coexist under distinct names | test + e2e | golden snapshots per OS; path grep; lock tests; two-scope e2e |
| AC-17 | 5 | The hook prints at most three matches above `max(min_score, 0.6 × top)` with the harness tool id, prefers explicit mentions, prints nothing without a match or with `CRUCIBLE_GUARDIAN=off`, finds the project root from a subdirectory `cwd`, and on bad input, a missing index or an unknown index schema prints nothing and exits 0 (with events on, a `guardian.failed` record carries the command-line harness and scope), on every OS lane | test | spawn the built binary with stdin fixtures |
| AC-18 | 5 | On the committed frozen route-bench fixture (POC prompts and index, license recorded), the ported router's direct top-3 hit rate and false-suggestion rate are no worse than the POC router's on the same fixture, within 5 points | test | route-bench test in `src/domain/guardian/` |
| AC-19 | 5 | Hook p95 latency over 100 runs on a 500-skill index is at most 250 ms on Linux and macOS and 500 ms on Windows | bench | latency script in the native lanes; numbers in the PR |
| AC-20 | 9 | Release gate, not CI: the POC eval (T1–T4, three repetitions, pinned Droid and model, corpus commit named) run through `forge sync` in two arms, the shipped defaults and `profile: prune`, records whether the hook fired; the default arm's success is at least the copy-everything arm's, or `compile.enabled` defaults to false for Droid before v0.9 ships | eval | manual keyed run; results table in the issue 9 PR |
| AC-21 | 5 | Via the SDK client, on every OS lane, the MCP server lists exactly `search_skills` and `load_skill`, returns at most five matches with ids (one-word queries included), loads by id or unique name and returns body and bundled-file paths, and returns `isError` for an unknown id or an ambiguous name (two plugins' `review`); `forge guardian route` prints matches, scores and thresholds and writes no events | test | MCP client integration test; route snapshot |
| AC-22 | 6 | With the scope's marker present, each event type writes one schema-valid line per decision, at most 4 KiB (truncation flagged), with no prompt or query text, in a per-process file, `project_id` null without a root; without the marker, or with `CRUCIBLE_TELEMETRY=off`, nothing is written (also on fail-open); sync writes and removes markers from the resolved setting and deletes files older than 7 days | test | schema validation; marker-string absence; gating and retention tests |
| AC-23 | 7 | Profile is off by default; `rank` reorders only; `prune` prunes mismatched skills, agents and commands (skills into the store), keeps dependencies, `keep` matches and every hook, MCP, rule, output style and LSP; tags come from git-tracked files only; user scope warns and ignores it | test + e2e | profile unit tests; e2e with an untracked file that would add a tag |
| AC-24 | 8 | In the 0004 jobs with compile on, `claude plugin validate` passes on every compiled tree and both guardians, both harnesses list the guardian enabled, and the MCP server answers a handshake where the harness CLI offers one (else the job records why it skipped) | e2e | load-check matrix |
| AC-25 | 1–7 | `forge uninstall` removes the project guardian, its keys and the project manifests and leaves event files; removing all user-scope plugins removes the user guardian; each issue's `docs/compile.md` section exists | e2e + doc | uninstall e2e; headings check |
| AC-26 | — | Codex and Copilot targets and destinations are stated | N/A | §9 of this spec |
| AC-27 | 9 | Release gate, not CI: in each harness's headless mode, with more MCP tools installed than its deferral threshold, a fixture prompt makes the hook run (a `resource.suggested` line with telemetry on) and the model can reach `load_skill` | eval | manual keyed run per harness; evidence in the issue 9 PR |
