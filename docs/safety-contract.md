# Forge safety contract

This is implementation guidance for [approved spec 0001](../specs/0001-safety-and-test-hardening.md), not a change
to its frozen acceptance contract. `scripts/safety-ledger.ts` is the executable ledger: every BR has an owning layer,
an example, a counterexample, acceptance IDs and existing test paths. `bun run check:contracts` validates it.

## Rules and migration

| Rule  | Safe example                                                    | Unsafe counterexample                                                                    | Layer and evidence                                            |
| ----- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| BR-01 | Collect every source outcome, abort on any failure              | Treat an unreadable source as empty and delete its files                                 | Application; sync safety tests                                |
| BR-02 | Retain disabled/removed/unknown/ambiguous ownership             | Guess a global owner using a project-only prefix                                         | Domain/application; safety and native platform tests          |
| BR-03 | Delete eligible tracked stale outputs only                      | Discover an untracked sibling or backup as a cleanup candidate                           | Application; planning and CLI snapshots                       |
| BR-04 | Persist installed bytes or explicitly unknown legacy baselines  | Record desired-but-skipped bytes as installed                                            | Domain; state upgrade, reconciliation and properties          |
| BR-05 | Validate a preview without changing protected bytes or reports  | Advance timestamps or write latest reports during preview                                | Application; outcome and CLI contracts                        |
| BR-06 | Restore targets and metadata or identify exact untrusted paths  | Say rollback complete after restoration failed, or infer backup provenance from `.bak`   | Infrastructure; every transaction write/chmod/rename position |
| BR-07 | Permit the selected symlink root, reject links beneath it       | Follow a target/backup/metadata symlink outside the boundary                             | Infrastructure; confinement and external sentinels            |
| BR-08 | Repeat preserves target/backup bytes; silent preserves outcomes | Hide an incomplete recovery emergency or reverse a committed exit after a report failure | Application; outcome tests                                    |
| BR-09 | Drain bounded streams, own deadlines and descendants            | Reuse old prompt bytes or leave an orphan after leader exit                              | Harness; pipe, PTY and lifecycle contracts                    |
| BR-10 | Disposable homes, isolated Git and fake schedulers              | Use operator credentials, live sources or invented readiness                             | Harness; isolation, lane and checker tests                    |

### Compatibility corrections

- Source load/read/resolve errors now fail the whole sync with exit 1 before protected mutation. Diagnostics still
  collect every configured source. A readable empty or fully filtered source is successful input and can clean
  tracked stale files with `keep_local:false`; removing the final configured source remains an error.
- Disabled assistants retain their files and state. Stale locally edited and legacy-unknown targets obey the same
  conflict policy as updates. Untracked files and generated backups are not discovered for cleanup.
- Different existing backups, target/backup/metadata collisions, file ancestors, and separator/case/Unicode-NFC
  aliases block the complete plan on every OS. Move the conflicting file deliberately before retrying a dry-run.
  Conservative Unicode case folding also rejects native sigma/final-sigma and expanding case equivalents.
  This includes differently spelled intermediate directories with distinct filenames, before fresh-root preview
  or apply. Identically spelled shared parent directories remain valid.
  This comparison never rewrites actual destination spelling or persisted state keys.
- Windows device names, alternate data streams, and trailing dots/spaces are rejected on Windows only.
  Legal POSIX filenames remain usable; portable case/Unicode collision checks still apply on every OS.
- Config stays version `"1"`. State upgrades to version 2 only in a committed transaction. Loading old state does
  not write it: legacy hashes remain `legacy-unknown` until installation or byte-identical desired content verifies
  them. `local-wins` never invents an installed baseline.
- Do not downgrade a v2 state file to the old CLI. Preserve local edits first, then restore one pre-upgrade
  target/config/state snapshot or deliberately rebuild state. A hash is not a backup.
- State/config timestamps advance together on successful apply, including no-op. Preview and pre-apply errors
  preserve them. When compensation is incomplete, metadata named in the emergency is **untrusted**.
- Legacy Windows backslash keys normalize to slash-separated state keys in memory before planning/status.
  Competing canonical keys fail rather than overwrite one another; case/NFC aliases still fail the full graph.
- On macOS and Linux a tracked key containing both `/` and `\` is ambiguous: it can name a literal-backslash file
  or a different nested file. Every command that reads state (sync, preview, status, health, source, config,
  uninstall) refuses it before any change. Keep both files, then rename the entry to its `/` form only if Forge
  installed the nested file; otherwise remove it. Backslash-only keys from older Windows state still normalize.
- Raw own `__proto__` file keys are unsupported and reject the whole legacy/v2 state before record parsing.
  They must not disappear silently, whether malformed or carrying unknown ownership. Rejection preserves
  protected bytes during apply/preview; ordinary `constructor` and `prototype` keys remain supported.
- Newly generated backups are private, including under umask022. Reusing an existing identical backup does not
  change its permissions. Status resolves upstream content for configured disabled assistants as well as enabled
  ones; disabling an assistant does not imply that its source disappeared.
- Silent mode suppresses normal presentation, not failure exits. Incomplete compensation always emits minimal
  recovery-required stderr, even if reports also fail. Preserve backups/recovery temporaries, restore targets,
  config and state from one known-good snapshot, then dry-run. Do not retry writes with untrusted metadata.

### Limits and current native blockers

**Serialize sync invocations.** This is handled-error compensation, not a crash journal, locking protocol or
power-loss atomicity guarantee. Confinement rejects pre-existing escapes, not hostile concurrent directory swaps.
Existing POSIX permission bits are preserved; new metadata is private. Ownership, timestamps, extended attributes
and alternate data streams are not preserved guarantees.

POSIX sessions use a separate durable process-group owner. IPC disconnect cleans its group even when the outer
validation deadline SIGKILLs the test runner before its `finally` can run. Native Windows retains Job Object ownership.

Windows replacement uses access-preserving `ReplaceFileW` or refuses. Deletion snapshots the DACL and inheritance
control for restoration. Transaction temporaries atomically receive an owner/SYSTEM-only protected DACL before
the first byte, including recovery writes that fail before metadata application. New Windows transaction outputs
retain that private default; existing outputs restore their snapshotted DACL. Harness processes use kill-on-close
Job Objects, a gated trusted bootstrap and suspended target creation, independent of the leader PID.
These paths still require **native Windows verification**, including restricted-access and leader-exits-first
fixtures. Local macOS passes or safe refusal do not establish Windows acceptance.

## Validation and evidence

Use exact Bun `.bun-version` and `bun install --frozen-lockfile`. Full tests remain `bun run test`, always through
the disposable launcher. Focused: `bun run scripts/run-tests.ts -- <paths...>`. Never run raw `bun test`.
The launcher and validation executor disable Bun dotenv autoload before imports. Their isolated environment also
disables it for nested Bun package scripts; operator `BUN_OPTIONS` are not inherited. Explicit fixture preloads retain
this protection. Every shared sandbox environment stops Git discovery before its canonical parent, including commands
starting at the sandbox root and symlink/junction bases inside a checkout. Explicit fixture `git -C` access remains valid.
Default session deadline is 10 seconds with a 20-second test budget; 30-second sessions need
`--timeout-ms 40000` before `--`. PTY text is a transcript, not a reconstructed screen.
Full/checker/platform entrypoints allow40 seconds for the30-second native compiler probe, without extending
ordinary session deadlines. Windows compiles once per sandbox tree before test imports; nested launchers and
validators reuse the nearest enclosing sandbox's build. Fixtures receive separate file copies when `sandbox.env` or
`testEnvironment()` is requested. Command-free fixtures do not write the large
executable. Every command environment prepares its own backend before use, so disposing or altering one backend
cannot affect another. Native Windows completion within the unchanged lane budget must still be verified.

Raw stream channels remain separate. Diagnostics recognize both unchanged raw bytes and streamed terminal-visible
text, projecting sensitive visible spans back across formatting; assertion cursors use a separate unredacted
bounded transcript. This is not a terminal screen emulator. Sandbox setup errors produce blocked check records.
Decoded exact SAS `sig` is private, including encoded/case spellings; ordinary names such as `design` and `signal`
are not short-substring matches. Incomplete names remain undecided until their boundary is known.
Production diagnostics also mask Basic/Bearer values and credential assignments by default, including
quoted/escaped values, quoted JSON keys, and complete YAML plain, literal and folded scalars, including
multiword and indented continuation lines and doubled single quotes. Generic inline `key=value` diagnostics
retain their token boundary; indented values after a newline are private through their complete scalar body.
Streaming continuation retains bounded phase/indent counters and quote syntax, never discarded scalar words.
Quoted-key continuation retains scalar mode independently, including indentless private sequences.
Basic/Bearer recognition does not narrow an established complete scalar boundary. Whitespace completes exact
short aliases before a delayed delimiter; unfinished names such as `sig` remain eligible to become public `signal`.
Repeated whitespace eviction keeps one complete current-line indentation origin per pending key syntax,
not every suffix column. Independent watchdogs still verify flood completion and later private/public boundaries.
An empty assignment does not hide the next unindented public diagnostic. Dedented public lines remain visible
after nested scalar bodies, including after raw-tail eviction. URL userinfo
stops at authority boundaries, never query/fragment email data. Query delimiters remain separate; streaming continuation retains syntax, never discarded
credential bytes. Renderers and emergency recovery diagnostics sanitize each field before terminal
escaping/trusted formatting and print it once, preserving trusted recovery instructions.
Owned-session public exit/drain waits also observe disposal completion: persistent cleanup denial must reject
within the existing cleanup budget even if exit notification never arrives, not wait for the outer test timeout.
Pipe/PTY failures retain original and cleanup errors with bounded sanitized transcript/invocation/replay context.
Cleanup failures block successful commands but preserve a nonzero exit observed before cleanup or deadline.
The isolated test launcher likewise retains observed test failure exit1 if sandbox cleanup later fails; a passing
batch with incomplete cleanup remains blocked2.

The ten required modules are quality, business, e2e, human-dx, agent-cli, security, performance, native-macos,
native-windows and build. `scripts/validation-lanes.ts` defines their commands, scopes, deadlines and AC/BR mappings.
The macOS lane uses the standard native `macos-15-intel` image. GitHub canceled the earlier ARM `macos-latest`
job without assigning a runner after15 minutes of capacity retries. This image change retains the same checks,
deadlines and fail-closed gate; it is not cross-compilation or an ARM execution claim.
Suite membership lives in `scripts/registry/suites.ts`, not package-script argument lists. Unit files stay co-located
with their layers; security and platform suites intentionally overlap them. `test:platform` means additional native
OS checks, not all Linux validation: portable suites plus the independent Linux build already cover Linux.
Contract guards reject missing curated paths, files with no declared lane AC label and unmapped declared AC labels.
Labels only prevent attribution drift; executable assertions and independent review remain necessary.
`bun run check:lanes -- --out results` runs at most two independent commands concurrently and collects all results.
Foreign native modules are blocked, not emulated. Local evidence cannot substitute for PR merge validation.
Exits: 1 for proven failure, 2 for otherwise incomplete evidence, 0 only for complete required successes.
Assembly validates each partial context and check schema, identity, command and sole expected raw-log path.
Missing/malformed sidecars become blocked checks without dropping siblings or replacing an existing raw log;
an independently failed sibling still makes the assembled lane exit1. Only an absent raw log receives a
bounded blocked placeholder. Confinement and non-collision write errors still fail rather than being suppressed.

CI checks out the event's exact tested SHA. The workflow matrix lists each lane's registered package scripts, and
each runs as its own `always()` step, so checks continue after sibling failures and their output is in the job log.
Matrix fail-fast is disabled. The always-run `Deterministic gate` passes only when `needs.lanes.result` is
`success`; a failed, cancelled, skipped or timed-out lane fails it. Because it reads the run's own job results,
"Re-run failed jobs" turns it green once the re-run lanes pass, with no artifact or provider API lookup.
The interactive driver shares the child's absolute session deadline, including unrelated waits after child disposal.
Nested raw check-log and partial-result writes validate every existing ancestor against the original
selected evidence root before creating directories or temporary files. A pre-existing link beneath that root
cannot redirect a write. This is additional evidence security, not an extension of frozen sync BR-07.
Literal POSIX backslashes in generated target filenames are refused before the first apply; use real directories.
Unknown or ambiguous retained ownership warns even when keep_local is true.

Security runs offline attack scenarios plus `bun audit --json --audit-level=high` with a 60-second deadline, the
only public-network fixture exception. High/critical runtime **or dev** findings fail. Invalid/unavailable/
unaudited responses block; no ignores or dependency changes are made by the audit.
Audit JSON uses a separate private stdout capture, capped at2MiB and decoded as strict UTF-8 before schema
validation. It is never parsed from redacted/truncated diagnostics: public package names such as `keyv` and
`path-key` are data, not credential assignments. Only validated field-sanitized findings are published; private
structured input is not added to command artifacts. Invalid, incomplete and oversized responses remain blocked.
Known high/critical findings still take precedence over lifecycle warnings or an unavailable exit code.
Private sandbox roots are replaced before their enclosing repository root, including repository-local roots,
native/canonical aliases and cleanup errors after disposal.
Performance checks offline 10/1000-target cold-help/cold-sync/warm-sync outcomes with 30-second invocation limits.
Timings identify OS/Bun/fixture and are advisory: there is no invented baseline, p95 or latency threshold.

Target automated feedback is normally 5–10 minutes, execution ceiling 15 minutes: lanes at most 10, gate at most 5.
Queue and independent-review times must be reported separately. Ten consecutive no-retry focused passes and native
CI links are required evidence, not something inferred from one local run.

## Merge readiness and owner boundaries

A PR is ready for the owner when all ten lanes and the always-run `Deterministic gate` pass on its exact tested
merge revision, and the hosted `review` check passes with no unresolved blocking findings. The code owner's approval
is the final decision. The repository has no readiness, producer or attestation collector: the PR body and CI are
the record, and prose saying “ready” is not evidence.

Injected emergency-handler subprocess tests live beside the application sync tests and remain in contracts,
security and platform selections. They do not claim to invoke the real CLI entrypoint.

Human renderer fields are credential-redacted before escaping terminal control characters, including OSC/CSI,
C0/C1, bidi controls and line separators. Trusted renderer styling and structural newlines are added afterward.
Escaping presentation does not rewrite stored paths or user files. Tests inspect actual raw pipe output in
ordinary sync and preview, not a transcript sanitizer that could hide an emitted clipboard/title control.
The same boundary protects unconditional emergency stderr, including silent mode and simultaneous report-storage
failure. Recovery guidance remains mandatory; terminal escaping happens only after credential redaction.

The owner must configure required `Deterministic gate` and independent reviews in branch rules after inspecting
the actual check names. Agents do not change repository settings, merge, release or grant deviations. Report
read-only branch-rule evidence or the access blocker in the implementation PR. A draft/non-draft toggle is not
readiness. Do not repeatedly toggle the state to force a review cycle without an owner request.

Future CLI and MCP interfaces need **separate approved contracts** over shared application use cases and safety
invariants. CLI stdout/exits and MCP schemas/errors remain transport-specific. This work adds no MCP lane, protocol,
compiler semantics, wizard redesign or release schedule. Screen-aware pilots, concurrency/crash recovery, extended
performance and packaging parity are separate follow-ups.
