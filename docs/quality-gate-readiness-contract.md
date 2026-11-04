# Spec 0001 supporting contract: readiness evidence

This proposed amendment supports the already approved `specs/0001-safety-and-test-hardening.md`.
Its clarifications require the separate amendment PR's approval; the original merge does not approve this draft.
It specifies future implementation deliverables, not an already implemented gate. No new reviewer service or
changes to the shared `factory-loop` repository are required.

## Commands and phases

1. Independent reviewers inspect the pinned tested revision. The verifier runs implementation checks and
   `scripts/readiness.test.ts`, including complete synthetic positive/negative bundles for AC-32.
   It then emits its completed implementation-check attestation. It does **not** require or run final aggregation
   against its own incomplete verdict, nor require a previous `results/readiness.json`.
   AC-32's checker invocation runs against a complete synthetic fixture input through the real CLI in self-tests;
   those fixture verdicts are test evidence, never a claim that the actual PR is ready.
2. The repository-local adapter collects those completed attestations and CI artifacts.
3. Final aggregation consumes the completed input bundle and writes the readiness report once. Its prior success
   is never an input. Re-running with identical inputs gives the same decision.

Required entrypoints:

| Command | Interface and responsibility |
| --- | --- |
| `check:lanes` | `bun run check:lanes -- --out results` runs applicable registry modules, maximum two independent subprocesses concurrently, collects all outcomes, then reports. |
| `collect:readiness` | `bun run collect:readiness -- --context results/context.json --out results/readiness-input.json` validates/imports local sidecars and read-only provider evidence. No tests, approvals or finding resolutions are invented. |
| `check:readiness` | `bun run check:readiness -- --input results/readiness-input.json --output results/readiness.json` consumes evidence only; no tests, reviewer calls or network mutations. These paths are defaults when flags are omitted. |

`check:lanes` runs portable modules and the current OS's native module; unavailable foreign-native checks are
explicitly `blocked`, not simulated. A local Linux host build is not proof of a Windows/macOS build. Context is
`local`, with actual HEAD as both head/tested SHA and a fresh invocation ID; it cannot join a PR merge-validation
context. Local focused commands retain ordinary exits. The aggregate exits `1` on any proven failure, `2` if
otherwise incomplete/blocked (including foreign-native results), and `0` only if all required modules truly ran.
An early failed command must not stop later independent modules. Native CI supplies the missing platform evidence.

`check:readiness` exits `0` for `ready-for-owner-review`, `1` for `not-ready` (known failure, unresolved blocking
finding, rejected/unapproved deviation), and `2` for `blocked` (missing/invalid/unavailable/mismatched evidence).
A proven failure takes priority over incompleteness; both remain listed. Invalid input or output-write failure
exits `2` with a redacted stderr error, never a successful or stale prior report. Do not mutate source attestations.
`collect:readiness` exits `0` only for a schema-valid assembled bundle, otherwise `2`; validity is not readiness.

## Version 1 JSON schemas

Implement strict repository-local validators (the existing Zod dependency is sufficient). Every record has
`schema_version:1`; reject unknown enum values, duplicate IDs and malformed identity/hash/provenance fields.
All paths below are relative to the evidence directory, with traversal rejected. Evidence URIs must resolve to
the referenced immutable artifact or authenticated provider object; a free-text claim is not evidence. Restrict
resolution to the selected run's local artifacts or authorized repository/session provider objects, never arbitrary
URLs or paths supplied by a report. Do not send credentials or private source contents to an evidence URI.

### Context: `results/context.json`

Fields:

- `kind`: `pr` or `local`.
- `repository`, `pr_number` (PR context), `head_sha`, `tested_sha`, `base_sha`: full immutable commit IDs.
- `run_id`: workflow ID or local invocation ID; `run_attempt`: positive integer.
- `workflow_ref`: trusted workflow revision; `required_lane_ids`: registry's complete required set.

The CI driver derives PR context from the trusted event/provider, not lane uploads or the PR author's supplied
JSON. All jobs check out its exact tested merge SHA. The summarizer checks identity, job conclusions and artifact
origin against the selected workflow run/attempt. Never mix reports from retries or same-head/different-base merges.
Local context has no PR number; base/workflow identifiers may be absent, but head/tested SHA must equal actual HEAD.

### Lane: `results/<lane-id>.json`

Fields: `head_sha`, `tested_sha`, `run_id`, `run_attempt`, `lane_id`, `status`, `runner_os`, `bun_version`,
`duration_ms`, and `checks`, in addition to `schema_version`.

- `status`: `pass`, `fail`, `blocked` or `cancelled`.
- Each check: `id`, `command`, `exit_code` (integer or null), `duration_ms`, `evidence` (nonempty URI/path list),
  and optional `reason`; cancellation/blocked checks require a reason.
- Test failure requires nonzero/null exit as appropriate; `pass` requires all applicable checks completed
  successfully, expected checks present and evidence available. Never trust a lane's summary over failed checks.
- Artifact origin must match the expected run/attempt. A lane cannot redefine whether it is required.

### Reviews: `results/reviews/{code,security}.json`

Each record has `role` (`code` or `security`), `head_sha`, `tested_sha`, `completion` (`complete` or `unavailable`),
`provenance`, `findings`, and `remaining_risks`, alongside `schema_version`.

`provenance` contains `producer_role`, `actor`, `source_uri`, `report_sha256`, `completed_at` and producer run/session
ID. The referenced raw report is retained. The independent producer, not the implementing agent, supplies the
verdict. Request this JSON sidecar alongside the existing reviewer's Markdown in the repository handoff; the local
adapter validates the sidecar and binds it to the raw report and authenticated provider/session identity.
Markdown-only automation comments remain supporting evidence, not an inferred “complete, no findings” verdict.
If the existing reviewer cannot supply that attestation, mark it unavailable and rerun the existing reviewer with
the output contract; do not add another generic reviewer or alter global droid instructions.

Each finding has `id`, `severity` (`blocking` or `nonblocking`), `status` (`open` or `resolved`), and evidence.
A resolved blocking finding additionally needs `resolution_source_uri` from the independent reviewer confirming
the fix on this tested revision. Implementer self-marking or merely resolving a conversation is insufficient.
Both review roles must be complete, even if one existing independent review run explicitly covers both roles.

### Verifier: `results/verifier.json`

Fields: `phase:"implementation-checks"`, `head_sha`, `tested_sha`, `completion` (`complete` or `unavailable`),
`provenance` as above, and `rows`, alongside `schema_version`.

Every AC occurs exactly once. Each row has `ac_id`, `result` (`pass`, `fail` or `blocked`), `command`,
`exit_code` (integer or null) and nonempty `evidence`. Missing/duplicate ACs, unknown IDs or a “pass” without evidence
are invalid. The independent verifier provides JSON alongside its Markdown table; the adapter cannot promote
unparseable prose to pass. AC-32's row is the checker self-test result from phase 1, not final aggregation output.
If a new merge/base revision is selected, reviews/verifier must attest that revision again; head-only reviews are
not accepted as integrated-revision verification. Their producer run IDs may differ from the CI validation run.

### Deviations: `results/deviations.json`

This is an array, empty when there are no deviations. Each entry contains `id`, `description`, affected `ac_ids`,
`contract_diff_sha256`, `head_sha`, `tested_sha`, and `approval`.

`approval` contains `decision` (`approved`, `rejected` or `pending`), `actor`, `source_uri` and `approved_at`.
Only an authenticated NazarUsik PR review/comment explicitly approving that exact deviation/hash and revision
counts as approval; the adapter checks the original object read-only. Neither agent prose, a bot's label, nor
an input flag can grant it. Approval records do not authorize silently rewriting the frozen approved contract.

### Bundle and output

`results/readiness-input.json` contains `context`, `lanes`, `reviews`, `verifier`, `deviations` and `gate`.
`gate` identifies the selected provider check/run and its conclusion, with source URI. The adapter fills the
bundle from the records above, resolving immutable evidence and validating provider provenance read-only.
Missing/unavailable records stay explicit. The aggregator revalidates inputs rather than blindly trusting the adapter.

`results/readiness.json` contains `context`, `verdict`, normalized `lane_results`, `ac_results`, `reviews`,
`deviations`, `remaining_risks`, `reasons` and `evidence`, alongside `schema_version`.
Verdict strings and exits follow the command contract. Readiness requires successful gate and all required lanes,
all AC rows passing, both independent reviews complete without open blocking findings, and no unapproved
deviations. A reason list names every known failure/blocker; neither readiness nor any prior verdict is required
to bootstrap itself. The report requests owner review; it never merges, publishes or changes branch settings.

## Required negative controls

Repository-local self-tests must cover: phase-1 completion without a prior final report; final complete bundle;
two simultaneous lane failures with surviving successes; early local failure followed by later checks; foreign OS
unavailable; stale/mixed tested SHA and run attempt despite matching head; missing/invalid artifacts; spoofed review
producer; absent role/verifier AC; unresolved/self-resolved blocking finding; pending/rejected/mismatched owner
approval; malformed records; and output-write failure. Do not parse an LLM saying “ready” as a gate override.
