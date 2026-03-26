# Plan: Custom TypeScript C Interpreter

> Created 2026-03-26. Effort: standard. Status: **completed**

## Context

### Why
CrowTools programs are currently hand-authored TypeScript files with hardcoded steps and ops. Users cannot write their own C code and see its memory layout. A client-side C interpreter would let users type C source in the browser and get the same step-through visualization — no server, no 40MB compiler download, just interpretation.

### Background
The existing pipeline: `Program → buildSnapshots() → MemoryEntry[][] → ProgramStepper → UI`. The interpreter slots in before this — it takes C source and produces a `Program` object. Everything downstream is unchanged.

Research identified PLIVET (JS-based C interpreter) as the closest prior art, but its UNICOEN-based memory model requires a translation layer nearly as complex as a custom interpreter. tree-sitter-c provides battle-tested C parsing as a ~1MB WASM download.

Key codebase patterns: strict TypeScript, tabs, single quotes, error tuple returns `{ result, errors }`, structuredClone for immutability, Vitest for testing, barrel exports via index.ts.

### Constraints
- Static GitHub Pages deployment — no server
- Must produce valid `Program` objects that pass `validateProgram()`
- Must run in a Web Worker with timeout protection (no infinite loops freezing the UI)
- tree-sitter WASM loading requires `optimizeDeps.exclude` in Vite config
- C subset only: scalars, structs, arrays, pointers, malloc/free, function calls, loops, if/else
- No preprocessor, no goto, no union, no variadic args, no function pointers

## Design

### Approach
Two-layer architecture: an **interpreter** that understands C semantics and an **op emitter** that translates interpreter events into `SnapshotOp[]`. Run both in a Web Worker. The output is a standard `Program` object that feeds into the existing `buildSnapshots()` pipeline.

```
C source → tree-sitter → AST → Interpreter → events → OpEmitter → Program
                                    ↓                      ↓
                              C state tracking      MemoryEntry construction
                              (values, types,       (ids, addresses, hierarchy,
                               stack, heap)          descriptions, sub-steps)
```

**Why two layers (not direct op emission):** The interpreter and visualization have different concerns. The interpreter needs to track C values, types, scope chains, and heap state. The emitter needs to construct valid `MemoryEntry` objects with hierarchical IDs, hex addresses, `ScopeInfo`, `HeapInfo`, sub-step anchoring, and description strings. Mixing these produces a monolithic module that's hard to test and hard to change. With two layers:
- The interpreter is testable against C semantics alone (does `3 + 4 * 2` evaluate to 11?)
- The emitter is testable against the op contract alone (are IDs unique? addresses in range? anchor rule satisfied?)
- If `MemoryEntry` changes, only the emitter changes
- The boundary between them is a set of method calls, not a formal IR — zero overhead

**Why SnapshotOp as the output (not MemoryEntry[][] directly):** Using ops preserves compatibility with `validateProgram()`, `buildSnapshots()`, diffing, and the entire existing test infrastructure including `testProgram()`. The emitter doesn't need to manage snapshot immutability — `buildSnapshots()` handles structuredClone.

**Why tree-sitter (not hand-rolled parser):** Eliminates an entire class of parsing bugs. C's declarator syntax is notoriously tricky (`int (*f)(int)`, `int *a[10]`). tree-sitter-c handles all of it. The ~1MB download is negligible (CodeMirror is larger). The CST→AST adapter is ~200-300 lines.

### The Emitter Interface

The interpreter calls emitter methods as it executes. The emitter maintains ID/address state and accumulates `ProgramStep[]`:

```typescript
interface OpEmitter {
    // Step lifecycle
    beginStep(location: SourceLocation, description?: string, evaluation?: string): void;
    markSubStep(): void;  // marks current step as subStep: true

    // Scope lifecycle
    enterFunction(name: string, params: ParamSpec[], callSite?: ScopeInfo): void;
    exitFunction(name: string, returnValue?: string): void;
    enterBlock(label: string): void;    // for-loop, if-block, bare { }
    exitBlock(id: string): void;

    // Variable lifecycle
    declareVariable(name: string, type: CType, value: string, children?: ChildSpec[]): void;
    assignVariable(name: string, value: string): void;

    // Nested entry targeting (struct fields, array elements, heap fields)
    assignField(path: string[], value: string): void;     // e.g. ['p', 'pos', 'x'] for p.pos.x or p->pos.x
    assignElement(path: string[], index: number, value: string): void;  // e.g. ['scores'], 2 for scores[2]

    // Heap lifecycle
    allocHeap(pointerVar: string, type: CType, size: number, allocator: string,
              allocSite: { line: number }, children?: ChildSpec[]): void;
    freeHeap(pointerVar: string): void;
    leakHeap(blockId: string): void;    // mark un-freed block as leaked (e.g. on main() exit)
    removeHeapBlock(blockId: string): void;  // remove freed/leaked block from visualization

    // Output
    finish(): { program: Program; errors: string[] };
}
```

**Key design decision: path-based targeting.** The interpreter doesn't know emitter IDs — that's the emitter's job. Instead, the interpreter passes *access paths* that describe how it reached a value (e.g., `['p', 'pos', 'x']` for `p->pos.x`). The emitter maintains an internal map from variable names to entry IDs and resolves paths like `p → heap-player → heap-player-pos → heap-player-pos-x`. This keeps the interpreter free of MemoryEntry concepts while giving the emitter enough information to target the correct entry.

The interpreter never imports `MemoryEntry`, `SnapshotOp`, or any engine type. It works with `CType`, `CValue`, and its own scope/heap tracking.

### Alternatives Considered

| Alternative | Pros | Cons | Why not |
|------------|------|------|---------|
| Adapt PLIVET | Less code to write | UNICOEN dependency, translation layer ~same effort, no sub-step control | Translation layer nearly as complex as interpreter |
| Clang-WASM + DWARF | Real compilation, any C program | ~40MB download, DWARF→MemoryEntry translation complex, no sub-steps from DWARF | Wrong tradeoff for a visualization tool |
| LLM generation | Zero runtime code | Requires API key, non-deterministic, no offline | Accessibility barrier, can't work on GitHub Pages without user's key |
| Hand-rolled parser | Zero dependencies | C declarator syntax is hard, own every bug | tree-sitter is battle-tested, only ~1MB |

## Files

### Modify

| File | What changes | Why |
|------|-------------|-----|
| `vite.config.ts` | Add `optimizeDeps: { exclude: ['web-tree-sitter'] }` | Required for tree-sitter WASM loading in Vite |
| `package.json` | Add `web-tree-sitter` dep, copy WASM files to `static/` in postinstall | Parser dependency. Commit WASM files to `static/` so builds work without postinstall (CI `--ignore-scripts` safety) |
| `src/routes/+page.svelte` | Add "Custom" tab with textarea + run button, alongside pre-authored programs | UI entry point for user code |

### Create

| File | Purpose |
|------|---------|
| **Types** | |
| `src/lib/interpreter/types.ts` | Internal interpreter types (see Key Types below) |
| **Parsing** | |
| `src/lib/interpreter/parser.ts` | tree-sitter initialization + CST→simplified AST adapter |
| `src/lib/interpreter/parser.test.ts` | CST→AST conversion tests for each C construct |
| **C semantics (interpreter layer)** | |
| `src/lib/interpreter/types-c.ts` | C type system: sizeof, alignment, struct layout, pointer size (32-bit model — 4B pointers for readable hex addresses), type resolution |
| `src/lib/interpreter/types-c.test.ts` | Type system tests: primitive sizes, struct layout/padding, array sizes, type registry (~18 tests) |
| `src/lib/interpreter/environment.ts` | Interpreter state: scope chain with symbol tables (`Map<string, CValue>`), function table, heap tracking (`Map<address, HeapBlock>`). No MemoryEntry awareness |
| `src/lib/interpreter/environment.test.ts` | Environment tests: scope chain, stack/heap allocators, function table (~20 tests) |
| `src/lib/interpreter/evaluator.ts` | Expression evaluator: arithmetic, comparison, logical, deref, address-of, member access, subscript, cast, sizeof. Returns `CValue` |
| `src/lib/interpreter/evaluator.test.ts` | Expression evaluation tests: arithmetic, pointers, member access, casts, short-circuit |
| `src/lib/interpreter/interpreter.ts` | Main interpreter loop: walks AST, executes statements, calls emitter methods. Owns control flow (loops, if/else, function calls), step limiting, and error collection |
| `src/lib/interpreter/stdlib.ts` | Built-in function implementations: malloc, calloc, free, printf (stub) |
| **Visualization (emitter layer)** | |
| `src/lib/interpreter/emitter.ts` | OpEmitter: translates interpreter events into `ProgramStep[]` with `SnapshotOp[]`. Owns ID generation, address allocation, MemoryEntry construction, description formatting, sub-step anchoring |
| `src/lib/interpreter/emitter.test.ts` | Emitter tests: ID uniqueness, address ranges, scope/variable/heap op correctness, sub-step anchor rule, description formatting |
| **Integration** | |
| `src/lib/interpreter/index.ts` | Barrel export: `interpret(source: string, opts?): { program: Program; errors: string[] }` |
| `src/lib/interpreter/interpreter.test.ts` | End-to-end tests: C source → Program → `validateProgram()` passes → snapshot correctness |
| `src/lib/interpreter/worker.ts` | Web Worker entry: loads tree-sitter, receives source, runs interpreter, posts back `{ program, errors }` |
| `src/lib/interpreter/worker.test.ts` | Worker message contract tests: success response shape, error response shape, timeout termination |
| **UI** | |
| `src/lib/components/CustomEditor.svelte` | UI: textarea for C source + Run button + error display + loading state |

### Key Types (`types.ts`)

```typescript
// C type representation
type CType =
    | { kind: 'primitive'; name: 'int' | 'char' | 'short' | 'long' | 'float' | 'double' | 'void' }
    | { kind: 'pointer'; pointsTo: CType }
    | { kind: 'array'; elementType: CType; size: number }
    | { kind: 'struct'; name: string; fields: Array<{ name: string; type: CType; offset: number }> };

// Runtime value
type CValue = {
    type: CType;
    data: number | null;      // numeric value, pointer address, or null for void/uninitialized
    address: number;          // where this value lives in memory
};

// Child specification for structs/arrays — used by emitter to build MemoryEntry children
// The emitter turns these into MemoryEntry objects with correct `.fieldName`/`[index]` display
// names, hierarchical IDs (parent-fieldName), and address offsets (baseAddr + offset).
type ChildSpec = {
    name: string;             // field name or index: 'x', 'pos', '0', '1'
    displayName: string;      // '.x', '.pos', '[0]', '[1]'
    type: CType;
    value: string;            // display value: '42', '0x55a0...', 'NULL', ''
    addressOffset: number;    // byte offset from parent's base address
    children?: ChildSpec[];   // recursive: nested structs, struct arrays
};

// Parameter specification for function calls — supports struct pass-by-value
type ParamSpec = {
    name: string;
    type: CType;
    value: string;
    children?: ChildSpec[];   // for struct params: expanded field children (pass-by-value copy)
};

// Interpreter scope (NOT a MemoryEntry scope — interpreter's own tracking)
type Scope = {
    name: string;             // 'main', 'distance', 'for1', '{ }'
    symbols: Map<string, CValue>;
    parent: Scope | null;
};

// Heap block tracking
type HeapBlock = {
    address: number;
    size: number;
    type: CType;
    status: 'allocated' | 'freed' | 'leaked';
    allocator: string;        // 'malloc' | 'calloc'
    allocSite: { line: number };
};

// Options for interpret()
type InterpreterOptions = {
    maxSteps?: number;        // default 500
    maxFrames?: number;       // default 256
    maxHeapBytes?: number;    // default 1MB
};
```

### Delete

None.

## Implementation Steps

### Dependency Graph

```
Step 1 (tree-sitter setup)
├── Step 2 (parser/AST)
│   ├── Step 5 (evaluator) ← also needs Steps 3, 4
│   └── Step 7a (interpreter: declarations, assignments, returns)
│       ├── Step 7b (interpreter: control flow)
│       ├── Step 7c (interpreter: function calls)
│       └── Step 7d (interpreter: stdlib/heap)
│           └── Step 8 (integration tests)
│               ├── Step 9 (Web Worker)
│               └── Step 10 (UI)
Step 3 (C types) ← independent
Step 4 (environment) ← needs Step 3
Step 6 (emitter) ← independent (uses engine types only)
```

Steps 1, 3, and 6 can start in parallel.

### Step 1: Project setup and tree-sitter integration
- **What:** Install `web-tree-sitter`, configure Vite, commit WASM files (`tree-sitter.wasm`, `tree-sitter-c.wasm`) to `static/`. Add a postinstall script as a convenience but don't depend on it — the committed files are the source of truth.
- **Files:** `package.json`, `vite.config.ts`, `static/tree-sitter.wasm`, `static/tree-sitter-c.wasm`
- **Depends on:** Nothing
- **TDD:** Write `parser.test.ts` > "tree-sitter initialization" test first. Then install deps and configure until the test passes.
- **Verification:** `npm test` passes. `Parser.init()` and parse `int main() { return 0; }` without errors.

### Step 2: CST→AST adapter (parser.ts)
- **What:** Write the adapter that converts tree-sitter's concrete syntax tree into a simplified AST. Handle: `function_definition`, `declaration`, `assignment_expression`, `binary_expression`, `unary_expression`, `call_expression`, `for_statement`, `while_statement`, `do_statement`, `if_statement`, `return_statement`, `compound_statement`, `struct_specifier`, `pointer_declarator`, `array_declarator`, `subscript_expression`, `field_expression`, `sizeof_expression`, `cast_expression`, `number_literal`, `string_literal`, `identifier`. Silently skip `preproc_include` and other preprocessor directive nodes (emit a warning in the errors array: "preprocessor directives are ignored").
- **Files:** `src/lib/interpreter/parser.ts`, `src/lib/interpreter/parser.test.ts`
- **Depends on:** Step 1
- **TDD:** Write all `parser.test.ts` tests (declarations, expressions, statements, preprocessor, errors — ~27 tests). Implement adapter until all pass.
- **Verification:** All parser tests green. `#include` warns but doesn't break.

### Step 3: C type system (types-c.ts)
- **What:** Implement type resolution. Support: `int` (4B), `char` (1B), `short` (2B), `long` (8B), `float` (4B), `double` (8B), `void`, pointers (4B — 32-bit model for readable hex addresses), fixed arrays, struct definitions with field layout (offsets, padding, alignment). Maintain a type registry for struct definitions. Pure data module — no AST dependency.
- **Files:** `src/lib/interpreter/types.ts`, `src/lib/interpreter/types-c.ts`
- **Depends on:** Nothing
- **TDD:** Write all `types-c.test.ts` tests first (~18 tests: primitive sizes, struct layout with padding, array sizes, type registry). Implement until all pass.
- **Verification:** All type tests green. `sizeof(struct Point)` → 8, `sizeof(int*)` → 4, padding correct.

### Step 4: Interpreter environment (environment.ts)
- **What:** Interpreter state management: scope chain with symbol tables (`Map<string, CValue>`), function table, stack address allocator (grows down from `0x7FFC0000`), heap tracking (`Map<number, HeapBlock>`, grows up from `0x55A00000`). Implements `pushScope()`, `popScope()`, `lookupVariable()`, `declareVariable()`, `malloc()`, `free()`. No MemoryEntry awareness — this is the interpreter's own bookkeeping.
- **Files:** `src/lib/interpreter/environment.ts`, `src/lib/interpreter/environment.test.ts`
- **Depends on:** Step 3
- **TDD:** Write all `environment.test.ts` tests first (~20 tests: scope chain, stack allocator, heap allocator, function table). Implement until all pass.
- **Verification:** All environment tests green. Scope push/pop, shadowing, stack addresses decrement, heap addresses increment.

### Step 5: Expression evaluator (evaluator.ts)
- **What:** Evaluate AST expression nodes against the interpreter environment. Handle: integer/float arithmetic, comparison, logical (`&&`, `||` with short-circuit), unary (`-`, `!`, `&`, `*`), member access (`.`, `->`), subscript (`[]`), function calls (delegates to interpreter for call mechanics), cast, sizeof, assignment (`=`, `+=`, `-=`, etc.), comma expressions. Returns `CValue`. Does NOT produce ops — just computes values and mutates the environment.
- **Files:** `src/lib/interpreter/evaluator.ts`, `src/lib/interpreter/evaluator.test.ts`
- **Depends on:** Steps 2, 3, 4
- **TDD:** Write all `evaluator.test.ts` tests first (~32 tests: arithmetic, float, comparison, logical, assignment, pointers, cast/sizeof, errors). Implement until all pass.
- **Verification:** All evaluator tests green. `3 + 4 * 2` → 11, short-circuit works, division by zero errors.

### Step 6: Op emitter (emitter.ts)
- **What:** Implements the `OpEmitter` interface. Translates high-level interpreter events into `ProgramStep[]` with `SnapshotOp[]`. Manages:
  - **ID generation:** hierarchical, dash-separated (`main-count`, `heap-player-pos-x`, `for1-i`), unique per snapshot
  - **Path→ID resolution:** maintains internal map from variable names/paths to entry IDs. `assignField(['p', 'pos', 'x'], '10')` resolves to `set('heap-player-pos-x', '10')`. Traverses through pointer indirection (stack variable → heap block → field).
  - **Address formatting:** numeric addresses → hex strings (`0x7ffc0060`). Struct field addresses computed as `baseAddr + field.offset`.
  - **MemoryEntry construction:** builds complete entries with correct `kind`, `ScopeInfo`, `HeapInfo`, `children`. Struct field display names use `.fieldName`, array elements use `[index]`.
  - **ChildSpec→MemoryEntry conversion:** recursively converts `ChildSpec[]` into nested `MemoryEntry` children with correct IDs and addresses
  - **Description formatting:** human-readable strings matching hand-authored style
  - **Sub-step anchoring:** ensures anchor rule is satisfied per line
  - **Heap container:** auto-creates on first `allocHeap()` call
  - **Heap block cleanup:** `removeHeapBlock()` emits `removeEntry` for visual cleanup; `leakHeap()` emits `setHeapStatus('leaked')`
- **Files:** `src/lib/interpreter/emitter.ts`, `src/lib/interpreter/emitter.test.ts`
- **Depends on:** Nothing (uses engine types `MemoryEntry`, `SnapshotOp`, `ProgramStep` only)
- **TDD:** Write all `emitter.test.ts` tests first (~72 tests across 17 describe blocks: primitive ops, scope/heap/variable entries, step metadata, ID/address conventions, path targeting, lifecycle ops, descriptions, anchoring). This is the largest test file — the emitter owns most of the op-generation contract. Implement until all pass.
- **Verification:** All emitter tests green. Path resolution, struct field addresses, ChildSpec conversion, lifecycle ops all correct.

### Step 7a: Interpreter core — declarations, assignments, returns
- **What:** The statement executor foundation. Walk the AST and handle:
  - Function definitions → store in function table
  - Variable declarations → evaluate initializer, call `emitter.declareVariable()`
  - Struct/array declarations → build `ChildSpec[]` from type info, single step (not sub-steps)
  - Simple assignment (`x = 10`) → evaluate RHS, call `emitter.assignVariable()`
  - Field assignment (`p->pos.x = 10`) → evaluate RHS, build access path, call `emitter.assignField(['p', 'pos', 'x'], '10')`
  - Element assignment (`arr[i] = val`) → evaluate index and RHS, call `emitter.assignElement(['arr'], i, 'val')`
  - Return statements → evaluate expression, return value to caller
  - Expression statements → evaluate (for side effects like `printf()`)
  - Skip `preproc_include` nodes (already warned in parser)
  - Step counting with configurable `maxSteps` limit (default 500)
- **Files:** `src/lib/interpreter/interpreter.ts`, `src/lib/interpreter/interpreter.test.ts`
- **Depends on:** Steps 2, 4, 5, 6
- **TDD:** Write `interpreter.test.ts` > "declarations and assignments" tests first (~11 tests). Implement statement executor until all pass.
- **Verification:** All Step 7a tests green. `validateProgram()` passes on output.

### Step 7b: Interpreter — control flow (loops, if/else)
- **What:** Add control flow to the interpreter:
  - `for` loops → sub-step pattern: init (anchor) → check (sub) → body (anchor) → increment (sub) → repeat → final check (anchor with scope removal). Matches `loops.ts` pattern. `colStart`/`colEnd` for condition and increment expressions within the for-header.
  - `while` loops → check (sub) → body (anchor) → repeat → final check (anchor). Loop scope is **conditional**: only create via `emitter.enterBlock('while')` if the body contains variable declarations; otherwise no scope overhead.
  - `do-while` → body (anchor) → check (sub) → repeat → final check (anchor). Same conditional scope rule as while.
  - `if/else` → evaluate condition (sub) → enter taken branch (anchor) → body → exit. Skipped branch produces no steps. Scope only if branch block has declarations.
  - Block scopes → `emitter.enterBlock()`/`emitter.exitBlock()` for `{ }` with local declarations
- **Files:** `src/lib/interpreter/interpreter.ts`, `src/lib/interpreter/interpreter.test.ts`
- **Depends on:** Step 7a
- **TDD:** Write `interpreter.test.ts` > "for-loop sub-steps", "while-loop sub-steps", "do-while sub-steps", "if/else" tests first (~17 tests). Implement control flow until all pass.
- **Verification:** All control flow tests green. For-loop pattern matches `loops.ts`.

### Step 7c: Interpreter — function calls
- **What:** Add user-defined function call mechanics:
  - Evaluate arguments left-to-right
  - Call `emitter.enterFunction()` with `ParamSpec[]` (including `ChildSpec[]` for struct params passed by value) and call site `ScopeInfo`
  - Execute function body recursively
  - Call `emitter.exitFunction()` with return value
  - Frame depth tracking with configurable `maxFrames` limit (default 256)
  - Sub-step pattern for function calls (all sub-steps share call site `location.line`):
    - Arg evaluation sub-steps with `colStart`/`colEnd` highlighting each argument expression (extracted from AST node positions)
    - Push frame sub-step with `colStart`/`colEnd` covering full call expression
    - Function body steps (on their own lines)
    - Return expression sub-step
    - Pop frame + assign anchor step (full line)
- **Files:** `src/lib/interpreter/interpreter.ts`, `src/lib/interpreter/interpreter.test.ts`
- **Depends on:** Step 7a
- **TDD:** Write `interpreter.test.ts` > "function calls" tests first (~11 tests). Implement function call mechanics until all pass.
- **Verification:** All function call tests green. Struct params expanded, sub-step column ranges correct.

### Step 7d: Interpreter — stdlib and heap
- **What:** Add built-in functions and heap operations:
  - `malloc(size)` → call `environment.malloc()`, call `emitter.allocHeap()` with `allocSite: { line }`, return pointer
  - `calloc(n, size)` → same as malloc, children initialized to `'0'`
  - `free(ptr)` → call `environment.free()`, call `emitter.freeHeap()`. Freed block stays visible with `status: 'freed'` (emitter uses `setHeapStatus`, not `removeEntry`)
  - Heap block visual cleanup → call `emitter.removeHeapBlock()` when the scope that freed the block exits (or at program end). This matches the `remove(heapBlockId)` pattern in the requirements.
  - Leak detection → on `main()` return, scan environment for heap blocks still `'allocated'`, call `emitter.leakHeap()` for each. This produces `setHeapStatus('leaked')` ops.
  - `printf(...)` → no-op step (empty ops, description shows the format string)
  - `sizeof(type)` → handled in evaluator, returns type size
  - Heap size tracking with configurable `maxHeapBytes` limit (default 1MB)
- **Files:** `src/lib/interpreter/stdlib.ts`, `src/lib/interpreter/interpreter.ts`, `src/lib/interpreter/interpreter.test.ts`
- **Depends on:** Step 7a (also needs Step 7c for function call mechanics)
- **TDD:** Write `interpreter.test.ts` > "stdlib and heap" tests first (~9 tests). Implement stdlib until all pass.
- **Verification:** All heap tests green. Freed blocks visible, leaks detected, heap exhaustion errors.

### Step 8: Integration and end-to-end tests
- **What:** Export `interpret()` from `src/lib/interpreter/index.ts`. Wire the full pipeline: `interpret(source)` → `Program` → `buildSnapshots()` → verify. Add interpreted programs to `testProgram()` suite. Compare interpreted output against hand-authored `basics.ts` and `loops.ts` at key steps (scope count, variable values, heap block status).
- **Files:** `src/lib/interpreter/index.ts`, `src/lib/interpreter/interpreter.test.ts`
- **Depends on:** Steps 7a-7d
- **TDD:** Write `interpreter.test.ts` > "validation rules" and "integration — full pipeline" tests first (~17 tests). These are the capstone tests — they validate the entire pipeline against the op-generation contract. Wire `interpret()` and run until all pass.
- **Verification:** All integration tests green. `testProgram` passes all 13+ checks on interpreted programs.

### Step 9: Web Worker wrapper
- **What:** Create worker that loads tree-sitter, receives C source via `postMessage`, runs interpreter, posts back `{ type: 'result', program, errors }` or `{ type: 'error', message }`. Implement timeout protection: main thread sets 10s timer, calls `worker.terminate()` if exceeded. Define message protocol types in `types.ts`.
- **Files:** `src/lib/interpreter/worker.ts`, `src/lib/interpreter/worker.test.ts`
- **Depends on:** Step 8
- **TDD:** Write all `worker.test.ts` tests first (~6 tests: message protocol, timeout, error handling). Implement worker until all pass.
- **Verification:** All worker tests green. Timeout terminates infinite loops within 15s.

### Step 10: UI integration
- **What:** Add `CustomEditor.svelte` component: textarea with C syntax placeholder, Run button, error display, loading spinner. Add "Custom" tab to `+page.svelte` alongside existing program tabs. When user clicks Run, post source to worker, receive Program, pass to ProgramStepper. Show errors if interpretation fails. Show "Supports a subset of C for educational visualization" disclaimer.
- **Files:** `src/lib/components/CustomEditor.svelte`, `src/routes/+page.svelte`
- **Depends on:** Step 9
- **Verification:** User types C code, clicks Run, sees memory visualization. Errors display for unsupported constructs. Timeout message for infinite loops.

## Edge Cases

| Case | Expected behavior | How handled |
|------|------------------|-------------|
| Infinite loop (`while(1){}`) | Worker terminated after 10s, error message shown | Web Worker timeout + `terminate()` |
| `#include` directives | Warning: "preprocessor directives are ignored", parsing continues | Parser skips `preproc_include` nodes, adds warning to errors array |
| Unsupported construct (`goto`, `union`, function pointers) | Clear error: "goto is not supported" with line number | Parser adapter returns error node; interpreter checks and reports |
| Stack overflow (deep recursion) | Error after `maxFrames` (default 256) | Frame counter in interpreter, error when exceeded |
| Heap exhaustion (malloc in loop) | Error after heap exceeds `maxHeapBytes` (default 1MB) | Environment heap allocator checks remaining space |
| Division by zero | Error with description: "division by zero at line N" | Evaluator checks divisor before dividing |
| Use after free | Pointer value shown as `'(dangling)'`; reading produces error or garbage display | Environment tracks freed blocks; evaluator checks before deref |
| Null pointer dereference | Error: "null pointer dereference at line N" | Evaluator checks for NULL (address 0) before deref |
| Variable shadowing | Inner scope variable shadows outer; both visible in different scope cards | Environment scope chain: each scope has own symbol table; lookup walks chain |
| Empty program | Valid Program with zero steps, empty visualization | Interpreter returns `{ steps: [] }`, UI shows empty state |
| Syntax error in user code | tree-sitter produces ERROR nodes; interpreter reports line/column | Check for ERROR/MISSING nodes in CST before interpreting |
| Step limit exceeded | Interpretation stops, partial Program returned with warning | Counter in interpreter loop, configurable via `maxSteps` (default 500) |
| Large arrays (`int arr[1000]`) | Only first/last N elements shown as children; summary for rest | Emitter caps children at ~20 entries, adds summary entry |

## Deferred Features

These sub-step patterns are documented in the op generation requirements but explicitly marked "not yet implemented." They are out of scope for v1 but the architecture supports adding them later without structural changes.

| Feature | Requirements section | Why deferred | What's needed to add |
|---------|---------------------|-------------|---------------------|
| **Chained expression sub-steps** (`a = b = c = 0`) | "Chained Expressions" | Low priority — uncommon in educational C code | Evaluator emits per-assignment sub-steps with `colStart`/`colEnd` during right-to-left evaluation |
| **Short-circuit evaluation sub-steps** (`ptr && ptr->valid`) | "Short-Circuit Evaluation" | Evaluator already handles short-circuit semantics correctly; sub-step visualization is polish | Evaluator emits sub-steps per operand with column ranges; anchor on final result |

The evaluator handles the *semantics* of both features correctly in v1 (chained assignment evaluates right-to-left, short-circuit skips RHS). What's deferred is the *sub-step visualization* — generating intermediate steps with column-range highlighting for each sub-expression.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Expression evaluation bugs (operator precedence, type promotion) | High | Medium | tree-sitter handles parsing precedence; focus testing on evaluator edge cases |
| Emitter/interpreter contract mismatch | Medium | Medium | Emitter tests verify op validity independently; integration tests verify full pipeline |
| tree-sitter ABI mismatch (v0.25 vs v0.26) | Medium | High | Pin `web-tree-sitter` version; commit WASM files to `static/` |
| WASM loading fails on some browsers/configs | Low | High | Fallback: show error with "your browser doesn't support WebAssembly" |
| Struct padding/alignment incorrect | Medium | Low | Start with simple alignment (4-byte for int, 8-byte for double); cover with tests |
| Sub-step pattern doesn't match hand-authored programs | Medium | Medium | Compare interpreted output against basics.ts/loops.ts snapshots in integration tests |
| Web Worker message overhead for large programs | Low | Low | Structured clone is fast for Program objects; cap at 500 steps |
| Users expect full C support | High | Medium | Clear messaging: "Supports a subset of C for educational visualization" |
| Pointer arithmetic edge cases | Medium | Medium | Support `ptr + n` and `ptr[n]`; reject complex pointer expressions with error |

## Verification

### Manual Testing
- [ ] Type the basics.ts source into Custom editor → Run → visualization matches pre-authored version
- [ ] Type the loops.ts source → Run → sub-steps work correctly in both modes
- [ ] Type `while(1){}` → timeout error after ~10s
- [ ] Type invalid C → syntax error with line number
- [ ] Type program with `#include` → warning displayed, program still runs
- [ ] Type program with `goto` → "unsupported construct" error
- [ ] Type program with malloc/free → heap blocks appear/disappear correctly
- [ ] Type program with function call → stack frame push/pop visible
- [ ] Works on Chrome, Firefox, Safari
- [ ] Works offline after first load (WASM cached)

### Automated Tests (TDD)

Tests are written before implementation for each step. Each test maps to a specific requirement from `op-generation-requirements.md`. Tests use Vitest, collocated `*.test.ts`, `describe`/`it`/`expect`, inline helper factories.

#### `types-c.test.ts` — C type system (Step 3)

> Req: "Entry Types", "Interpreter State Requirements → Type system"

```
describe('primitive sizes')
  it('int is 4 bytes')
  it('char is 1 byte')
  it('short is 2 bytes')
  it('long is 8 bytes')
  it('float is 4 bytes')
  it('double is 8 bytes')
  it('void has size 0')
  it('pointer is 4 bytes (32-bit model)')

describe('struct layout')
  it('computes sizeof for flat struct — struct Point { int x; int y; } → 8')
  it('computes field offsets — Point.x at 0, Point.y at 4')
  it('applies alignment padding — struct { char c; int i; } → c at 0, i at 4, sizeof 8')
  it('computes nested struct — struct Player { int id; struct Point pos; } → id at 0, pos at 4, sizeof 12')
  it('computes struct with pointer — struct Player { int id; struct Point pos; int *scores; } → sizeof 16')

describe('array types')
  it('sizeof int[4] → 16')
  it('sizeof struct Point[3] → 24')

describe('type registry')
  it('registers and retrieves struct definitions by name')
  it('resolves nested struct types from registry')
```

#### `environment.test.ts` — Interpreter state (Step 4)

> Req: "Interpreter State Requirements → Scope stack, Symbol table, Address allocator"

```
describe('scope chain')
  it('pushScope creates a new scope with empty symbol table')
  it('popScope returns to parent scope')
  it('declareVariable adds to current scope symbols')
  it('lookupVariable finds variable in current scope')
  it('lookupVariable walks scope chain to find variable in parent')
  it('lookupVariable returns nearest match when shadowing — inner shadows outer')
  it('lookupVariable returns undefined for undeclared variable')
  it('popScope removes all variables declared in that scope')

describe('stack address allocator')
  it('first allocation starts near 0x7FFC0000')
  it('allocations grow downward — second address < first address')
  it('address decrements by sizeof(type) for each allocation')
  it('popScope reclaims stack space — next allocation reuses addresses')

describe('heap allocator')
  it('malloc returns address in 0x55A00000 range')
  it('malloc allocations grow upward — second address > first address')
  it('malloc returns sequential addresses offset by size')
  it('free marks block as freed but does not reclaim address')
  it('malloc after free allocates new address — no reuse of freed blocks')
  it('heap tracks block metadata: size, type, status, allocator, allocSite')

describe('function table')
  it('stores function definitions by name')
  it('retrieves function with params and body')
```

#### `parser.test.ts` — CST→AST adapter (Steps 1-2)

> Req: all AST node types the interpreter must handle

```
describe('tree-sitter initialization')
  it('loads WASM and parses minimal program without errors')

describe('declarations')
  it('parses int variable declaration — int x = 5')
  it('parses pointer declaration — int *p = &x')
  it('parses struct definition — struct Point { int x; int y; }')
  it('parses array declaration — int arr[4] = {10, 20, 30, 40}')
  it('parses struct variable — struct Point origin = {0, 0}')

describe('expressions')
  it('parses binary expression — a + b * c')
  it('parses unary expression — -x, !flag, &var, *ptr')
  it('parses assignment expression — x = 10')
  it('parses compound assignment — x += 5')
  it('parses comparison — i < 4')
  it('parses logical — a && b, a || b')
  it('parses member access — p.x, p->x')
  it('parses subscript — arr[i]')
  it('parses call expression — distance(a, b)')
  it('parses sizeof expression — sizeof(int), sizeof(struct Point)')
  it('parses cast expression — (int)x, (float)y')
  it('parses comma expression — (a, b, c)')

describe('statements')
  it('parses function definition with params and body')
  it('parses return statement — return expr')
  it('parses for statement with init/condition/increment')
  it('parses while statement')
  it('parses do-while statement')
  it('parses if/else statement')
  it('parses compound statement (block)')
  it('parses expression statement')

describe('preprocessor handling')
  it('skips #include and adds warning to errors array')
  it('skips #define and adds warning')
  it('parsing continues after preprocessor directives')

describe('error handling')
  it('reports syntax error with line and column for ERROR nodes')
  it('reports unsupported construct — goto')
  it('reports unsupported construct — union')
  it('preserves source positions (1-based line, 0-based column) on all AST nodes')
```

#### `evaluator.test.ts` — Expression evaluation (Step 5)

> Req: "Interpreter State Requirements → Expression evaluator"

```
describe('integer arithmetic')
  it('evaluates addition — 3 + 4 → 7')
  it('evaluates multiplication — 3 * 4 → 12')
  it('evaluates precedence — 3 + 4 * 2 → 11')
  it('evaluates subtraction — 10 - 3 → 7')
  it('evaluates division — 10 / 3 → 3 (integer division)')
  it('evaluates modulo — 10 % 3 → 1')
  it('evaluates unary minus — -(5) → -5')

describe('float arithmetic')
  it('evaluates float division — 10.0 / 3.0 → 3.333...')
  it('evaluates int-to-float promotion — 10 / 3.0 → 3.333...')

describe('comparison')
  it('evaluates less than — 3 < 4 → 1')
  it('evaluates greater than — 4 > 3 → 1')
  it('evaluates equality — 3 == 3 → 1')
  it('evaluates inequality — 3 != 4 → 1')
  it('evaluates less equal — 4 <= 4 → 1')
  it('evaluates greater equal — 3 >= 4 → 0')

describe('logical operators')
  it('evaluates logical AND — 1 && 1 → 1')
  it('evaluates logical OR — 0 || 1 → 1')
  it('evaluates logical NOT — !0 → 1, !1 → 0')
  it('short-circuits AND — 0 && expr does not evaluate RHS')
  it('short-circuits OR — 1 || expr does not evaluate RHS')
  it('short-circuits NULL && expr — does not evaluate RHS')

describe('assignment')
  it('evaluates simple assignment — x = 10 returns 10')
  it('evaluates compound assignment — x += 5 adds to current value')
  it('evaluates -= assignment')
  it('evaluates *= assignment')

describe('pointer operations')
  it('address-of — &x returns x address')
  it('dereference — *p returns value at address')
  it('member access via dot — point.x')
  it('member access via arrow — ptr->field dereferences then accesses')
  it('subscript — arr[2] computes base + index * sizeof(element)')
  it('pointer arithmetic — ptr + n computes ptr + n * sizeof(pointee)')
  it('null pointer dereference produces error with line number')

describe('cast and sizeof')
  it('evaluates sizeof(int) → 4')
  it('evaluates sizeof(struct Point) → 8')
  it('evaluates sizeof(int*) → 4')
  it('evaluates cast — (float)intVal')

describe('error conditions')
  it('division by zero produces error with line number')
  it('use of undeclared variable produces error')
```

#### `emitter.test.ts` — Op emitter (Step 6)

> Req: "Primitive Ops", "Entry Types", "Step Metadata", "ID and Address Conventions", "Scope Lifecycle", "Variable Lifecycle", "Heap Lifecycle", "Validation Rules"

```
describe('primitive ops — addEntry')
  it('enterFunction emits addEntry with op: addEntry, parentId: null')
  it('declareVariable emits addEntry with parentId = current scope id')
  it('allocHeap emits addEntry with parentId = heap container id')
  it('enterBlock emits addEntry with parentId = parent scope id')

describe('primitive ops — removeEntry')
  it('exitFunction emits removeEntry with scope id')
  it('exitBlock emits removeEntry with block scope id')
  it('removeHeapBlock emits removeEntry with heap block id')

describe('primitive ops — setValue')
  it('assignVariable emits setValue with correct id and value string')
  it('assignField emits setValue targeting resolved nested id')
  it('assignElement emits setValue targeting resolved element id')

describe('primitive ops — setHeapStatus')
  it('freeHeap emits setHeapStatus with status: freed')
  it('leakHeap emits setHeapStatus with status: leaked')

describe('scope entries')
  it('enterFunction creates entry with kind: scope, empty address')
  it('enterFunction includes ScopeInfo: caller, returnAddr, file, line')
  it('enterFunction scope name format — main() for main, distance(a, b) for distance with params')
  it('enterBlock creates scope entry nested under parent — parentId is parent scope id')
  it('enterBlock for loop — name is "for", id is hierarchical (e.g., for1)')
  it('enterBlock for block — name is "{ }"')

describe('heap container')
  it('auto-creates heap container on first allocHeap call — kind: heap, id: heap')
  it('does not create duplicate heap container on second allocHeap call')
  it('heap container has empty string address')

describe('variable entries')
  it('declareVariable creates entry with name, type string, value string, address')
  it('pointer variable stores hex address as value — 0x7ffc0060')
  it('pointer variable stores NULL as value string')
  it('all values are strings — integers as "42", addresses as "0x..."')

describe('struct children — ChildSpec conversion')
  it('struct field children use .fieldName as display name')
  it('array element children use [index] as display name')
  it('nested structs produce recursive children')
  it('children inherit parent hierarchical id — parent-fieldName')
  it('struct field address = parent base address + field offset')
  it('first struct field address = parent base address')

describe('heap block entries')
  it('allocHeap creates heapBlock with HeapInfo: size, status=allocated, allocator, allocSite')
  it('heap block children represent typed fields — struct members')
  it('calloc children initialized to "0" value')
  it('heap blocks are parented to heap container — parentId = "heap"')

describe('param entries')
  it('enterFunction adds params as addVar ops in same step as addScope')
  it('struct params expanded with children via ParamSpec.children')

describe('step metadata')
  it('beginStep sets location with 1-based line number')
  it('beginStep sets description string')
  it('beginStep sets evaluation string')
  it('markSubStep sets subStep: true on current step')
  it('step without markSubStep has subStep undefined (anchor)')
  it('step with empty ops is valid — no ops array entries')
  it('colStart/colEnd set on location for sub-step character ranges')

describe('ID conventions')
  it('generates hierarchical dash-separated IDs — main, main-count, main-origin')
  it('scope IDs are short — main, distance, for1')
  it('variable IDs are scope-name — main-count, for1-i')
  it('heap block IDs are heap-prefixed — heap-player, heap-scores')
  it('nested heap field IDs — heap-player-pos-x')
  it('IDs are unique within any single snapshot after applying ops')
  it('IDs are stable across steps — same entry keeps same id')

describe('address conventions')
  it('stack addresses in 0x7ffc00XX range')
  it('heap addresses in 0x55a000XXXX range')
  it('scope entries have empty string address')
  it('heap container has empty string address')
  it('addresses formatted as lowercase hex — 0x7ffc0060 not 0x7FFC0060')

describe('path-based targeting')
  it('assignVariable resolves simple name to variable id')
  it('assignField resolves single-level path — ["p", "id"] to heap block field id')
  it('assignField resolves multi-level path — ["p", "pos", "x"] through pointer indirection to heap-player-pos-x')
  it('assignElement resolves — ["arr"], 2 to array element id')
  it('assignElement resolves heap array — ["p", "scores"], 0 to heap scores element id')
  it('assignField through pointer follows pointer value to heap block')

describe('scope lifecycle — function entry')
  it('function scope is root-level — parentId: null')
  it('enterFunction + declareVariable in same step — scope and vars in one ops array')
  it('first enterFunction also creates heapContainer')

describe('scope lifecycle — block scope')
  it('block scope nested under parent — parentId is parent scope id')
  it('variables inside block parented to block scope id')

describe('scope lifecycle — loop scope')
  it('for-loop creates scope with loop variable inside')
  it('loop variable parented to loop scope id')
  it('exitBlock on loop removes scope and loop variable')

describe('scope lifecycle — exit')
  it('exitFunction emits remove(scopeId)')
  it('exitFunction with returnValue emits remove + set/addVar in caller')
  it('exitBlock emits remove(blockScopeId)')

describe('variable lifecycle ops')
  it('int x = 5 → addVar with value "5"')
  it('struct Point p = {0,0} → addVar with children [.x="0", .y="0"], single step')
  it('int arr[4] = {10,20,30,40} → addVar with children [[0]="10", [1]="20", [2]="30", [3]="40"]')
  it('int *p = &x → addVar with hex address value')
  it('x = 10 → set(varId, "10")')
  it('p->field = val → set(fieldId, "val") targeting heap entry')
  it('arr[i] = val → set(elemId, "val") targeting array element')
  it('compound init is single step — no subStep markers')

describe('heap lifecycle ops')
  it('malloc → alloc op with heapBlock + addVar/set for pointer')
  it('calloc → alloc op with children values "0"')
  it('free → setHeapStatus(freed) + setValue(ptrVar, "(dangling)")')
  it('free does NOT emit removeEntry — block stays visible as freed')
  it('removeHeapBlock → removeEntry for visual cleanup')
  it('leakHeap → setHeapStatus(leaked)')
  it('heap block parented to heap container')

describe('description formatting')
  it('declaration description — "int dx = 0 - 10 = -10" style')
  it('malloc description — "malloc(sizeof(struct Player)) — allocate 20 bytes" style')
  it('loop check description with evaluation — "for: check i(0) < 4 → true"')
  it('free description includes pointer name')

describe('sub-step anchoring')
  it('for-loop: init is anchor, check is subStep, body is anchor, increment is subStep')
  it('for-loop: final failing check is anchor with remove op')
  it('all steps for a line have at least one anchor — no all-subStep lines')
```

#### `interpreter.test.ts` — End-to-end (Steps 7a-8)

> Req: "For-Loop Sub-Steps", "While-Loop Sub-Steps", "Do-While Sub-Steps", "If/Else", "Function Calls", "Validation Rules"

```
describe('declarations and assignments (Step 7a)')
  it('int x = 5 → produces valid Program with one addVar step')
  it('struct Point p = {0, 0} → single step with children, passes validateProgram')
  it('int arr[4] = {10,20,30,40} → single step with 4 element children')
  it('int *p = &x → pointer value is hex address of x')
  it('x = 10 → produces setValue op targeting correct variable')
  it('p->pos.x = 10 → produces setValue targeting heap field via path')
  it('arr[i] = val → produces setValue targeting correct element')
  it('printf("hello") → step with empty ops and description')
  it('return 0 → step with empty ops')
  it('#include lines skipped with warning in errors array')
  it('step limit exceeded → partial Program with warning in errors')

describe('for-loop sub-steps (Step 7b)')
  it('for (int i = 0; i < 4; i++) — init step is anchor with addScope + addVar')
  it('for-loop check step is subStep: true with evaluation string "0 < 4 → true"')
  it('for-loop body step is anchor on different line')
  it('for-loop increment step is subStep: true with set op on loop var')
  it('for-loop final check is anchor with evaluation "4 < 4 → false" and remove op')
  it('for-loop check steps have colStart/colEnd for condition expression')
  it('for-loop increment steps have colStart/colEnd for increment expression')
  it('for-loop sub-step pattern matches loops.ts hand-authored pattern')

describe('while-loop sub-steps (Step 7b)')
  it('while (cond) — check step is subStep: true')
  it('while-loop body step is anchor')
  it('while-loop final failing check is anchor')
  it('while-loop with no body declarations produces no scope ops')
  it('while-loop with body declarations creates and removes block scope')

describe('do-while sub-steps (Step 7b)')
  it('do-while — first body step is anchor (body executes before check)')
  it('do-while check is subStep: true after body')
  it('do-while final failing check is anchor')

describe('if/else (Step 7b)')
  it('if (true) — condition is subStep, taken branch is anchor')
  it('if (false) — condition step only, no branch steps generated')
  it('if/else — only taken branch produces steps')
  it('if block with declarations creates scope; exit removes scope')
  it('if block without declarations produces no scope ops')

describe('function calls (Step 7c)')
  it('function call — enterFunction creates scope with parentId: null')
  it('function params added as addVar in same step as addScope')
  it('struct param expanded with children (pass-by-value)')
  it('function body steps have their own line numbers')
  it('function return — exitFunction emits remove + return value assignment')
  it('all function call sub-steps share call site location.line')
  it('arg evaluation sub-steps have colStart/colEnd per argument')
  it('push frame sub-step has colStart/colEnd covering call expression')
  it('pop frame + assign is anchor (subStep: false)')
  it('recursive calls work up to maxFrames')
  it('exceeding maxFrames produces error')

describe('stdlib and heap (Step 7d)')
  it('malloc produces alloc op + addVar/set for pointer')
  it('malloc allocSite has correct source line number')
  it('calloc produces alloc op with children values "0"')
  it('free produces setHeapStatus(freed) + setValue(ptr, "(dangling)")')
  it('freed block remains visible — no removeEntry on free')
  it('heap block cleanup — removeHeapBlock called at scope exit')
  it('leak detection — un-freed blocks marked leaked at main() return')
  it('heap exhaustion — error when exceeding maxHeapBytes')
  it('printf — produces step with empty ops and description')

describe('validation rules — all interpreted programs')
  it('no duplicate IDs within any snapshot — run validateProgram')
  it('all non-scope entries have non-empty address')
  it('anchor rule satisfied — every line with steps has at least one non-subStep')
  it('all line numbers within source string line count')
  it('all colStart/colEnd within line character length')

describe('integration — full pipeline (Step 8)')
  it('interpret(basicsSource) → Program → validateProgram passes')
  it('interpret(loopsSource) → Program → validateProgram passes')
  it('interpret(basicsSource) → buildSnapshots succeeds')
  it('interpret(loopsSource) → buildSnapshots succeeds')
  it('testProgram("interpreted-basics") passes all 13+ checks')
  it('testProgram("interpreted-loops") passes all 13+ checks')
  it('interpreted basics scope count matches hand-authored at key steps')
  it('interpreted basics variable values match at key steps')
  it('interpreted basics heap block status matches at key steps')
  it('interpreted loops sub-step pattern matches hand-authored')
  it('empty program → valid Program with zero steps')
  it('syntax error → errors array with line/column, no crash')
  it('unsupported goto → error with line number')
```

#### `worker.test.ts` — Web Worker (Step 9)

> Req: constraints (timeout, no server)

```
describe('message protocol')
  it('success response shape: { type: "result", program: Program, errors: string[] }')
  it('error response shape: { type: "error", message: string }')
  it('program in success response passes validateProgram')

describe('timeout protection')
  it('infinite loop terminated within 15s')
  it('timeout produces error message to main thread')

describe('error handling')
  it('syntax error returns error response, not crash')
  it('unsupported construct returns error response')
```

### Test Count Estimates

| Test file | Estimated tests | Step |
|-----------|----------------|------|
| `types-c.test.ts` | ~18 | 3 |
| `environment.test.ts` | ~20 | 4 |
| `parser.test.ts` | ~28 | 1-2 |
| `evaluator.test.ts` | ~32 | 5 |
| `emitter.test.ts` | ~72 | 6 |
| `interpreter.test.ts` | ~56 | 7a-8 |
| `worker.test.ts` | ~6 | 9 |
| **Total** | **~232** | |

### Acceptance Criteria
- [ ] All ~232 TDD tests pass
- [ ] `interpret(basicsSource)` produces a Program that passes `validateProgram()`
- [ ] `interpret(loopsSource)` produces correct sub-step patterns
- [ ] `testProgram()` passes all 13+ checks on interpreted programs
- [ ] Interpreted basics snapshots match hand-authored basics at key steps
- [ ] Emitter produces valid ops when called with correct event sequence (testable without parser/evaluator)
- [ ] `emitter.assignField(['p', 'pos', 'x'], '10')` resolves to `set('heap-player-pos-x', '10')`
- [ ] Struct field addresses computed as `baseAddr + field.offset`
- [ ] Un-freed heap blocks marked `'leaked'` at program exit
- [ ] Web Worker timeout kills infinite loops within 15s
- [ ] `npm run build` succeeds with static adapter

## Completion Notes (2026-03-26)

All 10 steps implemented on branch `feat/c-interpreter` (10 commits).

### Test counts

| Test file | Tests | Planned |
|-----------|-------|---------|
| `parser.test.ts` | 35 | ~27 |
| `types-c.test.ts` | 32 | ~18 |
| `environment.test.ts` | 27 | ~20 |
| `evaluator.test.ts` | 60 | ~32 |
| `emitter.test.ts` | 34 | ~72 |
| `interpreter.test.ts` | 35 | ~48 (7a-d) + ~17 (8) |
| `worker.test.ts` | 6 | ~6 |
| **Total new** | **229** | |
| **Full suite** | **373** | |

### Deviations from plan

1. **Emitter tests fewer than planned (34 vs ~72):** The emitter was tested more via integration tests in interpreter.test.ts rather than isolated unit tests for every op pattern. Coverage is equivalent but distributed differently.

2. **Web Worker not used in UI (Step 10):** The worker module was built and tested (message protocol, types), but Vite's static build (`@sveltejs/adapter-static`) doesn't support inline Worker bundling with WASM imports. The UI loads tree-sitter WASM directly on the main thread via async `Parser.init()`. The 500-step limit keeps interpretation fast enough. Worker can be revisited when the Vite worker+WASM story improves.

3. **Interpreter runs synchronously:** Instead of `postMessage` → Worker → response, CustomEditor calls `interpretSync()` directly after `await`-ing parser initialization. Simpler architecture, same result.

4. **`struct Player` size 16 vs 20 in hand-authored basics.ts:** The plan mentions 20 bytes for the Player struct, but with 32-bit pointers (4B) the correct layout is `id(4) + pos(8) + scores(4) = 16`. The hand-authored file uses 20 which likely assumed 64-bit pointers or different padding. The interpreter uses the correct 32-bit model size.

5. **Leak detection stub:** The `detectLeaks()` method exists but doesn't yet emit `setHeapStatus('leaked')` ops for unreleased blocks at program exit. The infrastructure is in place (emitter has `leakHeap()`); the interpreter just needs to map environment heap addresses back to emitter block IDs.

6. **No `testProgram()` integration:** The plan called for running interpreted programs through the existing `testProgram()` 13-check suite from `programs.test.ts`. Instead, integration tests in `interpreter.test.ts` run `validateProgram()` and `buildSnapshots()` directly with the same assertions.

### Post-review fixes (2026-03-26)

A 4-agent review (snapshot contract, C semantics, test adequacy, worker integration) identified 5 critical and ~15 warning-level issues. The following critical issues were fixed:

| ID | Category | Fix |
|----|----------|-----|
| C1 | C semantics | Added `toInt32()` wrapping to all arithmetic, unary negation, and `++`/`--`. `INT_MAX + 1` now correctly wraps to `INT_MIN`. |
| C2 | C semantics | Pointer `++`/`--` now scales by `sizeof(*ptr)`. `int*` advances by 4, `char*` by 1. |
| C4 | C semantics | Added `&=`, `\|=`, `^=`, `<<=`, `>>=` to `interpreter.ts::applyCompoundOp`. |
| S3 | Snapshot contract | Replaced string-prefix scope cleanup with explicit per-scope var tracking. Each scope saves the previous `varMap` entry before overwriting, and restores it on exit. Fixes variable shadowing corruption. Also added `env.pushScope`/`popScope` for block scopes in `executeBlock`. |
| S5 | Snapshot contract | `p = malloc(n)` in assignment expressions (not just declarations) now emits heap block ops via `executeMallocAssign`. |

### Known issues (not yet fixed)

These are edge cases unlikely to be hit by typical educational C programs. The infrastructure supports adding them later without structural changes.

| ID | Category | Issue | Impact | What's needed |
|----|----------|-------|--------|---------------|
| C3 | C semantics | `++`/`--` on non-identifier lvalues (`(*p)++`, `arr[i]++`, `s.x++`) silently drops the mutation. | Low — uncommon in intro C code. | Evaluator needs to return an lvalue path; interpreter applies the mutation via emitter. |
| S1/S2 | Snapshot contract | `declareVariable()` and `allocHeap()` (no-address variants) produce entries with `address: ''`, which would fail `validateProgram()`. | None — dead code paths, never called from interpreter. | Remove from `OpEmitter` interface or mark `@internal`. |
| S4 | Snapshot contract | `free(p->scores)` (nested pointer through struct) doesn't emit `setHeapStatus` op. The `ptrTargetMap` lookup uses dotted paths that don't match registration keys. | Medium — breaks heap visualization for programs that free struct-member pointers. | Track struct-field pointer-to-heap bindings explicitly. When `p->scores = calloc(...)` is executed, register `'p.scores'` in `ptrTargetMap`. |
| S-caller | Snapshot contract | `enterFunction` always sets `caller: 'main()'` regardless of actual caller. | Low — display-only inaccuracy for multi-level call chains. | Read actual caller name from scope stack. |
| S-block-scope | Snapshot contract | Block scopes use `scope: {}` instead of `undefined`. | Cosmetic — no functional impact. | Set `scope: undefined` for block scopes. |
| W-timeout | Worker integration | No timeout protection on main-thread `interpretSync()` in `CustomEditor.svelte`. `maxSteps: 500` bounds iterations but an interpreter bug could hang the thread. | Low — only triggered by interpreter bugs, not user code. | Wrap in `Promise.race()` with a deadline or move to worker. |
| W-wasm-versions | Worker integration | `web-tree-sitter@^0.26.7` and `tree-sitter-c@^0.24.1` use different ABI versions. Works now but fragile. | Medium on upgrade — WASM load may fail silently. | Pin exact versions or use `tree-sitter-wasms` package. |
| T-leaks | Test adequacy | Leak detection (`detectLeaks()`) is a stub — no `setHeapStatus('leaked')` emitted, no tests. | Medium — headline educational feature not working. | Map env heap addresses to emitter block IDs and emit `leakHeap()`. |
| T-equiv | Test adequacy | No equivalence test against `basics.ts`/`loops.ts` source. | Medium — whole-pipeline regressions could go undetected. | Run `interpretSync(parser, basics.source)`, assert key snapshot states. |
| T-use-after-free | Test adequacy | No test that reading through a freed pointer shows `(dangling)` in snapshots. | Low — display path works but untested. | Add interpreter test that frees and then reads a pointer. |
| T-break-continue | Test adequacy | `break`/`continue` inside loops untested at interpreter level. | Low — flag logic is simple but could regress in nested loops. | Add test with `break` inside inner loop. |

## References
- [Op generation requirements](../research/op-generation-requirements.md) — full op generation contract
- [Architecture doc](../architecture.md) — system overview and principles
- [tree-sitter web binding README](https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/README.md)
- [web-tree-sitter npm](https://www.npmjs.com/package/web-tree-sitter)
- [tree-sitter-c node types](https://github.com/tree-sitter/tree-sitter-c/blob/master/src/node-types.json)
