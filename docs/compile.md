# Compile

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/crucibledx/assets/raw/main/forge/diagrams/dark/forge-compiler-pipeline.svg">
  <img alt="Forge compile pipeline: validate, resolve, compile (one unit per harness and scope), emit, install" src="https://github.com/crucibledx/assets/raw/main/forge/diagrams/light/forge-compiler-pipeline.svg">
</picture>

`forge sync` compiles every plugin it delivers, one compile unit per (harness, scope), before emission
(spec [0005](../specs/0005-compile-and-guardian.md)). The unit is everything [0003](./plugins.md) delivers to that
harness in that scope, so one scope's plugins are always compiled together and never mixed with the other scope's.

This version ships the core: the compile unit, its config, lock v2, the manifest and the sync discipline. The only
pass that runs is **link** (dependency edges from frontmatter `requires`, `subagent_type` references and explicit
`/<name>` mentions); normalize, dedupe, profile, minify, budget and guardian land in later issues. Every component
the compile leaves alone is emitted byte-identical to v0.8, so with nothing changed the installed plugins, the lock
`outputs` and the variants are exactly what v0.8 produced.

## Config

`compile:` lives in the config of the scope it compiles, like `plugins:`:

```yaml
compile:
  enabled: true # default; false keeps v0.8 output
  priority: [] # plugins that fill the listing first (budget pass, later issue)
  keep: [] # component ids always listed (later issue)
  defer: [] # component ids always deferred (later issue)
  profile: false # false | rank | prune | {mode, include, exclude} (later issue)
  guardian: {hook: auto, mcp: auto, min_score: 6} # or `guardian: off` (later issue)
  harnesses: # per-harness budget and cap overrides (later issue)
    droid: {skills: 9500, skill_description: 199}
```

The schema rejects unknown keys. `enabled` is the only key this version acts on; the rest are validated and locked
now so the later passes can read them without a config migration.

## What sync writes

- **Lock v2** (`.crucible/forge.lock`, user scope `~/.crucible/forge/forge.lock`): `version: 2` plus, per compiled
  harness, `compile[<harness>] = {enabled, inputs: "sha256:…", compiler: <n>}`. `inputs` hashes the effective compile
  config and harness data, the compiler version and the unit's sorted `(name, contentHash)` pairs — never the
  project path, config order or time. A v0.8 lock (`version: 1`) upgrades on the next sync.
- **Manifests** (`.crucible/compile/<harness>.json`, user scope `~/.crucible/forge/compile/`): one canonical-JSON
  document per compiled harness, next to a `.gitignore` of `*`. Per component: id (`<plugin>/<kind>/<name>`), status,
  reasons, entry cost and diagnostics; plus `inputs` and the `variants[<harness>]` the compile produced. No
  timestamps, no per-machine values; the schema is [schemas/compile-manifest.v1.json](schemas/compile-manifest.v1.json).
  A harness no longer compiled has its manifest pruned, and `forge uninstall` removes the manifests with the rest of
  the project state.
- **Emitted versions**, when a compile changes a plugin's bytes for a harness (not in this version): the emitted
  `plugin.json` version, catalog entry and cache path gain `c.<hex>` (first 8 hex of the output hash, computed with
  the source version in place) as build identifiers (`1.2.3` → `1.2.3+c.<hex>`, Droid) or prerelease identifiers
  (`1.2.3` → `1.2.3-c.<hex>`, Claude Code, which keeps source build metadata). The lock records `emitted[<harness>]`
  per plugin; cache pruning keeps every source and emitted version the lock names. Variant lines keep the source
  `<name>@<version>`.

## Sync discipline

| Lock state                                     | Sync does                                                                                                                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compile[h].compiler` newer than this forge's  | refuses before any write: "upgrade forge"                                                                                                                                  |
| lock `version` newer than 2                    | refuses before any write: "upgrade forge"                                                                                                                                  |
| no `compile[h]`, compile enabled (a v0.8 lock) | compiles, relocks, prints once: "forge 0.9 compiles plugins for `<harness>`: N listed, M deferred. Set `compile.enabled: false` to keep v0.8 output. See docs/compile.md." |
| compile disabled                               | writes `compile[h] = {enabled: false, compiler}`, relocks `outputs` to v0.8's bytes when they differ                                                                       |
| `inputs` unchanged, plugins reused             | installs the locked outputs verbatim                                                                                                                                       |
| `inputs` unchanged, cache miss                 | recompiles; the result must hash to the locked `outputs`, else aborts before any write naming the plugin, harness and manifest path                                        |
| `inputs` changed                               | recompiles, relocks, reports "recompiled for `<harness>`: `<which input changed>`"                                                                                         |

An older compiler never relocks a newer lock, so mixed-version teams cannot flip it. A harness that is enabled for
plugins but has no compile support yet gets one report line, "compile is not supported for `<harness>` yet", and
v0.8-identical output.

## Statuses and diagnostics

Every component of the unit lands in the manifest with a status: `listed`, `deferred`, `pruned` or `invalid`
(spec 0005 §1). This version lists everything; the later passes introduce the other statuses. Diagnostics carry a
severity and a code from the closed table in the manifest schema; the link pass adds `link-unresolved` when a
`requires` or `subagent_type` names nothing in the unit (a `/<name>` mention that matches nothing is prose, not a
reference).
