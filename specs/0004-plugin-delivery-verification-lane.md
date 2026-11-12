---
id: "0004"
title: "Plugin delivery verification lane"
status: approved
scope: project
target_repos: [forge-cli]
assets: none
size: mission
idea_issue: "crucibledx/hq#14"
created: 2026-11-11
---

# 0004: Plugin delivery verification lane

Part of forge v0.7, with [0002](0002-harness-model-and-rename.md) and [0003](0003-plugin-packages-and-delivery.md).
Owner requirement: "don't deliver untested rules" — every tier-1 harness gets a verification job that delivers a
plugin the way forge delivers it and proves, through the harness's own inspection surface, that every resource
landed. No model calls and no API keys: verification is structural. Model-level smoke tests move to the later
optimization phase.

## Problem

0003 proves output bytes, not that a harness accepts them. A plugin can be valid and still fail to register, land
a skill where the harness never looks, write an MCP entry the harness can't parse, or leave stray keys in a settings
file. Nothing in the ecosystem verifies one plugin across many harnesses.

## Complete, don't compete

Reuses each vendor's own inspection commands rather than building a parallel verification harness. Uses the official
[agent-plugins-conformance](https://github.com/agentplugins/agent-plugins-conformance) plugins as additional fixtures
where their Apache-2.0 format fits. When the optimization phase adds model-level evals, the agentskills.io eval
guidance and promptfoo's harness providers are the prior art to build on — explicitly not v0.7.

## Goals

- A CI lane that runs one verification job per tier-1 harness, in parallel, independent of the existing lanes.
- Each job: install the harness CLI (pinned version), have forge deliver a fixture plugin, then prove every resource
  landed using the harness's own inspection surface (plugin/skill/MCP list commands) or by reading the files and
  settings forge wrote.
- **No model calls, no API keys, no secrets.** Verification is structural, not behavioural at the model level.
- Consume the `cover-all` fixture plugin owned by 0003 M1, which covers every deliverable resource kind from the
  0003 matrix with expected adaptations and expected drops encoded as data.

## Non-goals

- No LLM invocations and no API keys in v0.7. Model-level smoke tests (does the skill trigger well, does the rule
  influence output) move to the later optimization phase, when skill quality matters.
- No testing of harness surfaces without a scriptable CLI or readable config (pure VS Code extension UI state).
- No changes to the existing ten lanes' semantics; the new lane joins the gate like any other.

## Design

### 1. What "landed" means per harness

Each job asserts on the strongest inspection surface the harness CLI offers, falling back to file checks:

| Harness | CLI install in CI (pinned) | Primary inspection | File/settings checks (always run) |
|---|---|---|---|
| Claude Code | `install.sh` + `claude install <ver>` | `claude plugin list --json` (id, version, scope, enabled, installPath) | `.claude/skills/<n>/`, emitted `.claude-plugin/`, `.claude/settings.json` owned keys |
| Factory Droid | npm `droid@<ver>` (auto-update off) | `droid plugin list` (text; `--json` unverified) + `enabledPlugins`/`extraKnownMarketplaces` in `.factory/settings.json` | settings keys, `.factory/` component dirs, marketplace cache presence |
| Codex | npm `@openai/codex@<ver>` | `codex plugin list --json` | `.agents/plugins/marketplace.json`, `.codex/config.toml` owned keys, `skills/` |
| Copilot CLI | npm `@github/copilot@<ver>` | `copilot plugin list --json` (if it requires GitHub auth, file-only job — recorded in the job) | `.github/copilot/settings.json`, `~/.copilot/installed-plugins/` |
| Cursor | vendor install script (no pin mechanism; job records `--version`, retries the install up to 2 times) | none documented | `.cursor/{rules,skills,agents,hooks.json,mcp.json}`, `~/.cursor/plugins/local/<n>/` |
| Devin | npm `devin@<ver>` | `devin plugins list`, `devin skills list`, `devin mcp list` (if they require login, file-only job) | `.devin/config.json` owned keys, `.devin/{skills,rules,agents}` |
| OpenCode | npm `@opencode/cli@<ver>` | none for content | `.opencode/{skills,commands,agents}`, `opencode.json` owned keys |
| Kilo | npm `@kilocode/cli@<ver>` | none for content | `.kilo/{skills,commands,agents}`, `kilo.jsonc` owned keys |
| Cline | npm `cline@<ver>` | `cline config skills` / `cline config mcp` with isolated `--config` dir | `.cline/skills`, `.clinerules/`, `cline_mcp_settings.json` owned keys (user scope) |
| Antigravity (conditional with its 0003 scope) | vendor install (pin mechanism unverified; job records version) | `agy plugin list --json` | `.agents/plugins/<n>/` |

A list command that turns out to require an account login degrades the job to file/settings checks only; the job
records which mode it ran in. The job fails if neither the list command nor the files show the delivery. Be plain
about the consequence: **for harnesses stuck in file-only mode (Copilot and Devin are the likely candidates), the
v0.7 guarantee is file/settings assertions plus the portability report and owned-key diff — not harness-confirmed
registration.** That is still a stronger guarantee than any competitor offers, and the degrade rule keeps it honest.

Assertion order per job: (1) `forge plugin add --yes --accept-settings` exits 0 with the expected portability
report (the fixture's default settings are opt-in, so the job passes the explicit flag — `--yes` never implies
settings acceptance, per 0003 §7); (2) the harness's own list command shows the plugin or its components (parsed as
JSON where the CLI offers `--json`); (3) every emitted file exists at its expected path; (4) settings files contain
exactly the forge-owned keys and nothing else changed (diff against a pre-run snapshot); (5) `forge plugin remove`
leaves no forge-owned files or keys behind.

### 2. Fixture plugin

Owned by 0003 M1: one fixture under `e2e/fixtures/plugins/cover-all/` exercising every deliverable resource kind
from the 0003 matrix — two skills (one portable, one vendor-folder), a path-scoped rule, a command, an agent, a
hook, a stdio MCP server (a tiny local script, no network), an output style, and opt-in default settings. Expected
adaptations and expected drops per harness are encoded as data, so the same fixture validates the portability
report, not just placement. This lane consumes the fixture and may extend it; it does not own it.

### 3. CI shape

- One matrix job per harness on `ubuntu-latest` (macOS/Windows file-level correctness is covered by the existing
  native lanes, extended with keyed-merge cases in 0003 M4; a harness whose CLI has no Linux build is marked in the
  table and verified file-only).
- Harness CLIs installed at pinned versions: npm packages pinned with integrity through the repo's own lockfile
  (as dev-only CI tools); vendor install scripts mirrored into the repo or pinned by recorded checksum — never an
  unpinned `install.sh` from the network on every PR. This is the lane's declared network policy, added to
  `docs/safety-contract.md` next to the security lane's existing `bun audit` exception. Note the interplay: the
  pinned CLI packages fall under the security lane's `bun audit --audit-level=high` gate, so M1 pre-checks the ten
  CLIs' audit posture; a vendor CLI with a high/critical finding is installed from a mirrored archive instead of
  npm, with the exception recorded in the contract doc.
- Jobs run with a disposable `HOME` and the harness's config-dir env overrides where they exist; no user state.
- The lane runs on `pull_request` and `push` like the others, and its evidence joins the deterministic gate. Joining
  the gate is explicit work: `scripts/validation-lanes.ts` (`requiredLaneIds`), the suites registry AC-label guards,
  the gate summary, and the contract docs all name the new lane.
- Failure output includes the forge plan, the portability report, and the inspection command output.

### 4. What this deliberately does not check

Whether the model uses a resource well (skill quality, instruction following). That belongs to the optimization phase
with model-level evals. The v0.7 guarantee is: **the harness sees exactly what forge delivered, and nothing else
changed.**

## Rollout

- **M1:** lane infrastructure (including the gate/registry/contract-doc wiring and the network-policy amendment),
  and the first two jobs (Claude Code, Droid) consuming the 0003 fixture. Joins the gate.
- **M2:** remaining native jobs (Codex, Copilot, Cursor, Devin; Antigravity only if its conditional 0003 scope lands).
- **M3:** pseudo-plugin jobs (OpenCode, Kilo, Cline), which lean entirely on file/settings assertions.
Each harness job is its own PR. A harness that blocks (auth-required list with unusable fallbacks) ships file-only
and is marked in the workflow with a comment linking the gap.

## Open questions

- Whether `droid plugin list --json`, `agy` version pinning, and the Cursor CLI's plugin listing exist — each is
  handled by the degrade-to-file-checks rule, so none blocks the lane.

## Acceptance contract

| ID | Behavior that must be true | Check (type) | How to run / evidence |
|------|----------------------------|--------------|-----------------------|
| AC-1 | The lane runs one job per tier-1 harness in parallel and the deterministic gate fails without it | e2e | gate run with the lane disabled fails; `requiredLaneIds` names the lane |
| AC-2 | No job references a secret, receives auth env, or makes a model API call | test | workflow lint: no `secrets.` in the lane and the job env matches a declared whitelist; job logs show no auth env |
| AC-3 | The `cover-all` fixture exercises every deliverable resource kind and declares expected adaptations/drops per harness | test | fixture manifest validated against the 0003 matrix |
| AC-4 | Each native-harness job proves the plugin is visible through the harness's own list command, or records why it ran file-only | e2e | job output artifact per harness |
| AC-5 | Each job proves every emitted file exists at its expected path and settings files contain exactly the forge-owned keys | e2e | per-harness assertion script output |
| AC-6 | `forge plugin remove` in the same job leaves no forge-owned files or keys | e2e | post-remove diff in the job |
| AC-7 | Harness CLI versions are pinned (or recorded, where pinning is impossible) and the install is reproducible without unpinned network scripts | e2e | version line in each job log; install provenance in the workflow |
| AC-8 | A deliberately broken delivery (wrong path) fails the job | test | negative-case job run on a fixture variant |
| AC-9 | A job failure's output includes the forge plan, the portability report, and the inspection command output | e2e | negative-case job artifacts |
| AC-10 | The lane's network policy and the gate wiring are documented in `docs/safety-contract.md`, and `check:contracts` passes | contract | `bun run check:contracts` on the M1 PR |

## Sources

- Install and inspection surfaces per vendor docs and CLI references (accessed 2026-11-11): code.claude.com (plugin list), docs.factory.com (plugin list), developers.openai.com/plugins, docs.github.com/copilot CLI reference, cursor.com/docs, docs.devin.ai/cli, opencode.ai/docs, kilo.ai/docs, docs.cline.bot, antigravity.google/docs.
- Official conformance fixtures: https://github.com/agentplugins/agent-plugins-conformance (Apache-2.0).
