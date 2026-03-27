---
title: Whole Codebase Refactoring
type: refactor
status: completed
date: 2026-03-26
---

# Whole Codebase Refactoring

## Context

A comprehensive analysis of the CrowCode codebase reveals several categories of issues: dead code, duplicated logic, naming inconsistencies, import path drift, magic constants, stale documentation, and a hand-authored programs layer that is no longer needed now that the interpreter is mature.

This plan prioritizes by impact: interpreter cleanup first, then component cleanup, then removing the entire hand-authored programs path (programs layer, builders, ProgramStepper), then documentation updates.

## Design

**Approach:** Bottom-up, dependency-ordered refactoring in four parts. Each step in Parts A-B is a single-file atomic change verified by `npm test && npm run check`. Part C is a coordinated deletion of the hand-authored programs path. Part D updates documentation to reflect the new single-path architecture.

**Key architectural change:** The hand-authored programs layer (`basics.ts`, `loops.ts`, builder helpers, `ProgramStepper.svelte`) is being fully removed. The interpreter is now the sole path from C source to `Program`. This eliminates the dual-path maintenance burden.

## Files

### Delete

| File | Why |
|---|---|
| `src/lib/programs/basics.ts` | Hand-authored program — interpreter handles this now |
| `src/lib/programs/loops.ts` | Hand-authored program — interpreter handles this now |
| `src/lib/programs/index.ts` | Barrel for deleted programs |
| `src/lib/programs/programs.test.ts` | Tests for deleted programs |
| `src/lib/components/ProgramStepper.svelte` | Dead code — zero importers |
| `src/lib/engine/builders.ts` | Only consumers were deleted programs |
| `src/lib/engine/builders.test.ts` | Tests for deleted builders |

### Modify

| File | What changes | Why |
|---|---|---|
| `src/lib/interpreter/interpreter.ts` | Remove dead `interpret()` export and `InterpretResult` type | Dead code — `.run()` returns empty stub |
| `src/lib/interpreter/types-c.ts` | Export `alignUp` | Currently private, duplicated in environment.ts |
| `src/lib/interpreter/environment.ts` | Import `alignUp` from types-c.ts, remove local copy | Deduplication |
| `src/lib/interpreter/stdlib.ts` | Remove unused `typeReg` parameter from `handleMalloc`/`handleCalloc` | Dead parameter |
| `src/lib/interpreter/worker.ts` | Use `import.meta.env.BASE_URL` instead of hardcoded `/CrowCode/` | Hardcoded path breaks local dev |
| `src/lib/interpreter/emitter.test.ts` | Move `import { vi }` to top of file | Misplaced import at line 538 |
| `src/lib/interpreter/*.ts` | Normalize `$lib/api/types` → `$lib/types` | Import path consistency |
| `src/lib/engine/index.ts` | Remove builder re-exports | `builders.ts` deleted |
| `src/lib/engine/integration.test.ts` | Remove 11 tests that import `basics`/`loops`; keep 1 inline test | Dependencies deleted |
| `docs/architecture.md` | Remove programs layer, ProgramStepper, CustomEditor, play/speed references; update to single interpreter path | Stale docs |
| `CLAUDE.md` | Update pipeline diagram, remove basics/loops from Key Files | Stale docs |

### Create

| File | Purpose |
|---|---|
| `src/lib/components/constants.ts` | Shared `MAX_VALUE_LENGTH` constant (extracted from 3 components) |

## Steps

### Part A: Interpreter Cleanup

#### Step 1: Remove dead `interpret()` function
> **Not done.** Dead `interpret()` export still exists at line 34 of `interpreter.ts`. Single-file fix.

- **What:** Delete the `interpret()` free function and its local `InterpretResult` type from `interpreter.ts`. The canonical `InterpretResult` stays in `index.ts`.
- **Files:** `src/lib/interpreter/interpreter.ts`
- **Depends on:** nothing
- **Verification:** `npm test && npm run check`

#### Step 2: Deduplicate `alignUp`
> **Moot.** `environment.ts` was deleted during the Memory unification refactor. No duplication remains.

#### Step 3: Remove unused `typeReg` parameter
> **Not done.** `typeReg` parameter still present in `handleMalloc`/`handleCalloc`. Single-file fix.

- **What:** Remove `typeReg: TypeRegistry` from `handleMalloc` and `handleCalloc` signatures in `stdlib.ts`. Update 2 internal call sites in `createStdlib`.
- **Files:** `src/lib/interpreter/stdlib.ts`
- **Depends on:** nothing
- **Verification:** `npm test && npm run check`

#### Step 4: Fix worker.ts hardcoded paths
> **Not done.** `worker.ts` still hardcodes `/CrowCode/` for WASM paths. Single-file fix.

- **What:** Replace hardcoded `/CrowCode/tree-sitter.wasm` and `/CrowCode/tree-sitter-c.wasm` with `import.meta.env.BASE_URL` pattern.
- **Files:** `src/lib/interpreter/worker.ts`
- **Depends on:** nothing
- **Verification:** `npm test && npm run check && npm run build`

#### Step 5: Fix misplaced vi import
> **Moot.** `emitter.test.ts` was deleted during the Memory unification refactor.

#### Step 6: Normalize import paths
> **Not done.** 5+ interpreter files still import from `$lib/api/types` instead of `$lib/types`.

- **What:** Change interpreter module files that import from `$lib/api/types` to use `$lib/types` instead, matching the engine convention.
- **Files:** All interpreter `.ts` files that import from `$lib/api/types`
- **Depends on:** Steps 1, 3, 4 (those interpreter files are also modified)
- **Verification:** `npm test && npm run check`

### Part B: Component Cleanup

#### Step 7: Extract shared `MAX_VALUE_LENGTH`
> **Not done.** Constant still duplicated locally in `MemoryRow.svelte`, `HeapCard.svelte`, `DrilldownModal.svelte`.

- **What:** Create `src/lib/components/constants.ts` with `export const MAX_VALUE_LENGTH = 40`. Update `MemoryRow.svelte`, `HeapCard.svelte`, `DrilldownModal.svelte` to import it.
- **Files:** `src/lib/components/constants.ts` (new), 3 `.svelte` files
- **Depends on:** nothing
- **Verification:** `npm test && npm run check`

### Part C: Remove Hand-Authored Programs Layer

> **Completed** by the organize-src-docs plan (`docs/plans/2026-03-27-refactor-organize-src-docs-plan.md`). Programs layer, ProgramStepper, builders, and engine barrel re-exports all deleted. integration.test.ts rewritten with inline programs. All documentation updated.

The interpreter is now the sole path from C source to `Program`. The hand-authored path (TypeScript literals + builder helpers) is fully removed.

#### Step 8: Delete programs layer
- **What:** Delete `src/lib/programs/` directory entirely (basics.ts, loops.ts, index.ts, programs.test.ts).
- **Files:** `src/lib/programs/*`
- **Depends on:** nothing
- **Verification:** grep confirms no .ts/.svelte imports from `$lib/programs` except integration.test.ts

#### Step 9: Delete dead ProgramStepper
- **What:** Delete `src/lib/components/ProgramStepper.svelte`. Zero importers exist.
- **Files:** `src/lib/components/ProgramStepper.svelte`
- **Depends on:** nothing
- **Verification:** grep confirms zero imports of `ProgramStepper`

#### Step 10: Delete builders
- **What:** Delete `src/lib/engine/builders.ts` and `src/lib/engine/builders.test.ts`.
- **Files:** 2 files
- **Depends on:** Step 8 (consumers deleted)
- **Verification:** files gone

#### Step 11: Update engine barrel + fix integration test
- **What:** (a) Remove all builder re-exports from `src/lib/engine/index.ts`. (b) In `integration.test.ts`, remove the 11 tests that import `basics`/`loops` and the import lines. Keep the 1 inline snapshot-isolation test.
- **Files:** `src/lib/engine/index.ts`, `src/lib/engine/integration.test.ts`
- **Depends on:** Steps 8, 10
- **Verification:** `npm test && npm run check`

### Part D: Documentation

> **Completed** by the documentation overhaul plan (`docs/plans/2026-03-27-refactor-documentation-overhaul-plan.md`) and organize-src-docs plan. All documentation (architecture.md, CLAUDE.md, CONTRIBUTING.md, interpreter-status.md) updated to reflect current codebase.

#### Step 12: Update CLAUDE.md + architecture.md
- Done.

### Part E: Final Verification

> **Completed.** 599 tests pass across 18 files. Build and type check pass. No references to deleted files remain in active documentation.

#### Step 13: Full verification
- Done.

---

## Remaining Items (not warranting a plan)

These 5 independent single-file fixes were identified but not completed. Each is a standalone change:

1. **Dead `interpret()` function** — `src/lib/interpreter/interpreter.ts` line 34. Delete function and local `InterpretResult` type.
2. **Unused `typeReg` parameter** — `src/lib/interpreter/stdlib.ts`. Remove from `handleMalloc`/`handleCalloc` signatures.
3. **Hardcoded worker paths** — `src/lib/interpreter/worker.ts`. Replace `/CrowCode/` with `import.meta.env.BASE_URL`.
4. **Import path normalization** — 5+ interpreter files use `$lib/api/types` instead of `$lib/types`.
5. **Duplicated `MAX_VALUE_LENGTH`** — constant defined locally in 3 `.svelte` files, should be extracted to `components/constants.ts`.

## Edge Cases

| Case | Expected behavior | How handled |
|---|---|---|
| `alignUp` has different behavior in two files | Both implementations are identical | Verified by reading both — safe to deduplicate |
| Removing `typeReg` param breaks callers | Only 2 internal call sites in stdlib.ts | Updated in same step |
| Worker path change breaks deployment | Service already resolves BASE_URL | Use same pattern |
| Import path change causes circular deps | `$lib/types` re-exports `$lib/api/types` | No circularity possible |
| Engine tests break from missing builders | Engine tests use inline literals, not builders | Verified — no engine test imports builders |
| Interpreter tests break from missing programs | Interpreter tests use inline C source strings | Verified — no interpreter test imports programs |
| Builder helpers needed later | Ops are fully typed in `api/types.ts` | Can be recreated from SnapshotOp union if needed |

## Verification

- [ ] `npm test` passes after each step
- [ ] `npm run check` passes after each step
- [ ] `npm run build` succeeds at end
- [ ] No imports of `$lib/programs` remain in .ts/.svelte files
- [ ] No imports of `ProgramStepper` remain
- [ ] No imports of builders remain
- [ ] Architecture doc reflects single-path (interpreter) architecture

## References

- [docs/architecture.md](../architecture.md) — system overview
- [docs/research/agent-driven-codebase-refactoring.md](../research/agent-driven-codebase-refactoring.md) — refactoring methodology
- [docs/plans/refactor-tasks-2026-03-26.md](refactor-tasks-2026-03-26.md) — executable task list
