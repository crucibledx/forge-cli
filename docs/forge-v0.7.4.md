# Forge v0.7.4 — Token Budgeting + Priority Ordering

> **Feature:** Estimate token costs per skill, enforce per-agent budgets, order output by priority.
>
> **Depends on:** v0.7.2 (skill graph), v0.7.3 (tree-shaking provides the kept set).
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

### Phase 1: Character heuristic (v0.7 scope)

```typescript
function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4)
}
```

Rough but sufficient for prioritization. English text averages ~4 characters per token across GPT/Claude tokenizers. Being ±20% off doesn't matter — this is for "which skill to drop first", not billing.

### Phase 2: Accurate tokenizer (future)

Use `tiktoken` or `@anthropic-ai/tokenizer` for model-specific counts. Optional, loaded lazily.

## Budget Enforcement

```typescript
interface BudgetResult {
  included: SkillNode[]       // skills that fit within budget
  excluded: SkillNode[]       // skills dropped due to budget
  totalTokens: number         // total of included skills
  budget: number              // configured limit
  utilization: number         // totalTokens / budget (0-1)
}

function applyBudget(
  skills: SkillNode[],        // already sorted by priority
  budget: number | undefined, // undefined = no limit
): BudgetResult
```

**Algorithm:**

```
1. Sort skills by effective priority (descending)
   - Effective priority = max(own priority, max priority of dependents)
2. Iterate sorted list, accumulate token estimates
3. When cumulative total exceeds budget, stop including
4. Exception: if a skill is a transitive dependency of an already-included skill, include it anyway (even if over budget)
5. Return included/excluded split
```

**Dependency protection**: You can't drop a skill that's needed by a higher-priority skill. If `study-java` (priority 90) depends on `detect-project` (priority 50), `detect-project` is protected even if the budget would otherwise exclude it.

## Config

```yaml
compile:
  budgets:
    claude-code: 15000      # max tokens for Claude Code
    cursor: 10000            # max tokens for Cursor
    # agents without a budget = no limit
```

Budgets are **per-agent**, because different agents have different effective context limits for rules/skills.

## Priority Ordering

Skills in the output are ordered for optimal agent consumption:

1. **Dependencies first** — a skill's deps appear before it (topological order)
2. **Higher priority first** within the same dependency depth
3. **For agents that read alphabetically** (Claude Code): prefix filenames with zero-padded priority rank (`001-study-java.md`, `002-review-java.md`)

```typescript
function orderSkills(
  graph: SkillGraph,
  skills: SkillNode[],
): SkillNode[]  // dependency-first, priority-second
```

## Types

```typescript
// domain/compiler/types.ts (extends previous)

interface TokenEstimate {
  skillId: string
  bodyTokens: number         // tokens in body content (after frontmatter)
  totalTokens: number        // tokens in full content (for agents that see frontmatter)
}
```

## File Location

```
domain/compiler/
  tokens.ts      — estimateTokens, estimateSkillTokens
  optimizer.ts   — applyBudget, orderSkills (extends tree-shake module)
```

## Tests

### Token estimation
- Empty string → 0 tokens
- Known string "Hello world" (11 chars) → 3 tokens (ceil(11/4))
- Skill with frontmatter → bodyTokens excludes frontmatter, totalTokens includes it

### Budget enforcement
- Skills under budget → all included
- Skills over budget → lowest priority dropped first
- No budget configured → all included
- Dependency protection: low-priority dep of high-priority skill → included even if over budget
- Single skill exceeds budget → included anyway (at least one skill always ships)

### Priority ordering
- Independent skills ordered by priority (highest first)
- Dependency appears before dependent regardless of priority
- Equal priority → stable order (original position preserved)
