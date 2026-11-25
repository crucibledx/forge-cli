# Harness context and cost optimizations: what Forge compile should borrow

Date: 2026-11-25. Status: research, input for spec 0005 (`forge compile`, issue #52). Closes issue #50.

Each finding is labelled:

- **DOCUMENTED**: official docs, changelog, or engineering blog.
- **SOURCE**: read in open source code (constant and file named).
- **OBSERVED**: measured by us, or reported in issues/third parties.
- **INFERRED**: reasoning, not a fact.

Primary inputs: four per-harness research passes run on 2026-11-25 against current docs and source
(Factory docs/changelog up to CLI v1.19.0; Claude Code docs and CHANGELOG up to v2.1.332;
`openai/codex` at commit `ebd0765`, release `rust-v0.172.0`; Copilot CLI docs/changelog up to v1.0.115),
plus measurements on the locally installed Droid 1.12.1 (section 2) and the compiler POC on branch
`poc/forge-compiler` (48 `droid exec` runs, section 7).

## 1. Budget table per harness

| Surface | Droid (Factory) | Claude Code | Codex CLI | Copilot CLI |
|---|---|---|---|---|
| Skill listing entry | `name: description` | name always; `description` + `when_to_use` | `- name: description (kind: path)` | XML entry with name + description |
| Skill listing budget | **Not documented.** OBSERVED: descriptions cut to name-only past a char budget (sections 2, 7); ~15k chars measured on 1.8.0, re-measured on 1.12.1 below | DOCUMENTED: 1% of the context window (`skillListingBudgetFraction`, default 0.01; legacy `SLASH_COMMAND_TOOL_CHAR_BUDGET` falls back to 8,000 chars) | SOURCE: 2% of the window (`SKILL_METADATA_CONTEXT_WINDOW_PERCENT = 2`, 4 bytes/token) or 8,000 chars if unknown (`DEFAULT_SKILL_METADATA_CHAR_BUDGET`); `skills.max_context_tokens` overrides, capped at 10,000 | OBSERVED: fixed `SKILL_CHAR_BUDGET` of 30,000 chars, not scaled to the window; env var can raise it; undocumented |
| Per-description cap | OBSERVED: ~200 chars (199 + "…") | DOCUMENTED: 1,536 chars (`skillListingMaxDescChars`) | SOURCE: 1,024 chars (`MAX_CATALOG_SKILL_DESCRIPTION_CHARS`) | DOCUMENTED: 1,024 chars max; OBSERVED: a longer description gets the skill **silently dropped** (copilot-cli#3494) |
| Over budget | OBSERVED: later entries lose their description (name-only), in load order, **no omission notice** | DOCUMENTED: descriptions dropped starting with least-invoked skills, names stay, warning in `--debug` log | SOURCE: descriptions shrunk evenly round-robin; then whole skills dropped from the end of a fixed order (user scope first), with a warning | OBSERVED: filled in arrival order; rest listed name-only as "Additional skills available"; no warning |
| Agent/droid listing | In the Task tool description (since CLI 0.22.3). DOCUMENTED: description >500 chars is a validation warning. OBSERVED: at 80 project droids every description was cut to ~55 chars (section 2) | DOCUMENTED: warning when non-built-in agent names+descriptions exceed 15,000 tokens total; nothing is dropped | SOURCE: roles listed inside the `spawn_agent` tool description; no cap or truncation found | DOCUMENTED: description shown in the `task` tool; no budget found. Agent body max 30,000 chars (cross-product doc) |
| On-demand tools/MCP | DOCUMENTED: Deferred Context Engine; 11 -> 2 tool definitions up front (15,798 -> 8,528 tokens); defers tool/MCP schemas, skill bodies, plugin instructions; −15.1% input tokens avg, −50.8% with 100+ hidden tools | DOCUMENTED: tool search on by default; `ENABLE_TOOL_SEARCH=auto[:N]` defers once tool definitions pass 10% (default) of the window | SOURCE: **every** MCP tool is deferred behind `tool_search`, no threshold; per-server `enabled_tools`/`disabled_tools`; agent-plugin tool specs hidden past 8 KB each / 64 KB total | DOCUMENTED: tool search on by default above ~30 tools (supported models only); `deferTools: "never"` per server; only allowlisted MCP server instructions load up front |
| Rules files | DOCUMENTED: AGENTS.md (also CLAUDE.md etc.) from cwd up to git root; 80,000 chars initial load, 40,000 per dynamic nested load; "caps, not targets" | DOCUMENTED: CLAUDE.md up the tree, <200 lines per file recommended, files >4 MiB skipped; on-demand files truncated at 40,000 chars (200K window; 150,000–200,000 on 1M window) | SOURCE: `project_doc_max_bytes` default 32 KiB; the file that crosses the budget keeps its **first** bytes, later files skipped, with a warning | DOCUMENTED: copilot-instructions.md, .github/instructions (`applyTo`), AGENTS.md/CLAUDE.md/GEMINI.md combined, duplicates removed; no size limit found (the 4,000-char code-review limit was removed 2026-06) |
| Prompt caching | DOCUMENTED: append-only requests; tools discovered mid-session appended at the end; production: 98% of input read from cache, 98.6% of requests strictly append-only; TTL not documented | DOCUMENTED: prefix order tools -> system -> messages; TTL 5 min default, 1 h on subscription; write 1.25x/2x, read 0.1x (0.05x/0.025x on newest models) | SOURCE: `prompt_cache_key` defaults to the session id; AGENTS.md/skill changes mid-session are **appended** as deltas, not rewritten. DOCUMENTED: exact-prefix match; TTL 30 min default | DOCUMENTED: invalidators: model/effort/context-size change, tools or MCP servers changed mid-session; cache expires after 24 h (OpenAI) / 1 h (most others); instruction edits only apply next session |

## 2. Measured: Droid 1.12.1 listing behavior (OBSERVED, 2026-11-25)

Setup: empty git repo, synthetic project skills (`measure-skill-NNN`, 177-char descriptions) and droids
(`measure-droid-NNN`, 288-char descriptions), trivial prompt `Reply with the single word OK.`, model
`claude-sonnet-5`, `droid exec -o json`. Total input = input + cache read + cache write.

| Project skills | Total input tokens | Delta vs 0 | Descriptions visible |
|---|---|---|---|
| 0 | 15,665 | — | — |
| 40 | 18,472 | +2,807 | all 40 |
| 80 | 19,204 | +3,539 | measure-skill-001…053 full, 054…080 name-only |
| 160 | 19,348 | +3,683 | measure-skill-001…045 full, 046…160 name-only |

Findings:

- The skill listing has a **character budget for descriptions**: entries past it keep their name and lose
  the description, in alphabetical load order within the project. There is **no "N more skills" notice**.
- The token cost of extra skills flattens fast (3,539 -> 3,683 between 80 and 160), confirming the cap:
  a huge install costs Droid little, but it **decides what stays visible in load order, not relevance**.
- Custom droids: at 20 droids with 288-char descriptions, all 20 descriptions shown in full (+2.2k tokens
  over baseline). At 80 droids, **every** description was cut to ~55 chars ("It reviews w…"), all 80 names
  still listed. So the droid listing budget is shared and descriptions shrink to fit.
- The earlier POC numbers (Droid 1.8.0: ~15k chars skills / ~11k chars droids, descriptions cut at ~200
  chars) remain consistent with these results; the exact caps are still not documented anywhere.

## 3. Droid (Factory) — detail

Sources: factory.com/news/frontier-harness (Oct 2026), factory.com/news/deferred-context-engine (May 2026),
docs.factory.com harness pages, changelog through CLI v1.19.0. Local install: 1.12.1.

- DOCUMENTED: only skill `name` and `description` are read at start; the SKILL.md body loads on invocation;
  supporting files only if referenced (docs.factory.com/harness/skills).
- DOCUMENTED: frontier harness: 2 of 11 tool definitions sent up front (tool tokens 15,798 -> 8,528);
  append-only requests with new tools appended at the end; cache reuse measured at 96.5–100% across common
  session changes; production 98% cache reads (frontier-harness post).
- DOCUMENTED: Deferred Context Engine defers internal tool schemas, MCP schemas, skills, and plugin
  instructions; −15.1% input tokens on average, −50.8% with 100+ hidden tools (deferred-context-engine post).
- DOCUMENTED: `disabledSkills`, frontmatter `enabled`, `disable-model-invocation` (hidden from the model,
  still `/skill`-invocable), `user-invocable: false`, `--disable-builtin-skills`; MCP `enabledTools`/
  `disabledTools` exclude tools entirely (never registered, zero cost).
- DOCUMENTED: droid `description` over 500 chars raises a validation warning; droids scanned only at the top
  level of `.factory/droids/` and `~/.factory/droids/`; project droid wins name clashes.
- DOCUMENTED: AGENTS.md discovery from cwd to git root (also `.factory/`, `.agents/`, `.agent/` per level,
  and personal files); caps of 80,000 chars initial and 40,000 per dynamic load; `AGENTS.md`, `agents.md`,
  `Agents.md`, `CLAUDE.md`, `Claude.md` all read, and the docs warn duplication wastes context.
- DOCUMENTED: auto-compaction at ~250,000 tokens default (`compactionTokenLimit`, per-model overrides);
  hook `additionalContext` capped at 1,000,000 chars, `systemMessage` at 10,000.
- DOCUMENTED (correcting the POC note): current docs say `UserPromptSubmit` **does** run in `droid exec`
  (a block exits non-zero). The POC found it did not fire in 1.8.0; no changelog entry records the fix, so
  re-verify before relying on it.

## 4. Claude Code — detail

Sources: code.claude.com/docs (skills, sub-agents, memory, mcp, prompt-caching, settings-reference),
anthropics/claude-code CHANGELOG through v2.1.332, platform.claude.com prompt-caching docs,
agentskills.io/specification. Read 2026-11-25.

- DOCUMENTED: skill listing budget is 1% of the context window; per-entry `description` + `when_to_use` cut
  at 1,536 chars. Over budget, descriptions of the least-invoked skills are dropped first; names stay.
  Knobs: `skillListingBudgetFraction`, `skillListingMaxDescChars`, legacy `SLASH_COMMAND_TOOL_CHAR_BUDGET`
  (8,000 chars), per-skill `skillOverrides` (`on` / `name-only` / `user-invocable-only` / `off`; not for
  plugin skills). `/context` and `/doctor` report listing cost.
- DOCUMENTED: subagent names+descriptions over 15,000 tokens total produce a startup warning; nothing is
  truncated. Agent bodies load only when the agent runs.
- DOCUMENTED: MCP tool search on by default; `auto` defers once tool definitions pass 10% of the window;
  `_meta["anthropic/alwaysLoad"]` pins a tool; upfront tool descriptions cut at 4,096 chars, deferred at
  16,384 (`CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH` overrides).
- DOCUMENTED: prompt cache layers: system prompt (core + tools), project context (CLAUDE.md, memory,
  unscoped rules), conversation. Invalidators: model switch (including a skill's `model:` field), effort
  change on older models, fast mode, MCP/tool changes while tools load upfront, compaction, CLI upgrade.
  Cache-safe: editing CLAUDE.md mid-session (applies after `/clear` or restart), invoking skills, subagents,
  plugin skills/commands/agents/hooks, MCP changes while tool search defers tools.
- DOCUMENTED: TTL 5 minutes default, 1 hour on subscription within plan usage; knobs `promptCacheTtl`,
  `CLAUDE_CODE_PROMPT_CACHE_TTL`, `ENABLE_PROMPT_CACHING_1H`.
- DOCUMENTED: CLAUDE.md recommended under 200 lines per file; files over 4 MiB skipped; `@path` imports up
  to 4 hops; AGENTS.md read natively since v2.1.277 only when no CLAUDE.md exists (otherwise use
  `@AGENTS.md`); on-demand files (subdirectory CLAUDE.md, `paths:` rules) truncated at 40,000 chars on a
  200K window since v2.1.309.
- DOCUMENTED: Agent Skills spec limits: `name` 1–64 chars (lowercase, digits, `-`), `description` 1–1,024
  chars, `compatibility` ≤500 chars, body under ~5,000 tokens / 500 lines.
- DOCUMENTED: MCP output capped at 25,000 tokens (`MAX_MCP_OUTPUT_TOKENS`); text results over 50,000 chars
  saved to a file; Bash output capped at 30,000 chars.

## 5. Codex CLI — detail

Sources: `openai/codex` at commit `ebd0765` (2026-11-25, release `rust-v0.172.0`), files under
`codex-rs/`; learn.chatgpt.com docs (build-skills, config reference, agents-md, MCP, subagents);
developers.openai.com prompt-caching and tool-search guides.

- SOURCE: skill entry rendered as `- {name}: {description} ({kind}: {path})`
  (`ext/skills/src/render.rs`). Budget = 2% of the context window in tokens at 4 bytes/token
  (`SKILL_METADATA_CONTEXT_WINDOW_PERCENT`), or 8,000 chars when the window is unknown
  (`DEFAULT_SKILL_METADATA_CHAR_BUDGET`); `skills.max_context_tokens` overrides up to 10,000
  (`MAX_CONFIGURED_SKILL_METADATA_TOKEN_BUDGET`).
- SOURCE: over budget, `allocate_skill_lines` shrinks all descriptions evenly (round-robin, one char at a
  time), then drops whole skills from the end of a fixed order (System, Admin, Repo, User — so **user-scope
  skills drop first**) with an "Exceeded skills context budget" warning. Newer render styles show
  `metadata.short-description` instead and add an "N additional skills omitted" line.
- SOURCE: per-description cap 1,024 chars (`MAX_CATALOG_SKILL_DESCRIPTION_CHARS`). `name` ≤64 chars
  (`MAX_NAME_LEN`), qualified name ≤129.
- SOURCE: every MCP tool gets `ToolExposure::Deferred` behind `tool_search`, no threshold
  (`core/src/mcp_tool_exposure.rs`); `tool_search` returns 8 results by default; agent-plugin MCP specs
  hidden past 8 KB each / 64 KB total. Config `tool_search = false` is retired and rejected.
- SOURCE: `prompt_cache_key` = session id by default; AGENTS.md edits mid-session are appended as a
  replacement fragment; skill changes appended as "Added or updated skills"; compaction resets both.
  DOCUMENTED: cache needs an exact prefix; TTL 30 minutes default (12 h option); minimum 1,024 tokens.
- SOURCE: AGENTS.md chain: `AGENTS.override.md`, then `AGENTS.md`, then fallback filenames, project root
  down to cwd, joined with the global file; `project_doc_max_bytes` default 32,768
  (`DEFAULT_PROJECT_DOC_MAX_BYTES`); the file crossing the budget keeps its first bytes (tail cut), later
  files skipped, with a warning. Nothing loads in untrusted projects.
- DOCUMENTED: `agents/openai.yaml` `policy.allow_implicit_invocation: false` hides a skill from implicit
  use; explicit `$skill` still works (whether it also leaves the listing is unverified).
- SOURCE: async compaction threshold default 65% (`DEFAULT_ASYNC_COMPACTION_THRESHOLD_PERCENT`).
- DOCUMENTED: custom agents are TOML in `~/.codex/agents/` or `.codex/agents/`; listed inside the
  `spawn_agent` tool description ("Available roles:"), user roles first; no cap found.

## 6. Copilot CLI — detail

Sources: docs.github.com/en/copilot (CLI reference, tool-search, custom instructions, custom agents,
context-management, optimize-ai-usage), changelog through v1.0.115, github/copilot-cli issues.

- OBSERVED: skill catalog is XML entries in the system prompt with a fixed character budget
  `SKILL_CHAR_BUDGET` of 30,000 by default (env-overridable, undocumented), filled in arrival order; skills
  past it move to a name-only "Additional skills available (invoke by name)" line (#5488, #2314, #2416).
  No warning when skills are cut. Subagents get their own truncated copy.
- DOCUMENTED: skill `name` ≤64 chars, `description` ≤1,024 chars; OBSERVED: a longer description gets the
  skill **silently dropped** (#3494). `user-invocable` and `disable-model-invocation` supported.
- DOCUMENTED: tool search on by default above ~30 tools, on supported models only (Claude Haiku 4.5+,
  Sonnet/Opus 4.0+, GPT 5.4+); always loaded: built-ins, `deferTools: "never"` servers, tools a custom
  agent names (unless `deferred-tool-loading: true`). MCP tool names capped at 64 chars (`server-tool`).
- DOCUMENTED: instruction files: `~/.copilot/copilot-instructions.md`, `.github/copilot-instructions.md`,
  `.github/instructions/**/*.instructions.md` (`applyTo`, shown as a table), `AGENTS.md`, `CLAUDE.md`,
  `GEMINI.md`, `.claude/rules` — combined with no precedence order, exact duplicates removed; `@path`
  imports (repo-local) in copilot-instructions.md/AGENTS.md/CLAUDE.md. No size limit found; guidance is
  short, self-contained statements. Subagents get no repo instructions unless
  `include-custom-instructions: true`.
- DOCUMENTED: cache invalidators: model, reasoning effort, or context-size change, and changing enabled
  tools or MCP servers mid-session; expiry 24 h (OpenAI) / 1 h (most others); instruction edits apply only
  next session; resumed sessions replay attachments to preserve the cache.
- DOCUMENTED: auto-compaction starts in the background at ~80% of the window; the CLI pauses at ~95% if it
  has not finished. Tool output over 20 KiB goes to a file (`COPILOT_LARGE_OUTPUT_THRESHOLD_BYTES`).
- DOCUMENTED: `userPromptSubmitted` hook's `additionalContext` bug (#2652) was fixed in v1.0.85.

## 7. What the POC adds (input, not re-measured here)

From `poc/forge-compiler` (48 `droid exec` runs, Droid 1.8.0, claude-sonnet-5; read-only input):

- With 92 public plugins installed, a trivial prompt cost 23.1k input tokens vs 14.8k empty; the compiled
  layout cut that to 21.2k (−24% of the overhead) and the guardian layout to 18.3k (−59%). After turn one
  these are cache reads, so **token savings on Droid are small; routing is the real problem**: in the
  copy-all layout the expected skill had a visible description in only 15% of benchmark cases.
- Task success: compiled 12/12, copy-all 9/12, no plugins 8/12. On the task needing one specific skill,
  compiled passed 3/3 at 1.2x baseline cost vs copy-all 1/3 at 2.0x.
- A deterministic BM25 router is not good enough to be the gate (top-3: 80% direct / 33% indirect, 35%
  false suggestions); a model-written query over the same index reaches 95%/65%.
- Cache arithmetic: with 0.05–0.1x cache reads, rewriting the prefix to remove T tool tokens pays back only
  after ~12–24x P/T unchanged turns. Per-request tool filtering loses money. Append-only hints after the
  cached prefix are the cache-safe shape.

## 8. Compile rules Forge should apply

Rules 1–6 apply to every target; rule 7+ are per harness. "Budget" numbers are conservative targets derived
from section 1; where a cap is undocumented (Droid), the rule is based on measurement and must be
re-checked when Factory documents it.

1. **Descriptions are routing; write them for the listing, not the body.** Put the trigger ("Use when…")
   keywords in the first sentence. Cap emitted descriptions at the strictest target in the compile:
   1,024 chars hard max (Agent Skills spec / Codex / Copilot), and offer a minify pass to ~200 chars for
   Droid so the observed cut never removes meaning (first sentence + trigger sentence, as in the POC).
2. **Never emit a description over 1,024 chars for Copilot**: the skill is silently dropped. Fail the
   compile (or auto-minify with a diagnostic) instead of letting the harness drop it.
3. **Fit the listing by relevance; the harness fills in load order, not merit.** Default budgets:
   Droid ~9,500 chars of skill descriptions (measured cap ~15k incl. names, minus built-ins) and ~9,000
   chars for droids; Claude Code 1% of the window (≈8,000 chars fallback); Codex 8,000 chars (2% rule);
   Copilot 28,000 chars (30k budget minus slack). Order kept entries by relevance score so truncation, if
   it ever happens, cuts the least relevant. What does not fit gets `disable-model-invocation: true`
   (Droid, Claude, Copilot) or `policy.allow_implicit_invocation: false` (Codex) — deferred, never deleted,
   still user-invocable and guardian-findable.
4. **Dedupe and normalize per target first.** The POC found real breakage in public corpora (duplicate
   agents, missing `name`, Claude-only model aliases). Name clashes get renamed with a diagnostic; exact
   body duplicates are removed and references rewritten.
5. **Emit one rules file per directory per harness family and keep it short.** Root AGENTS.md/CLAUDE.md
   well under every cap: <200 lines (Claude guidance), <32 KiB (Codex), <80k chars (Droid). Never write the
   same content to both AGENTS.md and CLAUDE.md: Droid and Copilot would load both, Claude would load only
   one. Put detail in nested files (Droid/Claude load on access; Codex tail-cuts at 32 KiB, so critical
   rules first in every file; Copilot `applyTo` instructions for path-scoped content).
6. **Make output deterministic, byte for byte.** No timestamps, no random ordering, stable sort
   everywhere. Every harness invalidates or dilutes its prompt cache when the prefix changes; compiled
   output should diff-empty between runs when inputs are unchanged. Emit once, at build time; never rewrite
   files mid-session (Codex/Claude append edits as extra context, Copilot ignores them until next session).
7. **Droid target:** skill descriptions ≤199 chars with the trigger first; droid descriptions ≤500 chars
   (validation warning) and keep the total droid listing small — at ~80 droids Droid cuts every description
   to ~55 chars, so prefer fewer, sharper droids over many; use `disabledSkills`/`enabledTools` in
   settings to prune rather than relying on deferral alone; do not duplicate rules across the five
   AGENTS.md/CLAUDE.md filenames Droid reads.
8. **Claude Code target:** descriptions ≤1,536 chars (≤1,024 keeps cross-harness parity); total subagent
   names+descriptions well under 15,000 tokens; use `paths:` rules for scoped content (truncated at 40k
   chars on demand); never emit `model:` on skills/commands unless intended — it invalidates the cache.
9. **Codex target:** repo-scope skills survive drops before user-scope ones, so compile into the repo, not
   the home dir; emit `metadata.short-description` for newer render styles; keep the AGENTS.md chain under
   32 KiB with critical content first; trim MCP with `enabled_tools`, and keep plugin tool specs under
   8 KB each / 64 KB total.
10. **Copilot target:** keep the whole skill catalog under ~28,000 chars and order must-see skills first
    (arrival order fills the budget; overflow is name-only with no warning); fail compile on names >64
    chars; set `deferred-tool-loading: true` on agents that name many tools; remember subagents see no repo
    instructions without `include-custom-instructions: true`.
11. **Do not build** a per-request tool-filtering proxy, prose compression of skill bodies, or Forge's own
    runtime deferral engine. All four harnesses already defer tools and bodies natively; the compile-time
    win is choosing what fills the capped listing, plus dedupe and normalization.
12. **The runtime guardian is append-only or nothing.** Hints must be appended after the cached prefix
    (UserPromptSubmit hook, tool result). Note the Droid caveat: docs now say `UserPromptSubmit` fires in
    `droid exec`, but the POC measured it not firing in 1.8.0 — re-verify on the current CLI before the
    guardian relies on it headless.

## 9. Open questions

- Droid's exact skill and droid listing budgets and drop order are still undocumented; sections 2 and 7 are
  measurements on 1.12.1/1.8.0. Ask Factory to document them (also requested in the POC research).
- Droid: cache TTL and the effect of a mid-session model switch or AGENTS.md edit are undocumented.
- Claude Code: the exact top-level CLAUDE.md warning threshold and where the skill/agent listings sit in
  the request (system vs messages) are not published.
- Codex: whether `allow_implicit_invocation: false` removes a skill from the listing; which render style
  the CLI uses by default.
- Copilot: whether `SKILL_CHAR_BUDGET` is a supported setting, whether `disable-model-invocation` skills
  count against it, and whether the custom-agent list has its own budget.
