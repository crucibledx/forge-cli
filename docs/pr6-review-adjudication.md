# PR6 owner-review follow-up

Source: [owner's Nov6 review](https://github.com/crucibledx/forge-cli/pull/6#issuecomment-6688181608).
The Nov5 ready result is historical, not approval of these changes. PR6 returned to draft when the evidence bypasses
were confirmed. The frozen spec and approved readiness contract are unchanged.

## Critical corrections

- Lane validation requires each check's own selected-run log. The production provider binds the citing lane,
  original lane JSON/context, artifact digest/check bytes and successful provider job.
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
