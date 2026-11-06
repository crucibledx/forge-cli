# PR6 owner-review follow-up

Source: [owner's Nov6 review](https://github.com/crucibledx/forge-cli/pull/6#issuecomment-6688181608).
The Nov5 ready result is historical, not approval of these changes. PR6 returned to draft when the evidence bypasses
were confirmed. The frozen spec and approved readiness contract are unchanged.

## Latest hosted review and CI failure on 41f6cee

All checks completed before this inventory. CI `42292191041` failed at20:59:02Z: nine lanes passed,
but security and the deterministic gate failed. Hosted review `42292192425` completed successfully
at21:01:44Z, posting five findings (review5806925604). Inventory: **86 threads, 5 open**.

| Finding | Correction and regression |
| --- | --- |
|4497545246 | Keep the consumed PTY cursor monotonic when an explicit historical mark replays old text. The actual batch child exits after replay; a subsequent default wait must reject the consumed second prompt. |
|4497545279 | Authenticate completed CHANGES_REQUESTED reviews while retaining exact app/revision/hash/role binding. Approved/commented/negative structured reviews parse; pending/dismissed reviews remain rejected. An authenticated open blocker produces known failure1 rather than unavailable2. |
|4497545287 | Move the unchanged three-case direct transaction permission matrix to infrastructure. Unit discovery now includes it; preserve security/native/contract selections explicitly. Keep the real CLI preview/apply refusal and byte-preservation regression in the original E2E file. |
|4497545297 | Reuse dependency-free repositoryRoot in the launcher, compiled smoke and generated-file cleanup. Preserve checkout-relative discovery and exact generated-file cleanup scope. |
|4497545307 | Remove invariant root parameters from runLanes and its private runCheck path. They always use repositoryRoot; output directory and executor still vary independently. Actual compiler fixtures retain their explicit disposable child cwd. |
| CI security failure | The original selected-run command artifact records209 pass/2 fail: two complete encoded matrices each exceeded their unchanged20s security runner budget (22.204s/22.674s). Split the same six-key/two-spelling/two-view/all-cut matrix into24 independent cases; keep actual both-stream checks separate. No case, cut, assertion, session deadline or runner budget is removed or relaxed. The default-budget security suite now passes235/0 locally. |

Original cursor/provider negatives reproduced **38 pass/3 fail**. Corrected focused checks pass
**54/0 in two isolated batches**. Review-r's preceding14-file static inspection found no substantiated
blocking/should-fix/nit findings and executed no tests; its scope does not override the new counterexamples.
Parent-preserved return SHA-256 `3fcc36e111e80f2aa527df37296b54419a725515a17d835c96e596472b244a48`.
Independent verifier-r's executed results remain separate; no previous report, resolved thread or ready UI
can override the selected run's failed security/gate outcomes.

## Hosted and independent review on a8f1853

Review-q completed static inspection `2026-11-06T20:34:21Z` on merge `d0212d1`.
It found a P1 concurrent URI-scheme continuation leak and a P2 gap in every-cut assertions.
The parent reproduced the leak with **31 pass/2 fail**, without modifying the reviewer/verifier worktrees.

| Finding | Correction and regression |
| --- | --- |
| Independent P1 | Retain the conservative partial URI-scheme view independently of every other context. `Bearer custom123` followed by retained `456://user:...` must not lose URI recognition merely because a Bearer recognizer is active. Pure span rendering and every raw cut through finalization/later appends pass, including both streams of real pipes and validation diagnostics. |
| Independent P2 | Check the actual surviving credential fragment at each cut, not just the complete original sentinel. Preserve visible padding and subsequent appended text, and assert the diagnostic byte cap, so empty or indiscriminately hidden output cannot pass. |
|4497352058 | Recognize literal/mixed/percent-encoded ASCII query names, including encoded uppercase letters, without decoding or rewriting diagnostic offsets. Carry validated finite partial names across cuts inside percent escapes. All six sensitive names, surrounding visible parameters, nested redaction data and both process streams are covered. |
|4497352065 | Define blocked exits per registered command, not universally. TypeScript exit2 is failure; launcher/audit incompleteness remains blocked. Shared classification drives lane assembly, evidence assessment and authenticated readiness. A real pinned-compiler TS2322 fixture retains exit2 and aggregate failure1; that known failure also dominates an unavailable sibling log. |
|4497352072 | Export/reuse PLATFORMS in the evidence schema. Existing three values remain accepted; an unknown OS is rejected. This is shared-authority maintenance, not a newly reproduced runtime safety defect. |
|4497352077 | Export/reuse SAFETY_LAYERS in contract validation. Preserve valid layers and reject an invalid runtime layer. This is shared-authority maintenance, not a newly reproduced runtime safety defect. |

CI `42288538734` completed successfully at20:34:01Z. Hosted review `42288540194` completed at20:39:14Z,
posting the four comments above (review5806676081). The parent inventoried **81 threads, 4 open**
after every current check completed. No draft toggle or earlier green workflow substituted for that inventory.

Hosted functional negatives reproduced **92 pass/8 fail**. Expanded positive diagnostics controls also caught
completed credentials incorrectly hiding the next ordinary line. Context now distinguishes awaiting a value
from continuing one, and requires an absolute-end match rather than accepting JavaScript `$` before a final newline.
This preserves visible text while keeping arbitrary and overlapping credential continuations private.
Final combined pure/transcript/real-pipe/actual-compiler/checker controls pass **166/0**.

Review-q executed no tests and supplied no hosted approval; parent-preserved return SHA-256
`0f14604b351613f015ca8857f8951bc504c81a2e46d433810c669e12242dfe15`.
Verifier-q completed `2026-11-06T20:42:13.988940Z` with32 phase1 passes in its executed scope,
own1309/0 full suite and ten483/0 contract runs. It authenticated eleven new original ZIPs/21 per-check logs,
with actual native224/0 per OS, compiled smoke on all three OSes, and CI feedback379s/queue2s.
Its thousands of previous composition/assignment/embedded-userinfo observations passed, but did not cover the
new URI-scheme, encoded-name or compiler-exit counterexamples. Those confirmed defects override an unqualified
current-head acceptance claim (AC-15/25/30/32); the original report is preserved, not rewritten.
Report SHA-256 `fc531e1bee5e82114d164602f12882bcbb5b1cdfc7e9ad774b89f61137652d2f`.
Actual phase2 remained blocked without genuine hosted producer attestations. Prior verdicts do not transfer.

## Hosted and independent review on b904e16

All checks on `b904e16` completed: CI `42285520399` and hosted review `42285521142` succeeded.
The completed reviewer posted four findings. Separate static review-p found a P1 composition leak;
verifier-p independently failed AC-15/30 with real-pipe counterexamples, despite green repository tests.

| Finding | Correction and regression |
| --- | --- |
| Independent P1 / verifier VP-1 | Recognize credential and explicit-secret spans against unchanged text and mask their union. Do not insert replacement markers before another recognizer runs. Pure nested/overlapping-secret and order controls plus every raw-cut boundary cover marker/value overlap, finish/later appends and complete Bearer/URI/assignment credentials. |
| Verifier VP-2 | Preserve the longest partial syntax marker, including a complete Bearer marker awaiting whitespace. A short matching suffix of another marker cannot replace it. Every-boundary assignment/Bearer controls exercise the previously missed cuts. |
|4497140734 | Carry concurrent finite syntax-only URI/query/Bearer/assignment contexts. An embedded assignment cannot discard live userinfo recognition. Apply every context to unchanged raw bytes before merging spans. Both transcript finalization and actual pipe/validation-artifact probes hide the suffix after an embedded ampersand. |
|4497140741 | Detect an absent tracked disk file before the unknown-baseline branch when upstream remains present. Pure explicit/omitted legacy-baseline checks agree with local-only drift; an actual status CLI check covers legacy state and an available upstream. Present legacy bytes remain unknown. |
|4497140748 | Give the enclosing three-invocation benchmark 120 seconds for three unchanged 30-second child deadlines plus setup/verification/cleanup. Latency remains advisory; no child/session deadline is increased. |
|4497140762 | Reuse CLI_ENTRY in helpers/performance and remaining E2E callers. Keep their execution/stream semantics unchanged. The touched benchmark phase type also follows the documented const-derived convention. |

Parent original P1 controls reproduced **26 pass/3 fail**, then expanded cut controls exposed two additional
marker-boundary failures before correction. Legacy deletion controls reproduced **15 pass/2 fail**.
After correction, combined focused controls pass **82/0** before the additional pure span-union checks.

Verifier-p completed `2026-11-06T20:18:00.021008Z` on `b904e16` with **30 phase1 pass, AC-15/30 fail**.
Its own full suite was 1294/0; ten 477/0 contract runs and authenticated native 224/0 per OS do not refute
its independent failing privacy probes. It retained 1170 composition observations (104 leaks), 1362 nested-secret
observations (44 leaks), and 240 assignment observations (16 leaks), plus real pipes leaking both channels.
Report SHA-256: `5d33986564d71002f4fdb709099f0bae17b4a61911e165b1697e0096324bfa7f`.
These failures remain historical evidence for that exact revision, not a current-patch verdict.
Actual phase2 remained blocked without genuine structured hosted producer attestations.

## Hosted review on 27b558d

All current CI checks, including the hosted reviewer, completed before this new inventory: CI `42282508408`
and review `42282509717` succeeded, but the review posted six additional findings. The loop continues.

| Comment | Correction and regression |
| --- | --- |
|4496932073 | Keep credential syntax and the longest explicit-secret suffix as independent bounded recognizer state. Mask explicit continuations before applying credential context, and scrub whole explicit secrets before general redaction can split them. Query/userinfo/Bearer/assignment overlap, both secret orders, arbitrary continuation bytes, finalization/later chunks and actual-pipe controls preserve secrecy. |
|4496932091 | Parse valid advisory JSON before treating stderr warnings as incompleteness. Known high/critical advisories remain fail/exit1 and retain the warning; warnings without known blocking advisories still block/exit2. Four severity/exit combinations assert failure precedence and retained diagnostics. |
|4496932101 | Replace pipe/spawn file-level mocks with injected process-boundary functions on the existing compatibility runners. Both zero-exit/deadline and retained-PTY-transcript controls still execute, without cached-module mutation. |
|4496932106 | Co-locate injected assistant/scope, stale ownership, state, silent and related planning matrices beside the sync handler. Shared fixtures live in test-helpers. Preserve real CLI state/silent/planning cases and the original frozen-command paths; add actual CLI ownership/scope counterparts rather than hiding injection behind E2E wrappers. Update ledger and security/native/contract suite membership. No acceptance text changes. |
|4496932117 | Derive SafetyLayer and ValidationPlatform from registry-local const objects, preserving all existing values and lane semantics. |
|4496932123 | Remove test-only policy re-exports; checker tests import policy helpers directly and retain runLanes from its implementation. |

Original regression controls reproduced **28 pass/9 fail**. After correction, the combined placement/behavior
checks pass **137/0**, with additional real-pipe controls included in final validation.
Verifier-o's original assessment on `27b558d` was 32 phase1 support passes, with its own 1242/0 full suite,
ten 425/0 contract runs and authenticated native 204/0 per OS. Those results did not cover the newly reproduced
overlapping-context and audit-warning counterexamples, so they do not override these findings or approve this patch.
Its report hash is `6cd9df0452065503eff57c99fdfa712743a0e29a7dfb159491fac20e14337be7`.
Actual phase2 remained blocked by missing genuine structured hosted producer attestations.

## Hosted review on 90bedd5

All checks on `90bedd5` completed, including hosted review `42278123829`. It posted seven additional findings.
The authorized loop continued rather than treating a successful reviewer check as a no-findings verdict.

| Comment | Correction and regression |
| --- | --- |
|4496676173 | Assertion text is streamed through a bounded ANSI recognizer before independent plain-text truncation. Cursor offsets count only discarded visible text, never separately stripped escape fragments. CSI/OSC tail cuts, every control-chunk boundary, long unfinished OSC and an actual PTY late wait cover consumed-prompt rejection and genuine subsequent prompts. Raw diagnostics/redaction remain separately bounded. |
|4496676181 | Deviation failures require validated current context/revision. Unavailable approval authentication adds a blocker only; current pending/rejected declarations remain failures. Ten controls cover stale/context/unavailable/current cases and a genuine failed sibling retaining precedence. |
|4496676191 | Remove orphan apply/rollback executors, AppliedMutation/FsService declarations, barrels and mocks. Preserve lexical safeResolve and its four pure checks; protected writes/compensation still use the transaction engine and its unchanged injection matrix. Tests exclusively for the removed executors are removed with those APIs, not counted as protected-transaction coverage. |
|4496676196 | Use relative imports for assistants/scope inside the domain property module; independent oracle hashing remains deliberately separate. |
|4496676202 | Define const-derived readiness ReasonKind once and share it between reasons and the callback. |
|4496676208 | Reuse the existing string/byte hashContent authority for producer Markdown, provider ZIP bytes and audit lock hashing. Independent expected-hash test oracles remain independent. |
|4496676215 | Remove redundant public sandbox home/temp fields. Assertions use env.HOME/env.TMPDIR, the same authority consumed by launchers; creation still uses distinct local directories. |

Before correction, the new controls reproduced 64 pass/9 fail. Independent verifier-n also reproduced both
behavioral findings on `90bedd5`: 30 phase-1 rows pass, AC-17/32 fail, including the actual PTY and actual readiness CLI.
Its report hash is `f80d05df9effd17bfe7b806582933995ef9b0e4882dfdee4e75e26ca0b17a275`.
That old revision's 1244/0 full suite and ten 405/0 contract runs do not override its original failed probes.

## Hosted review on 660d815

The owner explicitly authorized continuing after each push until all current-revision checks, including the
hosted reviewer, finish without unresolved actionable comments. The previous review completed with eight more
findings. All eight were confirmed; source/dependency/acceptance boundaries remain unchanged.

| Comment | Correction and regression |
| --- | --- |
|4496436540 | Query redaction treats an apostrophe as part of a credential, including unfinished raw-tail recognizer context. Six key/quoted-URL controls, truncated-tail/finalization controls and real-pipe diagnostics conceal the suffix. |
|4496436553 | Reject a generated target retaining a literal POSIX backslash before the initial apply, rather than installing one spelling and persisting another. Canonical/pre-structured resolver controls plus two consecutive real CLI refusals preserve protected bytes. Native Windows separators remain normalized by its path implementation. |
|4496436562 | Both output CLIs share reserved-source/evidence-directory guards, including case aliases. The collector rejects existing non-bundle data before provider access or source writes; a valid existing bundle reaches normal provider validation. Every required lane/sidecar remains byte-identical on destination refusal. |
|4496436569 | A direct, dependency-free gate fallback emits ten blocked rows and a nonpassing summary after installation failure. Its summary builder is shared with normal gate context failures. Clean frozen-history fixtures with no installed packages cover available/unavailable context; workflow guards reject removing the fallback. It does not authenticate downloaded evidence or claim any lane passed. |
|4496436587 | The driver and child share one absolute session deadline. The runner races unrelated driver promises against the remaining budget, cancels its timer and always disposes the child. Live-child and already-disposed-child controls settle before the outer watchdog, with no active processes left. |
|4496436597 | Classify/warn for retained stale ownership before checking keep_local. Unknown/disabled/ambiguous entries remain conservative even with the default retention policy; both keep_local controls warn without mutating retained data. |
|4496436612 | Move checkEvidencePath into a dependency-free authority consumed by ordinary writers/authenticators and installation-failure evidence. The no-packages fixture still executes successfully. |
|4496436620 | Remove the invariant audit root parameter and unused export. The entrypoint uses validation-identity's repositoryRoot for the lock and subprocess. Existing advisory assessment controls remain unchanged. |

Initial regression controls:69 passed/25 failed before corrections. The collector failures show its missing
early destination protection, not a claim that an invalid fixture reached a live authenticated overwrite.
The original log is retained; no blind retries or relaxed deadlines/acceptance changes.

The independent verifier-m report on660d815 also reproduced these runtime/evidence counterexamples:25 phase-1
rows passed and7 failed (AC-14,15,18,25,27,30,32), with a separate retain-and-warn BR-02 violation. Its two
1208/0 full-suite runs and ten379/0 contract runs did not refute those counterexamples. The original report
hash is `fefd0336a0780807313aa06401825fa9dd509d4c30b08ed17e9e2eb627edcf7e`.
That verdict belongs to the old revision; confirmation of the corrections requires a new exact-revision pass.

## Hosted review on 6101759

The owner's Nov6 follow-up identified four new inline comments. All four were confirmed.
Six pinned-tooling security controls first demonstrated acceptance of an unrelated workflow, mismatched/missing
workflow IDs, unavailable/incorrect workflow metadata and a mismatched workflow reference.

| Comment | Correction and regression |
| --- | --- |
|4496254749 | Select only the independently specified `ci.yml` workflow: resolve its provider ID/canonical path, match both against the selected run and require the exact PR-merge workflow reference. Fabricated sibling-workflow archives are rejected before archive acquisition. |
|4496254757 | Gate lookups settle independently; unavailable/malformed jobs or artifacts still produce an on-disk all-lane summary. Available provider IDs and known failed jobs survive sibling lookup failure. The actual entrypoint also persists ten blocked rows with null context when context verification fails; it never fabricates identity. |
|4496254761 | Removed the unconsumed test-suite re-export from validation-lanes. Both production readers continue importing the registry authority directly. |
|4496254778 | Removed the unconsumed portablePath re-export. The plan's local import and metadata exports remain intact. |

The gate still exits unsuccessfully on provider/context failure. The blocked summary makes failure evidence
uploadable; it is not a passing lane/gate or permission to merge. Frozen acceptance/dependencies remain unchanged.

## Follow-up hosted review 5804417415

The owner requested resolution of the 12 findings on f86d115. All 12 were confirmed and corrected with pinned tooling.
These are code/comment dispositions, not independently authenticated approval or permission to merge.

| Comment | Correction and regression |
| --- | --- |
|4495646365 | Git acquisitions sharing the exact cache key serialize through file enumeration; independent cache keys remain parallel. Real frozen-history cold/warm subdirectory loads both succeed, and a failed acquisition does not suppress its queued sibling. |
|4495646374 | Read-only POSIX preparation checks write/search access on the existing parent or nearest existing ancestor, for replacement, deletion and nested creation. Real CLI preview/apply both fail without protected mutations. Windows retains native read-only/access-preserving safeguards. |
|4495646383 | Removed orphan single-file reader wrappers/barrel export and obsolete mock. Confinement tests exercise the production cached-boundary reader directly. |
|4495646389 | Moved malformed/legacy parser assertions to infrastructure/config tests. Domain upgrade/reconciliation/drift tests use domain fixtures with no infrastructure import. |
|4495646395 | Schema/provider accept canonical `/pull/N#issuecomment-ID` and supported `/issues/N#issuecomment-ID`; review-fragment approvals remain supported. Existing owner/hash/revision/timestamp rejection controls remain. |
|4495646409 | Lane policy/context and every artifact authentication determine normalized results. Stale/expired/unverified verdicts become blocked and cannot establish known failures; authenticated failures and verified siblings remain visible. |
|4495646418 | Report destinations cannot identify sidecars/check logs or overwrite existing non-report data. Cleanup is allowed only after output safety validation. Valid/malformed input controls preserve all source bytes. |
|4495646424 | Frozen-install failures emit original blocked check/lane/context artifacts via a dependency-free Bun entrypoint, not the package runner. A clean frozen-history checkout with no installed packages executes it; workflow removal is rejected by contract guards. |
|4495646434 | Diagnostics sanitize before tail truncation and carry bounded credential recognizer context across discarded bytes. Raw inspection remains separate. Completed URI, split/continued credential, explicit secret and real pipe/validation regressions cover the boundary. |
|4495646439 | Compatibility timeout errors include the PTY combined transcript when stdout is empty; existing zero-exit deadline test plus PTY-only diagnostic control exercise the real completion path. |
|4495646472 | Removed fixed validationContext root parameter/call-site overrides. Dependency-free event/checkout identity is shared with setup-failure capture; schema validation remains in the normal wrapper. |
|4495646478 | Gate/readiness use one positive-ID provider-job schema; gate selection derives its smaller projection from the same authority. Non-positive/non-integral IDs fail. |

The initial typecheck caught optional provider identity fields and the first expanded redaction tests exposed query
context precedence and an unfinished URI test setup. Those were corrected before the green focused/full runs.
No acceptance/dependency/bundle/version changes or draft toggles were made.

### Independent review of adf46c1

The bounded independent review on tested merge `3b9b3ac18471d67b0e455543b31ad0493dfd5974`
completed at `2026-11-06T18:18:19Z`. It found two actionable regressions. Both were reproduced with four
failing controls before correction, retaining the original failure log:

- Preserve the query delimiter and partial credential name when tail truncation cuts through a query key.
  Domain/harness tests cover every name boundary for all six supported keys, case variants, all three
  delimiters, finalization and later chunks. Real pipe/validation results cover query and userinfo cuts.
- Authenticate check failures individually. A missing sibling log still blocks the lane but cannot suppress
  a different check's authenticated failure. Missing failure logs, stale lane identity and invalid context
  still produce blocked evidence, not a proven failure; verified lane siblings remain visible.

The reviewer ran format/lint/typecheck/contracts and read-only reproduction probes, not a passing test suite.
Its delegated focused-test/report writes were denied by the confirmation boundary. The returned report is
retained by the parent as supporting evidence, not authenticated approval of this follow-up revision.

### Hosted review 5804937450 on adf46c1

The hosted review completed with six further inline findings while the independent follow-up was running.
All six were confirmed and handled in this same bounded follow-up:

| Comment | Correction and regression |
| --- | --- |
|4496055068 | Query/assignment context inspects only the final matching marker, avoiding overlapping suffix rescans. The original pinned Bun 1.4.2 probe took 7,653.9 ms for 40,000 repeated query markers. A subprocess control exercises both marker types under the ordinary session deadline, without a new performance threshold. |
|4496055088 | Only authenticated current-context/revision, completed review/gate failures establish known failures. Stale, unavailable and unauthenticated failure claims remain blocked. Nine controls retain genuine failures and reject untrusted claims. |
|4496055098 | The wrapper and CLI use one flag/value-pair input selector, including repeated inputs, optional `--` and flag-like path values. The provider evidence root and parsed bundle cannot select different inputs. |
|4496055130 | Gate and readiness share positive-ID artifact metadata; readiness extends only digest/workflow fields. Shared schema and real provider controls reject zero/non-integral/negative artifact IDs. |
|4496055136 | Pipe and validation runners use one transcript drain helper, retaining concurrent reads, reader registration/finalization and lock release. Existing flood/UTF-8/lifecycle tests exercise both callers. |
|4496055146 | Injected source-resolution handler cases now live beside application sync tests. Their ledger path is updated; real subprocess cases stay in E2E. No frozen contract text changed. |

CI run `42268746524` passed all ten lanes and the deterministic gate on adf46c1/tested merge 3b9b3ac.
Both native suites passed 202 tests. The independent verifier completed at `2026-11-06T18:24:03Z`,
with 1,174/0 full tests and ten consecutive contract runs. Its 32 phase-1 support passes did not detect
the additional reviewer counterexamples and do not approve this changed revision or phase-2 readiness.
Original native/verifier artifacts remain retained separately; no old result is transferred forward.

## Earlier hosted review5804051755

All nine inline findings on7df422f were confirmed and corrected. The hosted reviewer used Bun1.2.11 without
dependencies, so its static findings were reproduced using the pinned1.4.2 launcher, not assumed tested.

| Comment | Disposition and regression |
| --- | --- |
|4495380351 | Fixed actual `#pullrequestreview-ID` owner approval parsing; real-route positive plus wrong owner/revision/hash/timestamp/fragment controls. |
|4495380393 | Authenticate completed failed/blocked/canceled lane artifacts without treating them as passes. Original lane/context/check bytes remain bound; failed job plus passing lane is rejected. Aggregate failure/sibling reporting remains covered. |
|4495380402 | Block AC results for unauthenticated/stale/unavailable/non-independent verifiers or invalid row evidence/exits. Context failure blocks all rows; a bad row does not erase verified siblings. Eight negative controls, valid32-pass fixture, and trusted/unverified failure classification. |
|4495380413 | Reject non-colocated collector outputs before provider access. Actual CLI tests cover relocated, colocated and source-overwrite cases. |
|4495380424 | Removed unused local-session parser and parser-only tests. Shared hosted payload schema lives in `producer-payload.ts`; schema-only tests do not claim authentication. Hosted producer forgery controls remain. |
|4495380431 | Frozen Git generation and lookup import one `e2e/fixtures/git-manifest.ts`; existing bundle bytes are unchanged. Real Git E2E cases exercise imports. |
|4495380442 | Both source/compiled version assertions read `package.json.version`; no version bump. |
|4495380459 | Ownership and collision checks use shared domain portable folding, including repeated separators. Unicode/case/slash aliases and actual ownership have regressions. State migration deliberately retains its distinct conservative key handling. |
|4495380467 | Removed production `buildSyncState`; remaining fixture convenience and all callers live in test helpers/tests. Production continues through `reconcileState`. |

The issue-comment's tenth, unconfirmed version-sensitive teardown candidate was not an inline finding. No
speculative lifecycle rewrite is made; pinned full-suite/contract checks remain the reproduction standard.
The owner's explicit instruction is to mark the corrected PR ready for review so independent automation starts.
This UI state does not substitute for authenticated readiness or authorize merge/release/global service changes.

## Critical corrections

- Lane validation requires each check's own selected-run log. The production provider binds the citing lane,
  original lane JSON/context, artifact digest/check bytes and completed provider job, without promoting failure evidence to pass.
- Writable local sessions cannot authenticate independent approval. Only the independently operated app's
  provider-hosted structured exact-revision review is supported. The verifier must be a different producer.
  The live PR head/base/merge must still match the selected revision.
- Release job existence, exactly one pinned setup and frozen install are checked unconditionally for quality,
  test, build and publish-npm. Removing the setup step no longer disables enforcement.
- Missing deviations are blocked, not synthesized as an empty approved list. Gate collection reads the actual
  selected-run provider job rather than requiring a manually constructed gate record.

The hosted-attestation adapter is fail-closed, not proof that the existing service supplies the output contract.
Missing genuine hosted reviews/verifier remain an explicit AC-32 blocker. No settings/global reviewer changes,
owner approval, contract amendment, merge or release are authorized by this follow-up.

## Inline review, all21 comments

| ID | Disposition | Correction / regression |
| --- | --- | --- |
| EC1 | Confirmed, corrected | State loading normalizes legacy Windows separators, rejects competing keys without merging case/NFC aliases.12 orchestration cases cover all local policies, equal/different bytes, apply/preview. |
| EC2 | Confirmed, corrected | Producer URIs cannot replace check artifacts, even with a permissive resolver. Each check has one own-lane/check path. |
| EC3 | Confirmed, corrected, hosted producer still required | Local transcripts lose approval authority. Provider review identity, revision, hash, role and timestamps are checked read-only. |
| EC4 | Confirmed, corrected | New backup operations are private. Real update/stale deletion tests use original0600 files and umask022; incomplete recovery checks retained backup privacy. |
| EC5 | Confirmed, corrected | Status resolves all configured assistant upstream content. Real CLI regression proves disabled content remains in sync and actual source removal remains visible. |
| EC6 | Confirmed, corrected | Missing deviations.json blocks collection. Pending/rejected entries cannot disappear through fallback. |
| EC7 | Confirmed, corrected | Collector obtains actual provider gate. Success/failure/missing/running job controls exercise collection. |
| EC8 | Confirmed, corrected | Durable POSIX owner survives runner SIGKILL, cleans group on IPC disconnect. Both pipe and PTY outer-deadline regressions require fixture descendants to be dead. Windows retains kill-on-close Job Objects. |
| EC9 | Confirmed, corrected | Windows scheduler compilation occurs after isolated environment construction, with explicit env/cwd. Native Windows regression observes the compiler invocation. |
| EC10 | Confirmed, corrected | Convenience runners reject timedOut even with exit0; raw result remains inspectable. |
| EC11 | Corrected | SYNC_BASELINES const object is the shared type/schema authority. |
| EC12 | Corrected | Property replay options moved to test helpers, outside production domain. |
| EC13 | Corrected | Config/state path constants share one domain/config authority. |
| EC14 | Corrected | Harness sanitization reuses domain credential redaction, then preserves additional fixture assignment/path/secret scrubbing. The comment states why both layers exist. |
| EC15 | Corrected | Unused TransactionError.original public field removed; constructor cause still builds its message. |
| EC16 | Corrected | Unused readiness root parameter removed. |
| EC17 | Corrected | contractInputs uses the repository root, without unused override. |
| EC18 | Corrected | Unused environment-source parameter removed. |
| EC19 | Corrected | Every registered lane is required; no redundant per-entry required:true or opt-out. Registry completeness remains guarded. |
| EC20 | Corrected | Unused provider approval updated_at field removed. |
| EC21 | Corrected | Production and tests share prepareSync/commitPrepared. executePlan removed; test-only convenience composes the real functions. |

## Owner review, points1–17

| Point | Disposition |
| --- | --- |
|1 | Critical writable-evidence and provenance bypasses confirmed and closed as above. Genuine hosted attestation remains a delivery blocker, never an inferred pass. |
|2 | Cross-lane and edited-lane substitutions rejected by both pure policy and production artifact-provider tests. |
|3 | Release-pin removal bypass rejected, including setup/job removal and unfrozen install. |
|4 | Failure fixtures renamed alpha/beta. All27 loader-failure cases require a nonempty named source cause and remediation. Orchestration checks distinct causes, successful/empty acquisitions and exact error count. |
|5 | Existing planning empty-input unit coverage was real but insufficient for the early-return mutation. Four new handler-level real-filesystem cases cover empty success, keep/delete and apply/preview. |
|6 | Shared ci:lane/ci:gate package entrypoints are used by workflow YAML. Guards validate actual command strings and alias implementations. Placeholder out-of-range steps are not an independent gate bypass. |
|7 | Security now selects missing planning/confinement/silent tests. Native selections include migration, portable graph, confinement and compiler isolation. Mechanical path/AC-label checks reject curated drift; labels do not prove assertion quality. |
|8 | Typed suite manifests replace growing package-script file lists. Domain/application/infrastructure tests stay co-located; e2e stays separate; cross-cutting selections overlap intentionally. |
|9 | Removed unused production executePlan. Tests and real preview/apply use the same prepare/commit path. |
|10 | Shared lane assessment/aggregate/exit/evidence policy extracted; reporting separated from sync orchestration. No broad transaction rewrite during the security correction. Further hotspot decomposition is deferred, not claimed complete. |
|11 | Shared config/state paths, config serializer, check-path builder, lane policy and redaction reused. Entrypoint-specific argv grammars stay strict rather than introducing a permissive generic parser. |
|12 | Canonical confinement is exported; lexical safeResolve is explicitly not the security boundary. File readers canonicalize once per pass while resolving each candidate safely. Transactions independently revalidate before mutation. |
|13 | Added load-bearing comments for preview preparation, both graph validations, target/backup/state/config commit order, sanitizer layering and durable group ownership/stdio ordering. |
|14 | Health runner docblock corrected; deadlines made meaningful; compatibility timeout/exit0 false success fixed. Dead conflict-resolution helper/types/tests and obsolete sync messages removed. README uses actual conflict strategies. Broader type/style conversion is deferred. |
|15 | Handled with8. No blanket file relocation or small-file churn. |
|16 | No redundant Linux-only lane added. test:platform means extra native checks; portable suites and the independent Linux build cover Linux. |
|17 | Suite manifests have a registry module; shared policy/path authority precede further layout changes. AC IDs are explicit. A wholesale scripts directory move and alias sweep are deferred to preserve required entrypoints and keep this correction reviewable. |

## Claims not adopted

- The alleged slash/space userinfo redaction issue was not reproduced as an actionable credential escape.
- The reported historical EPERM diagnostic masking was not reproduced. The new durable-owner implementation
  exposed a separate zombie-only EPERM race during full tests. Cleanup now verifies no live group members before
  tolerating that error; live denial and unverifiable group snapshots still fail.
- Out-of-range no-op workflow check slots do not bypass the real registry/provider gate.
- The earlier default catch-all did collect all122 test files. Curated lane attribution was the narrower problem.
- The bot's missing-dependency/Bun1.2.11 run and owner's registry-workaround lockfile were not exact frozen Bun1.4.2
  CI reproductions. That does not invalidate their confirmed defects or justify retaining fragile timing budgets.

## Validation boundary

The subsequent run `42249948977` verified the Windows fix:196/0, build/compiled checks successful, and all eight
Linux lanes passed. macOS was canceled with no runner assignment (`runner_id:0`, no steps):
“The job was not acquired by Runner of type hosted even after multiple attempts.” GitHub annotated ARM capacity
constraints; the gate correctly failed for missing required evidence. The macOS job now selects the standard
native `macos-15-intel` runner documented in [GitHub's hosted-runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
No tests or deadlines are removed, and runner-drift negative controls still reject non-native execution and
accidental return to the capacity-constrained label. Original canceled-job evidence remains retained.

The first corrected-head native CI run (`42246778781`) passed nine lanes but failed Windows:194 tests passed,
two hooks timed out while recompiling the same fake scheduler. Those failures and original artifacts are retained,
not retried into success. Compilation now occurs once per process, primed before test imports with isolated env/cwd
and a30-second bound; each fixture receives an independent byte copy. The native regression verifies one compile,
environment isolation, independence after mutation/disposal of the first fixture, and a real second fake job.
The30-second compiler probe uses a40-second runner budget. Actual subsequent native evidence is still required.

Current code must pass frozen install, format/lint/typecheck/contracts, full isolated tests, native build/compiled
smoke and actual selected-run native CI. The PR records exact revisions and links after those runs complete.
Historical CI, an earlier local test run, a synthetic fixture's ready verdict, and a draft toggle are not current
readiness. Local independent review/verifier reports remain supporting evidence until authenticated by a supported
independently operated provider.
