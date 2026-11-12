---
id: "0002"
title: "Coding harness model, rename, and custom harnesses"
status: approved
scope: project
target_repos: [forge-cli]
assets: none
size: mission
idea_issue: "crucibledx/hq#14"
created: 2026-11-11
---

# 0002: Coding harness model, rename, and custom harnesses

Part of forge v0.7, together with [0003 plugin packages and delivery](0003-plugin-packages-and-delivery.md) and
[0004 delivery verification lane](0004-plugin-delivery-verification-lane.md). This spec owns the vocabulary and the harness data
model the other two build on.

## Problem

- **Outdated vocabulary.** Forge calls Claude Code, Cursor, Copilot and the rest "AI assistants". The org now calls
  them coding harnesses, and v0.7 adds "plugins", a word forge already uses for its own unbuilt extension mechanism
  (`src/infrastructure/io/plugin`, `PluginRequest` in `src/domain/protocol/types.ts`, the reserved `plugins: []` key in
  `docs/forge.config.yaml`).
- **The model only knows three content globs** (`skills/**`, `rules/**`, `workflows/**`). Plugins also carry
  subagents, hooks, MCP servers, LSP servers, output styles and default settings.
- **Missing harnesses.** Only five are built in (`claude-code`, `cline`, `copilot`, `cursor`, `windsurf`). Droid,
  Codex, Kilo Code, OpenCode, Devin and Antigravity are missing, even for loose resources.
- **No user-defined harnesses.** `assistantIdSchema` is `z.enum(getAssistantIds())`, so any harness that isn't built
  into the binary is rejected at config load.
- **Windsurf is out of date.** It became Devin Desktop on 2026-06-02. Cascade, the agent forge targets today, is legacy.

## Complete, don't compete

- Harness IDs and paths follow each vendor's own documentation, linked in the path table below. Forge doesn't
  invent folder conventions.
- `.agents/skills` (read by Codex, Copilot, Cursor, Devin, Kilo, OpenCode, Cline and others) is used where a harness
  documents it, rather than adding a forge-specific skills folder.
- Custom harness definitions let teams cover the long tail (Qwen Code, Augment, Amp, Junie, Zed, Warp, Kiro) without
  forge maintaining them.

## Goals

- Rename "assistant" to "harness" in code, CLI text, config, reports and docs in **one mechanical PR**, without
  breaking existing configs.
- Rename forge's own unbuilt "plugin" concept to "extension", so "plugin" means a harness plugin from here on.
- Extend the harness definition with a component model that can describe every resource kind 0003 delivers.
- Add built-in definitions for Droid, Codex, Kilo Code, OpenCode and Devin; **Antigravity is conditional** — it
  ships if capacity allows (the owner's decision was "if capacity allows"), otherwise v0.8. Mark Windsurf legacy.
- Let users declare custom harnesses in config, validated at the boundary.

## Non-goals

- Plugin packaging, install, versioning and adapters (0003) and delivery verification (0004).
- Changing v0.6 sync behaviour for existing built-in harnesses. Their target paths and transforms stay byte-identical.
- Website copy. The web repo is updated after v0.7 lands.
- Custom harnesses that run code. Definitions are data only.
- The hq design docs that use "plugin" for the planned Smelt shared engine. Those are updated separately; this spec
  only frees the word inside forge-cli.
- Comment-preserving config writes in general (the existing writer reserializes and drops comments). The surgical
  alias edit avoids extending that to the rename; a comment-preserving writer is a tracked follow-up, out of scope
  for v0.7.

## Design

### 1. Vocabulary

| Old | New | Notes |
|---|---|---|
| assistant / AI assistant | harness / coding harness | Identifiers, files, folders, CLI text, docs |
| `src/domain/assistants/` | `src/domain/harnesses/` | `AssistantDefinition` → `HarnessDefinition`, `assistantsRegistry` → `harnessesRegistry`, and so on |
| `assistants:` config key | `harnesses:` | `assistants:` is still read (alias) through v0.x and removed at v1.0; `harnesses:` is always written |
| `targets[].assistant` item key | `targets[].harness` | Same alias rule as `assistants:` |
| `SyncReport.assistants` | `SyncReport.harnesses` | `forge health` reads older reports that only have `assistants` |
| telemetry event `assistants` | `harnesses` | Local JSONL only; older lines stay as written |
| `docs/how-to-add-assistant.md` and the "AI Assistants" section of `docs/forge.config.yaml` | `docs/how-to-add-harness.md`, "Coding harnesses" | |
| `io/plugin`, `PluginRequest`/`PluginResponse`, reserved `plugins: []` | `io/extension`, `ExtensionRequest`/`ExtensionResponse` | Forge's own extension point, still unbuilt |

Config `version` stays `"1"`. If a config has both `assistants:` and `harnesses:`, loading fails with a message that
names both keys and asks the user to keep one. The alias conversion is a **standalone, rename-only text
edit of the `assistants:` key line**, landing as its own write before the config writer runs: the existing writer
reserializes the whole document (`CONFIG_HEADER + stringifyYaml`, `src/infrastructure/config/writer.ts`) and already
drops comments on every write, so routing the rename through it would silently extend comment loss to user-edited
files. If the operation that triggered the first write also carries other config changes, those go through the
reserializing writer as a second write, with its existing comment-dropping behavior. Sync state needs no
migration: state entries store only `{hash, sourceName, baseline}` (`src/infrastructure/config/state.ts`), no
harness IDs.

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
  format: ComponentFormatId        // e.g. 'skill-dir', 'markdown', 'cursor-mdc', 'mcp-json', 'mcp-toml', 'json-keys'
  key?: string                     // for keyed formats: JSON/TOML key path to merge under (e.g. 'mcpServers')
  transforms?: TransformStep[]
}

export interface HarnessDefinition {
  id: HarnessId
  name: string
  status: 'supported' | 'legacy'
  detection: DetectionRule
  targetMappings: TargetMapping[]                                  // v0.6 resource sync, unchanged
  components: Partial<Record<ComponentKind, ComponentTarget>>      // what the harness can load, and where
  plugin?: HarnessPluginCapability                                 // defined in 0003 §6
}
```

- `components` is the source of truth for new code. For the five existing built-ins, `components[skill|rule|command]`
  mirror their v0.6 `targetMappings` exactly — same destinations and same transforms — and a registry test checks
  that every mapping's destination **and transforms** match `components[kind]` (`skills/**` → `skill`,
  `rules/**` → `rule`, `workflows/**` → `command`).
- New built-ins hand-write both `targetMappings` and `components`; the same consistency test keeps them aligned.
- For a custom harness, `targetMappings` is derived from `components` with the same three globs.
- `format` IDs are a closed registry in `src/domain/harnesses/formats.ts`. 0003 adds emitters for each format.
- A missing kind means "this harness has no such concept". 0003 decides the fallback for each kind.

### 3. Built-in harnesses

Paths come from the vendor docs listed under Sources. "—" means the harness has no location for that kind. Columns
are project paths, with the global path after `|` where it differs. Keyed targets are written `file#key`.

| Kind | Claude Code | Droid | Codex | Copilot | Cursor | Devin | OpenCode | Kilo | Cline | Antigravity |
|---|---|---|---|---|---|---|---|---|---|---|
| skill | `.claude/skills/` | `.factory/skills/` \| `~/.factory/skills/` | `.agents/skills/` \| `~/.agents/skills/` | `.github/skills/` \| `~/.copilot/skills/` | `.cursor/skills/` \| `~/.cursor/skills/` | `.devin/skills/` \| `~/.config/devin/skills/` | `.opencode/skills/` \| `~/.config/opencode/skills/` | `.kilo/skills/` \| `~/.kilo/skills/` | `.cline/skills/` \| `~/.cline/skills/` | `.agents/plugins/<n>/skills/` |
| rule (always-on) | `.claude/rules/` | `.factory/AGENTS.md`? UNVERIFIED | `AGENTS.md` (file) | `.github/instructions/` (renamed `*.instructions.md`, frontmatter `paths`→`applyTo`) | `.cursor/rules/` (`.mdc`) | `.devin/rules/` + `AGENTS.md` | `AGENTS.md` (file) | `AGENTS.md` + `kilo.jsonc#instructions` | `.clinerules/` \| `Documents/Cline/Rules/` | `rules/AGENTS.md` |
| command | `.claude/commands/` | `.factory/commands/` \| `~/.factory/commands/` | — | `.github/prompts/` | `.cursor/commands/` | — (skills act as commands) | `.opencode/commands/` \| `~/.config/opencode/commands/` | `.kilo/commands/` \| `~/.config/kilo/commands/` | `.clinerules/workflows/` \| `Documents/Cline/Workflows/` | — |
| agent (subagent) | `.claude/agents/` | `.factory/droids/` \| `~/.factory/droids/` | `.codex/agents/*.toml` | `.github/agents/` | `.cursor/agents/` | `.devin/agents/` | `.opencode/agents/` \| `~/.config/opencode/agents/` | `.kilo/agents/` \| `~/.config/kilo/agents/` | `.cline/agents/` | `.agents/plugins/<n>/agents/` |
| hook | `.claude/settings.json#hooks` | `.factory/settings.json#hooks`? UNVERIFIED | — | — | `.cursor/hooks.json` | `.devin/hooks.v1.json` | code only | code only | `.clinerules/hooks/` scripts | `.agents/plugins/<n>/hooks.json` |
| mcp | `.mcp.json#mcpServers` | `~/.factory/mcp.json#mcpServers` (project UNVERIFIED) | `.codex/config.toml#mcp_servers` | `.vscode/mcp.json` / `~/.copilot/mcp-config.json` | `.cursor/mcp.json` | `.devin/mcp_config.json` | `opencode.json#mcp.servers` | `kilo.jsonc#mcp` | `~/.cline/.../cline_mcp_settings.json` (global only) | `.agents/plugins/<n>/mcp_config.json` |
| output-style | `.claude/output-styles/` | `.factory/output-styles/`? UNVERIFIED | — | — | — | — | — | — | — | — |

Detection rules follow the existing pattern: the harness's project folder, plus its home folder for global mode.
`windsurf` keeps its v0.6 mappings, gets `status: legacy`, and `forge init` no longer preselects it. Health and status
show "legacy (now Devin Desktop)" next to it. Antigravity's definition ships only if the conditional scope lands
(Goals); the column documents the intended paths either way.

### 4. Custom harnesses

```yaml
harnesses:
  - id: claude-code
    enabled: true
  - id: acme-agent
    enabled: true
    definition:
      name: Acme Agent
      detection: {directories: [.acme], files: []}
      components:
        skill:   {project: .acme/skills/, global: ~/.acme/skills/, format: skill-dir}
        rule:    {project: .acme/rules/, format: markdown,
                  transforms: [{transformer: frontmatter-rename, params: {from: paths, to: globs}}]}
        command: {project: .acme/commands/, format: markdown}
        # keyed targets need 0003 M4 (keyed-merge mutation); rejected at load until then:
        mcp:     {project: .acme/mcp.json, format: mcp-json, key: mcpServers}
      plugin: {mode: pseudo}
```

- Definitions can also live in `.crucible/harnesses/<id>.yaml` (project) or `~/.crucible/forge/harnesses/<id>.yaml`
  (global), so teams can share them. Precedence: **inline definition > project file > global file**.
- Loading is two-pass: a pre-load definition registry collects built-in IDs, inline `definition:` blocks, and
  definition files (project first, then global); only then are `harnesses:` references validated against the
  collected set. File discovery lives in that registry, not in the config schema — the config parser stays a pure
  parse of one file.
- Validation (zod, at definition load):
  - `id` is kebab-case and must not clash with a built-in ID.
  - Paths are relative, contain no `..`, and stay inside the project root or `~`.
  - `format` and transformer names must exist in their registries.
  - A `components` entry with `key:` is rejected with a named error until 0003 M4 lands (keyed merges don't exist
    before then); afterwards it merges per 0003 §7.
  - `plugin.mode` is `pseudo` or `native`. `native` is allowed only with the data-only emitters and registrars
    0003 §6 enumerates (`agent-plugins`, `claude`, `pseudo`; `dropIn`, `settings-keys`).
- An unknown `id` without a `definition` fails with: `Unknown harness "<id>". Add a definition or remove it from
  harnesses:`.
- `forge init` and `forge config` list custom harnesses next to built-ins. `forge status` and `forge health` treat
  them the same way.

## Rollout

- **M1:** the rename (section 1 rows except the last). One PR, purely mechanical apart from the aliases, the report
  read fallback, the both-keys error, and the surgical alias conversion. Existing tests keep passing with renamed
  identifiers and nothing else.
- **M2:** `plugin` → `extension` for forge's own unbuilt extension point (last row of the vocabulary table).
- **M3:** the `components` model, the format registry, and the consistency test for the five existing built-ins.
- **M4:** one PR per new built-in harness (Droid, Codex, Kilo, OpenCode, Devin; Antigravity if the conditional scope
  lands), plus Windsurf legacy. The Droid PR resolves its UNVERIFIED loose-resource cells (rule, hook, output-style)
  against a local Droid install before the paths are committed.
- **M5:** custom harnesses (inline and file-based).
- Docs: `README.md` table, `docs/how-to-add-harness.md`, and a new `docs/custom-harnesses.md`. CHANGELOG under v0.7.0.
  The web repo is updated after v0.7 lands, including a redirect from `/forge/assistants`.

## Open questions

- None that block. Path cells the vendor docs leave open are marked `UNVERIFIED`: plugin-delivered components are
  checked by the 0004 verification lane; the Droid loose-resource cells are resolved by the M4 spike above, not by
  an e2e test asserting a guess.

## Acceptance contract

| ID | Behavior that must be true | Check (type) | How to run / evidence |
|------|----------------------------|--------------|-----------------------|
| AC-1 | A config with only `assistants:` loads unchanged and behaves exactly as before | test | config loader unit test with a v0.6 fixture |
| AC-2 | A config with both `assistants:` and `harnesses:` fails to load with an error naming both keys | test | config loader unit test |
| AC-3 | The alias conversion is a standalone, rename-only text edit of the config file: byte-identical except the `assistants:` key line, comments included. It lands as its own write; when the triggering operation also carries other config changes, the reserializing writer applies them in a second write with its existing comment-dropping behavior | test | alias-conversion unit test (byte comparison minus the key line) + write-ordering test |
| AC-4 | Every built-in harness's `targetMappings` destinations and transforms match its `components` entry for the same kind | test | registry consistency test in `src/domain/harnesses/` |
| AC-5 | `forge init`, `forge status` and `forge health` show "harness" wording and no "assistant" remains in user-facing CLI output or the README | cli snapshot + grep | grep of `--help` output, init/status fixtures, `README.md` |
| AC-6 | `forge health` reads a v0.6 report that has `assistants` and displays it | test | report reader unit test with an old-format fixture |
| AC-7 | The five existing harnesses sync the same files to the same paths as v0.6 | e2e | existing sync e2e suites pass unmodified apart from renames |
| AC-8 | Each new built-in harness (droid, codex, kilo, opencode, devin; antigravity if the conditional scope lands) is detected from its documented folders and syncs skills/rules/workflows to the documented paths | e2e | per-harness sync e2e fixture |
| AC-9 | `windsurf` is marked legacy, is not preselected by `forge init`, still syncs as before when enabled, and `forge status`/`health` show "legacy (now Devin Desktop)" | e2e | init fixture + windsurf sync e2e + status snapshot |
| AC-10 | A custom harness declared inline syncs skills, rules and commands to its declared paths, with declared transforms applied | e2e | custom-harness sync e2e fixture |
| AC-11 | Definition files are discovered in `.crucible/harnesses/<id>.yaml` and `~/.crucible/forge/harnesses/<id>.yaml`; precedence is inline > project file > global file | test | harness definition registry tests, one per precedence clash |
| AC-12 | An unknown harness id without a definition fails config load with the "Unknown harness" message | test | config loader unit test |
| AC-13 | A custom definition with a path outside the project root (or `~`), an unknown format, an unknown transformer, a clashing built-in id, or (before 0003 M4) a keyed target is rejected at load with a specific message per case | test | schema validation tests, one per case |
| AC-14 | Forge's own extension point is named `extension` (`io/extension`, `ExtensionRequest`); no type, flag or doc uses "plugin" for it | test + doc | typecheck + grep; `docs/forge.config.yaml` updated |
| AC-15 | `docs/how-to-add-harness.md` and `docs/custom-harnesses.md` exist and match the implemented model | doc | file paths and headings |
| AC-16 | `forge init` and `forge config` list custom harnesses next to built-ins | cli snapshot | init/config output fixture with a declared custom harness |

## Sources

- Claude Code: https://code.claude.com/docs/en/plugins-reference.md, https://code.claude.com/docs/en/skills (accessed 2026-11-11)
- Factory Droid: https://docs.factory.com/harness/plugins, local droid v1.8.0 (accessed 2026-11-11)
- OpenAI Codex: https://learn.chatgpt.com/docs/codex-manual.md, https://learn.chatgpt.com/docs/agent-configuration/agents-md.md (accessed 2026-11-11)
- GitHub Copilot: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference (accessed 2026-11-11)
- Cursor: https://cursor.com/docs/plugins.md, https://cursor.com/docs/rules.md, https://cursor.com/docs/skills.md (accessed 2026-11-11)
- Devin: https://docs.devin.ai/cli/extensibility/plugins/overview, https://docs.devin.ai/desktop/devin-local/customizations (accessed 2026-11-11)
- OpenCode: https://opencode.ai/docs/plugins/, https://opencode.ai/docs/skills/ (accessed 2026-11-11)
- Kilo Code: https://kilo.ai/docs/customize/skills, https://kilo.ai/docs/customize/marketplace (accessed 2026-11-11)
- Cline: https://docs.cline.bot/getting-started/config.md (accessed 2026-11-11)
- Antigravity: https://antigravity.google/docs/plugins/ (accessed 2026-11-11)
