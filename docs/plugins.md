# Plugin delivery

Forge installs [Agent Plugins 1.0](https://agent-plugins.org) packages into coding harnesses. You declare plugins in
the forge config; `forge sync` resolves, locks, emits and installs them. This is the first-run how-to; the full
contract is [spec 0003](../specs/0003-plugin-packages-and-delivery.md).

Droid is the supported harness today; Claude Code follows. An enabled harness without plugin support gets one report
line per plugin ("plugins are not supported for \<harness\> yet") and its loose-resource sync is unchanged.

## Configure

```yaml
# .crucible/forge.config.yaml
plugins:
  - name: crucible-loop
    source: {type: git, url: git@github.com:crucibledx/factory-loop.git, path: plugins/crucible-loop, ref: main}
    harnesses: [droid] # optional; default: every enabled harness with plugin support
    scope: project # optional; default: the scope of this config file
```

Sources:

- `local`: `{type: local, path: <dir>}` — pinned by a content hash of the package files.
- `git`: `{type: git, url: <url>, path: <package subdir>, ref: <branch, tag or SHA>}` — `ref` resolves to a commit
  SHA at lock time (default `main`). Git uses your own credentials, non-interactively.

## Scope must match the config

A plugin's scope must match the config file it is declared in, because one sync root is one transaction:

| Entry                      | Declared in                               | Installed by                 |
| -------------------------- | ----------------------------------------- | ---------------------------- |
| `scope: project` (default) | a project's `.crucible/forge.config.yaml` | `forge sync` in that project |
| `scope: user`              | `~/.crucible/forge.config.yaml`           | `forge sync --global`        |

A mismatch fails config validation with a named error that says where the entry belongs and which command installs
it. The two scopes never share a sync run, a lockfile, a cache root or a marketplace name, so covering both means
running both syncs.

## What sync writes

Project scope (relative to the project root) / user scope (relative to your home):

- `.crucible/forge.lock` / `~/.crucible/forge/forge.lock` — the committed lock: each plugin's version, source
  descriptor, resolved commit, content hash, per-harness output hashes, and a `variants` value per harness.
- `.crucible/plugins/` / `~/.crucible/forge/plugins/` — the cache, never committed (`.gitignore` is `*`): the package
  copy and the emitted Droid tree per plugin and version, plus the marketplace catalogs
  (`.factory-plugin/marketplace.json`, `.claude-plugin/marketplace.json`).
- `.factory/settings.local.json` / `~/.factory/settings.json` — exactly two forge-owned keys, merged into the file
  without touching your other keys: `extraKnownMarketplaces["<marketplace>"]` pointing at the cache root, and
  `enabledPlugins["<plugin>@<marketplace>"] = true`.

Marketplace names are distinct per cache root: `crucible-forge-user` for the user scope and `crucible-forge-<id>` per
project (`<id>` derives from the project path), so a project never shadows the user catalog or another project's.

Plugin rules become a generated `SessionStart` hook inside the emitted Droid plugin (Droid adds the hook's output to
the session context); a path-scoped rule is approximated as always-on. The sync report names every such adaptation
and drop per harness, and ends with the installed plugin set, per-harness status and the `variants` values.

## Lock discipline

- No lock entry: resolve, lock, install.
- Unchanged source descriptor: install the locked content verbatim. A git branch moving upstream does not change
  what sync installs.
- Changed descriptor, or changed content of a `local` source: relock and report it.
- A plugin that fails validation, a `local` path that does not exist, or an unreachable source on a cache miss:
  the sync aborts before any write, naming the plugin.

## After sync

Restart Droid: settings-declared plugins install on its next start.

## Update or remove

To update, change the source, `ref` or the package itself and sync again; sync relocks and reports the change. To
remove a plugin, delete its `plugins:` entry and sync: forge removes its two settings keys, its cache entry and any
old cached versions, and the marketplace key goes when the scope's last plugin goes. `forge uninstall` does the same
for a project install.

A forge-owned key you edited by hand belongs to you: sync blocks with a drift error unless you pass `--force` (the
plan lists what `--force` overrode), and `forge uninstall` keeps the key and warns, naming it.
