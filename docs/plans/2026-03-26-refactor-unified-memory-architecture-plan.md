---
title: Unified Memory Architecture
type: refactor
status: completed
date: 2026-03-26
deepened: 2026-03-26
---

# Unified Memory Architecture

## Enhancement Summary

**Deepened on:** 2026-03-26
**Agents used:** pattern-recognition, code-simplicity, architecture, snapshot-contract, test-adequacy, c-semantics, refactoring-best-practices, interpreter-architecture

### Key Improvements from Review
1. Reduced Memory API surface from 27 to ~20 methods — drop `entries` map, move function table off Memory, merge `setFieldValue`/`setElementValue`/`setDerefValue` into `setByPath`
2. Consolidated 5 handler files into 2 (`statements.ts`, `control-flow.ts`)
3. Collapsed 14 steps into 8 — removed redundant granularity
4. Added critical missing API: stack pointer save/restore, function pointer indices, `pointerTargets` scoped save/restore, `markSubStep`, `free` by block ID
5. Added concrete memory.test.ts spec (20 scenarios ported from deleted files)
6. Added snapshot fixture strategy: commit golden files before the swap
7. Added `MemoryReader` interface for Evaluator — enforces read-only access
8. Split Step 11 into incremental handler-by-handler migration

### New Risks Discovered
- `free(p->field)` requires block ID resolution, not just variable name lookup
- `setElementValue` needs type lookup for byte stride (not hard-coded `* 4`)
- Evaluator's `++`/`--` and simple assignment must call `memory.setValue` not `writeMemory` to trigger ops
- Heap container timing must match reference programs (emit in first `pushScope`, not first `malloc`)

## Context

The interpreter currently maintains three parallel models of the same reality:

1. **Environment** — runtime state: scope chain, variables (name → CValue), heap blocks (address → HeapBlock), stack/heap addresses
2. **DefaultEmitter** — visualization state: scope stack, variable→ID mapping (varMap), pointer→heap-block mapping (ptrTargetMap), child registry (childMap), step/op accumulation
3. **Interpreter.memoryValues** — a `Map<number, number>` bridging the two, tracking numeric values at addresses

The interpreter (1,812 lines) is a god class because its primary job is keeping these three models in sync. Every operation requires: update Environment, format for Emitter, store in memoryValues. This coupling produces:

- **Paired methods** that differ only in whether an address is known: `declareVariable`/`declareVariableWithAddress`, `allocHeap`/`allocHeapWithAddress`, `buildChildren`/`buildChildrenWithAddress`
- **Escape hatches** (`directSetValue`, `directFreeHeap`) where the emitter's high-level API doesn't cover a case
- **The `callDeclContext` hack** — a nullable instance variable threading info between interpreter and emitter because neither has the full picture
- **Complex path resolution** (`resolvePathId`, `resolvePointerPath`) that reconstructs what Environment already knows

### Research Context

Analysis of production tools (Python Tutor, JavaWiz, JSExplain) confirms CrowCode's pre-computed snapshot approach is industry-standard. The state duplication between Environment and Emitter is the concrete problem — both maintain parallel scope stacks that must stay synchronized. See [interpreter-architecture-patterns.md](../research/interpreter-architecture-patterns.md).

## Design

**Core idea:** Replace Environment + DefaultEmitter + memoryValues with a single `Memory` class where every mutation to runtime state automatically produces the corresponding visualization op.

The invariant "visualization matches execution" is maintained by construction, not by coordination.

**What changes:**

| Current | Redesign |
|---|---|
| `Environment` (190 lines) | Absorbed into `Memory` |
| `DefaultEmitter` (584 lines) | Gone — ops are side effects of Memory mutations |
| `interpreter.memoryValues` | Absorbed into `Memory.addressValues` |
| `interpreter.ts` (1,812 lines) | Thin orchestrator (~200 lines) + 2 handler modules (~700 lines) |

**What stays the same:**

- Engine layer (snapshot.ts, diff.ts, validate.ts, navigation.ts) — untouched
- Output format (`Program { steps[].ops[] }`) — untouched
- Parser (tree-sitter → AST) — untouched
- Evaluator — mostly unchanged (gets `MemoryReader` interface instead of `Environment`)
- Types (api/types.ts, interpreter/types.ts, types-c.ts) — untouched
- UI — untouched

**Alternatives considered:**

- **Shared Scope Context** (extract scope stack into shared object, keep Environment and Emitter separate): Eliminates the specific duplication (parallel scope stacks) while preserving separation. Better on testability and extensibility. Worse on simplicity — still requires three objects to coordinate. See [research analysis](../research/interpreter-architecture-patterns.md#a-middle-path-shared-scope-context).
- **Action layer** (formalize interpreter→emitter boundary with a MemoryAction union): Cleans up the interface but keeps two objects in sync. Addresses the symptom (messy interface) not the cause (parallel state).
- **Keep current structure, just extract handlers**: Reduces interpreter.ts size but doesn't address the fundamental coupling between Environment and Emitter.

**Decision:** Full unification. The test suite (630 tests) is strong enough to catch regressions, and the simplification in call sites (one call instead of three-way coordination) outweighs the theoretical testability benefit of keeping them separate.

## Memory Class Design

```ts
class Memory {
    // === Runtime state (replaces Environment) ===
    private scopes: ScopeFrame[] = [];                  // scope chain
    private addressValues = new Map<number, number>();   // address → numeric value
    private heapBlocks = new Map<number, HeapBlock>();   // address → metadata
    private stackPointer: number;                        // grows downward from STACK_BASE
    private heapPointer: number;                         // grows upward from HEAP_BASE

    // === ID/path tracking (replaces Emitter's maps) ===
    private entryIdByVar = new Map<string, string>();        // var name → entry ID
    private heapEntryByPointer = new Map<string, string>();  // pointer name → heap entry ID
    private childEntriesById = new Map<string, Map<string, string>>(); // entry ID → children

    // === Op recording ===
    private currentOps: SnapshotOp[] = [];

    // === ScopeFrame includes save/restore data ===
    // { id, name, vars[], savedVarIds, savedPointerTargets, savedStackPointer }

    // === Unified mutations (each updates state AND records op) ===
    pushScope(name: string, params?: ParamSpec[], callSite?: ScopeInfo): string;
    popScope(): void;
    pushBlock(label: string): string;
    popBlock(): void;

    declareVariable(name: string, type: CType, value: number, children?: ChildSpec[]): CValue;
    // ^ computes address internally from stackPointer. Always produces address on entry.
    setValue(name: string, value: number): void;
    setByPath(path: string[], value: number): void;
    // ^ unified field/element/deref resolution. Internally does type lookup for byte stride.

    malloc(size: number, pointer: string, type: CType, allocator: string, line: number, children?: ChildSpec[]): number;
    // ^ computes address from heapPointer. Emits heap container on first call.
    free(pointer: string): void;
    freeByBlockId(blockId: string): void;  // for free(p->field) pattern
    detectLeaks(): void;  // iterates heapBlocks, emits setHeapStatus ops

    // === Step lifecycle ===
    beginStep(location: SourceLocation, description?: string, evaluation?: string): void;
    markSubStep(): void;
    flushStep(): void;  // pushes current step to internal list
    finish(): { program: Program; errors: string[] };

    // === Queries (read-only — matches MemoryReader interface for Evaluator) ===
    lookupVariable(name: string): CValue | undefined;
    readMemory(address: number): number | undefined;
    currentScopeId(): string;
    scopeDepth(): number;
    isFreedAddress(address: number): boolean;
    getHeapBlock(address: number): HeapBlock | undefined;
    resolveEntryId(path: string[]): string | undefined;  // for handlers that need raw IDs

    // === Address-based write (no op emission — used only by evaluator for ++/--)
    // Evaluator must call setValue() for identifier targets to get ops.
    // writeMemory is internal to Memory's own mutation methods.
}
```

### MemoryReader Interface (for Evaluator)

```ts
interface MemoryReader {
    lookupVariable(name: string): CValue | undefined;
    readMemory(address: number): number | undefined;
    setValue(name: string, value: number): void;  // evaluator needs this for ++/--
    scopeDepth(): number;
    getFunction(name: string): ASTNode | undefined;
    getFunctionIndex(name: string): number;
    getFunctionByIndex(index: number): { name: string; node: ASTNode } | undefined;
}
```

The Evaluator depends only on this interface — it cannot call `malloc`, `pushScope`, or other mutation methods.

### Key Design Constraints (from reviews)

1. **Every `addEntry` op must have a non-empty `address`** on non-scope entries. `declareVariable` computes from `stackPointer`; `malloc` computes from `heapPointer`. No "filled in by caller" pattern.
2. **`pushScope`/`popScope` must save/restore `stackPointer`** for function call frame reclamation.
3. **`pushScope`/`popScope` must save/restore `heapEntryByPointer`** in addition to `entryIdByVar` — prevents pointer shadowing bugs.
4. **`ScopeFrame` must include:** `{ id, name, vars: string[], savedVarIds: Map, savedPointerTargets: Map, savedStackPointer: number }`
5. **Heap container `addEntry` op emitted in first `pushScope`**, not first `malloc` — matches reference program timing.
6. **`setByPath` must do type lookup** to compute byte stride for array element addressing. Not hard-coded `* 4`.
7. **`writeMemory` is NOT public** — all writes go through `setValue`/`setByPath`/`malloc` to guarantee op emission. Internal use only within Memory's own mutation methods.
8. **Function table stays on Memory** (simpler than a separate object, and `MemoryReader` exposes the read interface to Evaluator).

## Files

### Create

| File | Purpose | Est. lines |
|---|---|---|
| `src/lib/interpreter/memory.ts` | Unified Memory class | ~400 |
| `src/lib/interpreter/memory.test.ts` | Tests for Memory (see spec below) | ~400 |
| `src/lib/interpreter/handlers/statements.ts` | Declarations, assignments, expression statements, return | ~400 |
| `src/lib/interpreter/handlers/control-flow.ts` | if, for, while, do-while, switch, break, continue | ~300 |

### Modify

| File | What changes | Why |
|---|---|---|
| `src/lib/interpreter/interpreter.ts` | Rewrite to thin orchestrator (~200 lines) | Delegates to Memory + handlers |
| `src/lib/interpreter/evaluator.ts` | Depend on `MemoryReader` interface instead of `Environment` | Enforces read-only access |
| `src/lib/interpreter/stdlib.ts` | Replace `Environment` + callback wiring with `Memory` | Memory has `readMemory` directly |
| `src/lib/interpreter/index.ts` | Update imports | Re-export Memory if needed |

### Delete

| File | Why |
|---|---|
| `src/lib/interpreter/emitter.ts` | Replaced by Memory |
| `src/lib/interpreter/emitter.test.ts` | Tests replaced by memory.test.ts |
| `src/lib/interpreter/environment.ts` | Absorbed into Memory |
| `src/lib/interpreter/environment.test.ts` | Tests replaced by memory.test.ts |

## memory.test.ts Specification

The following scenarios must be covered, ported from the deleted test files plus new cases:

### From environment.test.ts (scope/variable/heap correctness)
1. Variable declared in inner scope shadows outer; after `popScope`, outer value restored via `lookupVariable`
2. `popScope` on empty scope chain returns gracefully
3. Stack addresses decrease monotonically across two `declareVariable` calls
4. `declareVariable` for `double` type returns 8-byte aligned address
5. `pushScope`/`popScope` save/restore stack pointer — next `declareVariable` reuses freed range
6. Double-free returns error containing `'double free'`
7. Free of unknown address returns error containing `'invalid pointer'`
8. Heap exhaustion (small budget) returns error
9. `getHeapBlock` returns correct `size`, `allocator`, `allocSite.line`

### From emitter.test.ts (op shape/ID generation)
10. `pushScope` produces `addEntry` with `kind === 'scope'` AND heap container `addEntry` with `kind === 'heap'` on first call; no heap op on subsequent calls
11. `declareVariable` produces `addEntry` op with correct `id` (`'main-x'`), `name`, `type`, `value`, `address` (non-empty), `parentId`
12. `setValue` produces `setValue` op with correct `id` and new value string
13. Nested struct children: `declareVariable` with ChildSpec tree produces children with IDs like `'main-player-pos-x'` and addresses computed by adding offsets recursively
14. Two sequential `pushBlock('for')` / `popBlock` produce scope entries with different IDs
15. `free(pointer)` produces `setHeapStatus` op with `status === 'freed'`
16. `detectLeaks` produces `setHeapStatus` ops with `status === 'leaked'` for unfreed blocks
17. `popScope` produces `removeEntry` op for the scope
18. `flushStep` with no pending ops produces step with empty `ops` array
19. Error when `setValue` for undeclared variable

### New cases (from review findings)
20. `heapEntryByPointer` is restored on scope exit (pointer shadowing)
21. `setByPath(['p', 'pos', 'x'], 42)` resolves through pointer to `heap-p-pos-x` and updates both `addressValues` and the op
22. `freeByBlockId` works for `free(p->field)` pattern
23. `markSubStep` sets `subStep: true` on current step
24. `formatAddress(0x100)` produces `'0x00000100'` — zero-padded to 8 hex digits
25. Array element `setByPath` computes correct byte offset via type lookup (not `* 4`)

### Snapshot fixtures (committed before Phase 3)
26. Golden file test: run `interpretSync` on 5+ representative programs, compare full `Program` output against committed JSON fixtures (with address normalization)

## Steps

### Phase 1: Build Memory (additive, no breakage)

#### Step 1: Memory class — scopes, variables, and field/element/deref
- **What:** Implement `Memory` with: scope chain (`pushScope`/`popScope`/`pushBlock`/`popBlock` with stack pointer and variable/pointer save/restore), variable management (`declareVariable`/`setValue`/`lookupVariable`), unified path mutation (`setByPath`), ID generation (scope/block/heap counters), step lifecycle (`beginStep`/`markSubStep`/`flushStep`/`finish`), and `MemoryReader` interface. Address computation from `stackPointer` for variables. `ScopeFrame` with full save/restore data.
- **Files:** `src/lib/interpreter/memory.ts`, `src/lib/interpreter/memory.test.ts`
- **Depends on:** nothing
- **Verification:** `npm test` — new tests pass (scenarios 1-5, 10-14, 17-21, 23-25), existing tests unaffected

#### Step 2: Memory class — heap, read/write, utilities
- **What:** Implement `malloc`/`free`/`freeByBlockId`/`detectLeaks`, heap address allocation from `heapPointer`, heap entry creation with children (always with addresses), `readMemory`, `isFreedAddress`, `getHeapBlock`, function table. Heap container emitted in first `pushScope`.
- **Files:** `src/lib/interpreter/memory.ts`, `src/lib/interpreter/memory.test.ts`
- **Depends on:** Step 1
- **Verification:** `npm test` — new tests pass (scenarios 6-9, 15-16, 22), existing tests unaffected

### Phase 2: Extract handlers + snapshot fixtures (additive, no breakage)

#### Step 3: Extract handler functions
- **What:** Create `handlers/statements.ts` (declarations, assignments, expression statements, return, heap operations) and `handlers/control-flow.ts` (if, for, while, do-while, switch, break, continue, shared `checkLoopFlags` helper). Handlers are standalone functions taking explicit parameters (`memory: Memory, evaluator: Evaluator, ...`). No `StmtContext` type — pass what each handler needs. Handlers call back into a `dispatch(node)` callback for recursive AST traversal.
- **Files:** `src/lib/interpreter/handlers/statements.ts`, `src/lib/interpreter/handlers/control-flow.ts`
- **Depends on:** Steps 1-2 (handlers use Memory)
- **Verification:** `npm run check` — compile passes

#### Step 4: Commit snapshot fixtures
- **What:** Add `src/lib/interpreter/__fixtures__/` with golden-file JSON output from `interpretSync` for representative programs. Include: a struct+pointer program, a for-loop program, a malloc/free/leak program, a multi-function program, and a nested struct through heap pointer program. Normalize addresses in comparison (relative offsets, not absolute values). Add a `snapshot-regression.test.ts` that runs these programs and compares output.
- **Files:** `src/lib/interpreter/__fixtures__/*.json`, `src/lib/interpreter/snapshot-regression.test.ts`
- **Depends on:** nothing
- **Verification:** `npm test` — fixtures match current output

### Phase 3: Swap (incremental, handler-by-handler)

#### Step 5: Rewire Evaluator + stdlib to use Memory
- **What:** Replace `Environment` dependency with `MemoryReader` in Evaluator. Evaluator calls `memory.lookupVariable()`, `memory.readMemory()`, `memory.setValue()` (for `++`/`--`). Replace Environment + callback wiring in stdlib with Memory. Critical: evaluator `++`/`--` and simple assignment must call `setValue` not raw `writeMemory` to trigger ops.
- **Files:** `src/lib/interpreter/evaluator.ts`, `src/lib/interpreter/stdlib.ts`, their test files
- **Depends on:** Steps 1-2
- **Verification:** `npm test`

#### Step 6: Migrate interpreter to Memory+handlers (incremental)
- **What:** Rewrite interpreter to use Memory and handler functions. Do this incrementally by category: (a) wire Memory alongside existing env/emitter, (b) migrate declarations first, run tests, (c) migrate assignments, run tests, (d) migrate control flow, run tests, (e) migrate functions/heap, run tests, (f) remove env/emitter usage. Each sub-step is a commit. Delete old files (`emitter.ts`, `emitter.test.ts`, `environment.ts`, `environment.test.ts`) when nothing imports them.
- **Files:** `src/lib/interpreter/interpreter.ts`, 4 files deleted
- **Depends on:** Steps 3, 5
- **Verification:** `npm test` after each sub-step — ALL tests must pass including snapshot fixtures

### Phase 4: Verify and ship

#### Step 7: Full verification
- **What:** `npm test && npm run check && npm run build`. Verify snapshot fixtures match. Verify no imports of `emitter.ts` or `environment.ts` remain.
- **Files:** none
- **Depends on:** Step 6
- **Verification:** all green

#### Step 8: Update documentation
- **What:** Update `docs/architecture.md` to describe the unified Memory architecture. Update interpreter component descriptions. Update CLAUDE.md key files.
- **Files:** `docs/architecture.md`, `CLAUDE.md`
- **Depends on:** Step 7
- **Verification:** manual review

## Edge Cases

| Case | Expected behavior | How handled |
|---|---|---|
| Variable shadowing across scopes | Inner scope variable resolves to inner ID; outer restored on scope exit | `ScopeFrame.savedVarIds` + `ScopeFrame.savedPointerTargets` restored in `popScope` |
| Pointer path resolution through nested structs | `p->pos.x` resolves to `heap-p-pos-x` | `setByPath` follows `heapEntryByPointer` then walks `childEntriesById` |
| Heap reallocation (`p = malloc(); free(p); p = malloc()`) | Second malloc gets new block ID | Heap ID counter: `heap-p`, `heap-p2`. `heapEntryByPointer` always points to latest. |
| Array element writes via pointer | `scores[i] = 42` finds correct heap child | `setByPath` resolves pointer → heap block, type lookup for byte stride, indexes child |
| `free(p->field)` | Free the heap block pointed to by a struct field | Handler resolves field path to block ID, calls `freeByBlockId` |
| Step with no ops (e.g., `printf` or `return 0`) | Step emitted with empty ops array | `beginStep`/`flushStep` lifecycle — never guard with `hasPendingOps()` |
| Evaluator reads during mutation sequence | Reads see latest values | Memory is single source of truth — no sync lag |
| Heap container timing | Appears in first step alongside `main()` scope | Emitted inside first `pushScope`, matching reference program behavior |
| Stack pointer reclamation on function return | Stack space freed | `popScope` restores `savedStackPointer` from `ScopeFrame` |
| Pointer variable shadowed in inner scope | Inner pointer target restored to outer on scope exit | `ScopeFrame.savedPointerTargets` restored alongside `savedVarIds` |

## Risk Mitigation

**The critical risk is Step 6** — migrating the interpreter to use Memory+handlers.

Mitigations:
1. **Phase 1 is fully additive** — Memory exists alongside Environment/Emitter with its own tests. No existing tests break.
2. **Phase 2 is fully additive** — handlers are standalone functions not yet wired in. Snapshot fixtures are committed.
3. **Step 6 is incremental** — migrate one handler category at a time (declarations → assignments → control flow → functions/heap), committing and running all tests after each. Bisecting failures is trivial.
4. **Snapshot fixtures** — committed golden-file tests catch regressions in `subStep` flags, `evaluation` strings, op ordering, and address formatting that unit tests miss.
5. **630 existing tests** as primary safety net, plus new memory.test.ts (~25 scenarios) and snapshot fixtures.

## Verification

- [ ] `npm test` passes after each sub-step of Step 6
- [ ] `npm run check` passes
- [ ] `npm run build` succeeds
- [ ] Snapshot fixtures match pre-refactor output
- [ ] No imports of `emitter.ts` or `environment.ts` remain
- [ ] `interpreter.ts` is under 300 lines
- [ ] No `directSetValue`/`directFreeHeap` escape hatches exist
- [ ] No `callDeclContext` hack exists
- [ ] Every `addEntry` op has non-empty `address` on non-scope entries
- [ ] `MemoryReader` interface enforces evaluator has no mutation access beyond `setValue`

## References

- [docs/architecture.md](../architecture.md) — current system overview
- [docs/research/interpreter-architecture-patterns.md](../research/interpreter-architecture-patterns.md) — instrumented interpreter patterns, shared-scope-context alternative
- [docs/research/typescript-large-class-refactoring.md](../research/typescript-large-class-refactoring.md) — god class decomposition, context object patterns
- [src/lib/api/types.ts](../../src/lib/api/types.ts) — SnapshotOp, MemoryEntry (output format, unchanged)
- [src/lib/interpreter/emitter.ts](../../src/lib/interpreter/emitter.ts) — current emitter (to be replaced)
- [src/lib/interpreter/environment.ts](../../src/lib/interpreter/environment.ts) — current environment (to be absorbed)
- [docs/research/op-generation-requirements.md](../research/op-generation-requirements.md) — op generation contracts
