# Forge CLI — v0.4 Architecture & Design

> ✅ **Implemented** — shipped as v0.4.x. Kept as historical reference.

> **Milestone:** Forge v0.4 — "Auto-Pilot"
>
> **Prerequisite:** Forge v0.3 shipped (sync v2, merge engine, forge status).
>
> **Scope:** Scheduled sync via `Bun.cron`, OS-level job registration,
> scheduler commands, error logging for unattended runs.

---

## New Commands

| Command                     | What it solves                                          |
|-----------------------------|---------------------------------------------------------|
| `forge scheduler install`   | Register a cron job with the OS scheduler               |
| `forge scheduler uninstall` | Remove the OS-registered cron job                       |
| `forge scheduler status`    | Show whether the scheduler is installed + next run time |

---

## Scheduler Design

### Config

```yaml
# .crucible/forge.config.yaml — v0.4 additions

sync:
  # Cron expression for automatic sync (null = manual only)
  schedule: "0 9 * * 1"    # Every Monday at 9am
```

### `forge scheduler install`

Registers an OS-level cron job that runs `forge sync --silent` on the configured schedule.
Uses `Bun.cron` — handles OS integration (launchd on macOS, cron on Linux) transparently.

```
$ forge scheduler install

  ⚠ This will register a scheduled task with your OS.
    forge sync will run automatically: every Monday at 9am

  Continue? › Yes

  ✓ Scheduler installed. Next run: Mon 12 May 2026, 09:00
  Logs: ~/.crucible/logs/scheduled/forge.sync.log
```

### `forge scheduler uninstall`

```
$ forge scheduler uninstall

  ✓ Scheduled task removed.
```

### `forge scheduler status`

```
$ forge scheduler status

  Scheduler: installed
  Schedule:  0 9 * * 1  (every Monday at 9am)
  Next run:  Mon 12 May 2026, 09:00
  Last run:  Mon 05 May 2026, 09:00  ✓ (no errors)
```

---

## Error Logging

Scheduled syncs run without a TTY. Errors are logged to:

```
~/.crucible/logs/scheduled/forge.sync.log
```

Log format:

```
[2026-05-05T09:00:12Z] INFO  forge sync started (scheduled)
[2026-05-05T09:00:14Z] ERROR Source "team-backend" failed: git fetch timed out
[2026-05-05T09:00:14Z] INFO  forge sync completed with errors
```

On the next manual `forge sync` or `forge status`, if the log contains errors since the
last successful run, the CLI prints a warning:

```
  ⚠ Scheduled sync had errors on Mon 05 May 2026, 09:00
    Source "team-backend": git fetch timed out
    Run `forge sync` to retry, or check ~/.crucible/logs/scheduled/forge.sync.log
```

---

## Implementation Notes

- `Bun.cron` (built-in since Bun 1.x) handles cron parsing and OS-level registration.
  No external cron library needed.
- `--silent` flag for `forge sync`: suppresses all interactive output, writes errors to
  log file only. Exit code reflects success/failure for OS scheduler health checks.
- Log rotation: keep last 30 days of logs. Older entries pruned on each scheduled run.

---

## Init / Sync — Scheduler Prompt (v0.4 addition)

During `forge init` or `forge sync`, if no scheduler is configured:

```
  Set up automatic sync? › Yes
  Schedule (cron): › 0 9 * * 1

  ⚠ This will register a scheduled task with your OS.
  Continue? › Yes

  ✓ Scheduler installed. Logs: ~/.crucible/logs/scheduled/forge.sync.log
```

---

*Document version: 0.4 — pre-implementation*
*Prerequisite: forge v0.3 shipped*
*Scope: Bun.cron scheduler, forge scheduler commands, unattended error logging*
