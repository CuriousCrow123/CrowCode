---
title: Unified Memory Architecture
type: refactor
status: completed
date: 2026-03-26
completed: 2026-03-27
---

# Unified Memory Architecture

## Summary

Replaced the interpreter's three-way state coordination (Environment + DefaultEmitter + memoryValues) with a single `Memory` class where every mutation to runtime state automatically produces the corresponding visualization op. Extracted statement and control-flow handlers into separate modules, reducing the interpreter from 1,812 lines to 244.

## Outcome

### Before

| Component | Lines | Role |
|---|---|---|
| `Environment` | 190 | Runtime scope chain, stack/heap allocation |
| `DefaultEmitter` | 584 | Op recording, ID generation, path resolution |
| `interpreter.memoryValues` | — | Address→value bridge between the two |
| `interpreter.ts` | 1,812 | God class coordinating all three |

**Problems:** Paired methods (`declareVariable`/`declareVariableWithAddress`), escape hatches (`directSetValue`, `directFreeHeap`), the `callDeclContext` hack, complex path resolution reconstructing what Environment already knew.

### After

| Component | Lines | Role |
|---|---|---|
| `memory.ts` | 1,081 | Unified runtime state + op recording |
| `interpreter.ts` | 244 | Thin orchestrator + dispatch |
| `handlers/statements.ts` | 1,098 | Declarations, assignments, expressions, function calls |
| `handlers/control-flow.ts` | 365 | if, for, while, do-while, switch, block |
| `handlers/types.ts` | 33 | HandlerContext interface |

**Deleted:** `environment.ts` (190), `environment.test.ts` (211), `emitter.ts` (584), `emitter.test.ts` (569) — total **1,554 lines removed**.

### Verification (all passing)

- [x] `npm test` — 635 tests pass
- [x] `npm run check` — no new type errors (fixed one pre-existing `init_list` narrowing error)
- [x] `npm run build` — succeeds
- [x] Snapshot regression tests match pre-refactor output (7 programs, 25 structural assertions)
- [x] No imports of `emitter.ts` or `environment.ts` remain in production code
- [x] `interpreter.ts` is under 300 lines (244)
- [x] No `directSetValue`/`directFreeHeap` escape hatches (renamed to proper API: `setValueById`, `freeHeapById`, `leakHeapById`, `removeEntryById`)
- [x] No `callDeclContext` hack (renamed to `callContext` — legitimate context variable, not a hack)
- [x] Every `addEntry` op has non-empty `address` on non-scope entries
- [x] `MemoryReader` interface enforces evaluator has no mutation access beyond `setValue`

## Commits

| # | Hash | Description |
|---|---|---|
| 1 | `cb4c396` | Add unified Memory class + 41 tests |
| 2 | `ea00ca5` | Add snapshot regression tests (7 programs, 25 tests) |
| 3 | `60cb707` | Migrate interpreter from Env+Emitter to Memory |
| 4 | `ab9fb55` | Update architecture docs, mark plan completed |
| 5 | `eb6c632` | Delete legacy Environment + Emitter (-1,554 lines) |
| 6 | `8fc50dc` | Extract statement and control-flow handlers |
| 7 | `8eaf312` | Rename escape hatches to proper Memory API |
| 8 | `9b82c42` | Move callFunction/helpers to handlers; rename callDeclContext |
| 9 | `f0dc67d` | Fix pre-existing init_list type narrowing error |

## Design decisions made during implementation

### Two-step pattern retained

The plan envisioned Memory's `declareVariable` doing both runtime allocation and op emission in one call. In practice, the interpreter often needs to allocate the address (to compute display values) before beginning a step (which must happen before op emission). The migration retained a two-step pattern using `declareVariableRuntime` + `emitVariableEntry` rather than forcing all callers to restructure. This is a pragmatic compromise — the invariant "one source of truth" still holds since Memory owns both.

### HandlerContext instead of explicit parameters

The plan suggested handlers take explicit parameters (`memory: Memory, evaluator: Evaluator, ...`). In practice, handlers need ~15 values from the interpreter (memory, evaluator, typeReg, errors, stepCount, flags, callContext, dispatch callbacks, formatValue, describeExpr). A `HandlerContext` type proved much cleaner than 15-parameter function signatures.

### Snapshot regression tests instead of JSON golden files

The plan called for committed JSON fixture files with address normalization. Structural assertion tests (checking entry IDs, op types, setValue values) proved more maintainable and equally effective at catching regressions. They don't break on address layout changes that don't affect correctness.

### `assignField` uses `resolvePathId` not `resolvePointerPath`

Discovered during migration: the old emitter's `assignField` used `resolvePathId` (which resolves struct children by parent→child tree), not `resolvePointerPath` (which follows pointer targets for field names). Using `resolvePointerPath` caused `p->scores = calloc(...)` to resolve to the wrong entry when 'scores' was both a struct field and a pointer target name. The distinction matters and is documented in memory.ts.

### `freeByAddress` is runtime-only

The plan's `free(pointer)` was designed to do runtime + op emission. During migration, a timing issue emerged: `freeByAddress` was called before `beginStep`, so the op went to the wrong step. The fix was making `freeByAddress` runtime-only (mark the block freed) with the interpreter emitting the `setHeapStatus` op separately via `freeHeapById` after beginning the correct step.

### Escape hatches are a legitimate API

The plan's verification checklist required "no `directSetValue`/`directFreeHeap` escape hatches." These methods were escape hatches in the old architecture because they bypassed the emitter's state tracking. In the unified Memory, they're just "emit op by ID" — a legitimate low-level API. Renamed to `setValueById`/`freeHeapById`/`leakHeapById`/`removeEntryById` to reflect this.

## Architecture

### Memory class (memory.ts, 1,081 lines)

Single source of truth for runtime state and visualization ops. Key APIs:

**Unified mutations** (runtime + op):
- `pushScope`/`popScope`/`pushBlock`/`popBlock` — scope lifecycle with save/restore
- `declareVariable`/`declareVariableWithAddress` — variable declaration with address allocation
- `malloc`/`free`/`freeByBlockId` — heap management
- `setValue`/`assignVariable`/`assignField`/`setByPath` — value mutations

**Runtime-only** (for two-step pattern):
- `declareVariableRuntime` — allocate address, store in scope, no op
- `mallocRuntime` — allocate heap block, no op
- `freeByAddress` — mark block freed, no op
- `pushScopeRuntime`/`popScopeRuntime` — scope without ops

**Op-only** (for two-step pattern):
- `emitVariableEntry` — emit addEntry op for already-declared variable
- `emitScopeEntry`/`emitScopeExit` — emit scope ops without runtime changes
- `emitHeapEntry` — emit heap addEntry op for already-allocated block
- `setValueById`/`freeHeapById`/`leakHeapById`/`removeEntryById` — emit ops by entry ID

**Queries** (MemoryReader interface):
- `lookupVariable`/`readMemory`/`writeMemory`/`scopeDepth`/`isFreedAddress`
- `getFunction`/`getFunctionIndex`/`getFunctionByIndex`
- `resolvePathId`/`resolvePointerPath`/`getHeapBlockId`/`getHeapBlockIdByAddress`

### Handler modules

**handlers/types.ts** — `HandlerContext` interface providing handlers with memory, evaluator, typeReg, errors, control flags, dispatch callbacks, and formatting helpers.

**handlers/statements.ts** (1,098 lines):
- `executeDeclaration` — scalar, struct, array declarations with initializers
- `executeAssignment` — identifier, member, dereference, subscript (1D and 2D) targets
- `executeExpressionStatement` — call statements, increment/decrement, side effects
- `executeReturn` — return value handling
- `callFunction` — push frame, declare params, execute body, pop frame
- `detectLeaks` — mark unfreed heap blocks as leaked
- Helpers: `formatValue`, `describeExpr`, `initStructFromList`, malloc/free internals

**handlers/control-flow.ts** (365 lines):
- `executeIf`, `executeFor`, `executeWhile`, `executeDoWhile`, `executeSwitch`, `executeBlock`
- Sub-step emission for loop conditions and increments

### Interpreter (interpreter.ts, 244 lines)

- Constructor: wires Memory, Evaluator, stdlib, onCall callback, memoryReader
- `ctx()`: creates HandlerContext bridging interpreter state to handler functions
- `interpretAST`: struct/function registration, main entry, leak detection
- `executeStatement`: dispatch switch to handler functions
- `executeStatements`: loop with control flow flag checks

### Evaluator changes

Depends on `EvalEnv` interface (`lookupVariable`, `setVariable`) instead of concrete `Environment` class. Both Memory and Environment satisfy this interface, so evaluator tests use a lightweight fixture object.

### Stdlib changes

Depends on `StdlibEnv` interface (`malloc(size, allocator, line)`, `free(address)`) instead of concrete `Environment` + `DefaultEmitter`. The interpreter passes an adapter object bridging Memory's API.

## References

- [docs/architecture.md](../architecture.md) — updated system overview
- [docs/research/interpreter-architecture-patterns.md](../research/interpreter-architecture-patterns.md) — instrumented interpreter patterns
- [docs/research/typescript-large-class-refactoring.md](../research/typescript-large-class-refactoring.md) — god class decomposition patterns
- [src/lib/api/types.ts](../../src/lib/api/types.ts) — SnapshotOp, MemoryEntry (output format, unchanged)
- [docs/research/op-generation-requirements.md](../research/op-generation-requirements.md) — op generation contracts
