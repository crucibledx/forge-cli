---
id: "0001"
title: "Forge safety and test foundation"
status: approved
scope: project
target_repos: [forge-cli]
assets: none
size: mission
idea_issue: "crucibledx/hq#2"
created: 2026-11-04
---

# 0001: Forge safety and test foundation

## Problem

Agents will change Forge more often, but passing the current tests does not establish that a sync is safe.
In v0.6.24, a failed source can become an empty successful result; mixed enabled/disabled assistants are not
filtered consistently; state is rebuilt from intended rather than applied targets; rollback excludes state/config
commit failures. Tests can encode these behaviors without detecting a policy violation.

Baseline: `origin/main` at `7a9dd3e9036d97499501bb2d2e9ebaac9b063ca2`. Recorded CI had 523 unit and 167 E2E
tests, about 71 seconds end to end. This is one historical observation, not a new run or p95.
The E2E framework already uses real Bun PTYs. Keep it; its gaps are lifecycle, pipe draining, isolation,
and matching old transcript text as if it were a new prompt.

Research and evidence: [part 1](https://github.com/crucibledx/hq/issues/2#issuecomment-6631850781),
[part 2](https://github.com/crucibledx/hq/issues/2#issuecomment-6631983637).
Draft PR #1 is unapproved roadmap input, not a compatibility standard.

## Complete, don't compete

- Keep `bun:test`, the current PTY journeys, existing review automation, and the independent verifier.
  Add executable Forge rules, not another general reviewer, runner, agent harness, or MCP server.
- [Bun subprocesses](https://bun.com/docs/runtime/child-process) provide transport, not screen semantics.
  A later screen-aware pilot can use [Tuistory](https://github.com/remorses/tuistory) or another existing driver.
- [fast-check](https://fast-check.dev/docs/tutorials/setting-up-your-test-environment/property-based-testing-with-bun-test-runner/)
  complements example tests with reproducible generated counterexamples.
- Follow [CLI Guidelines](https://clig.dev/) when designing the subsequent machine interface. Harness vendors
  can improve their own interfaces; cross-tool configuration ownership and Forge's sync safety remain our job.
  There is no claim that vendors cannot build similar checks.

## Goals

- Make sync failure, ownership, scope, state, and rollback policies executable before adding features.
- Make the existing test harness trustworthy, isolated, and bounded on failure.
- Preserve quick feedback with reproducible installs, a small generated-test corpus, and measured CI costs.
- Give reviewers and verifiers stable rule IDs and independently runnable checks.
- Establish existing-command agent-DX evidence without pretending the wizard is a machine protocol.
- Separate human DX, business rules, agent CLI, E2E, security and performance evidence behind one readiness decision.

## Non-goals

- No compiler, new assistant format, manifest, plugin engine, new CLI flags, JSON protocol, or wizard redesign.
- No whole-suite migration to a screen driver, global coverage quota, mutation campaign, or paid model evaluation.
- No concurrent-writer or process-crash/power-loss atomicity guarantee. Serialize sync invocations until a separate
  locking/cache-coordination spec is approved; document this limitation prominently.
- No repository-settings mutation, automatic merge/release, version bump, or changes in other repositories.
  Required branch rules are an owner-operated follow-up, not secretly enabled by this spec.

## Design

### 1. Safety ledger and compatibility boundary

Add `docs/safety-contract.md`: each `BR-*` below gets examples, counterexamples, owning layer, test paths,
and relevant acceptance IDs. The policies below are proposed approval decisions, not descriptions of today's
implementation. Merging this spec approves them. A later implementation may not weaken them by changing fixtures.

Keep config version `"1"`, existing sync flags (`--dry-run`, `--silent`, `--verbose`), global scope, source
precedence, transforms, and default conflict strategies. Correct the explicitly unsafe behaviors below, including
the existing E2E expectation that a nonexistent source succeeds. Do not freeze current output wording as an API.

| Rule | Required policy |
| --- | --- |
| BR-01 | Any configured source load/read/resolve failure aborts the whole sync before user-data mutation. No partial-success mode. A readable empty source is successful input, not a failure. |
| BR-02 | Only enabled assistants receive writes or stale deletions. Previously tracked files for disabled/removed/unknown assistants remain untouched and tracked. |
| BR-03 | Delete only previously tracked stale targets for currently enabled assistants when `keep_local:false`. Untracked sibling files and unrelated user files are never cleanup candidates. |
| BR-04 | Trusted state hashes mean last-installed upstream bytes, not desired bytes or observed local edits. Legacy entries remain explicitly unknown until verified; state changes only with the committed outcome. |
| BR-05 | `--dry-run` performs the same source validation and planning, returns the same failure outcome, and changes no target, backup, state, or project/global config bytes. |
| BR-06 | Handled apply/state/config persistence failures restore the pre-run protected snapshot when compensation succeeds. Otherwise report unrestored paths, including metadata, and never claim success or a restored snapshot. |
| BR-07 | Target, backup, metadata, and rollback operations remain inside the selected root. Reject traversal and symlink/reparse-point targets or ancestors below that root. |
| BR-08 | Repeating a successful sync preserves target and backup bytes. `--silent` changes presentation only, never outcome or safety policy. |
| BR-09 | Every test session has one total deadline, drains output, detects child exit, and cleans up its child processes and terminal on every path. |
| BR-10 | Tests use disposable homes, temp/cache/config roots and local sources, never the operator's credentials, home, scheduler, or live remote repositories. |

#### Source and plan outcomes

Refactor `src/application/commands/sync/handler.ts` so source acquisition produces explicit successful/failed
outcomes; do not render-and-continue into a destructive plan. Resolve only enabled assistant definitions.
Collect source diagnostics, then abort if any source failed. An all-empty but successful input must still reach
planning so stale cleanup obeys BR-03; it must not take today's unconditional early-success return.
For valid configuration, attempt every source and collect load/resolve successes and failures;
success here means readable/resolved input, not committed files. Never stop diagnostics at the first source error.
This runtime policy is separate from CI: independent validation lanes also finish and report before a failed gate.
Any per-file planning error aborts before applying *any* mutation, including a backup.
Validate source directories before scanning: local/Git roots and a configured Git subdirectory must exist and be
directories. Missing paths, read failures, clone/fetch/branch failures and resolution errors are failures; a
readable empty or fully filtered directory is successful empty input. Test both loaders, not just a missing local path.

Exit `0` means the planned sync committed or was a valid dry-run; exit `1` means a source, config, conflict,
planning, apply, or persistence failure. Preserve existing top-level usage-error behavior.
In human mode identify the failing source/path and actionable next step; silent mode still returns `1`.
No new partial-success exit code or machine-output schema is introduced.
Redact credentials from all diagnostics/reports, including Git URLs and nested errors.

Keep `SyncReport`'s existing fields. For a normal run reaching sync execution, persist `success:false` on failure
with `error` and `files.errors >= 1`, and do not leave an older success as the apparent latest run when report
storage works. A failure report has `synced:0`; `errors` counts failed sources or paths, with a minimum of one
for transaction-wide failure. On success, retain the existing per-status count meanings.
Dry-run never writes a latest/history report, including empty-input and failed previews.
Logs, Git download caches, and enabled local telemetry are allowed incidental effects, not protected user data.
Report/log/telemetry failures must not turn an already committed sync into a claimed rollback: warn unless silent,
keep its committed exit outcome, and preserve the original sync error on failure. Incomplete compensation is the
one silent-mode exception: always emit a minimal recovery-required diagnostic with unrestored paths to stderr,
even if report storage also fails. Never include source contents or credentials in that diagnostic.

#### Ownership and persisted state

Introduce internal state version `2`: `{version:2, lastSync, files}`, with entries
`{hash, sourceName, baseline:"installed"|"legacy-unknown"}`. Config remains version `"1"`.
Read old unversioned state as `legacy-unknown` in memory, without writing during load/preview.
Legacy hashes may describe desired-but-skipped bytes: never silently reinterpret them as installed baselines.
If a legacy target differs from desired bytes, always run the configured local-conflict policy, even if the old
hash equals the desired hash. `local-wins` retains bytes and the unknown marker; `error` aborts; `remote-wins`
uses the normal backup/overwrite policy. Only installation or byte-identical current desired content establishes
an `installed` baseline. `status` must label unknown baselines rather than assert verified in-sync from their hash.
Reject malformed/unsupported state versions before mutation. Persist v2 only inside a successful transaction;
rollback restores exact legacy bytes. Do not downgrade v2 back to the old CLI: document restoring a pre-upgrade
backup or deliberately rebuilding state after preserving edits.
For `local-wins`, retain the previous entry unchanged; if there was no previous entry, do not invent one.
For stale targets kept by `keep_local:true`, and disabled/removed/unknown assistants, retain previous entries.
Remove an entry only when its tracked target is successfully deleted. Advance state/config `lastSync` together
only on a successful apply, including a successful no-op. Pre-apply failures and dry-runs leave both unchanged;
handled persistence failures restore both when compensation succeeds. If metadata cannot be restored, explicitly
identify it as unrestored and untrusted instead of claiming that timestamps or the previous state remain consistent.
Recovery guidance: preserve remaining files/backups, restore target/config/state from one known-good snapshot,
and rerun a dry-run before apply; do not automatically retry writes using unrestored metadata.

Classify ownership using all registered assistants' destination mappings for the selected project/global scope,
with separator normalization and segment boundaries, not the existing project-only prefix helper. Match against
all assistants before checking which are enabled. Unmatched or ambiguous mappings are conservative: retain their
files/entries and warn, never guess an owner or delete. Test every assistant in both scopes, natively on Windows too.

Stale locally edited tracked files use the same conflict policy as updates: `local-wins` preserves bytes/entry,
`error` aborts the entire plan, `remote-wins` may delete, with a backup when `backup:true`.
An existing stale `legacy-unknown` target is always treated as locally changed, even when its bytes equal the old
hash; no desired content exists to verify that baseline. Apply the same conflict/backup policy before deletion.
Deleting one source from a nonempty source list is intentional removal for its enabled-assistant targets, not a
fetch failure. Retain the existing `sources:[]` validation error: removing the final source exits `1` and does not
clean anything. Deliberate empty-input cleanup requires at least one configured readable empty source.
Existing explicit overwrite semantics for an untracked target collision remain, including `backup:true`.
Never overwrite a different existing `.bak` file: treat that collision as a plan error; an identical backup may
be reused. Backup files are not future stale-cleanup candidates.
After intentional exact-path source precedence resolution, validate the complete target/backup/delete/metadata
path graph. Reject competing operations at one path, source targets colliding with generated backups or reserved
metadata, file/directory ancestor collisions, and aliases. Use a conservative portable alias key (separator-normalized,
Unicode NFC, lowercase) on every OS, even where the filesystem could distinguish them. Distinct spellings sharing
a key fail before writes; do not merge them through source precedence. Existing identical backup reuse is not a
second write operation. Document the new case/Unicode collision rejection as a compatibility correction.

#### Bounded transaction and path confinement

Introduce an internal prepare/apply/commit/compensate boundary in the infrastructure layer, orchestrated by the
application handler. No new public API or journal format. Validate all planned paths before mutation; snapshot
existence and bytes of targets, backups, `.crucible/sync-state.json`, and `.crucible/forge.config.yaml`.
Also snapshot supported access metadata: preserve existing POSIX permission bits on replacement and restoration.
Create adjacent temporaries exclusively at mode `0600`, then set the required final mode before rename; new
config/state stay private, and new targets use `0666 & ~umask`. On Windows preserve existing access controls on
replacement or refuse before mutation if preservation is unsupported; never clear read-only attributes to force
a write. Native tests cover read-only refusal and a restricted-access fixture. Ownership, timestamps, extended
attributes and alternate data streams are not preserved guarantees; warn in migration documentation.
Use byte/permission-preserving restoration, including originally absent metadata. Track newly created directories and
remove them on rollback only when empty. Do not delete pre-existing directories.

Use adjacent temporary files plus rename for individual file/state/config replacement. On any handled error,
restore all touched files and metadata, including a partially failed operation, in reverse order. Do not rely
on the current `AppliedMutation.success` filter to discover every touched file. Return rollback results rather
than swallowing restoration errors. Full compensation permits “rollback complete”; otherwise exit `1`, name
unrestored paths, say recovery is incomplete, and retain available backups for manual recovery.
Test state commit succeeding, config commit failing, then state restoration failing: name state as untrusted.
Fault injection is via injected infrastructure functions in tests, never hidden production environment flags.

Confinement uses platform-aware `relative`/absolute/drive checks, not a string prefix plus `/`.
Canonicalize the selected project/global root once; a symlink used to reach the root is permitted.
Below that boundary reject symlink/reparse-point leaves or existing ancestors, including dangling links, before
reads, writes, deletes, metadata commits, and compensation. An external-root sentinel must remain byte-identical.
Refuse the root itself as a file target and test sibling-prefix, `..`, absolute outside-root, Windows drive/UNC,
and mixed-separator cases. Internal symlink targets are also rejected for a simple, consistent policy.
This protects against pre-existing path escapes, not a malicious concurrent process swapping directories after
validation. Crash recovery and hostile concurrent filesystem races require a separately approved design.

### 2. Trustworthy subprocess and PTY harness

Keep `e2e/framework/`, existing convenience runners, and `bun:test`. Add shared lifecycle ownership:

- Pipe result: `{stdout, stderr, exitCode: number | null, signal: string | null, timedOut: boolean, output}`.
  `output` remains the stripped-stdout compatibility alias. Never merge streams in pipe-contract tests.
  Begin draining stdout/stderr concurrently before awaiting exit; decode streaming UTF-8 without chunk damage.
- PTY result uses `output` as the combined transcript and explicit exit/signal/timeout fields. A PTY cannot
  prove separate stdout/stderr. Label `getOutput()` a transcript, never a reconstructed terminal screen.
- Default total session deadline 10 seconds, configurable per test up to 30 seconds; individual waits cannot
  extend it. At expiry reject with a bounded transcript. Stop registered descendants, escalate termination after
  500 ms, reap the child, close the PTY, and cancel outstanding waits/timers within another 2 seconds.
  Fixture descendants must be proved dead, not merely unreferenced.
- Session runners own cleanup in `finally`, including driver assertion failure. Input methods return/chain the
  promise for the actual write so rejected actions cannot become unhandled background work.
- Configure Bun's runner timeout explicitly: 20 seconds for a default session (<=5-second setup + 10-second
  session + 2.5-second cleanup); a 30-second session needs a >=40-second test timeout. Register every session in
  teardown before driving it; `afterEach` disposes active sessions even after a runner timeout. Add a nested Bun
  fixture deliberately killed by the test runner's shorter timeout, and prove its child/descendants are reaped.
- `waitForText` consumes an output cursor through the match. A subsequent wait cannot match the same old bytes.
  Reject immediately on exit when the awaited new text did not arrive. Add explicit transcript-mark support for
  drivers that must distinguish several prompts emitted in one chunk; never depend on fixed sleeps.
- Cap retained raw diagnostic tails at 256 KiB per stream/transcript while continuing to drain. Success assertions
  use bounded scenario data, not unbounded retained logs. Failure artifacts include command, relative cwd, exit,
  signal, timeout, transcript tail and test seed. Redact fixture secrets and normalize disposable paths.

Use `mkdtemp` for every test workspace, with distinct `project/`, `home/`, and `tmp/` directories.
Set HOME/USERPROFILE, temp variables and XDG roots; use an allowlisted subprocess environment containing required
runtime/PATH/OS variables, not inherited tokens, SSH agent, Git config, or Forge settings.
Set Git config isolation and `GIT_TERMINAL_PROMPT=0`; use fresh local bare repositories. Unit tests mock scheduler
infrastructure; scheduler E2E uses a fake command backend, never the real user scheduler. If an existing test requires
an OS scheduler, move it to an explicit opt-in suite outside required/offline checks.

Set child temp roots *before importing* modules with cached temp/home constants, so the existing Git cache resolves
inside the fixture. Prove cache isolation with two independent subprocesses; do not introduce a public cache flag.
Isolation applies to the existing full unit/E2E suites too, not only new helpers. A test launcher establishes a
disposable process-level environment before Bun imports *any* tests; per-test fixtures nest inside it. Existing
Git unit-test cache cleanup must only delete that sandbox's cache. Prove this using an outside-cache sentinel and
the full-suite launcher's unchanged inherited environment/secret sentinels, not a real operator-home experiment.
Mocks/global scope remain serial within a process; no blanket concurrency switch.
Harness fixture programs cover stdout/stderr flood, split Unicode, repeated prompts, early exit, infinite wait,
driver assertion failure, cancellation/EOF, and a spawned descendant.

### 3. Fast business-rule and existing-agent-DX checks

Add `src/domain/sync/safety.property.test.ts` using a pinned fast-check dev dependency:
100 runs per property, fixed default seed `20261104`, report seed/path on failure and accept `FC_SEED`/`FC_PATH`
environment replay overrides; empty path means a fresh run, malformed overrides fail with an actionable error.
Check source precedence with an independent ordered-map oracle, conflict decisions with a small truth table,
resolved-path uniqueness for valid noncolliding inputs, and pure state-reconciliation preservation of skipped/
retained entries. Do not use production functions as their own oracle.
Add each discovered minimal counterexample to ordinary example tests. Additional property time target: 2 seconds,
measured rather than a flaky hard wall-clock assertion.

Add `e2e/contracts/existing-cli.test.ts` for today's noninteractive commands: `--help`, `--version`, config-backed
`sync`, `sync --dry-run`, `sync --silent`, `config show`, and `status` against local fixtures.
Use closed stdin and redirected streams; assert genuine exit, outcome, filesystem/state and absence of prompt
control sequences. For `status`, configure a previously synced fixture to avoid querying the real scheduler.
Test malformed/missing config for `sync` and invalid options without a hang.
This is a regression lane, not a claim that `init`/source/config wizards are agent-native or that current stdout
is a stable JSON contract. Keep wizard journeys in PTY tests; assert persisted results as well as prompts.

### 4. Reproducible and visible gates

Check in `.bun-version` with one tested exact stable patch version (candidate on this machine: `1.4.2`; this is
not a compatibility claim until checked). Commit `bun.lock`, stop ignoring it, use `bun install --frozen-lockfile`
in CI and release workflow jobs, and read the same pin with setup-bun. Align documented development prerequisites;
raise the declared minimum runtime only when the source launcher has actually passed on that minimum.
Do not trigger releases, change tag behavior, or pin a floating `latest`.

#### Independent validation modules

Add a small checked-in registry `scripts/validation-lanes.ts`: stable lane ID, commands, required flag, timeout,
fixture scope and AC/BR mappings. This is a table of modules, not a plugin framework. All rows below are required
on every PR, with no path-based skips. Existing full suites stay intact; focused lanes may reuse their tests.

| Lane ID | Checks and command contract |
| --- | --- |
| quality | Existing `format:check`, `lint`, `typecheck`, including `scripts/`; separate steps preserve all diagnostics. |
| business | `test:unit`, `test:properties`, `check:contracts`, and scripts' checker self-tests. |
| e2e | Full `test:e2e`, including harness lifecycle/isolation and sync safety. |
| human-dx | `test:human`: existing init/config/source/uninstall PTY journeys, invalid input, help, selection and cancellation-before-persistence; verify config/files, not just prompts. No screen-emulator claims. |
| agent-cli | `test:agent`: `e2e/contracts/existing-cli.test.ts`, closed stdin, bounded exit, separate streams and safe outcomes for today's commands. |
| security | `test:security`: confinement, ownership, rollback and credential-redaction scenarios; malicious local-source script sentinel must never execute; dependency audit below. |
| performance | `test:performance`: fixed offline 10/1000-target fixtures, cold help and cold/warm sync, checked output/state and recorded timings; no new benchmark framework. |
| native-macos / native-windows | Separate `test:platform` jobs for local sync/rollback/containment/ownership in both scopes, pipe smoke, access controls, and native compiled help/version. |
| build | Existing Linux build and compiled help/version, independently of unit/E2E success. Cross-compilation is not native execution evidence. |

Run independent jobs in parallel with distinct process/home/cache/temp sandboxes; do not parallelize unsafe tests
inside a process. No quality/unit failure may skip E2E/human/agent/security/performance/native/build diagnostics.
Matrix jobs use `fail-fast:false`; independent checks within a lane use separate steps with recorded outcomes,
not a short-circuit `&&` chain. Failed setup blocks only that job; dependent checks are explicitly blocked, never
passed. Cancellation/superseding a commit cannot cancel only failing siblings and leave a green current-head gate.

The workflow matrix lists each lane's registered package scripts; `check:contracts` keeps it equal to the registry.
Every lane checks out the event's tested SHA, and each check runs as a separate `always()` step whose output streams
to the job log. `Deterministic gate` runs `always()` after the lane matrix and passes only when `needs.lanes.result`
is `success`: any failed, cancelled, skipped or timed-out lane fails it. The result comes from the same workflow run
and commit, so "Re-run failed jobs" combines re-run and carried-over lanes correctly.

Security runs `bun audit --json --audit-level=high` on the frozen lock, with a 60-second request deadline.
High/critical advisories in runtime or development dependencies block readiness; no implicit ignore list.
Unavailable/invalid advisory data or skipped unaudited packages are blocked, not a clean audit. This public-registry
metadata request is the explicit network exception; deterministic security/other fixtures remain offline.
Performance smoke has a 30-second per-invocation safety deadline; wrong outputs or timeout fail the lane.
Latency samples are advisory per OS/Bun/fixture; ongoing baseline aggregation, p50/p95 publication and approved
regression thresholds belong to the performance follow-up, not an unimplemented 20-sample trigger here.

New scripts: `test:contracts`, `test:properties`, `test:platform`, `test:human`, `test:agent`, `test:security`,
`test:performance`, `check:contracts`, `check:lanes`; isolate before imports.
`scripts/run-tests.ts [--timeout-ms 20000|40000] -- <paths...>` spawns pinned `bun test --timeout <ms>`, forwards
exit and disposes its sandbox in `finally`. `test:contracts` selects checker self-tests, `e2e/framework/contracts/`,
`e2e/commands/sync/safety/` and `e2e/contracts/`; platform runs only native-safe safety tests plus platform.test.ts.
`check:contracts` validates BR/AC IDs, existing mappings/paths, required lanes/workflow jobs, frozen exact toolchain
and follow-up boundaries. Include scripts' self-tests in `test`; malformed fixture registries/workflows must fail.
Retain `test` as the full suite. `check:lanes` runs applicable modules without short-circuiting; foreign native
modules are blocked, not simulated.

#### Timing, evidence and merge readiness

Record per-job/test durations, OS/Bun version and flake results. Each check runs as its own CI step, so its
output, including failures, is in that lane's job log; the repository uploads no evidence artifacts.
Record 10 consecutive no-retry focused safety/harness passes plus native CI runs on the implementation PR.
Nazar's budget replaces the two-minute target: complete automated PR feedback normally 5–10 minutes, acceptable
execution-path ceiling 15 minutes (parallel lanes <=10 minutes, gate <=5). Measure through the required gate;
report queue and independent-review time separately. Timeout blocks, never skips a lane.
Unbounded queue/owner/LLM review is not a fabricated SLA. Local checks target <=10 seconds without flaky assertions.

Merge readiness is CI plus human review. A PR is ready when all required lanes and `Deterministic gate` pass on its
exact tested merge revision, the hosted `review` check passes with no unresolved blocking findings, and the code
owner approves. A failed, cancelled, skipped or timed-out lane fails the gate; no AI verdict overrides it. The repository keeps
no readiness collector/checker, producer attestations or evidence bundles; the PR body and CI are the record.
PR draft/non-draft is not readiness; avoid non-draft-only review trigger cycles. Update repo loop/contributor/safety
guidance and owner setup for required `Deterministic gate`/reviews; report unenforced rules truthfully. No auto-merge.

## Rollout

1. Spec PR only. Merge is approval, not proof that any acceptance check below already passes.
2. Implementation slice A: lifecycle/isolation, pin/lock and harness self-tests. No production policy changes yet.
3. Slice B, depending on A: fail-closed planning, ownership/state reconciliation, confined compensating transaction,
   focused regressions and properties. Run existing suites; update unsafe permissive expectations explicitly.
4. Slice C, depending on B: modular native/human/agent/security/performance gates, evidence and readiness review.
   The mission is complete only when the final integrated branch satisfies every AC row.

Implementation uses ordinary reviewable PRs linked to the same approved contract. Do not mark this issue done
after slice A. Keep releases/manual semver separate. Add release-note-ready safety/migration guidance to
`docs/safety-contract.md` and README: source errors now fail, disabled targets are preserved, empty sources can
clean tracked stale files, backup/alias collisions can block a plan, state v2 uses conservative legacy baselines,
access-metadata limits apply, silent mode has an emergency-recovery exception, and sync invocations must be serialized.
No website changes or companion assets are required for this spec.

Track, but do not implement under this contract, separate future CLI and MCP interface specs: shared application
use cases/invariants, transport-specific CLI stdout/exit and MCP schemas/errors; neither transport replaces the other.
Future modules attach to the registry only when their feature contracts are approved; no fake passing MCP lane.
Other follow-ups: explicit noninteractive setup/source/config with versioned output/errors; <=6-journey
screen-driver pilot (cancellation/Unicode/resize, <=30 seconds); concurrency/crash recovery; packaging parity/
extended performance; compiler corpora with native activation correctness. Mutation/real-agent evaluations start advisory.
Every approved compiler slice needs its own input/IR/output/diagnostic checks; this spec approves no draft compiler
semantics or release schedule.

## Open questions

No blocking unknown prevents a spec review. Nazar confirmed current-CLI-first hardening, separate future CLI/MCP
interfaces, and 5–10/15-minute feedback. His all-results request applies to CI; runtime source outcomes are also
collected, but partial mutation remains unapproved. The other sync-safety decisions remain proposals until merge.
The exact Bun patch and native CI capabilities are validated during implementation, with unsupported environments
reported as blocked rather than quietly skipped. A larger scope needs a separate spec, not silent expansion.

## Acceptance contract

Written before implementation. The implementing agent may not edit this section.
Paths below are implementation deliverables, not assertions that these tests already exist.
All commands run from the Forge repository using the pinned Bun and frozen lockfile. Every `bun test <paths>`
below is shorthand for `bun run scripts/run-tests.ts -- <paths>`, with process isolation and a 20-second runner
timeout; use `--timeout-ms 40000` before `--` for longer session tests. CI must use the launcher, not raw Bun.
Test files must contain the named BR/scenario assertions; each must fail for its documented counterexample.

Owner-approved amendment (crucibledx/forge-cli#29, merged by the owner): AC-32 now describes the CI merge gate.
The earlier readiness collector/checker, producer attestations and `docs/quality-gate-readiness-contract.md` are withdrawn.
Owner-approved amendment (crucibledx/forge-cli#28): `Deterministic gate` aggregates the run's own lane job results
(`needs.lanes.result`) instead of re-validating uploaded lane evidence; AC-25, AC-27 and AC-32 are reworded to match.

| ID | Behavior that must be true | Check (type) | How to run / evidence |
| --- | --- | --- | --- |
| AC-1 | Ledger covers BR-01..10 with examples/counterexamples, layers, AC IDs and existing test paths; validator rejects malformed contracts. | test | `bun run check:contracts` and `bun test scripts/check-contracts.test.ts` |
| AC-2 | All configured sources report acquisition/resolve outcomes despite errors; local/Git root/subdirectory/read/clone/fetch/branch/resolve failures exit 1 without protected mutation, alone/all-failed and with a good changed source; successes are not claimed installed. | e2e | `bun test e2e/commands/sync/safety/source-failure.test.ts` |
| AC-3 | Readable empty/fully filtered sources succeed; keep_local false cleans eligible stale targets, true retains them. Removing a source cleans eligible targets while another remains; removing the final source fails without mutation. | e2e | `bun test e2e/commands/sync/safety/empty-source.test.ts` |
| AC-4 | Every assistant, in project and global scopes on each native platform, uses scope-aware ownership; disabled/removed/unknown/ambiguous outputs and entries remain unchanged under both keep_local policies. | e2e | `bun test e2e/commands/sync/safety/assistant-scope.test.ts`; AC-26 native runs |
| AC-5 | Stale cleanup preserves untracked sentinels; local-wins/error/remote-wins and backup true/false obey policy for edited stale targets and every existing legacy-unknown stale target, including bytes equal to its old hash. | e2e | `bun test e2e/commands/sync/safety/ownership.test.ts` |
| AC-6 | State v2 records installed vs legacy-unknown baselines; skipped/stale entries persist, never-installed local-wins targets stay absent. Old skipped-update and stale-equals-legacy-hash fixtures cannot bypass conflict policy; migration/preview/failure/status are truthful. | test | `bun test src/domain/sync/reconcile.test.ts e2e/commands/sync/safety/upgrade.test.ts` |
| AC-7 | State/config lastSync advance together on success/no-op; pre-apply failures leave both unchanged, handled apply/persistence failures restore both when compensation succeeds; unrestored metadata is explicitly identified otherwise. | e2e | `bun test e2e/commands/sync/safety/state.test.ts` |
| AC-8 | Dry-run validates identically but never changes protected files or reports, including all-empty, source-failure and conflict cases. | e2e | `bun test e2e/commands/sync/safety/dry-run.test.ts` |
| AC-9 | Any planning error blocks all writes: different existing backups, generated-backup/source-target/metadata conflicts, case/NFC aliases and file/directory collisions. Identical backup reuse and intentional exact-path source precedence still work. | e2e | `bun test e2e/commands/sync/safety/planning.test.ts` |
| AC-10 | Inject failure before/after each target/backup/delete/state/config write/rename with working compensation; exact prior bytes/existence/permissions return, newly created empty dirs disappear and pre-existing dirs remain. Successful replacements preserve supported access metadata. | test | `bun test src/infrastructure/fs/transaction.test.ts`; AC-26 Windows restricted-access/read-only fixtures |
| AC-11 | Compensation failure names unrestored paths, marks metadata untrusted, never claims rollback/success, exits 1 and retains backups; specifically state commit succeeds, config commit fails, state restoration fails. | test | `bun test src/application/commands/sync/transaction.test.ts` |
| AC-12 | All operations reject traversal, root-as-file, prefix siblings, outside absolute paths and symlink ancestors/leaves including metadata/backup/rollback. | test | `bun test src/infrastructure/fs/confinement.test.ts`; native Windows drive/UNC cases in AC-26 |
| AC-13 | Project/global sync stay in their canonical selected root; symlink-root access works, outside sentinel bytes do not change on rejection. | e2e | `bun test e2e/commands/sync/safety/confinement.test.ts` |
| AC-14 | Repeated sync preserves target/backup bytes and policy; all existing conflict/transform/layout cases still pass except documented unsafe expectations. | e2e | `bun run test` plus `bun test e2e/commands/sync/safety/repeat.test.ts` |
| AC-15 | Human failures identify source/path/recovery action; failed latest reports are truthful when writable; previews produce none; report/log/telemetry errors neither reverse commits nor hide primary failures. Credential-bearing Git URLs/nested errors leak no secret sentinel to stdout/stderr/logs/latest/history/emergency diagnostics. | test | `bun test src/application/commands/sync/outcome.test.ts` |
| AC-16 | Pipe runner drains simultaneous stdout/stderr floods without deadlock, preserves separate channels/UTF-8, exit and signal, with bounded diagnostic tails. | test | `bun test e2e/framework/contracts/pipe.test.ts` |
| AC-17 | PTY waits consume new output, reject early exit, propagate input failure, distinguish repeated prompts, and decode split Unicode. | test | `bun test e2e/framework/contracts/pty.test.ts` |
| AC-18 | Pipe/PTY hangs, Ctrl+C/EOF, driver exceptions and runner-level timeout trigger bounded cleanup; runner budget exceeds setup/session/cleanup, descendants die and waits/PTYs do not leak. | test | `bun test e2e/framework/contracts/lifecycle.test.ts` |
| AC-19 | Full unit/E2E launcher and per-test homes/cache/temp/env/scheduler/Git isolation prevent inherited contamination; legacy Git cache cleanup preserves an outside-sandbox sentinel and no secret reaches child/artifact. | test | `bun test e2e/framework/contracts/isolation.test.ts`; `bun run test` in isolated launcher |
| AC-20 | All four independent-oracle properties run >=100 cases each, print replay seed/path and reproduce a deliberately injected counterexample in checker self-tests. | test | `bun run test:properties`; PR includes seed/path replay command and expected failed negative-control run |
| AC-21 | Closed-stdin help/version/sync/dry-run/silent/config show/status terminate with asserted outcomes; missing/malformed sync config and invalid options fail without prompts. | e2e | `bun test e2e/contracts/existing-cli.test.ts` |
| AC-22 | Existing wizard journeys still assert persisted configs/files, not just transcript text; no screen-emulator claims for stripped output. | e2e | `bun test e2e/commands/init.test.ts e2e/commands/config/ e2e/commands/source/` |
| AC-23 | Silent valid/failed/preview sync uses the same exit/mutation policy with no visible output, except incomplete rollback always names unrestored paths on stderr, including simultaneous report-storage failure. | e2e | `bun test e2e/commands/sync/safety/silent.test.ts` |
| AC-24 | A clean frozen install uses committed lock/exact Bun pin; inconsistent pin/workflow/lock settings fail validation; release jobs share it without release execution. | test | `bun install --frozen-lockfile && bun run check:contracts`; implementation PR records `bun --version` and clean git diff |
| AC-25 | All registered required modules gate every PR; unit/quality failure never skips other lanes; fail-fast is off; the always-run `Deterministic gate` fails unless every lane job in the run succeeded, so a failed/cancelled/skipped/timed-out lane fails it. | test | `bun run test:contracts`; `scripts/check-contracts.test.ts` workflow fixtures reject an unregistered/missing matrix lane, dropped or short-circuiting check steps, fail-fast, path filters and a gate that is not `always()`, lacks `needs: lanes` or ignores its result; PR links a run with one red lane and red gate, and CI job links prove separate unit/E2E jobs |
| AC-26 | Native macOS and Windows execute local sync/rollback/containment/pipe smoke and compiled help/version without real scheduler access; Windows drive/UNC cases run natively. | e2e | `bun run test:platform` and native CI artifact links for both OSes, including built binary commands |
| AC-27 | Every check's output, including failures, is readable in its own lane job log; ten focused runs pass without retries; 5–10-minute target, 15-minute ceiling and lane deadlines are configured/reported without invented p95. | test | `bun run test:contracts` ten times; `bun run check:contracts` verifies separate check steps and timeouts; PR links a failing-assertion job log and native/CI timing samples |
| AC-28 | Module/readiness guidance, exact commands, safety limits, separate future CLI/MCP contracts and approval boundaries are documented; no fabricated MCP coverage or branch enforcement. | doc | `bun run check:contracts`; README, CONTRIBUTING.md, docs/safety-contract.md, .factory/loop-contract.md; PR includes read-only branch-rule evidence/access blocker |
| AC-29 | Human DX asserts input/invalid retry/selection/help/cancel-before-persistence and saved outcomes; agent CLI checks closed stdin/streams/errors separately; both report independently when another lane fails. | e2e | `bun run test:human` and `bun run test:agent`; registry fixtures verify required lane coverage |
| AC-30 | Security tests never execute source scripts or leak secrets; audited high/critical, unavailable/invalid or unaudited results block without hiding sibling successes. No audit modifies dependencies. | test | `bun run test:security`; security wrapper fixtures inject each audit outcome and assert status/evidence/unchanged lock |
| AC-31 | Performance smoke checks 10/1000-target output/state, records cold/warm timings, fails incorrect output/30-second timeout, reports insufficient baselines advisory; no invented hard latency threshold. | test | `bun run test:performance`; benchmark wrapper fixtures exercise timeout/wrong output/missing baseline |
| AC-32 | Merge readiness is the CI gate plus human review, not repository tooling: `Deterministic gate` passes only when every required lane job passes on the current head's tested merge revision; a failed, cancelled, skipped or timed-out lane fails it. The repository ships no readiness, producer or attestation collector/checker. The hosted `review` check and code-owner approval then decide the merge through owner-configured branch rules, not a repository test. | test | `bun run test:contracts` (`scripts/check-contracts.test.ts` AC-32 workflow-drift cases); `bun run check:contracts`; `git grep` for readiness/producer tooling and `collect:readiness`/`check:readiness` in `scripts`, `package.json`, `.factory` and `CONTRIBUTING.md` finds none; CI `Deterministic gate` on the PR, red with one red lane and green after "Re-run failed jobs" |
