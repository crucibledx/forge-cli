# PR6 owner-review follow-up

Source: [owner's Nov6 review](https://github.com/crucibledx/forge-cli/pull/6#issuecomment-6688181608).
The Nov5 ready result is historical, not approval of these changes. PR6 returned to draft when the evidence bypasses
were confirmed. The frozen spec and approved readiness contract are unchanged.

## Latest hosted review and independent verification on5de579b

All seven hosted runs completed before source edits: CI42316891062 succeeded00:19:46Z;
hosted reviewer42316892014 succeeded00:21:23Z with review5808804883 (four P2 findings);
five later triggers completed/skipped00:21:28Z. Fresh two-page inventory:109 threads,
101 resolved,8 open. PR remains ready only at the owner's instruction; genuine
app-authored exact-revision code/security/distinct-verifier attestations remain unavailable.

Independent static review-y completed on merge8094dea (head5de579b/treef567682, parents
verified): no actionable P0/P1/P2 findings across the complete22-file delta, frozen spec,
readiness contract and related callers. Static only: no execution, writes or remote calls.
Parent-archived report `results/pr6-review24/review-y-returned.md`, SHA-256
`302a837be640d6d1ee939d66878b5d0758ae15fe4490f1f429d8af12918df3a8`.
Independent verifier-y completed00:34:54Z: **31 pass/1 fail** (AC-27), findings Y-1/Y-2.
Its own full1554/0, ten fresh704-case contract invocations without retries, default
security, live audit0, and authenticated original CI evidence (11 ZIPs/21 check logs,
digests and checkout bindings verified, wall feedback383s against the600s target) do not
cancel the two counterexamples. Actual readiness collect0/checkblocked2 still lacks genuine
hosted producer attestations. Report SHA-256
`4a6bc15aabc8d28d386f916bcba3a6775f1041219d1c678ee461483fd1f04908`; manifest
`d38475aa5fcc81d813f0ba1d33d680a44d15a82978140d6d35280fb255c55dee`.

| Finding | Correction and regression |
| --- | --- |
|4499030237 | Full known-secret matches, live continuation checks and evicted-prefix state now use one KMP matcher; no overlapping prefix/continuation rescans. Independent brute-force oracle covers every overlapping-prefix/bit-string combination plus Unicode; repetitive600000-byte/1s and1200000-byte/7s session cases run under independent watchdogs with ordinary suffixes preserved. |
|4499030246 and verifier-y Y-1 | Retained check logs sanitize individual fields before JSON serialization, never redact serialized JSON. Actual `https://u:...`, token-only and query-token child output plus pre-redacted `https://[redacted]` stdout keep parseable logs with command/signal/cwd/seed/replay/exit/streams and all ten sibling reports. Verifier-y's unchanged retained-json control replays6/0 with the stack control. |
|4499030259 | Shared `MAX_EVIDENCE_BYTES` (2MiB) is enforced at the writer through escape-aware byte budgeting of each serialized string field: streamed stdout/stderr retain tails with a visible truncation marker; command/cwd/signal stay1KiB; seed/replay stay within an eighth each; the reason keeps its16KiB primary summary. A worst-case NUL-per-stream actual executor log and both ZIP methods authenticate through the unchanged reader/archive limits; reader limits were not raised. |
|4499030263 | `readinessCLI(args, provider)` and `readinessInputPath(args)` derive defaults and the Bun pin from the existing repositoryRoot authority; only tests redirect through absolute disposable paths and the provider port. Regressions prove default path independence from process cwd and a fixture-local .bun-version never substituting for the repository pin. |
| verifier-y Y-2 (public failure stack) | Failure metadata fields are bounded before serialization; `error.stack` keeps the already-private message envelope byte-identical and appends only sanitized frames within the total256KiB budget, never re-redacting the serialized Session JSON. Pipe and PTY message AND stack controls, escaped and credential arguments, keep valid parseable context. |

Unchanged-head reproductions are preserved: original seven controls1/6 (the600000-byte/7s
case passed in4.18s on pinned Bun1.4.2 and is not misreported as a negative), additional
watchdogs0/2, and a fresh exact-merge recapture1/6. Corrected focused395/0 covers all
prior and new controls including the independent matcher oracle, escape budgets, retained
envelope authentication and canonical readiness authority. No case, assertion, deadline or
budget was weakened.

## Hosted and independent review on53829d9

CI42312009504 succeeded23:33:09Z and hosted42312010423 finished23:35:30Z
(review5808471134). All later triggers completed/skipped23:35:38Z before source edits.
Post-completion inventory:105 threads,101 resolved,4 open. PR remains ready only at the
owner's instruction; genuine exact-revision app attestations remain unavailable.

Independent static review-x completed23:30:59.222Z on merge6019664 and the complete18-file
delta:two P1/two P2 findings. Verifier-x completed23:49:32.575819Z:27 pass/5 fail
(AC-15/25/27/30/32), four counterexamples. Parent counterexamples additionally block
unqualified AC-16/18 support. Their green baseline suites never cancel these findings.

| Finding | Candidate correction and committed regression |
| --- | --- |
| review-x P1 token-only unfinished userinfo;4498504370 broader follow-up | Treat unfinished authorities conservatively, including colon-free credentials; retain separate tentative spans and confirmed privacy. Exercise live prefixes, formatting, eviction and actual pipe/PTY/validation timeouts. |
| review-x P1 colon-heavy quadratic recognition/context | Replace the two overlapping-colon patterns with unambiguous scans. Independent child watchdogs cover262144 colons for each recognizer without relaxing the5s watchdog. |
| review-x P2 ordinary host:port/IPv6 split corruption | Resolve tentative authority privacy at path/query/fragment boundaries without removing confirmed spans. Every UTF8 byte split of three ordinary URLs must equal single-chunk raw/visible diagnostics. |
| review-x P2 and verifier-x X-3 missing timestamp siblings | Transport optional unknown temporal fields, then enforce strict finite ISO/ordered timestamps per selected row. Missing/object/null fields block only their selected lane; both actual consumers retain independent failed/successful siblings. |
|4498755028 | Share the bounded sanitized pipe/PTY failure envelope. Retain observed signal/exit, command/arguments, relative cwd and invocation-time supplied seed/replay; individually bound fields before JSON serialization. |
|4498755040 | Derive canonical incoming and output paths from repositoryRoot inside both gate entrypoints. Production accepts context/pin plus injected I/O/provider ports, not invariant path parameters. Test adapters assert canonical paths before redirecting I/O. |
| verifier-x X-1 production persisted privacy | Move the existing ANSI state machine into pure domain code and project visible credential spans back to unchanged raw input. Production redact/redactData now mask unfinished userinfo and ANSI-fragmented credentials. Real handler subprocess regressions inspect unfiltered stdout plus actual latest/history/JSONL and unchanged protected bytes. |
| verifier-x X-2 oversized setup/cleanup reason | Sanitize the complete reason before preserving a UTF8-bounded16000-byte primary summary, including Error/non-Error setup and cleanup. Normalize caught lane reasons before retained JSON/schema validation, preserving every sibling and independent known failure. |
| verifier-x X-4 direct public PTY wait error | Use the same private bounded envelope for local-wait, total-deadline and exited-child rejections. Cover credential/ANSI/long-known-secret requests, positive transcript/context and zero remaining owned processes; avoid embedding an already formatted failure twice. |

Parent original controls0/8 become8/0 with only the canonical gate I/O adapter changed.
Expanded focused332/1 had one newly authored fixture using nonexistent lane ID agent;
the correct registered agent-cli ID passes the entire lane file9/0. Earlier candidate
failures remain retained:193/4 and221/2 exposed genuine projection/context/empty-cwd
regressions that were fixed;241/1 was Bun treating an empty-array it.each value as a
done callback, corrected with wrapped values. Production correction-focused271/0 and
candidate copies of the verifier's persisted/adversarial controls pass. Original verifier
files are never edited or executed to overwrite their evidence.

Complete final quality/types/contracts/full1554/0 in18 isolated batches/build/compiled0.
Default20s security370/0 across22 files, expanded to production/domain, compatibility and
lane-overflow regressions; no timeout or case/assertion is relaxed. Audit0 retains the
moderate minimatch advisory explicitly, with no high/critical finding or dependency change.
Full log SHA-256 `12f3966ac3b5b4b3cdd1a4707ef5697bef2b82666c36a271d33f799140237885`;
security `c87a45c7fd6fa57a060e503c5b6d476b3a9f5e05f04f17d1d80420376605adfb`.
Full readiness replay must run on a clean pinned merge: copied verifier controls initially
retain the old merge identity (14/12); adapting only that identity still correctly refuses
the dirty author checkout (14/12). Neither run is a production timestamp counterexample
or a pass. Preserve both receipts and rerun the same cases on a clean candidate merge.

Verifier-x independently ran full1496/0 once, ten fresh650/0 contract batches without
retries, default security297/0, human60/0, live audit0 and authenticated11 new original
CI ZIPs/21 logs. Actual native237/0 on both OSes and three-OS compiled help/version
succeeded. Its original temporal fixture had three bad positive URI bindings; temporal-v2
corrects only that URI and retains the three genuine missing-timestamp negatives.
Deliberate property negative/replay failures remain expected negatives, not stability retries.
Actual collect0/checkblocked2 lacks genuine code/security/distinct-verifier app attestations.

Static review-x report SHA-256 `251fcd819bb211cc3fda430bd68a31f5fec3a6d232add1a5b163fb3104f89fdd`.
Verifier-x original report `e742cb4cf5a06779197d4a1f3ff268b2cde58588e3b296518eae4026e22472e3`;
text `efec64aa4d4c4857a3b0a7fec4db3361978c9666a4211af0a81f4389fff244ca`;
manifest `e3781a50f56270f4d1c6e701e709ac36127b6b9e858c282e38225b8b426bc13c`.
These are finite independent implementation reports, not hosted app approvals.
Next candidate needs fresh exact-merge review/all32 verification and every hosted check,
including the hosted reviewer's final comments, before any further correction or clearance.

## Hosted and independent review on 0c88fdc

CI42307687363 completed successfully22:58:43Z; hosted42307688599 completed22:59:32Z.
All checks finished before further source edits. Hosted review added two findings; static
review-w added a P2 and verifier-w found blocking W-1. These override prior bounded support.
PR stays ready at the owner's instruction, never as a substitute for authenticated readiness.

| Finding | Correction and regression |
| --- | --- |
|4498504370 | Conservatively mask unfinished colon-bearing URL userinfo in live diagnostics, including ANSI/OSC formatting, byte prefixes, suffixes after eviction and stopped output. All public pipe/PTY/validation/driver views use the same policy; private assertion text stays untouched. Ordinary completed URLs and surrounding output remain positive controls. |
|4498504387 | Snapshot supplied seed/replay and relative cwd at command start; retain observed child.signalCode with exit status before cleanup. Cleanup-only or late signals cannot become the original termination. Injected races, actual POSIX SIGTERM/SIGKILL and retained per-check runner JSON cover the metadata. |
| review-w P2 | Reserve independently sanitized leading primary/cleanup summaries before separately clipping detail tails. Remove redundant transcript embedding from the driver deadline. Cover oversized Error/non-Error/cleanup messages, noisy deadline, long known secrets and positive context within the existing byte cap. |
| verifier-w W-1 | Authenticate all three selected-window timestamps through strict ISO parsing, finite epoch values and ordered bounds in one shared gate/provider helper. Validate per selected row rather than discarding unrelated known job failures. Regress both gate entrypoints and actual artifact provider, missing/reversed/malformed/impossible dates, valid endpoints/offsets and sibling preservation. |

Parent originals: first three controls0/3; corrected3/0. Timestamp original6 failures across
both actual consumers are retained unchanged; correction-focused234/0. Two earlier expanded
runs retain their invalid fixture oracles: an evicted early marker and a second wait for an
already-consumed PTY marker, which tested the wait deadline rather than the driver deadline.
The corrected fixture preserves timeout and privacy assertions without relaxing limits.
Complete format/lint/types/contracts, full1496/0 in18 isolated batches, build and compiled smoke0;
unchanged default20s security297/0. Security now includes actual validation-process failures.
Full log SHA-256 `9ca39a447cde487616c0f7ae4fe9138dc467824f8bcca0f6b5f47cfc1c93ead4`;
security `c67711aae77d7ecbee4da631f5f4e8bd954594f092820024818a27487594bc14`;
focused `78108b6461a6afd87c2d9ab455d0190bf780258413578f0cd583e258f8637f49`.

Original Windows artifact13548220087 has provider/actual ZIP digest
`27664e722c6a7c9d0249c2571de3b5de0948e69b5f6b5a5305f948925af4ccc4`.
Embedded context matches0c88fdc/merge90b4c82/run42307687363/attempt1.
Native job128201077530 reports237/0, including first-byte privacy, partial recovery,
malformed DACL and access preservation/refusal. Finding4498296400 closed only after this proof
(follow-up4498660733). Current inventory must still paginate103 threads.

Verifier-w completed2026-11-06T23:08:21.502722Z:29 pass/3 fail, W-1 blocks AC-25/27/32.
It independently ran full1452/0 once, ten fresh606/0 contract runs without retries,
new11 original ZIPs/21 logs, native237/0 on both OSes, three compiled smokes,
default security264/0 and live audit0. New finite OSC8 corpus:35/0,21 semantic cases,
1597 UTF8 cuts,828 tail observations,12 lone characters and27 invisible-eviction stages.
Full authenticated fixture readiness incorrectly accepted malformed artifact/job timestamps;
the positive enum-oracle mistake and report-generation tooling failures remain disclosed,
not counted as production failures or hidden retries. Actual collect0/checkblocked2 still
lacks genuine exact-revision code/security/distinct-verifier attestations.
Report SHA-256 `4d3b09a7cb9e2483ed60abe3b3c58d479c48df2c4e485e179a9cda68cc2b0421`;
rows `0315667118f29bad0fd18a417736ddfcfb5d4277c3ac1f6fd636b6ec11ec9d40`;
manifest `cabe9e3491a8a57975ec7ec93d481dd189966c47fdcd87d313ef0d0a28f180aa`.
Parent live-privacy/summary/metadata counterexamples also override unqualified
AC-15/16/18/27/30 support. Static review-w examined the complete17-file delta and relevant
dependencies without execution or writes; its one P2 was reproduced and accepted.
The new candidate requires fresh exact-revision hosted and independent assessment.

## Hosted and independent review on 8d79a72

All checks completed before correction: CI42303981084 succeeded22:26:26Z and hosted
review42303981852 succeeded22:30:21Z, posting five findings in review5807891602.
Fresh paginated inventory covers101 threads on two pages:96 resolved,5 open.
PR remains ready at the owner's instruction; this UI state is not authenticated readiness.

| Finding | Correction and regression |
| --- | --- |
|4498296377 | Retain sanitized bounded original error name/message/stack, command, relative cwd, observed exit/signal, timeout/budget, supplied seed/replay and transcript after driver cleanup. Keep primary and cleanup failures together without exposing a raw cause object. Four real PTY controls cover normal/non-Error failures, cleanup failure and oversized Unicode output, positive message/stack context, secret removal and byte bounds. |
|4498296387 | Read only docs/safety-contract.md, the single documentation input the validator actually examines. |
|4498296400 | Inline the fixed owner/SYSTEM SDDL in production privateAccessMetadata; arbitrary descriptor construction belongs to the Windows test helper. Native descriptor/transaction tests remain intact; next-revision Windows CI remains required. |
|4498296409 | Validate all21 mandatory ordered command/id/blocked-exit contracts against independent frozen policy. Removing any required check or replacing/duplicating/reordering it cannot silently shorten the gate. |
|4498296416 | Share complete bounded pagination between gate/provider, filter the requested run/attempt and reject incomplete/changed/duplicate pages. Later retained-attempt uploads work without weakening selected-job windows, expiration, digests, duplicate-name or revision checks. |

Original unchanged-head controls reproduce0/4; the same controls after correction pass4/0.
First focused correction137/4 is preserved: three incorrect uppercase marker expectations and
one oversized-output control revealing unreliable lazy stack text. Explicit original name/message
plus stack fixes the latter; corrected focused141/0. Added positive stack/context checks pass11/0.
Complete format/lint/types/contracts, full1452/0 in18 isolated batches, build and compiled smoke0;
default20s security264/0. The later assertion strengthening changes no production code.
Full log SHA-256 `e77e7284eae0a04a351da2ab5a082d6115b6af20db08eb2cddbae70aa509c025`;
security `f841d5daf0432d8ccb856e92a347f0f8e40cad971932600ef5c4e7a350d5b8ed`.
No assertion/case, deadline, workflow, frozen acceptance, dependency, lock, pin or version is relaxed.

Verifier-v completed2026-11-06T22:37:35.880118Z on8d79a72/mergea79dfc9:
32 bounded support passes, own full1405/0 once and ten fresh559/0 contract runs without retries.
New original11 CI ZIPs/21 check logs, native237/0 per OS, compiled smoke on all three OSes,
default security253/0 and live audit0 were authenticated/executed.
New OSC8 controls cover21 semantic cases/1597 actual UTF8 byte cuts,828 tail stage/view
observations/12 surviving lone characters and27 invisible-eviction stages; existing135/0 and
46k privacy corpus, lifecycle/compiler/clock/root controls were freshly rerun.
The original26/9 external-oracle result and corrected10/0 remain distinct. Four disclosed tooling
issues concern C1/PTY/canonical-path oracles, wrong-property replay path, removed-cwd comparison
and shell-backtick corruption in report-source generation before execution; no successful test/CI retry.
The new functional negatives override unqualified AC-18/25/27 support; the raw report is unchanged.
Report SHA-256 `5f3e83130536e646336e525ec7b90bae204109ed0803691b62e96aadaa3c4d07`;
rows `6aaa6857a6252e8715529b8849354735679701a4d4adfb3dc6c48e7e3d1e9942`;
manifest `fe45c413fe3ae9ae9ecc84551d8259de36d45191be4c6955ccaf6d941d589b44`.
Actual authenticated collect0/checkblocked2 still lacks genuine exact-revision code/security/
distinct-verifier attestations. Static review-v found no further issue in its12-file scope,
but does not override the hosted findings. Current correction needs fresh exact-revision checks.
## Hosted and independent review on 8ca1e7c

All current checks finished before this inventory. CI `42301213738` succeeded at22:06:46Z;
hosted review `42301214684` completed at22:05:58Z, posting two maintenance findings
(review5807662766). Inventory: **96 threads, 2 open**. Separately, independent static review-u
reported a blocking OSC8 disclosure, reproduced by the parent on the unchanged head.

| Finding | Correction and regression |
| --- | --- |
| review-u P1 | Project unchanged raw-recognized ranges into visible diagnostics as well as visible-recognized ranges into raw diagnostics. Use one shared span union/renderer. Each view retains bounded, clipped privacy ranges until its own bytes are evicted, even if invisible formatting evicts the source view first. Private assertion text/cursors remain unredacted and independent. |
|4498116409 | Remove invariant actualHead checkout input; both production callers use the shared repositoryRoot internally. |
|4498116415 | Remove invariant executeCheck working-directory input; subprocess execution and repository-path scrubbing use shared repositoryRoot. Preserve varying commands, deadlines and injected lifecycle ports. Update all production/fixture callers; absolute fixture program/project paths retain actual compiler and outer-runner failure controls. |

The original OSC8 control reproduced **0 pass/1 fail**: public visible diagnostics disclosed the label
while raw diagnostics hid it. The initial correction's focused run passed81 cases but failed one new
test that incorrectly expected separate PTY stdout; PTYs intentionally expose only combined output.
That test now asserts empty separate fields and positive/private combined output. The original log remains.
Corrected combined controls pass174/0 before strengthening the same matrix to every UTF8 byte cut.
The unchanged-default20s security suite passes253/0, including those strengthened byte cuts.

Nine additional privacy cases cover OSC8 ST/BEL/C1 spellings, every streamed/raw-tail byte boundary,
surviving suffixes including the final character, finalization/later append, three invisible buffer evictions,
positive ordinary labels, actual separate pipes/validation streams and combined PTY output.
One additional real subprocess checks fixed execution cwd and HEAD identity after changing the child's cwd.
Final format/lint/types/contracts, full tests (**1405/0 in18 isolated batches**), build and compiled smoke
all exit0. Both separately captured compiled commands report correct output/exit0. Full log SHA-256
`e53ca820e5708d8cb61d301e46e0bc989c12ad5d15cbfa68d283c749d231cd9d`;
default20s security log `787389027125da351cd071c08103d54e0cdd2cf29009904e1fd7c181f4dbf6c7`.
No case/assertion was removed or weakened. Session/test/job deadlines, workflow, frozen acceptance,
dependencies, lock and pin are unchanged.

Static review-u completed2026-11-06T22:06:06Z with this P1 and no additional substantiated
should-fix/nit findings in its complete21-file scope plus dependencies. Read-only commands exit0;
no dynamic tests/probes or file writes. Its report did not claim parent execution as independent evidence.
Parent-preserved return SHA-256 `96c601460ea1dff3480fcd7a2dd1d770b03c4ca67d38cb4b9bfe6f4291361a1a`.
This counterexample overrides unqualified AC-15/16/30 support from existing green tests.
Verifier-u's report remains separate and bound to the preceding revision, not approval of its correction.

## Hosted review on 4e27e98

All current checks finished before this inventory. CI `42297469940` succeeded at21:37:46Z.
Hosted review `42297470921` completed at21:42:05Z, posting five findings (review5807420589).
Inventory: **94 threads, 5 open**. Four functional/evidence findings and one maintenance item were confirmed.

| Finding | Correction and regression |
| --- | --- |
|4497925128 | Recognize unchanged raw and streamed terminal-visible spans independently, then project visible sensitive spans back across their original formatting ranges. Preserve separate raw stdout/stderr, private raw inspection, bounded visible diagnostics and unredacted assertion cursors. Every chunk/raw-tail cut, retained suffix, finalization/later append and actual pipe/PTY/validation checks cover explicit and automatic credentials without hiding ordinary output. |
|4497925134 | Capture the lane clock before checkout using the portable epoch-second shell clock. Each independent check receives only remaining elapsed job time minus90 seconds for bounded cleanup, assembly and upload inside the unchanged ten-minute job cap. Missing/malformed/future/exhausted clocks block rather than renew the budget. Contract negatives reject removed/late/changed anchors; actual CLI probes preserve all three quality check logs and blocked assembly. |
|4497925139 | Move sandbox setup inside the handled command lifecycle and cap the isolated Windows compiler by the smaller remaining setup budget, never above its existing30 seconds. Preserve setup diagnostics as blocked records, dispose partial sandbox roots and continue sibling collection even if an executor rejects unexpectedly. Inject setup failures and run all-results collection with a known synthetic sibling failure; the separate pinned-compiler regression retains actual exit2/failure1 coverage. |
|4497925143 | Retain nonzero command exits observed before cleanup/deadline; cleanup errors block a prior success without replacing proven failure. Keep original diagnostics plus cleanup reasons, including sandbox disposal/drain errors. Do not mistake signals generated during cleanup for a prior command failure. Inject both cleanup boundaries for exit0/1/2 and a proven failure followed by a pipe deadline. |
|4497925149 | Remove the invariant provider checkout-root parameter. Both production callers and fixture callers use the reduced signature; checkout head/cleanliness/merge-parent verification always uses shared repositoryRoot. Independently varying evidence directory and provider ports remain. API maintenance, not a newly reproduced safety defect. |

Original formatted controls reproduced **65 pass/6 fail**, including both real pipe and PTY disclosures.
Source-isolated original executor controls reproduced **1 pass/5 fail**; only absolute imports and process-boundary
ports were added to original HEAD logic, with original sources/logs retained. The first correction's focused run
caught cleanup-induced signal exits incorrectly counted as failures; the observing boundary was corrected before
completion. Expanded focused controls passed148/0 before two additional drain-failure rows.

Final format/lint/types/contracts, full tests (**1395/0 in18 isolated batches**), build and compiled smoke all exit0.
The unchanged-default20s security suite passes244/0. Five extra production-CLI/actual-deadline probes pass5/0:
missing/malformed/future/exhausted clocks preserve logs and assembly, and a1.5-second hanging command finishes
cleanup at2.042 seconds, before the reserved evidence interval. Probe CI identities are synthetic checker inputs,
not provider approval. No assertion, fixture, session/test deadline, job cap, frozen acceptance, dependency or pin
is removed or relaxed. The workflow adds only the initial clock step.

Static review-t completed2026-11-06T21:36:02Z with no substantiated blocking/should-fix/nit finding in its
seven-file scope plus relevant dependencies, and no dynamic tests executed.
Parent-preserved return SHA-256 `ec5f6cc0d91b52ba89f656fcfb7289e6620fa3911dcdf948303a37ccc8e08747`.
Verifier-t completed2026-11-06T21:49:24.055197Z on4e27e98/merge4158bda with32 bounded support passes,
own1375/0 full suite and ten529/0 contract runs without retries. Its independent39/0 root-selector controls
and fresh native237/0 per OS support the preceding root correction. Eleven original ZIPs/21 per-check logs,
compiled smoke on all three OSes and prior strong privacy matrices were freshly authenticated/executed.
They did not cover these formatting/lifecycle/deadline counterexamples, which override unqualified
AC-15/16/18/25/27/30/32 support. The raw report remains unchanged, not transferred to the next revision.
Actual phase2 remained blocked/exit2 for missing genuine code/security/distinct-verifier attestations.
Report SHA-256 `0d5c05000d27dee5868a13b78462d1783c36f0bb4b852b4099ee1fd8d1d949bc`.

## Hosted review on 26ac169

All current checks finished before this inventory. CI `42294603204` passed at21:16:44Z,
including the corrected default-budget security lane235/0 and deterministic gate. Hosted review
`42294604236` completed at21:20:02Z, posting three findings (review5807141571).
Inventory: **89 threads, 3 open**. One functional regression and two maintenance findings were confirmed.

| Finding | Correction and regression |
| --- | --- |
|4497713825 | Accept equivalent dot-directory Git root selectors, including trailing/repeated forward or backward separators and repeated dot components. Do not normalize away parent traversal; actual subdirectories still use unchanged confinement. Seven real cold/warm acquisition cases, six traversal/outside refusals, and four real CLI preview/apply cases cover success, protected-byte preservation and actual installed content. |
|4497713839 | Remove the unconsumed confinement barrel exports and make the internally used custom error private. Keep createConfinement and every direct production/test consumer unchanged. This is API maintenance, not a newly reproduced safety failure. |
|4497713863 | Derive partial query markers from the existing six-key registry. Keep separate Bearer/assignment-only markers and all existing literal/encoded/boundary/positive-output controls. This is shared-authority maintenance, not a newly reproduced leak. |

Original new selector controls reproduced **37 pass/9 fail**, including three actual CLI preview failures.
Corrected focused checks pass **183/0 in two isolated batches**. Final format, lint, types, contracts,
full tests (**1375/0 in18 isolated batches**), build and compiled smoke all exit0.
The seven cold/warm selectors cover both separator spellings on every OS; actual native CI is still required
for Windows claims. No frozen acceptance text, workflow, deadline, dependency, lock or toolchain pin changed.

Independent static review-s completed2026-11-06T21:14:20Z with no substantiated blocking/should-fix/nit
findings in the preceding15-file correction scope plus relevant dependencies, with no dynamic tests executed.
Parent-preserved return SHA-256 `1da7c2c7301ccdda96e33271d5b18489db87f68f20af6ab230842667f0d4593e`.

Verifier-s completed2026-11-06T21:26:42.085256Z on26ac169/merge33ecd67 with32 implementation-check support
passes in its executed scope, own1358/0 full suite and ten525/0 contract runs without retries.
It directly exercised three actual historical-mark PTYs, completed negative-review parser/readiness controls,
permission placement and outside-cwd launcher/compiled smoke. It authenticated eleven new original ZIPs,
21 per-check logs, actual native224/0 per OS and compiled smoke on all three OSes. Security235/0 used
the unchanged20s budget, with the slowest matrix case2645.45ms; all cuts/assertions remain covered.
Actual phase2 remained blocked/exit2 for missing genuine code/security/verifier role attestations.
The new Git selector counterexamples override an unqualified AC-2/8 claim despite those bounded passes;
the original report is preserved, not rewritten or transferred to the next revision.
Report SHA-256 `004cb3e527f1a9232d25da6c7059796b3ad506d6d15d8128a1609583cbc21828`.

## Hosted review and CI failure on 41f6cee

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

Its recovered final report completed2026-11-06T21:09:23.105541Z with30 phase1 passes and AC-18/30 failures
for actual security runner-budget blockerVR-1. Actual phase2 was not-ready/exit1, preserving known security/gate
failure precedence alongside missing genuine producer roles. Its own1330/0 full suite, ten497/0 contract runs
and authenticated native224/0 per OS did not erase that failure. The subsequent parent cursor/provider negatives
also bound its AC-17/32 support. Original classification11/1 fixture-selection error and separate corrected15/0
matrix remain separate, not relabeled12/0.
Report SHA-256 `f1a33fd18832b8e230aa9d2049d3356ebda4ff4fc2f8e019a70d21644308df98`.

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
