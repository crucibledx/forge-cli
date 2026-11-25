---
id: "0002"
title: "Coding harness model and rename"
status: approved
scope: project
target_repos: [forge-cli]
assets: none
size: mission
idea_issue: "crucibledx/hq#14"
created: 2026-11-11
---

# 0002: Coding harness model and rename

Part of forge v0.8, together with [0003 plugin packages and delivery](0003-plugin-packages-and-delivery.md) and
[0004 plugin load check](0004-plugin-load-check.md). This spec owns the vocabulary and the harness data model the
other two build on. v0.8 is the fast plugin release: **Droid and Claude Code first**. v0.8.0 is this spec plus
0003's package model, keyed merge and Droid/Claude Code delivery (crucibledx/forge-cli#53–#57); the remaining v0.8
items land as v0.8.x before v0.9 work starts. Everything else in the original harness plan moves to later releases
(section 5).

## Problem

- **Outdated vocabulary.** Forge calls Claude Code, Cursor, Copilot and the rest "AI assistants". The org now calls
  them coding harnesses, and v0.8 adds "plugins", a word forge already uses for its own unbuilt extension mechanism
  (`src/infrastructure/io/plugin`, `PluginRequest` in `src/domain/protocol/types.ts`, the reserved `plugins: []` key in
  `docs/forge.config.yaml`).
- **The model only knows three content globs** (`skills/**`, `rules/**`, `workflows/**`). Plugins also carry
  subagents, hooks, MCP servers, LSP servers and output styles.
- **Droid is missing.** Only five harnesses are built in (`claude-code`, `cline`, `copilot`, `cursor`, `windsurf`).
  Droid, one of the two v0.8 plugin targets, cannot even receive loose resources today.

## Complete, don't compete

- Harness IDs and paths follow each vendor's own documentation, linked under Sources. Forge doesn't invent folder
  conventions.
- `.agents/skills` (read by Codex, Copilot, Cursor, Devin, Kilo, OpenCode, Cline and others) is used where a harness
  documents it, rather than adding a forge-specific skills folder.

## Goals (v0.8)

- Rename "assistant" to "harness" in code, CLI text, config, reports and docs in **one mechanical PR**, without
  breaking existing configs.
- Rename forge's own unbuilt "plugin" concept to "extension", so "plugin" means a harness plugin from here on.
- Extend the harness definition with a component model that can describe every resource kind 0003 delivers.
- Add a built-in **Droid** definition. Claude Code is already built in.

## Non-goals

- Plugin packaging, install and versioning (0003) and the load check (0004).
- Other new built-in harnesses, Windsurf legacy marking, and custom harnesses: later releases (section 5).
- Changing v0.7 sync behaviour for existing built-in harnesses. Their target paths and transforms stay byte-identical.
- Website copy. The web repo is updated after v0.8 lands.
- The hq design docs that use "plugin" for the planned Smelt shared engine. Those are updated separately; this spec
  only frees the word inside forge-cli.
- Comment-preserving config writes in general (the existing writer reserializes and drops comments). The surgical
  alias edit avoids extending that to the rename; a comment-preserving writer is a tracked follow-up, out of scope
  for v0.8.

## Design

### 1. Vocabulary

| Old | New | Notes |
|---|---|---|
| assistant / AI assistant | harness / coding harness | Identifiers, files, folders, CLI text, docs |
| `src/domain/assistants/` | `src/domain/harnesses/` | `AssistantDefinition` → `HarnessDefinition`, `assistantsRegistry` → `harnessesRegistry`, and so on |
| `assistants:` config key | `harnesses:` | `assistants:` is still read (alias) through v0.x and removed at v1.0; `harnesses:` is always written |
| `SyncReport.assistants` | `SyncReport.harnesses` | `forge health` reads older reports that only have `assistants` |
| telemetry event `assistants` | `harnesses` | Local JSONL only; older lines stay as written |
| `docs/how-to-add-assistant.md` and the "AI Assistants" section of `docs/forge.config.yaml` | `docs/how-to-add-harness.md`, "Coding harnesses" | |
| `io/plugin`, `PluginRequest`/`PluginResponse`, reserved `plugins: []` | `io/extension`, `ExtensionRequest`/`ExtensionResponse` | Forge's own extension point, still unbuilt. The top-level `plugins:` key is then free for 0003 |

Config `version` stays `"1"`. If a config has both `assistants:` and `harnesses:`, loading fails with a message that
names both keys and asks the user to keep one. The alias conversion is a **standalone, rename-only text
edit of the `assistants:` key line**, landing as its own write before the config writer runs: the existing writer
reserializes the whole document (`CONFIG_HEADER + stringifyYaml`, `src/infrastructure/config/writer.ts`) and already
drops comments on every write, so routing the rename through it would silently extend comment loss to user-edited
files. The edit matches only the canonical top-level mapping key (`^assistants:`); quoted keys, extra spacing and
commented `# assistants:` lines keep the read alias, are left untouched, and get a note in the report. If the
operation that triggered the first write also carries other config changes, those go through the reserializing
writer as a second write, with its existing comment-dropping behavior. Sync state needs no migration: state entries
store only `{hash, sourceName, baseline}` (`src/infrastructure/config/state.ts`), no harness IDs.

**Downgrade note.** A converted config (only `harnesses:`) is rejected by pre-rename CLIs, whose schema requires
`assistants:` (`src/infrastructure/config/schema.ts`). The CHANGELOG entry says so, mirroring the state-v2
downgrade hazard the safety contract documents.

### 2. Harness definition

```ts
// src/domain/harnesses/types.ts
export const COMPONENT_KINDS = {
  SKILL: 'skill', RULE: 'rule', COMMAND: 'command', AGENT: 'agent', HOOK: 'hook',
  MCP: 'mcp', LSP: 'lsp', OUTPUT_STYLE: 'output-style', SETTING: 'setting',
} as const

export interface ComponentTarget {
  project?: string                 // path relative to project root (dir ends with '/', file otherwise)
  global?: string                  // path relative to home ('~/' prefix)
  format: ComponentFormatId        // e.g. 'skill-dir', 'markdown', 'mcp-json', 'json-keys'
  key?: string                     // for keyed formats: JSON key path to merge under (e.g. 'mcpServers')
  transforms?: TransformStep[]
}

export interface HarnessDefinition {
  id: HarnessId
  name: string
  detection: DetectionRule
  targetMappings: TargetMapping[]                                  // v0.7 resource sync, unchanged
  components: Partial<Record<ComponentKind, ComponentTarget>>      // what the harness can load, and where
  plugin?: HarnessPluginCapability                                 // shape in 0003 §5; unset in v0.8, set by #56/#57
}
```

- `components` is the source of truth for new code. For the five existing built-ins, `components[skill|rule|command]`
  mirror their v0.7 `targetMappings` exactly (same destinations and same transforms), and a registry test checks
  that every mapping's destination **and transforms** match `components[kind]` (`skills/**` → `skill`,
  `rules/**` → `rule`, `workflows/**` → `command`).
- New built-ins hand-write both `targetMappings` and `components`; the same consistency test keeps them aligned.
- `format` IDs are a closed registry in `src/domain/harnesses/formats.ts`. 0003 adds emitters for the formats it
  delivers.
- A missing kind means "this harness has no such concept". 0003 decides the fallback for each kind.
- `HarnessId` stays a closed union of built-in IDs in v0.8 (custom harnesses are later, section 5).

### 3. Built-in harness paths

Paths come from the vendor docs listed under Sources. "—" means the harness has no location for that kind. Columns
are project paths, with the global path after `|` where it differs. Keyed targets are written `file#key`. Only the
Claude Code and Droid columns are v0.8 scope; the other columns are reference data for the later waves in section 5
and are re-verified when those waves are specced.

| Kind | Claude Code | Droid | Codex | Copilot | Cursor | Devin | OpenCode | Kilo | Cline |
|---|---|---|---|---|---|---|---|---|---|
| skill | `.claude/skills/` | `.factory/skills/` \| `~/.factory/skills/` | `.agents/skills/` \| `~/.agents/skills/` | `.github/skills/` \| `~/.copilot/skills/` | `.cursor/skills/` \| `~/.cursor/skills/` | `.devin/skills/` \| `~/.config/devin/skills/` | `.opencode/skills/` \| `~/.config/opencode/skills/` | `.kilo/skills/` \| `~/.kilo/skills/` | `.cline/skills/` \| `~/.cline/skills/` |
| rule (always-on) | `.claude/rules/` | UNVERIFIED (spike, see below) | `AGENTS.md` (file) | `.github/instructions/` | `.cursor/rules/` (`.mdc`) | `.devin/rules/` + `AGENTS.md` | `AGENTS.md` (file) | `AGENTS.md` + `kilo.jsonc#instructions` | `.clinerules/` |
| command | `.claude/commands/` | `.factory/commands/` \| `~/.factory/commands/` | — | `.github/prompts/` | `.cursor/commands/` | — | `.opencode/commands/` | `.kilo/commands/` | `.clinerules/workflows/` |
| agent (subagent) | `.claude/agents/` | `.factory/droids/` \| `~/.factory/droids/` | `.codex/agents/*.toml` | `.github/agents/` | `.cursor/agents/` | `.devin/agents/` | `.opencode/agents/` | `.kilo/agents/` | `.cline/agents/` |
| hook | `.claude/settings.json#hooks` | `hooks/hooks.json` in the plugin (loose path UNVERIFIED) | — | — | `.cursor/hooks.json` | `.devin/hooks.v1.json` | code only | code only | `.clinerules/hooks/` |
| mcp | `.mcp.json#mcpServers` | `~/.factory/mcp.json#mcpServers`; plugin `mcp.json` (project loose UNVERIFIED) | `.codex/config.toml#mcp_servers` | `.vscode/mcp.json` | `.cursor/mcp.json` | `.devin/mcp_config.json` | `opencode.json#mcp` | `kilo.jsonc#mcp` | `cline_mcp_settings.json` (global only) |
| output-style | `.claude/output-styles/` | `.factory/output-styles/` | — | — | — | — | — | — | — |

Detection follows the existing pattern: the harness's project folder, plus its home folder for global mode. Droid is
detected from `.factory/` (project) and `~/.factory/` (global).

**Droid loose-resource mappings.** The Droid definition maps `skills/**` → `.factory/skills/` and `workflows/**` →
`.factory/commands/`, with the global paths above. The `rules/**` mapping is resolved by a spike against the Droid CLI
pinned in CI before the definition is committed: if Droid documents a rules directory, `rules/**` maps there;
otherwise Droid gets no `rules/**` mapping and sync reports rules as not delivered for Droid. Forge does not write
loose rules into `AGENTS.md` (a whole-file target forge would share with the user). The remaining UNVERIFIED Droid
cells are only reached through plugins (0003), where the plugin layout is documented.

### 4. Plugin capability

The definition type gains the optional `plugin?: HarnessPluginCapability` field (shape in 0003 §5). v0.8 lands it
**unset on every built-in**; 0003's delivery issues (#56, #57) set it on `droid` and `claude-code` together with
their emitters and registrars, so the model never names a registrar that does not exist yet. An enabled harness
without it keeps its v0.7 loose-resource sync and is skipped for plugins with a report line (0003).

### 5. Later releases

These were part of the original v0.8 plan and move out, so v0.8 ships Droid and Claude Code quickly. Each comes back
as a spec revision with its own acceptance rows; nothing below is part of this contract.

| Item | Where it goes |
|---|---|
| Codex and Copilot built-ins (Copilot's loose-resource definition already exists) | v0.10 harness wave, with their plugin delivery (0003 §9) |
| Cursor and Devin built-ins, Windsurf marked legacy ("now Devin Desktop") | v0.11 harness wave |
| OpenCode and Kilo built-ins | v0.11 harness wave, with the shim plugin emitter |
| Cline plugin delivery (its loose-resource definition stays as is) | v0.11 harness wave, with the pseudo-plugin emitter |
| Custom harnesses (inline and `.crucible/harnesses/<id>.yaml` definitions, two-pass validation, data-only plugin modes) | v0.11 harness wave, with the pseudo-plugin emitter they depend on |
| Antigravity | Backlog, conditional on owner capacity |

## Rollout

Implemented by crucibledx/forge-cli#53, in two PRs:

- **PR 1:** the rename (section 1, all rows). Mechanical apart from the aliases, the report read fallback, the
  both-keys error, and the surgical alias conversion. Existing tests keep passing with renamed identifiers and
  nothing else.
- **PR 2:** the `components` model, the format registry, the consistency test for the five existing built-ins, the
  optional plugin capability field (unset), and the Droid definition (after the rules spike in section 3).
- Docs: `README.md` table and `docs/how-to-add-harness.md`. CHANGELOG under v0.8.0, including the downgrade note
  (section 1). The web repo is updated after v0.8 lands, including a redirect from `/forge/assistants`.

## Open questions

- None that block. The Droid `rules/**` destination is decided by the PR 2 spike (section 3), not by an e2e test
  asserting a guess.

## Acceptance contract

| ID | Behavior that must be true | Check (type) | How to run / evidence |
|------|----------------------------|--------------|-----------------------|
| AC-1 | A config with only `assistants:` loads unchanged and behaves exactly as before | test | config loader unit test with a v0.7 fixture |
| AC-2 | A config with both `assistants:` and `harnesses:` fails to load with an error naming both keys | test | config loader unit test |
| AC-3 | The alias conversion is a standalone, rename-only text edit of the config file: byte-identical except the canonical top-level `assistants:` key line, comments included. It lands as its own write; when the triggering operation also carries other config changes, the reserializing writer applies them in a second write with its existing comment-dropping behavior. Non-canonical spellings keep the read alias and are left untouched | test | alias-conversion unit test (byte comparison minus the key line, quoted/spaced/commented cases) + write-ordering test |
| AC-4 | Every built-in harness's `targetMappings` destinations and transforms match its `components` entry for the same kind | test | registry consistency test in `src/domain/harnesses/` |
| AC-5 | `forge init`, `forge status` and `forge health` show "harness" wording and no "assistant" remains in user-facing CLI output or the README | cli snapshot + grep | grep of `--help` output, init/status fixtures, `README.md` |
| AC-6 | `forge health` reads a v0.7 report that has `assistants` and displays it | test | report reader unit test with an old-format fixture |
| AC-7 | The five existing harnesses sync the same files to the same paths as v0.7 | e2e | existing sync e2e suites pass unmodified apart from renames |
| AC-8 | `droid` is detected from `.factory/` (project) and `~/.factory/` (global) and syncs skills and workflows to `.factory/skills/` and `.factory/commands/` (and the global paths); rules go to the spike-resolved directory, or are reported as not delivered for Droid when there is none. The spike's outcome replaces this row in the PR that lands the definition | e2e | Droid sync e2e fixture, project and global |
| AC-9 | Forge's own extension point is named `extension` (`io/extension`, `ExtensionRequest`); no type, flag or doc uses "plugin" for it | test + doc | typecheck + grep; `docs/forge.config.yaml` updated |
| AC-10 | `docs/how-to-add-harness.md` exists and matches the implemented model (components, format registry, consistency test) | doc | file path and headings |
| AC-11 | The harness definition type carries the optional plugin capability field, unset on every built-in (0003 §5 sets it in #56/#57) | test | registry unit test |

## Sources

- Claude Code: https://code.claude.com/docs/en/plugins-reference.md, https://code.claude.com/docs/en/skills,
  https://code.claude.com/docs/en/memory.md (`.claude/rules/` and `~/.claude/rules/`, incl. path scoping) (accessed 2026-11-25)
- Factory Droid: https://docs.factory.com/harness/plugins, https://docs.factory.com/droid-cli/settings, local droid v1.12.1 (accessed 2026-11-25)
- Reference data for later waves (section 3 table): OpenAI Codex https://learn.chatgpt.com/docs/codex-manual.md; GitHub Copilot https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference; Cursor https://cursor.com/docs/rules.md; Devin https://docs.devin.ai/desktop/devin-local/customizations; OpenCode https://opencode.ai/docs/skills/; Kilo Code https://kilo.ai/docs/customize/skills; Cline https://docs.cline.bot/getting-started/config.md (accessed 2026-11-11)
