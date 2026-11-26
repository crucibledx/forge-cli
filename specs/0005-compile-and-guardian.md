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
  <img alt="Forge compile pipeline: packages, compile passes per harness, emit, lock and install" src="https://github.com/crucibledx/assets/raw/main/forge/diagrams/light/forge-compiler-pipeline.svg">
</picture>

## Problem

Every harness shows the model a capped listing of skill and agent names and descriptions; a body loads only when the
model picks it. A handful of public plugins overflows that listing, and each harness cuts by its own rule: Droid
truncates descriptions to about 200 characters and goes name-only in load order; Claude Code drops descriptions of the
least-used skills; Codex shrinks all descriptions evenly, then drops user-scope skills first; Copilot fills in arrival
order and silently drops any skill whose description exceeds 1,024 characters (R§2–R§6). None ranks by relevance to
the current project, and public corpora also carry outright breakage: duplicate agents, skills without `name`,
Claude-only model aliases in Droid.

The POC measured Droid only (48 `droid exec` runs, 92 public plugins, three repetitions per cell, R§7). Copying
everything succeeded 9/12 and the expected skill had a visible description in 15% of routing cases. The "compiled" arm
(profile pruning on, a category allow-list, profile matches ranked first) succeeded 12/12. The "guardian" arm (every
skill moved out of the listing, the hook note pasted into the prompt because `droid exec` 1.8.0 did not fire the hook)
succeeded 11/12 at the lowest cost among layouts with plugins installed. The defaults below were not measured as such;
AC-20 measures them before v0.9 ships.

Forge v0.8 delivers packages byte for byte. It knows every component it installs into each harness, so it is the one
place that can normalize them, remove duplicate noise, fill the listing deliberately and say why.

## Complete, don't compete

- Harnesses already defer tool schemas and MCP tools (Claude Code and Copilot tool search, Codex deferred MCP). Droid's
  Deferred Context Engine defers "internal tool schemas, MCP tool schemas, skills, and plugin instructions" behind a
  discover-and-promote loader (R§3). Forge builds no proxy, no per-request tool filtering, no deferral engine, and no
  prose compression of bodies (rule 11); per-request prefix rewrites lose money against prompt caching (R§7).
- Forge defers only where the harness has no native discovery for unlisted skills. That is harness data (§4), set from
  the issue 3 spike for Droid and off for Claude Code, whose own overflow keeps every name and ranks by usage. When a
  harness gains native discovery, its budget pass and guardian default to off.
- Hiding uses the documented knob: `disable-model-invocation: true` (Droid, Claude Code) keeps a skill installed and
  user-invocable but out of the model's listing (R§3, R§4).
- Delivery stays 0003's: compiled output flows through the same emitters, local marketplace, lock and registrars. The
  guardian is a forge-generated plugin, so each harness's own plugin system loads its hook and MCP server.
- Triggers live in the Agent Skills `metadata` map, so compiled packages stay valid for every other consumer.
- The MCP server uses the official MCP TypeScript SDK (`@modelcontextprotocol/sdk`, MIT, exact version pinned, stdio
  server entry only, covered by `check:security-audit`).
- Ember owns observability. Forge writes guardian events through its existing telemetry switch (§8); Ember's resource
  follow-up spec decides how to read them (Ember 0001 reserves `ember.resource.*`).
- What forge adds: one deterministic compile per harness that normalizes and dedupes what forge installs, fills a
  capped listing in an order the user controls where the harness needs it, deletes nothing unless pruning is opted in,
  explains every decision, and ships a guardian that points the model at what is not listed.

## Goals (v0.9)

- Compile every plugin forge delivers to Droid and Claude Code: normalize, dedupe, minify, and, where the harness
  needs it, fit the listing to a budget by user-controlled priority and defer the rest.
- Never delete by default: a deferred skill stays installed, is invocable by the user where the harness honors the
  flag, and is findable through the guardian.
- Ship the guardian (a `UserPromptSubmit` hook and a stdio MCP server) as a forge-generated plugin when skills are
  deferred.
- Byte-stable output recorded in the lock and the variant; compile reruns only when its inputs change; mixed-version
  teams never flip the lock.
- `forge compile` explains every decision without writing anything.
- Opt-in profile ranking and pruning from project files.
- Guardian events for Ember, without prompt text, behind the telemetry switch.
- Name the Codex and Copilot compile targets and destinations for v0.10.

## Non-goals

- Editing source packages, or writing anywhere other than 0003's cache, owned keys and rule files.
- Proxies, per-request tool filtering, MCP tool pruning, body compression, embeddings, or model calls in compile or the
  guardian (rule 11).
- Compiling v0.7 loose resources, components forge did not install, or `forge marketplace emit` output (0003 §8).
- Writing `AGENTS.md` or `CLAUDE.md` (0002 §3). Rule compile is dedupe and size reporting only.
- Codex and Copilot compile in v0.9 (§9).
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
  Edits touch only the changed keys; a component compile leaves alone is byte-identical to v0.8's output. 0003's
  emitters consume it unchanged; the only added package is the guardian.
- `compile.enabled: false`, or a harness without compile support, makes compile the identity. Enabled harnesses
  without support get one report line, "compile is not supported for `<harness>` yet".
- Passes, in order: **link → normalize → dedupe → profile → minify → budget → guardian**. Each records a status and an
  ordered reason list per component. Diagnostics carry a code from a closed table (`docs/schemas/compile-manifest.v1.json`)
  and a severity: `error` (fails `forge compile --check`) or `warning`.

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
    claude-code: {skills: off}  # a number turns the Claude Code budget pass on
```

- `compile:` lives in the config of the scope it compiles (project or user config, as `plugins:` does in 0003).
- `keep` and `defer` are `Bun.Glob` patterns matched against whole component ids. An id matched by both is kept, with
  a warning; a `keep`, `defer` or `priority` entry that matches nothing is a warning naming it.
- **Priority** fills the listing: `keep` matches, then plugins in `compile.priority` order, then (with `profile` set)
  components matching the project profile, then components with more in-unit dependents, then plugin name, then
  component name. The order of `plugins:` is not a signal: 0003 §4 requires the variant to ignore config order.
- When skills are deferred and `priority` is empty, `forge sync` and `forge compile` name the plugins that lost the
  most listing slots and print a ready-to-paste `compile.priority:` line.

### 3. Passes

| Pass | Does | Never |
|---|---|---|
| link | Edges inside the unit from frontmatter `requires`, `subagent_type` references and explicit `/<name>` mentions; unresolved names are warnings | crosses units |
| normalize | Applies the harness's normalize table (domain data). Droid: a skill without `name` gets its directory name; a skill or agent without `description` gets the first non-empty body line (Claude Code's documented fallback); a Claude model alias becomes `inherit`; Claude tool names map to Droid's. An agent whose mapped tool list would be empty is `invalid` for Droid, because an empty list could widen access. Claude Code: missing `description` is a warning only. Every edit is a diagnostic | edits bodies; adds `model:` (rule 8); widens an agent's tools |
| dedupe | Same kind, same normalized body and description across plugins: the first by priority stays, repeating skills become `deferred` (reason "duplicate of `<id>`", not indexed); identical Claude rule files are emitted once; duplicate agents and commands are reported and still emitted (plugins namespace them; removal breaks references); description word-Jaccard ≥ 0.5 is a warning | renames anything |
| profile | §6, only when `profile` is set | runs by default |
| minify | A description (Claude Code: `description` plus `when_to_use`) over the harness cap keeps its first sentence plus its first "Use when/for …" sentence, cut at a word boundary with `…` if still over (rules 1, 7, 8) | touches bodies, or text under the cap |
| budget | Only for listings whose harness data sets a budget. Walks components in priority order, first-fit: an entry that does not fit is deferred and smaller later ones may still fit. `keep` may exceed the budget, with a warning. Commands count where the harness lists them and defer like skills where the flag applies to them; otherwise they are a fixed cost with a warning. Agents have no documented hide flag: past the agent budget their descriptions shrink evenly to a 120-character floor, then a warning names the overflow | removes an agent |
| guardian | Builds the guardian package (§5) when `hook` or `mcp` is `on`, or `auto` and a skill is `deferred` (not as a duplicate) or `pruned` | runs when both are `off` |

**Triggers.** A skill may declare `metadata.triggers`, a comma-separated string ("pytest failure, flaky test,
conftest"). The Agent Skills spec types `metadata` as a string map, so any other value is a warning and is ignored.
Triggers weight the guardian router (§7) and the profile matcher (§6) and never enter the emitted description.

**Reduced features.** A deferred skill that uses harness skill features (`allowed-tools`, `context: fork`,
`$ARGUMENTS`, `${CLAUDE_SKILL_DIR}`, `!` injection) works fully when the user invokes it, but only as plain
instructions when the model reads it through the guardian; compile records a warning for each.

### 4. Harness data: budgets and strategies

Per harness and listing, in characters, costed the way the harness renders the entry (rules 3, 7, 8). Every value is
domain data overridable under `compile.harnesses`.

| Harness | Listing | Entry cost | Budget default | Description cap | Strategy |
|---|---|---|---|---|---|
| Droid | skills (and commands if listed) | `name + 3 + description` | 9,500, or off if the spike finds native discovery | 199 | `flag`, or `store` if the spike finds the flag ignored on plugin skills |
| Droid | droids | `name + 25 + description` | 9,000 | 500 | — |
| Claude Code | skills and commands | `plugin:name + 4 + description + when_to_use` | off (Claude ranks overflow by usage and scales with the window) | 1,024 (Claude's own cap is 1,536) | `flag` |
| Claude Code | subagents | `plugin:name + 4 + description` | 40,000 (Claude warns near 15,000 tokens) | 1,024 | — |

The **measured cap** per listing (Droid skills about 15,000 characters, R§3) is harness data too; it is used only for
reports. Built-ins, loose resources and other plugins share each listing: `forge compile` scans the harness's skill and
droid directories read-only and reports their cost next to forge's share and the measured cap (for Claude Code it also
points at `/context`). The scan never feeds the compile, so output never depends on machine-local files.

**Issue 3 spike (Droid, pinned CLI), recorded in the PR with evidence:** (a) whether an over-budget plugin skill is
discovered natively, with and without the flag; (b) whether `disable-model-invocation` hides plugin skills; (c) on the
route-bench fixture, name-only overflow versus hidden plus guardian. The spike sets Droid's budget default and strategy
in harness data; the acceptance rows cover both strategies.

### 5. Emit, guardian package, lock

**Emitted version.** When compile changes any byte of a plugin's output for a harness, its emitted `plugin.json`
`version`, catalog entry and cache path become `<version>+c.<first 8 hex of outputs[harness]>`, so a harness that
refreshes by version sees new bytes. If issue 1's spike shows a harness ignores build metadata, the emitter uses
`<version>-c.<hex>` for that harness instead. Variant lines keep the source `<name>@<version>` (0003 §4).

**Deferred skills.** `flag`: the skill stays in its plugin with `disable-model-invocation: true`; the user invokes it
as `/<plugin>:<skill>` on Claude Code and by its Droid name on Droid. `store`: the skill is left out of its plugin and
lives only in the guardian store.

**Guardian package.** One per unit, named `crucible-guardian-project` or `crucible-guardian-user` (plugin and MCP
server key alike, so both scopes coexist), version `1.<COMPILER_VERSION>.0` plus the content suffix above:

```
crucible-guardian-<scope>/
  plugin.json
  mcp.json                               # args: [guardian, mcp, --root, ${PLUGIN_ROOT}]
  dev.crucibledx.forge/hooks/hooks.json  # UserPromptSubmit: forge guardian hook --root "${CLAUDE_PLUGIN_ROOT}", timeout 5
  guardian/index.json                    # {schema, harness, scope, compile_inputs, events, entries, bm25}
  guardian/store/<plugin>/<skill>/       # copies of deferred and pruned skill directories, bundled files included
```

The emitter maps `${PLUGIN_ROOT}` to each harness's plugin-root variable. The store copies exist because the harness
installs plugins into its own cache, whose path forge does not control; the guardian's root is known at runtime. No
emitted file contains an absolute path (0003 §2). `index.json` is canonical JSON (sorted keys and entries, trailing
newline). This store replaces rule 3's `.crucible/store`, so the guardian ships as one plugin. The hook runs the
installed `forge`; `forge health` warns when `forge` is not on `PATH`, and `docs/compile.md` notes that GUI-launched
harnesses need it on the login `PATH`.

**Lock.** Each plugin's `outputs[<harness>]` already hashes compiled bytes. Additions:

- `lockVersion: 2` (absent means 1). The guardian is a lock entry with `source: {type: generated}`, so it is part of
  `variants[<harness>]`.
- `compile[<harness>] = {inputs: "sha256:…", compiler: <COMPILER_VERSION>}`. `inputs` hashes canonical JSON of the
  harness's effective compile config and harness data, the profile tags (when `profile` is set), `COMPILER_VERSION` (an
  integer bumped whenever a pass changes output) and the unit's sorted `(name, contentHash)` pairs.

**Sync discipline** (extends 0003 §4):

| Lock state | Sync does |
|---|---|
| `compile[h].compiler` greater than this forge's | refuses before any write: `LockFromNewerCompiler` ("upgrade forge") |
| `lockVersion` greater than 2 | refuses before any write: `LockFromNewerForge` |
| no `compile[h]` (a v0.8 lock) | compiles, relocks, and prints once: "forge 0.9 compiles plugins for `<harness>`: N listed, M deferred. Set `compile.enabled: false` to keep v0.8 output. See docs/compile.md." |
| `inputs` unchanged, plugins reused | installs the locked outputs verbatim |
| `inputs` unchanged, cache miss | recompiles; the result must hash to the locked `outputs`, else aborts before any write with `CompileMismatch` naming the plugin, harness and manifest path, and "report this as a forge bug" |
| `inputs` changed | recompiles, relocks `outputs`, `compile` and `variants`, and reports "recompiled for `<harness>`: `<which input changed>`" |

An older compiler never relocks a newer lock, so mixed-version teams cannot flip it.

**Manifest.** `forge sync` writes `.crucible/compile/<harness>.json` (user scope: `~/.crucible/forge/compile/`) as a
planned transaction write, with a `.gitignore` of `*`: per component its id, status, reasons, entry cost and
diagnostics; budget used, limit and measured cap; profile evidence; `inputs`; and the resulting
`variants[<harness>]`. Canonical JSON, no timestamps; schema `docs/schemas/compile-manifest.v1.json`.

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

**Hook** (`forge guardian hook --root <dir>`). Reads the payload from stdin (`prompt`, `session_id`, `cwd`), loads
`<root>/guardian/index.json`, routes, prints the note and exits 0. It fails open: malformed input, a missing index, an
unknown index `schema`, or any error prints nothing, writes `guardian.failed` and exits 0. `CRUCIBLE_GUARDIAN=off`
silences it for a session. The project root is found by walking up from `cwd` to `.crucible/forge.lock`. Its only
effect on context is output appended after the cached prefix (rule 12).

**Router** (ported from POC `poc/guardian/router.ts`). An explicit mention of a skill name wins. Otherwise BM25 over
name words (×3), triggers (×3), plugin (×1) and description (×1), with corpus statistics precomputed at compile. A hook
match needs two or more query terms and a score of at least `max(min_score, 0.6 × top)`; at most three are shown. The
hook is a hint, never a gate: the POC router hit the right skill in its top 3 for 80% of direct and 33% of indirect
prompts with 35% false suggestions, while a model-written query through `search_skills` reached 95% and 65% (R§7). The
note points at `load_skill` first, because a raw path in the harness plugin cache may need a Read permission:

```text
[crucible-guardian] These installed skills may fit this request. They are not in your skill list.
- pytest-runner (testing-kit): Run and triage pytest failures. Use when tests fail or flake.
  Load: crucible-guardian-project load_skill "pytest-runner" (or read /…/guardian/store/testing-kit/pytest-runner/SKILL.md)
If none fit, ignore this note, or call search_skills with a short query.
```

**MCP server** (`forge guardian mcp --root <dir>`, stdio). `search_skills {query}` uses the router without the
two-term minimum and returns up to five matches with name, plugin, description and path. `load_skill {name}` returns
the SKILL.md body and the absolute paths of its bundled files; an unknown name is an `isError` result. Tool
descriptions state the index size.

**Debugging.** `forge guardian route "<prompt>" [--harness <id>] [--scope <s>]` prints matches, scores and thresholds
for the installed index and writes no events.

**Scopes.** Each guardian searches only its own index; a prompt gets at most one note per scope.

**Spikes in issue 4** (pinned CLIs, recorded in the PR): whether `UserPromptSubmit` fires in headless `droid exec`
(R§3; the POC saw it not fire on 1.8.0), and whether reading a store path prompts for permission. `forge compile`
prints a note when the hook cannot fire headless; the MCP server works either way.

### 8. Ember event contract

Forge writes; Ember reads. Only the guardian runtime writes events, and only when the scope's `telemetry.enabled` is
true (default false, the existing forge switch) at compile time; compile bakes the result into `index.json` as
`events`, so the hook never parses config.

- Files: `~/.crucible/forge/telemetry/guardian-<YYYY-MM-DD>-<pid>.jsonl` (UTC date, one file per process, so no
  interleaving on any OS), next to forge's existing `events-*.jsonl`. One JSON object per line, at most 4 KiB: a record
  that would exceed it drops trailing `resources` and sets `truncated: true`. Sync deletes guardian files older than 7
  days; user-scope uninstall removes them; project-scope uninstall leaves them.
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
| `harness`, `scope` | `droid` \| `claude-code`; `project` \| `user` | from `index.json` |
| `project_id` | 12 hex \| null | 0003 §5 id of the root found from `cwd`; null when none |
| `session_id` | string \| null | from the hook payload; null for MCP calls |
| `compile_inputs` | `sha256:…` | from `index.json`; the §5 manifest maps it to the variant |
| `resources` | array of `{id, kind, plugin, name, version, rank, score, reason}` | `reason`: `explicit` or `bm25`; empty on `guardian.failed` |
| `truncated` | boolean, optional | set when resources were dropped |
| `error` | `bad_input` \| `index_missing` \| `index_schema` \| `io` \| `internal`, optional | only on `guardian.failed` |

Mapping these records to `ember.resource.*` belongs to Ember's follow-up spec.

### 9. Codex and Copilot (v0.10)

Both arrive with their delivery (0003 §9: the `agent-plugins` emitter and their registrars); their rows come with that
spec revision. Both default to the `store` strategy, because neither hide flag is verified to free listing budget (R§9).

| | Codex | Copilot CLI |
|---|---|---|
| Destination | Codex's plugin system at project scope, because Codex drops user-scope skills first (rule 9); 0002 §3's `.agents/skills/` for loose skills | Copilot CLI plugin system; 0002 §3's `.github/skills/` for loose skills |
| Listing | 8,000 chars; entry `- name: description (kind: path)` (R§5) | 28,000 chars in arrival order; whether forge controls order across plugins is a v0.10 spike (rule 10) |
| Description cap | 1,024, plus `metadata.short-description` | 1,024, hard: minify always runs (rule 2); names over 64 chars are `invalid` |
| Flags | `allow_implicit_invocation: false` only if the spike shows it frees budget | `disable-model-invocation` under the same condition |
| Guardian | MCP server; a hook only if Codex documents prompt-time context injection | `userPromptSubmitted` hook with `additionalContext` (fixed in v1.0.85) plus MCP |
| Rules | report the `AGENTS.md` chain against the 32 KiB tail cut | report instruction size |

### 10. Commands and reports

- `forge compile [--harness <id>] [--scope project|user] [--json] [--check] [--strict-cap] [--explain <id>]` writes
  nothing. Its first line is "Plan only; nothing written. Run `forge sync` to apply." It compiles from the lock and
  cache, fetching into a temporary directory on a cache miss, and prints per harness: listing used and budget, counts
  per status, diagnostics, and the foreign-listing estimate. `--check` exits 1 when a fresh compile differs from the
  lock or an `error` diagnostic exists; a measured-cap overrun fails only with `--strict-cap`. Teams and producers run
  `forge compile --check` in CI. `--explain` prints one component's status and reason chain.
- `forge guardian hook|mcp --root <dir>` are internal (hidden from help); `forge guardian route` is the debug command.
- `forge sync` adds a line per harness: "droid: 42 listed, 118 deferred (9,412/9,500 chars), guardian on".
- `forge health` warns when a guardian is installed but `forge` is not on `PATH`, or a listing exceeds its measured cap.
- `forge uninstall` (project scope, 0003) also removes the project guardian and compile manifests.

Compile adds no mutation kind: it changes bytes that 0003's transaction writes, the guardian registers with the same
two keyed entries as any plugin, and the manifest is a planned write. Event files are telemetry outside the
transaction, as today.

## Rollout

Unfiled issues, each one PR under ~1,500 changed lines, in dependency order. All need v0.8 (#53–#57). Each issue adds
its own section to `docs/compile.md`.

1. **Compile core, lock and sync** (L): config schema, compile unit, link pass, statuses, manifest and its schema,
   lock v2 with `compile[h]`, `generated` source, emitted version, the sync discipline table, the `enabled: false`
   identity. Spike: version refresh in both harnesses.
2. **`forge compile` command** (M, needs 1): report, `--json`, `--check`, `--strict-cap`, `--explain`, foreign scan,
   sync and health lines.
3. **Normalize and dedupe** (L, needs 1): normalize tables, dedupe, overlap warnings, the `compile-corpus` fixture.
4. **Listing budgets** (L, needs 3): minify, harness data, priority, first-fit budget, both strategies, triggers, the
   priority hint. Spike: §4 (Droid).
5. **Guardian** (L, needs 4): package, index, `forge guardian hook|mcp|route`, frozen route-bench fixture, latency
   check. Spikes: §7.
6. **Guardian events** (S, needs 5): writer, gating, retention, `docs/schemas/guardian-event.v1.json`.
7. **Profile rank and prune** (M, needs 4; store from 5).
8. **Compile load check** (M, needs 5): extends the 0004 jobs (no model calls).
9. **Release eval** (S, needs 5 and 7): the manual, keyed eval run for AC-20.

v0.10, with their delivery issues: **Codex compile target** (M), **Copilot compile target** (M).

Diagrams: `forge/diagrams/forge-compiler-pipeline.drawio` (updated) and `forge-guardian-flow.drawio` in
`crucibledx/assets`.

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
| AC-1 | 1 | With `compile.enabled: false`, and with compile on but no component changed, emitted trees and lock `outputs` for `cover-all` are byte-identical to v0.8 | test | golden comparison against the 0003 emitter snapshots |
| AC-2 | 1 | Compiled trees, manifest, `outputs` and `variants` are identical across two runs, two project roots and a reordered `plugins:` list | test | determinism unit tests |
| AC-3 | 1 | Each row of the §5 sync discipline table holds, including the one-time v0.8 upgrade message, both refusals before any write, `CompileMismatch` before any write, and the exact "recompiled for" text | e2e + cli snapshot | sync e2e per row with filesystem snapshots |
| AC-4 | 1 | When compile changes a plugin's bytes, its emitted version, catalog entry and cache path carry the content suffix; after changing only `compile.priority`, both harnesses serve the new bytes | test + e2e | emitter unit test; 0004 job case |
| AC-5 | 1 | The manifest is written by sync only, at the §5 paths with a `.gitignore` of `*`, validates against its schema, has no timestamps, and records `inputs` and the variant | test | manifest unit and schema tests |
| AC-6 | 1 | Link edges come from `requires`, `subagent_type` and `/<name>` mentions inside the unit; unresolved names warn | test | link unit tests |
| AC-7 | 2 | `forge compile` writes nothing (also on a cache miss) and prints the plan-only line; `--json` validates against the manifest schema; `--check` exits 1 on lock drift or an `error` diagnostic, 0 otherwise, and fails on a cap overrun only with `--strict-cap`; `--explain` prints the reason chain; sync and health print their lines | e2e + cli snapshot | filesystem snapshots, exit-code cases, report snapshots |
| AC-8 | 2 | `forge compile` reports the foreign-listing cost, and compiled output is identical with and without foreign skills present | e2e | seeded `~/.factory/skills` and `.claude/skills` |
| AC-9 | 3 | Normalize per harness: Droid fills a missing `name` and a missing `description` from the first body line, maps model aliases and tool names, and marks an agent with no mapped tools `invalid`; Claude Code only warns on a missing `description`; no `model:` is added; no agent gains tools; every edit is a diagnostic; frontmatter edits are targeted | test | golden per harness on `compile-corpus` |
| AC-10 | 3 | Identical skills across plugins leave one `listed` and the rest `deferred` naming the kept id and absent from the index; identical rule files are emitted once; duplicate agents and commands are reported and emitted; near-duplicates only warn; nothing is renamed | test | dedupe unit tests |
| AC-11 | 4 | Over-cap descriptions (Claude Code: with `when_to_use`) become first plus trigger sentence within the cap at a word boundary; under-cap text and every body are byte-unchanged | test | minify unit tests; body-hash equality |
| AC-12 | 4 | With a budget set, listed entries fit it unless `keep` alone exceeds it (warning); the listed set is first-fit in priority order; with no budget (Claude Code default) nothing is deferred for budget; non-`invalid`, non-`pruned` components are all present (`flag`) or in the store (`store`) | test | budget property tests over generated corpora, per strategy |
| AC-13 | 4 | `flag`: over-budget and `defer`-matched skills carry `disable-model-invocation: true` in their plugin. `store`: they are absent from their plugin and present in the guardian store and index, with reason `store` | test | golden per strategy |
| AC-14 | 4 | Agent descriptions over the agent budget shrink evenly to no less than 120 characters, a warning names any remaining overflow, and no agent is removed | test | budget unit tests |
| AC-15 | 4 | String `metadata.triggers` is used; other types warn and are ignored; triggers never enter emitted descriptions; `keep`/`defer` glob whole ids, keep wins over defer with a warning, and unmatched entries warn; the priority hint prints when skills are deferred and `priority` is empty | test + cli snapshot | config and parser tests; report snapshot |
| AC-16 | 5 | The guardian exists only per the §3 rule; its tree matches golden output with the `${PLUGIN_ROOT}` mapping and the quoted hook root, has no absolute path, canonical `index.json`, is locked as `generated` and changes the variant; project and user guardians coexist under distinct names | test + e2e | golden snapshot; path grep; two-scope e2e |
| AC-17 | 5 | The hook prints at most three matches with load instructions, prefers explicit mentions, prints nothing without a match or with `CRUCIBLE_GUARDIAN=off`, and on bad input, a missing index or an unknown index schema prints nothing and exits 0, on every OS lane | test | spawn the built binary with stdin fixtures |
| AC-18 | 5 | On the committed frozen route-bench fixture (POC prompts and index, license recorded), the ported router's direct top-3 hit rate and false-suggestion rate are no worse than the POC router's on the same fixture, within 5 points | test | route-bench test in `src/domain/guardian/` |
| AC-19 | 5 | Hook p95 latency over 100 runs on a 500-skill index is at most 250 ms on Linux and macOS and 500 ms on Windows | bench | latency script in the native lanes; numbers in the PR |
| AC-20 | 9 | Release gate, not CI: the POC eval (T1–T4, three repetitions, pinned Droid and model, corpus commit named) run through `forge sync` in two arms, the shipped defaults and `profile: prune`, records whether the hook fired; the default arm's success is at least the copy-everything arm's, or `compile.enabled` defaults to false for Droid before v0.9 ships | eval | manual keyed run; results table in the issue 9 PR |
| AC-21 | 5 | Via the SDK client, the MCP server lists exactly `search_skills` and `load_skill`, returns at most five matches (one-word queries included), returns body and bundled-file paths, and `isError` for an unknown name; `forge guardian route` prints matches and scores and writes no events | test | MCP client integration test; route snapshot |
| AC-22 | 6 | With telemetry on, each event type writes one schema-valid line per decision, at most 4 KiB (truncation flagged), with no prompt or query text, in a per-process file; with telemetry off nothing is written; sync deletes files older than 7 days | test | schema validation; marker-string absence; gating and retention tests |
| AC-23 | 7 | Profile is off by default; `rank` reorders only; `prune` prunes mismatched skills, agents and commands (skills into the store), keeps dependencies, `keep` matches and every hook, MCP, rule, output style and LSP; tags come from git-tracked files only; user scope warns and ignores it | test + e2e | profile unit tests; e2e with an untracked file that would add a tag |
| AC-24 | 8 | In the 0004 jobs with compile on, `claude plugin validate` passes on every compiled tree and both guardians, both harnesses list the guardian enabled, and the MCP server answers a handshake where the harness CLI offers one (else the job records why it skipped) | e2e | load-check matrix |
| AC-25 | 1–7 | `forge uninstall` removes the project guardian, its keys and the project manifests and leaves event files; each issue's `docs/compile.md` section exists | e2e + doc | uninstall e2e; headings check |
| AC-26 | — | Codex and Copilot targets and destinations are stated | N/A | §9 of this spec |
