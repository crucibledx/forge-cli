# Forge safety contract

This is implementation guidance for [approved spec 0001](../specs/0001-safety-and-test-hardening.md), not a change
to its frozen acceptance contract. `scripts/safety-ledger.ts` is the executable ledger: every BR has an owning layer,
an example, a counterexample, acceptance IDs and existing test paths. `bun run check:contracts` validates it.

## Rules and migration

| Rule | Safe example | Unsafe counterexample | Layer and evidence |
| --- | --- | --- | --- |
| BR-01 | Collect every source outcome, abort on any failure | Treat an unreadable source as empty and delete its files | Application; sync safety tests |
| BR-02 | Retain disabled/removed/unknown/ambiguous ownership | Guess a global owner using a project-only prefix | Domain/application; safety and native platform tests |
| BR-03 | Delete eligible tracked stale outputs only | Discover an untracked sibling or backup as a cleanup candidate | Application; planning and CLI snapshots |
| BR-04 | Persist installed bytes or explicitly unknown legacy baselines | Record desired-but-skipped bytes as installed | Domain; state upgrade, reconciliation and properties |
| BR-05 | Validate a preview without changing protected bytes or reports | Advance timestamps or write latest reports during preview | Application; outcome and CLI contracts |
| BR-06 | Restore targets and metadata or identify exact untrusted paths | Say rollback complete after restoration failed, or infer backup provenance from `.bak` | Infrastructure; every transaction write/chmod/rename position |
| BR-07 | Permit the selected symlink root, reject links beneath it | Follow a target/backup/metadata symlink outside the boundary | Infrastructure; confinement and external sentinels |
| BR-08 | Repeat preserves target/backup bytes; silent preserves outcomes | Hide an incomplete recovery emergency or reverse a committed exit after a report failure | Application; outcome tests |
| BR-09 | Drain bounded streams, own deadlines and descendants | Reuse old prompt bytes or leave an orphan after leader exit | Harness; pipe, PTY and lifecycle contracts |
| BR-10 | Disposable homes, isolated Git and fake schedulers | Use operator credentials, live sources or invented readiness | Harness; isolation, lane and checker tests |

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
ordinary session deadlines. Windows primes one isolated compilation before test imports; fixtures receive separate
byte copies when `sandbox.env` or `testEnvironment()` is requested. Command-free fixtures do not write the large
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
CI records its lane clock before checkout, shares remaining time across independent steps, and reserves90 seconds
inside the unchanged shared ten-minute lane budget for bounded cleanup, evidence assembly and upload. Missing, malformed,
future or exhausted clock evidence blocks command execution rather than granting a new full budget.

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

CI checks out the event's exact tested SHA. Independent checks continue after sibling failures. Matrix fail-fast
is disabled. Seven-day bounded sanitized artifacts include failures; the always-run `Deterministic gate` checks
selected run/attempt, provider jobs and evidence before passing. Missing, stale, skipped or cancelled evidence
fails the gate. An upload failure cannot turn a lane green.
Unavailable or malformed provider lookups still persist a blocked all-lane gate summary, retaining independently
available metadata and known failures. Invalid context is recorded as unavailable, never invented.
The interactive driver shares the child's absolute session deadline, including unrelated waits after child disposal.
Collector/report destinations cannot replace reserved source evidence or existing non-bundle/non-report data.
Nested report, raw check-log and partial-result writes validate every existing ancestor against the original
selected evidence root before creating directories or temporary files. A pre-existing link beneath that root
cannot redirect a write. This is additional evidence security, not an extension of frozen sync BR-07.
Readiness selects that boundary from the input bundle's directory, not the report's parent. Its default report
is `readiness.json` in that selected directory. Previous-report reads and stale cleanup use the same boundary;
cleanup revalidates after asynchronous provider work. A selected-root alias is supported, links beneath it are not.
Input/output equality uses the same portable case/NFC/expanding-case identity as other ownership comparisons.
Existing files also compare exact device/inode identities, covering hardlinks and native short-name aliases.
Both evidence CLIs reject source aliases before reading stale output or permitting cleanup, preserving the input bytes.
Literal POSIX backslashes in generated target filenames are refused before the first apply; use real directories.
Unknown or ambiguous retained ownership warns even when keep_local is true.

After a frozen-install failure, a dependency-free Bun entrypoint records the original context, blocked lane and
unexecuted check logs before the always-run upload. It does not require packages that failed to install.
The gate has its own dependency-free fallback: all ten rows remain blocked and its summary stays nonpassing.
Unavailable context is null, and downloaded lane records are not promoted to authenticated results.
Both fallbacks use the dependency-free shared evidence writer with the repository as their original root.
Every destination, including `results` and nested check directories, is checked before mkdir; exclusive creation
preserves existing context/lane/check/gate evidence. Native junction controls check unchanged outside directory
entries as well as sentinel bytes, without installing packages. These are additional evidence-security checks.

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

## Readiness and owner boundaries

Readiness is two-phase: independent exact-revision implementation checks and synthetic checker tests first;
completed producer attestations, selected-run artifacts and one final aggregation second. No previous readiness
report bootstraps its own success. The [approved supporting contract](quality-gate-readiness-contract.md) defines
strict sidecars and provenance. Missing adapters/attestations remain blocked; prose saying “ready” is not evidence.

Each check must cite its own `checks/<lane>/<check>.log`. The production provider validates its selected-run ZIP
digest, original context and lane JSON, check bytes, completed job and citing lane.
The selected run must also match the provider ID and canonical path of the independently required `ci.yml`
workflow, with the exact PR-merge workflow reference. A supplied bundle cannot nominate a different workflow.
Checkout/merge/live-PR and run/workflow identity are authenticated independently of job/artifact availability.
An unavailable artifact listing blocks the affected evidence, not an independently authenticated producer failure.
Authenticated failed/unavailable lane artifacts remain collectable for all-results diagnostics; a non-successful job cannot authenticate a passing
lane. Producer reports cannot replace
CI check logs, and one lane's log cannot stand in for another. Collection obtains the real selected gate job and
requires `deviations.json` explicitly; a missing file is not evidence that no deviations exist.
The output bundle must be colocated with its context/check evidence. Relocated `--out` paths are rejected before
provider access instead of emitting a bundle whose relative paths cannot resolve. Unauthenticated/stale/unavailable
verifiers produce blocked AC results; an invalid row's evidence or exit status blocks that row, not verified siblings.
Lane results likewise become blocked when policy/context/artifact authentication fails; invalid evidence cannot
establish a known failure. Report outputs cannot replace source sidecars/checks or existing non-report files, including
on the stale-report cleanup path. Canonical PR conversation-comment approval URLs are accepted and authenticated.

**Local session files are supporting reports, never independent approval.** The production adapter rejects
`factory-session://` producers, even with valid schemas and hashes. Its supported authenticated producer is a
provider-hosted `factory-droid[bot]` GitHub review on the selected PR and head. Its unique `forge-evidence-v1` block
must contain `raw_report_markdown`, `reviews` and `verifier`, following the strict producer schema. Every record binds
both head/tested SHAs, role, review ID, actor, exact review URI, raw-report SHA-256 and completion timestamp.
The independently operated app must finalize that block with its own review ID/URI after creating the review;
an implementer-posted copy or prose-only bot review is insufficient. Verification requires a different producer ID
from code/security review. Readiness also checks the live PR head/base/merge rather than accepting stale evidence.

Selecting a passing review ID cannot hide newer independent findings. The provider authenticates the complete
paginated review history for this head/tested revision, separately per code/security/verifier role. An older
role verdict is stale; unrelated heads, integrated revisions, actors and roles cannot supersede it. A blocking
finding persists until a later same-role app-authored review explicitly resolves its ID with that review's
authenticated URI, completed verdict and non-dismissed provider review. Unavailable findings cannot establish
failure authority, and unavailable/dismissed resolutions cannot clear a completed historical blocker.
Every historical finding's referenced evidence is authenticated before opening or clearing that blocker.
Missing resolution evidence retains the prior proved failure and an explicit blocked-evidence diagnostic.
Omitting the finding from a newer passing report is not resolution. New authenticated
blockers retain known-failure exit1, even when later history pages are unavailable; missing/invalid/duplicate/
oversized or incomplete history cannot establish readiness. Page and aggregate report-byte limits fail closed.
Raw report-byte authentication is separate from current-verdict selection.
Unknown/missing actor metadata and malformed older same-revision app reports are unavailable, not silently skipped.
An older empty `COMMENTED` shell may be ignored only after validating its actor, head, timestamp, canonical review
URI and complete review schema. It cannot be the selected ID or newer output. This exception does not cover
nonempty Markdown, malformed attestation blocks, approvals, change requests, dismissals or any authenticated
historical verdict. Supporting prose is never promoted to passing authority; uncertain history still blocks.
Human dismissal never clears an app-authored blocker; a dismissed passing review cannot authorize readiness.
Authenticated verifier failures survive history outages and obsolete selections only after each row's nonzero
exit, evidence, revision, completed producer and independence are validated. A later passing row clears a prior
failure only with its own valid evidence, not an incomplete or dismissed verdict. Invalid claims stay blocked2.
Producer payloads reject duplicate roles. Collection imports each current role independently, so newer code can
combine with still-current older security without importing the superseded code record.
Collection assembles authenticated records even when current history is unavailable or proves failures; it
does not grant passing authority. An obsolete record is retained as a routing fallback if no selected replacement
exists, rather than dropping its role and hiding newer historical blockers.
All bounded unique routing references stay in `producers.json`. The checker authenticates every selected candidate
before history lookup and retains their records through per-finding/per-row evidence, completion, revision, exit
and producer-independence validation. A representative bundle sidecar or URI sort is not adverse-verdict authority.
An incomplete/invalid claimed failure cannot suppress a different candidate's valid failing AC during an outage;
this includes an unavailable primary review, an edited sidecar, or a non-independent routing record.
Producer independence uses authenticated identities and the app report's own role participation, not merely
claimed local review IDs or missing local review sidecars.
The routing list admits at most100 unique producer URIs, so overlapping old/new role producers are retained
without granting any URI verdict authority. A changed authenticated same-ID report retains both versions'
adverse findings/rows, but neither version's pass/resolution can clear a failure. This contested identity applies
across overlapping role lookups; history is merged in provider submission order, not lookup order.
Each authenticated source carries the complete parsed provider object's version hash, so cross-lookup changes
to role participation or other records are contested even when one role's record remains byte-identical.
Verifier independence is bound to that authenticated version's own role participation; a later edit cannot
retroactively erase an earlier independently proved failure. Neither contested version grants passing authority.
failure1 takes precedence over blocked2. Provider report/artifact outages and invalid remote payloads are
reported as unavailable without discarding independently authenticated siblings. Collection emits a schema-valid
partial bundle and the checker reauthenticates it; collection success is never a readiness verdict.
Malformed local bundles, invalid routing lists, conflicting source sidecars and unsafe output paths still stop collection.
Untrusted collection and readiness error diagnostics are credential-redacted and visibly terminal-escaped.
Deviation approval requires an exact owner-authored structured decision. A review must be submitted and
non-dismissed; pending, missing, unknown or withdrawn states cannot approve it. Authenticated issue/PR comments
retain the separate explicit-decision route. A general PR review state alone never grants a deviation.
Tests preserve the actual
collector-then-checker boundary in both URI orders, without extending the strict bundle schema or bootstrapping readiness.
Injected emergency-handler subprocess tests live beside the application sync tests and remain in contracts,
security and platform selections. They do not claim to invoke the real CLI entrypoint.

Human renderer fields are credential-redacted before escaping terminal control characters, including OSC/CSI,
C0/C1, bidi controls and line separators. Trusted renderer styling and structural newlines are added afterward.
Escaping presentation does not rewrite stored paths or user files. Tests inspect actual raw pipe output in
ordinary sync and preview, not a transcript sanitizer that could hide an emitted clipboard/title control.
The same boundary protects unconditional emergency stderr, including silent mode and simultaneous report-storage
failure. Recovery guidance remains mandatory; terminal escaping happens only after credential redaction.

This adapter does not make the existing review service emit such an attestation. If the existing independently
operated review/verifier cannot provide it, readiness stays **blocked**. Normally keep the PR draft; an explicit owner
request may mark it ready for review to start independent automation, without granting readiness or merge approval.
Do not manufacture
a payload, post as the owner, reuse a local transcript as authentication, or change shared reviewer services/settings.
The Nov5 readiness result for PR6 used the weaker local trust path and is withdrawn as sufficient approval.

The owner must configure required `Deterministic gate` and independent reviews in branch rules after inspecting
the actual check names. Agents do not change repository settings, merge, release or grant deviations. Report
read-only branch-rule evidence or the access blocker in the implementation PR. A draft/non-draft toggle is not
readiness. Do not repeatedly toggle the state to force a review cycle without an owner request.

Future CLI and MCP interfaces need **separate approved contracts** over shared application use cases and safety
invariants. CLI stdout/exits and MCP schemas/errors remain transport-specific. This work adds no MCP lane, protocol,
compiler semantics, wizard redesign or release schedule. Screen-aware pilots, concurrency/crash recovery, extended
performance and packaging parity are separate follow-ups.
