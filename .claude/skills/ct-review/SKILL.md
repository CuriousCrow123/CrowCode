---
name: ct-review
description: Multi-agent code review for CrowCode changes. Launches parallel reviewers for snapshot contracts, C semantics, test adequacy, and worker integration. Use after implementation before shipping.
argument-hint: "[optional: specific files or branch to review]"
disable-model-invocation: true
---

# CrowCode Review

Run parallel review agents on recent CrowCode changes.

## What to Review

<review_target> #$ARGUMENTS </review_target>

If no target specified, review all uncommitted + staged changes:
```bash
git diff --name-only HEAD
git diff --staged --name-only
```

## Determine Which Agents to Run

Check which files changed, then select agents:

```bash
git diff --name-only HEAD | head -30
```

| Files changed | Agents to launch |
|---|---|
| `src/lib/interpreter/*.ts` | snapshot-contract, c-semantics, test-adequacy, worker-integration |
| `src/lib/interpreter/*.test.ts` | test-adequacy |
| `src/lib/interpreter/worker.ts` | worker-integration |
| `src/lib/engine/*.ts` | snapshot-contract |
| `src/lib/components/*.svelte` | (inline Svelte review — see below) |
| `vite.config.ts`, `package.json` | worker-integration |
| Only tests or docs | Skip review — `npm test` is sufficient |

## Agent Definitions

Launch selected agents **in parallel** using the Agent tool. Each agent file contains its full review checklist.

### 1. Snapshot Contract Reviewer
**Agent file:** `.claude/agents/review/ct-snapshot-contract-reviewer.md`

Launch when: interpreter code, engine code, or any code producing MemoryEntry/SnapshotOp changed.

```
Read .claude/agents/review/ct-snapshot-contract-reviewer.md for your full instructions.
Review these changed files: [list interpreter/engine files]
```

### 2. C Semantics Reviewer
**Agent file:** `.claude/agents/review/ct-c-semantics-reviewer.md`

Launch when: expression evaluator, type system, or memory model changed.

```
Read .claude/agents/review/ct-c-semantics-reviewer.md for your full instructions.
Review these changed files: [list evaluator/types-c/memory files]
```

### 3. Test Adequacy Reviewer
**Agent file:** `.claude/agents/review/ct-test-adequacy-reviewer.md`

Launch when: interpreter tests written or modified, or interpreter implementation changed without corresponding test changes.

```
Read .claude/agents/review/ct-test-adequacy-reviewer.md for your full instructions.
Review these test files: [list test files]
Also check implementation files for untested behavior: [list implementation files]
```

### 4. Worker Integration Reviewer
**Agent file:** `.claude/agents/review/ct-worker-integration-reviewer.md`

Launch when: worker code, WASM config, UI-worker communication, or Vite/SvelteKit config changed.

```
Read .claude/agents/review/ct-worker-integration-reviewer.md for your full instructions.
Review these files: [list worker/config/component files]
```

### 5. Svelte Component Review (inline — no separate agent)

For component-only changes, review inline (no agent needed):

- Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`) used correctly
- Effects clean up resources (`clearInterval`, `EditorView.destroy`, `worker.terminate`)
- Props typed via `$props()` destructuring
- Keyboard event handling doesn't interfere with input elements
- Tailwind classes follow existing patterns (`zinc-950` bg, `blue-500` accents)
- Components are independent (no cross-component state leaking)

## Presenting Results

After all agents return, consolidate into three tiers:

### Critical — Must fix before shipping
- Type contract violations (wrong MemoryEntry fields, missing addresses)
- C semantic errors (wrong sizeof, broken pointer arithmetic)
- Worker lifecycle bugs (leaked workers, stale timeouts, SSR crash)
- Missing tests for core behavior

### Warnings — Should fix
- Style inconsistencies
- Missing edge case tests
- Suboptimal patterns (could be simplified)

### OK — What passed
- Summarize areas that are correct

For each issue, include:
- **File and line**: `src/lib/interpreter/evaluator.ts:42`
- **What's wrong**: Description
- **Fix**: Concrete suggestion

## When to Skip Review

- Single file change under 50 lines
- Test-only changes
- Documentation updates
- Config-only changes

For these, `npm test` + `npm run check` is sufficient.
