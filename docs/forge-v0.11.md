# Forge v0.11 — Token Budgeting + Priority Ordering

> **Milestone:** Forge v0.11 — "Budget-Aware"
>
> **Prerequisite:** Forge v0.9 (skill graph). Pairs well with v0.10 (tree-shaking provides the kept set).
>
> **Scope:** Estimate token costs per skill, enforce per-agent budgets,
> order output by priority. Ensures agents get the most important skills
> first within their context window limits.
>
> **Effort:** ~1 week.

---

## Problem

Agent context windows are finite. A team with 30 skills totaling 50K tokens will blow past context limits on some agents. Today there's no way to know which skills to prioritize or how close you are to the budget.

## Solution

1. **Estimate tokens** per skill using a character-based heuristic
2. **Enforce budgets** — if total exceeds a per-agent limit, drop lowest-priority skills first
3. **Order output** — skills emitted in dependency-first, priority-second order

## Token Estimation

### Phase 1: Character heuristic (v0.11 scope)

```typescript
function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4)
}
```

Rough but sufficient for prioritization. English text averages ~4 chars/token. ±20% off doesn't matter — this is for "which skill to drop first", not billing.

### Phase 2: Accurate tokenizer (future)

Use `tiktoken` or `@anthropic-ai/tokenizer` for model-specific counts. Optional, loaded lazily.

## Budget Enforcement

```typescript
interface BudgetResult {
  included: SkillNode[]       // skills that fit within budget
  excluded: SkillNode[]       // skills dropped due to budget
  totalTokens: number
  budget: number
  utilization: number         // totalTokens / budget (0-1)
}

function applyBudget(skills: SkillNode[], budget: number | undefined): BudgetResult
```

**Algorithm:**

1. Sort skills by effective priority (descending)
2. Iterate sorted list, accumulate token estimates
3. When cumulative total exceeds budget, stop including
4. **Exception**: if a skill is a transitive dependency of an already-included skill, include it anyway
5. Return included/excluded split

## Config

```yaml
compile:
  budgets:
    claude-code: 15000
    cursor: 10000
    # agents without a budget = no limit
```

## Priority Ordering

Skills in output are ordered for optimal agent consumption:

1. **Dependencies first** — topological order
2. **Higher priority first** within same dependency depth
3. **For alphabetical agents** (Claude Code): prefix filenames with rank (`001-study-java.md`)

## File Location

```
domain/compiler/
  tokens.ts      — estimateTokens, estimateSkillTokens
  optimizer.ts   — applyBudget, orderSkills (extends tree-shake module from v0.10)
```

## Tests

### Token estimation
- Empty string → 0 tokens
- Known string "Hello world" (11 chars) → 3 tokens
- bodyTokens excludes frontmatter, totalTokens includes it

### Budget enforcement
- Skills under budget → all included
- Skills over budget → lowest priority dropped first
- No budget configured → all included
- Dependency protection: low-priority dep of high-priority skill → included even if over budget
- Single skill exceeds budget → included anyway (at least one skill always ships)

### Priority ordering
- Independent skills ordered by priority (highest first)
- Dependency appears before dependent regardless of priority
- Equal priority → stable order
