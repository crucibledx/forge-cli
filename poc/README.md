# POC: Forge as a compiler + runtime guardian

**Throwaway proof of concept. Not for merge. Not a PR to main.** Branch `poc/forge-compiler`.

This folder is self-contained (own `package.json`) and does not touch Forge's `src/` or lockfile.

- `compiler/`: parse a plugin corpus into a component graph, run passes (normalize, dedupe, tree-shake, defer,
  minify, budget), and emit per harness (`droid`, `claude`) with a manifest.
- `guardian/`: deterministic per-request skill router used by a Droid `UserPromptSubmit` hook, plus a tiny stdio
  MCP fallback (`search_skills`, `load_skill`).
- `eval/`: fixture project, tasks, runner (`droid exec -o json`), and analysis. Raw results are in `eval/results/`.

```bash
cd poc && bun install
bun compiler/cli.ts --config eval/forge.compile.yaml --project eval/fixture --mode compile --target droid --out /tmp/out
```

## Rerunning the measurements

The corpus config (`eval/forge.compile.yaml`) expects wshobson/agents at commit `9c61ab2` under
`/Users/smith/poc-scratch/corpus/wshobson-agents`; adjust the path for another machine.

```bash
bun eval/run.ts 3 4 T1 && bun eval/run.ts 3 4 T2          # 4 conditions x task x 3 reps, --auto low
EVAL_AUTO=medium bun eval/run.ts 3 2 T3                   # T3/T4 need venv/pip, which --auto low blocks
EVAL_AUTO=medium bun eval/run.ts 3 2 T4
bun eval/rescore.ts                                       # re-apply current checks to existing workspaces
bun eval/aggregate.ts > eval/results/summary.md
bun eval/route-bench.ts <guardian-ws> eval/results/route-bench/prompts.json <compile-ws>/.crucible/forge.manifest.json eval/results/route-bench/copy-visible.json
bun eval/route-model-score.ts eval/results/route-bench/ <guardian-ws>
```

`droid exec` 1.8.0 does not fire `UserPromptSubmit`, so `eval/run.ts` appends the guardian note to the prompt itself.
