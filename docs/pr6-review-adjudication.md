# PR6 owner-review follow-up

Source: [owner's Nov6 review](https://github.com/crucibledx/forge-cli/pull/6#issuecomment-6688181608).
The Nov5 ready result is historical, not approval of these changes. PR6 returned to draft when the evidence bypasses
were confirmed. The frozen spec and approved readiness contract are unchanged.

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
