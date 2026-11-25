---
id: "0004"
title: "Plugin load check"
status: approved
scope: project
target_repos: [forge-cli]
assets: none
size: session
idea_issue: "crucibledx/hq#14"
created: 2026-11-11
---

# 0004: Plugin load check

Part of forge v0.8, with [0002](0002-harness-model-and-rename.md) and [0003](0003-plugin-packages-and-delivery.md).
Owner requirement: "don't deliver untested rules". For v0.8 that means a small check per plugin harness: does the
harness load what forge installed? It uses the harness's own CLI, with no model calls and no API keys. Lands as
v0.8.x, after #51, #56 and #57.

## Problem

0003's golden tests prove output bytes, not that a harness accepts them. A plugin can be valid and still fail to
register, sit in a marketplace the harness never reads, or carry a manifest the harness rejects. Rules are the
riskiest delivery in v0.8: for Claude Code they are loose files outside the plugin directory, and for Droid they are
a generated hook — so the check covers them explicitly.

## Complete, don't compete

Reuses each vendor's own commands (`claude plugin validate`, `claude plugin list`, `droid plugin list`) instead of a
parallel verification harness, and reuses the pinned harness CLI install from the real sync smoke test
(crucibledx/forge-cli#51) instead of a second one.

## Goals

- One load-check job per v0.8 plugin harness (Claude Code, Droid), in parallel, gating merges.
- Each job installs the `cover-all` fixture (0003) with the built forge binary, then asks the harness CLI whether the
  plugin is there, checks the rule delivery, then removes the plugin and asks again.
- **No model calls, no API keys, no secrets.**

## Non-goals

- Model-level checks (does a skill trigger, does a rule change output). Those belong to `forge bench` and the
  optimization phase.
- A per-component inventory through the harness beyond the rule assertions below. Per-component placement is 0003's
  golden and e2e tests.
- Harnesses other than Claude Code and Droid. Each later harness wave adds its own job (0003 §9).

## Design

### 1. The job

One matrix entry per harness and scope (`user`, `project`) on `ubuntu-latest`, in a disposable `HOME` and project
folder:

1. Install the harness CLI at the pinned version (the #51 install step) and log `--version`.
2. Write a forge config with the `cover-all` fixture as a `local` plugin source and run `forge sync --yes`. It must
   exit 0. For Claude Code at project scope, the job pre-seeds the folder-trust entry in the disposable HOME's
   `~/.claude.json` first. If a harness or scope cannot be automated without a model call, the entry runs at the
   scope that can and records why the other is skipped.
3. Ask the harness:

| Harness | Load assertion | Extra checks |
|---|---|---|
| Claude Code | `claude plugin list --json` shows `cover-all@crucible-forge`, enabled, at the locked version | `claude plugin validate <cache>/cover-all/<version>/claude-code/` passes (warnings allowed); the rule files `~/.claude/rules/cover-all--*.md` (user scope) or `.claude/rules/cover-all--*.md` (project scope) exist with the fixture's rule text |
| Droid | `droid plugin list --scope <scope>` shows `cover-all@crucible-forge`, `Enabled`, at the locked version | the emitted plugin's `hooks/hooks.json` registers a `SessionStart` hook that prints the fixture's rule text |

4. Remove the plugin from the config, run `forge sync --yes`, and assert the list no longer shows it and the rule
   files are gone.

If a harness only materializes settings-declared plugins when a session starts, the job triggers that with the
harness's own non-model command (for example a marketplace update) and records which one. If the list command needs
a login or a step that cannot run without a model call, the job falls back to the harness's validate command (where
one exists) plus a check of the forge-written settings keys, and prints `load-check mode: fallback (<reason>)`. A job
in fallback mode still fails when its checks fail; it never passes silently.

Session-level rule application (the model actually seeing the rule) is verified at the byte level only in v0.8; the
follow-up is `forge bench` and the optimization phase.

### 2. CI shape

- The jobs run in the same workflow job family as #51 and reuse its pinned CLI install (npm packages pinned with
  integrity, or a vendor archive pinned by checksum; never an unpinned script from the network).
- The load check is a required lane: `scripts/validation-lanes.ts` names it, so the Deterministic gate fails when it
  fails. Its network policy (npm registry and vendor archive downloads only) is added to `docs/safety-contract.md`
  next to the security lane's `bun audit` exception, and the "ten required modules" sentence there is updated to
  name the new lane.
- A failing job prints the forge plan, the portability report, and the harness command output.
- The job script is runnable locally. The negative case (AC-7) runs through it locally against a broken fixture
  variant; its log is attached to the PR as evidence. No permanently failing job exists in CI.
- Adding a harness later is one matrix entry plus its row in the table above.

## Rollout

- One wave-2 PR (v0.8.x), after #51, #56 and #57: the lane, the jobs, the gate wiring and the contract-doc amendment.
- If #51's job is not yet a required lane when this lands, this PR makes the shared job required.

## Open questions

- Whether `claude plugin list` shows a settings-declared plugin before a session starts, and whether `droid plugin
  list` needs a login. Both are handled by the trigger and fallback rules in section 1, so neither blocks.

## Acceptance contract

| ID | Behavior that must be true | Check (type) | How to run / evidence |
|------|----------------------------|--------------|-----------------------|
| AC-1 | The load check runs one job per v0.8 plugin harness (Claude Code, Droid) per automatable scope in parallel, and the Deterministic gate fails when the lane fails or is missing | e2e | `requiredLaneIds` names the lane; gate run with the lane failed |
| AC-2 | No job references a secret, receives auth env, or makes a model API call | test | workflow lint: no `secrets.` in the lane and the job env matches a declared allowlist |
| AC-3 | Harness CLIs are pinned and each job logs the version it ran; no unpinned network script runs | e2e | version line in each job log; install provenance in the workflow |
| AC-4 | After `forge sync --yes`, each job proves through the harness's own list command that `cover-all@crucible-forge` is enabled at the locked version, or prints the fallback mode and its reason and passes the fallback checks | e2e | job log per harness and scope |
| AC-5 | The Claude Code job passes `claude plugin validate` on the emitted plugin directory | e2e | job log |
| AC-6 | Each job asserts the rule delivery of section 1: Claude rule files exist with the fixture's text, the Droid plugin registers the `SessionStart` rule hook; after removal the rules are gone and the harness list no longer shows the plugin | e2e | job log |
| AC-7 | A deliberately broken delivery (fixture variant with a wrong manifest path) fails the job script; the negative case runs locally and its log is attached to the PR | test | negative-case log in the PR |
| AC-8 | A failing job prints the forge plan, the portability report, and the harness command output | e2e | negative-case log in the PR |
| AC-9 | The lane's network policy and gate wiring are documented in `docs/safety-contract.md`, including the updated "ten required modules" sentence, and `check:contracts` passes | contract | `bun run check:contracts` on the PR |

## Sources

- Claude Code plugin CLI (`plugin list`, `plugin validate`) and rules: https://code.claude.com/docs/en/plugins-reference.md, https://code.claude.com/docs/en/memory.md (accessed 2026-11-25).
- Factory Droid plugin CLI (`droid plugin list --scope`) and hooks: https://docs.factory.com/harness/plugins (accessed 2026-11-25).
