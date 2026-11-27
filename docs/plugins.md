# Plugin delivery

Forge installs [Agent Plugins 1.0](https://agent-plugins.org) packages into coding harnesses. You declare plugins in
the forge config; `forge sync` resolves, locks, emits and installs them. This is the first-run how-to; the full
contract is [spec 0003](../specs/0003-plugin-packages-and-delivery.md).

Droid and Claude Code are supported. An enabled harness without plugin support gets one report line per plugin
("plugins are not supported for \<harness\> yet") and its loose-resource sync is unchanged.

## Configure

```yaml
# .crucible/forge.config.yaml
plugins:
  - name: crucible-loop
    source: {type: git, url: git@github.com:crucibledx/factory-loop.git, path: plugins/crucible-loop, ref: main}
    harnesses: [claude-code, droid] # optional; default: every enabled harness with plugin support
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
  copy and one emitted tree per harness (`<plugin>/<version>/claude-code/`, `<plugin>/<version>/droid/`), plus the
  marketplace catalogs (`.claude-plugin/marketplace.json` for Claude Code, `.factory-plugin/marketplace.json` for
  Droid), each pointing at its own harness's trees.
- Per harness, forge-owned keys merged into its settings file without touching your other keys:
  `extraKnownMarketplaces["<marketplace>"]` pointing at the cache root, and `enabledPlugins["<plugin>@<marketplace>"]`
  set to `true` for each plugin:

  | Harness     | Project scope                  | User scope                 | Marketplace source |
  | ----------- | ------------------------------ | -------------------------- | ------------------ |
  | Claude Code | `.claude/settings.local.json`  | `~/.claude/settings.json`  | `directory` source |
  | Droid       | `.factory/settings.local.json` | `~/.factory/settings.json` | `local` source     |

  Project scope writes the harness's local settings file, not the shared one, because the cache path is absolute and
  per machine.

Marketplace names are distinct per cache root: `crucible-forge-user` for the user scope and `crucible-forge-<id>` per
project (`<id>` derives from the project path), so a project never shadows the user catalog or another project's.

Plugin rules are delivered per harness:

- Claude Code: one forge-owned rule file per rule, `.claude/rules/<plugin>--<rule>.md` (user scope:
  `~/.claude/rules/`), with `paths` frontmatter kept, so a path-scoped rule stays path-scoped. Sync tracks these files
  like any other synced file: a hand edit is a local conflict, and removal follows `keep_local`.
- Droid: a generated `SessionStart` hook inside the emitted Droid plugin (Droid adds the hook's output to the session
  context); a path-scoped rule is approximated as always-on.

LSP servers reach Claude Code (`.lsp.json` in its tree) and are dropped for Droid; plugin default settings are not
applied to either harness in v0.8. The sync report names every such adaptation and drop per harness, and ends with
the installed plugin set, per-harness status and the `variants` values.

## Lock discipline

- No lock entry: resolve, lock, install.
- Unchanged source descriptor: install the locked content verbatim. A git branch moving upstream does not change
  what sync installs.
- Changed descriptor, or changed content of a `local` source: relock and report it.
- A plugin that fails validation, a `local` path that does not exist, or an unreachable source on a cache miss:
  the sync aborts before any write, naming the plugin.

## After sync

Restart the harness: both install settings-declared plugins on their next start. Claude Code installs a project's
plugins only once you trust the project folder; the sync report says so under each Claude Code plugin.

## Update or remove

To update, change the source, `ref` or the package itself and sync again; sync relocks and reports the change. To
remove a plugin, delete its `plugins:` entry and sync: forge removes its settings keys, its cache entry and any old
cached versions, and the marketplace key goes when the scope's last plugin goes. Its Claude Code rule files are deleted
when `keep_local` is false and kept when it is true. `forge uninstall` does the same for a project install, and
deletes the rule files whatever `keep_local` says.

A forge-owned key you edited by hand belongs to you: sync blocks with a drift error unless you pass `--force` (the
plan lists what `--force` overrode), and `forge uninstall` keeps the key and warns, naming it.
