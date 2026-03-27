---
name: ct-work
description: Execute CrowCode work plans efficiently — read plan, create todos, implement step-by-step with tests, commit, and ship. Use when ready to implement a planned feature.
argument-hint: "[plan file path]"
---

# CrowCode Work

Execute a CrowCode work plan systematically. Focus on shipping complete features.

## Input

<input_document> #$ARGUMENTS </input_document>

**If empty, check for active plans:**
```bash
grep -rl "status: active" docs/plans/*.md 2>/dev/null
```

If multiple active plans, ask which one to work on.

## Phase 1: Quick Start

### 1. Read and Clarify

- Read the plan completely
- Read referenced files (architecture.md, types.ts, existing code)
- If anything is unclear, ask now — better than building the wrong thing
- Get user approval to proceed

### 2. Setup Branch

Check current branch:
```bash
git branch --show-current
```

- **If on feature branch:** Ask to continue or create new
- **If on main:** Create feature branch: `git checkout -b feat/<descriptive-name>`

### 3. Create Todo List

Use TodoWrite to break the plan into tasks:
- One task per plan step
- Include test tasks
- Include verification tasks
- Keep exactly one task `in_progress` at a time

## Phase 2: Execute

### Task Loop

```
for each task in priority order:
  1. Mark as in_progress (TodoWrite)
  2. Read referenced files from the plan
  3. Look for similar patterns in codebase (grep/glob)
  4. Implement following existing conventions
  5. Write tests for new functionality
  6. Run tests: npm test
  7. Mark as completed (TodoWrite)
  8. Check off corresponding item in plan file ([ ] → [x])
  9. Evaluate for incremental commit
```

### CrowCode Quality Check (per task)

Before marking a task done, verify:

| Question | How to check |
|----------|-------------|
| **Does it satisfy the type contract?** Types match `MemoryEntry`, `SnapshotOp`, `Program` from `api/types.ts`? | Read types.ts, verify return types |
| **Would `validateProgram()` pass?** No duplicate IDs, non-scope entries have addresses, anchor rule satisfied? | Run interpreter output through validateProgram in tests |
| **Does `buildSnapshots()` consume it without warnings?** | Check for console.warn spy in tests |
| **Does it match existing program patterns?** Compare output structure against basics.ts/loops.ts | Read both program files, compare |
| **Are snapshots immutable?** No shared references between steps? | Use structuredClone, test with mutation check |

### Incremental Commits

| Commit when... | Don't commit when... |
|----------------|---------------------|
| Logical unit complete (parser, memory model, evaluator) | Partial implementation |
| Tests pass | Tests failing |
| Switching context (engine → component) | Would need "WIP" message |

```bash
# Verify tests pass
npm test

# Stage specific files (not git add .)
git add src/lib/interpreter/parser.ts src/lib/interpreter/parser.test.ts

# Commit with conventional format
git commit -m "feat(interpreter): add tree-sitter C parser with CST→AST adapter"
```

### Follow Existing Patterns

- **TypeScript style:** strict mode, tabs, single quotes, semicolons
- **Imports:** use `$lib/` alias, `import type` for type-only imports
- **Exports:** barrel via `index.ts`, re-export from engine barrel
- **Errors:** return `{ result, errors: string[] }`, no thrown exceptions in engine code
- **Tests:** Vitest, `describe`/`it`/`expect`, inline helper factories, console.warn spy
- **Immutability:** `structuredClone()` for snapshot isolation

### Test Continuously

```bash
# Run all tests
npm test

# Run specific test file during development
npx vitest run src/lib/interpreter/parser.test.ts

# Watch mode for active development
npx vitest src/lib/interpreter/
```

**Test patterns to follow:**
- Unit tests per module (`parser.test.ts`, `memory.test.ts`, `evaluator.test.ts`)
- Integration test: C source → interpret → validateProgram → snapshot check
- Use `testProgram()` from `programs.test.ts` for full 13-check validation
- Spy on `console.warn` to catch engine errors

## Phase 3: Quality Check

### 1. Run Full Suite

```bash
npm test
npm run check  # svelte-check TypeScript verification
npm run build  # verify static build succeeds
```

### 2. Review Agents (for complex changes)

Use review agents only for:
- Changes touching 10+ files
- New architectural patterns
- Performance-sensitive code (interpreter loop, memory model)
- Security-relevant code (Web Worker sandbox, user input handling)

For most tasks: tests + type checking + following patterns is sufficient.

### 3. Final Validation

- [ ] All TodoWrite tasks completed
- [ ] All tests pass (`npm test`)
- [ ] Type check passes (`npm run check`)
- [ ] Build succeeds (`npm run build`)
- [ ] No console errors in browser
- [ ] Plan checkboxes all checked off

## Phase 4: Ship

### 1. Final Commit

```bash
git add <relevant files>
git commit -m "$(cat <<'EOF'
feat(interpreter): [description of complete feature]

[Brief explanation of what was built and why]

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

### 2. Update Plan Status

Edit the plan file frontmatter: `status: active` → `status: completed`

### 3. Create PR (if requested)

```bash
git push -u origin feat/<branch-name>

gh pr create --title "feat(interpreter): [description]" --body "$(cat <<'EOF'
## Summary
- What was built
- Key decisions made

## Testing
- Tests added
- Manual testing performed

## Plan
See docs/plans/YYYY-MM-DD-...-plan.md
EOF
)"
```

### 4. Report

Summarize:
- What was completed
- Link to PR (if created)
- Any follow-up work needed
- Remaining plan items (if partial)

## Key Principles

1. **Start fast** — Read plan, clarify once, execute
2. **Plan is your guide** — Follow referenced files and patterns
3. **Test as you go** — Run tests after each change, fix immediately
4. **Quality is built in** — Follow conventions, don't add extra
5. **Ship complete** — Don't leave features 80% done
6. **One task at a time** — Mark in_progress, complete, move on

## Common Pitfalls

- **Analysis paralysis** — Read the plan and execute, don't re-research
- **Skipping tests** — Test continuously or suffer at the end
- **Forgetting TodoWrite** — Track progress or lose track
- **Over-engineering** — Match existing patterns, don't invent new ones
- **Batch completion** — Mark tasks done individually, not in batches
- **Ignoring plan references** — The plan links to files for a reason
