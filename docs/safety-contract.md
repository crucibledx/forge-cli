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
- Config stays version `"1"`. State upgrades to version 2 only in a committed transaction. Loading old state does
  not write it: legacy hashes remain `legacy-unknown` until installation or byte-identical desired content verifies
  them. `local-wins` never invents an installed baseline.
- Do not downgrade a v2 state file to the old CLI. Preserve local edits first, then restore one pre-upgrade
  target/config/state snapshot or deliberately rebuild state. A hash is not a backup.
- State/config timestamps advance together on successful apply, including no-op. Preview and pre-apply errors
  preserve them. When compensation is incomplete, metadata named in the emergency is **untrusted**.
- Silent mode suppresses normal presentation, not failure exits. Incomplete compensation always emits minimal
  recovery-required stderr, even if reports also fail. Preserve backups/recovery temporaries, restore targets,
  config and state from one known-good snapshot, then dry-run. Do not retry writes with untrusted metadata.

### Limits and current native blockers

**Serialize sync invocations.** This is handled-error compensation, not a crash journal, locking protocol or
power-loss atomicity guarantee. Confinement rejects pre-existing escapes, not hostile concurrent directory swaps.
Existing POSIX permission bits are preserved; new metadata is private. Ownership, timestamps, extended attributes
and alternate data streams are not preserved guarantees.

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
Default session deadline is 10 seconds with a 20-second test budget; 30-second sessions need
`--timeout-ms 40000` before `--`. PTY text is a transcript, not a reconstructed screen.

The ten required modules are quality, business, e2e, human-dx, agent-cli, security, performance, native-macos,
native-windows and build. `scripts/validation-lanes.ts` defines their commands, scopes, deadlines and AC/BR mappings.
`bun run check:lanes -- --out results` runs at most two independent commands concurrently and collects all results.
Foreign native modules are blocked, not emulated. Local evidence cannot substitute for PR merge validation.
Exits: 1 for proven failure, 2 for otherwise incomplete evidence, 0 only for complete required successes.

CI checks out the event's exact tested SHA. Independent checks continue after sibling failures. Matrix fail-fast
is disabled. Seven-day bounded sanitized artifacts include failures; the always-run `Deterministic gate` checks
selected run/attempt, provider jobs and evidence before passing. Missing, stale, skipped or cancelled evidence
fails the gate. An upload failure cannot turn a lane green.

Security runs offline attack scenarios plus `bun audit --json --audit-level=high` with a 60-second deadline, the
only public-network fixture exception. High/critical runtime **or dev** findings fail. Invalid/unavailable/
unaudited responses block; no ignores or dependency changes are made by the audit.
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

The owner must configure required `Deterministic gate` and independent reviews in branch rules after inspecting
the actual check names. Agents do not change repository settings, merge, release or grant deviations. Report
read-only branch-rule evidence or the access blocker in the implementation PR. A draft/non-draft toggle is not
readiness and must not create a review-trigger cycle.

Future CLI and MCP interfaces need **separate approved contracts** over shared application use cases and safety
invariants. CLI stdout/exits and MCP schemas/errors remain transport-specific. This work adds no MCP lane, protocol,
compiler semantics, wizard redesign or release schedule. Screen-aware pilots, concurrency/crash recovery, extended
performance and packaging parity are separate follow-ups.
