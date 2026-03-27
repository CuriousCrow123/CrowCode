# CrowCode Architecture

## How to Read This Document

- **New contributor:** Read Level 1 and Level 2 (~5 min). That gives you the full mental model.
- **Adding a feature to the engine:** Also read the Engine section in Level 3.
- **Extending the interpreter:** Also read C Interpreter Pipeline in Level 3.
- **Investigating a design decision:** See [docs/decisions/](decisions/).
- **Looking for conventions:** See [CONTRIBUTING.md](../CONTRIBUTING.md).

---

## Level 1 — System Context

CrowCode is an interactive C memory visualizer. Users step through C programs and see the memory layout change at each instruction — stack frames, local variables, heap allocations, and scope lifecycle.

Programs can come from two sources:
1. **Pre-authored** — TypeScript files in `src/lib/programs/` that define steps manually using builder helpers
2. **Custom** — C source code written by the user in the Custom tab, parsed and interpreted via tree-sitter in the browser

Both produce the same `Program` type. From there, the pipeline is identical.

### Principles

1. **State is truth.** The UI reads snapshots (`MemoryEntry[]`). Operations are an authoring format that produces snapshots. Everything downstream sees snapshots only.
2. **Every entry is addressable.** A stable `id` field on every `MemoryEntry` enables diffing, animation keys, modal tracking, and op targeting.
3. **Snapshots are diffable.** `diffSnapshots()` compares two snapshots by `id`, producing added/removed/changed sets.
4. **Navigation is independent.** Step index management knows nothing about memory or code. Sub-step toggle, play/pause, and future features (breakpoints, search) are all index filters.
5. **Views are independent.** Code editor and memory view both read from the current step. Neither knows about the other.

---

## Level 2 — Module Map

```
C source code ──→ tree-sitter ──→ AST ──→ Interpreter ──→ Program
                                                              │
Pre-authored programs (TypeScript) ───────────────────────────┘
                                                              │
                                                              ▼
                                                      buildSnapshots()
                                                              │
                                                              ▼
                                                      MemoryEntry[][]
                                                        (one per step)
                                                              │
                                                    ┌─────────┴──────────┐
                                                    ▼                    ▼
                                              CodeEditor           MemoryView
                                                    ▲                    ▲
                                                    └─────────┬──────────┘
                                                     +page.svelte (orchestrator)
                                                              │
                                                        StepControls
```

### Modules

| Module | Responsibility | Key files |
|--------|---------------|-----------|
| **Engine** (`src/lib/engine/`) | Snapshot building, diffing, validation, navigation | `snapshot.ts`, `diff.ts`, `validate.ts`, `navigation.ts` |
| **Interpreter** (`src/lib/interpreter/`) | C source → `Program` conversion: parsing, evaluation, statement execution, memory management | `parser.ts`, `memory.ts`, `evaluator.ts`, `interpreter.ts`, `service.ts` |
| **Components** (`src/lib/components/`) | Svelte UI: code editor, memory view, step controls, tabs | `CodeEditor.svelte`, `MemoryView.svelte`, `EditorTabs.svelte` |
| **Stores** (`src/lib/stores/`) | Application state: editor tabs, localStorage persistence | `editor-tabs.svelte.ts` |

### Directory Structure

```
src/lib/
├── api/
│   └── types.ts                    Core type definitions (MemoryEntry, SnapshotOp, Program)
├── engine/
│   ├── snapshot.ts                 applyOps, buildSnapshots, indexById
│   ├── diff.ts                     diffSnapshots
│   ├── validate.ts                 validateProgram
│   ├── navigation.ts               getVisibleIndices, nearestVisibleIndex
│   └── index.ts                    Barrel export
├── interpreter/
│   ├── parser.ts                   tree-sitter C → AST conversion
│   ├── memory.ts                   Unified runtime state + op recording
│   ├── evaluator.ts                Expression evaluation (arithmetic, pointers, casts)
│   ├── interpreter.ts              Statement execution, control flow, memory management
│   ├── handlers/                   Statement and control-flow handlers
│   │   ├── statements.ts           Declaration, assignment, expression statement handlers
│   │   ├── control-flow.ts         if/else, for, while, do-while, switch, break, continue, return
│   │   ├── types.ts                Handler type definitions
│   │   └── index.ts                Barrel export
│   ├── service.ts                  Main-thread interpreter entry (used by +page.svelte)
│   ├── worker.ts                   Web Worker entry for async interpretation
│   ├── types.ts                    AST node types, interpreter options
│   ├── types-c.ts                  C type system (primitives, pointers, arrays, structs)
│   ├── stdlib.ts                   Standard library (malloc, calloc, free, sprintf, strlen, etc.)
│   └── index.ts                    Barrel export (interpretSync, resetParserCache)
├── components/
│   ├── CodeEditor.svelte           CodeMirror 6 wrapper, read-only, line/range highlight
│   ├── StepControls.svelte         Navigation UI (prev/next/play/speed/sub-step)
│   ├── MemoryView.svelte           Renders scope cards + heap card from MemoryEntry[]
│   ├── ScopeCard.svelte            Stack frame card with variable table
│   ├── HeapCard.svelte             Heap allocation table with status coloring
│   ├── MemoryRow.svelte            Single variable row (name, type, value, address)
│   ├── DrilldownModal.svelte       Modal for navigating into nested structs/arrays
│   ├── EditorTabs.svelte           Tab bar for switching between programs
│   └── CustomEditor.svelte         C code editor with test program dropdown and Run button
├── stores/
│   └── editor-tabs.svelte.ts       Multi-tab state, localStorage persistence, run cache
├── test-programs.ts                26 test programs for Custom tab dropdown
├── summary.ts                      Computes display summaries for nested values
└── types.ts                        Re-exports from api/types.ts
```

---

## Level 3 — Component Details

### Data Model

#### MemoryEntry

The core type. Represents any node in the memory tree — a variable, struct field, array element, scope frame, or heap block.

```ts
type MemoryEntry = {
    id: string;              // Stable across steps. Unique within a snapshot.
    name: string;            // Display name (".x", "[0]", "main()", etc.)
    type: string;            // C type string ("int", "struct Point", "int*")
    value: string;           // Display value ("42", '"hello"', "0x55a0...")
    address: string;         // Memory address
    children?: MemoryEntry[];
    kind?: 'scope' | 'heap'; // Scopes are stack frames; heap is the heap container
    scope?: ScopeInfo;       // Only for kind='scope': caller, returnAddr, file, line
    heap?: HeapInfo;         // Only for heap blocks: size, status, allocator, allocSite
};
```

#### Program, ProgramStep, SnapshotOp

A `Program` is source code paired with an ordered list of `ProgramStep`s. Each step has a source location, optional description, and a list of `SnapshotOp`s that transform the previous snapshot.

```ts
type Program = {
    name: string;
    source: string;           // C source code
    steps: ProgramStep[];
};

type ProgramStep = {
    location: SourceLocation; // { line, colStart?, colEnd? }
    description?: string;     // Human-readable ("malloc 32 bytes")
    evaluation?: string;      // Expression result ("distance() → 500")
    ops: SnapshotOp[];        // Transforms to apply
    subStep?: boolean;        // Only visible in sub-step mode
};
```

Four op types cover all memory changes. See [ADR-002](decisions/002-four-op-model.md) for why this set is minimal and complete.

| Op | Purpose |
|---|---|
| `addEntry` | Insert a new entry (scope, variable, struct field, heap block) |
| `removeEntry` | Remove an entry and all its children |
| `setValue` | Change an entry's value |
| `setHeapStatus` | Change a heap block's status (allocated/freed/leaked) |

All ops target entries by `id`.

---

### Engine

#### Snapshot Pipeline

```
[] (empty)
  → applyOps([], step[0].ops) → snapshot[0]
  → applyOps(snapshot[0], step[1].ops) → snapshot[1]
  → ...
```

`buildSnapshots(program)` runs this pipeline once on load, producing `MemoryEntry[][]`. Every snapshot is an independent deep clone — mutating one cannot corrupt another. Access to any step is O(1). Backward stepping is just `snapshots[index - 1]`.

> See [ADR-001](decisions/001-snapshot-precomputation.md) for the precomputation tradeoff and future migration path.

#### Diffing

`diffSnapshots(prev, next)` flat-walks both trees, indexes entries by `id`, and compares:

- **added**: ids in `next` not in `prev`
- **removed**: ids in `prev` not in `next`
- **changed**: ids in both where `value` differs

Used for: changed-value highlighting, entry appear/disappear animations (future).

#### Navigation

Navigation is decoupled from the snapshot engine. It manages:

- `getVisibleIndices(steps, subStepMode)` — returns which step indices are visible in the current mode
- `nearestVisibleIndex(visibleIndices, currentIndex)` — maps an arbitrary index to the nearest visible one

Sub-step toggle: steps with `subStep: true` are hidden in line mode. Toggling mid-program uses `nearestVisibleIndex` to remap position.

#### Validation

`validateProgram(program)` builds all snapshots and checks for:

- Duplicate ids within a snapshot
- Missing addresses on non-scope entries
- `subStep` anchor rule violations (all steps for a line being sub-steps)

Runs at dev/load time. Errors include step number and specific message.

---

### C Interpreter Pipeline

The interpreter converts C source code into a `Program`. This happens when the user clicks Run in the editor.

```
C source string
      │
      ▼
  tree-sitter WASM parser          ← tokenizes + builds CST
      │
      ▼
  parser.ts: parseSource()         ← CST → AST conversion
      │
      ▼
  AST (ASTNode tree)
      │
      ▼
  interpreter.ts: interpretAST()   ← walks AST, executes statements
      │
      ├── memory.ts                ← unified runtime state + op recording
      ├── evaluator.ts             ← evaluates expressions (arithmetic, pointers)
      ├── handlers/                ← statement and control-flow handlers
      ├── types-c.ts               ← C type system (sizeof, alignment, struct layout)
      └── stdlib.ts                ← malloc, calloc, free, sprintf
      │
      ▼
  Program { name, source, steps }
      │
      ▼
  buildSnapshots() → UI            ← standard pipeline from here
```

> See [ADR-003](decisions/003-unified-memory-class.md) for why `memory.ts` replaced the former Environment + Emitter split.

#### Interpreter Components

**Parser** (`parser.ts`): Converts tree-sitter's concrete syntax tree to a simplified AST. Handles: function/struct definitions, declarations, assignments, expressions (binary, unary, call, member, subscript, cast, sizeof, ternary, comma), control flow (if/else, for, while, do-while, break, continue, return). Stores column ranges for condition highlighting.

**Memory** (`memory.ts`): Unified runtime state and visualization op recording. Every mutation (pushScope, declareVariable, malloc, free, etc.) updates runtime state AND records the corresponding `SnapshotOp`. Manages: scope chain with variable shadowing, stack/heap allocation (stack down from `0x7FFC0000`, heap up from `0x55A00000` with 16-byte alignment), variable→ID mapping, pointer→heap-block mapping, child registration, path resolution through pointers, function table. Generates deterministic IDs like `main-x`, `heap-p-pos-x`, `for1-i`. Implements `MemoryReader` interface for the Evaluator.

**Evaluator** (`evaluator.ts`): Pure expression evaluation. Depends on `EvalEnv` interface (lookupVariable, setVariable). Handles all operators (arithmetic, comparison, logical with short-circuit, bitwise), pointer arithmetic with element-size scaling, dereference with memReader, cast truncation (char/short/int), sizeof. Returns `{ value: CValue, error?: string }`.

**Interpreter** (`interpreter.ts`): Statement execution engine. Walks the AST top-down, calling evaluator for expressions and Memory for both runtime state changes and visualization steps. The `handlers/` subdirectory contains factored-out statement and control-flow handlers.

**Service** (`service.ts`): Main-thread interpreter entry point. Initializes tree-sitter WASM (using `import.meta.env.BASE_URL` for path resolution), runs the full parse → interpret pipeline, and enforces a `MAX_STEPS = 500` limit (programs exceeding this are truncated with a warning).

**Worker** (`worker.ts`): Web Worker entry point for async interpretation. Note: `worker.ts` hardcodes the `/CrowCode/` path prefix for WASM files, while `service.ts` uses `BASE_URL` dynamically. In practice, `+page.svelte` imports `service.ts` for the main thread.

**Type System** (`types-c.ts`): 32-bit ILP32 model. Primitives (char=1, short=2, int=4, long=8, float=4, double=8, void=0), pointers (4 bytes), arrays (N × element), structs (fields with alignment padding). TypeRegistry resolves parser type specs to runtime types.

**Standard Library** (`stdlib.ts`): malloc, calloc, free, sprintf, strlen, strcpy, strcmp, strcat, abs, sqrt, pow. printf/puts/putchar are no-ops (recognized but produce no output).

#### WASM Initialization

tree-sitter requires two WASM files in `static/`: `tree-sitter.wasm` and `tree-sitter-c.wasm`. These are copied from `node_modules` by the `postinstall` script in `package.json`. The `vite.config.ts` excludes `web-tree-sitter` from Vite's dependency pre-bundling (`optimizeDeps.exclude`) because tree-sitter initializes its own WASM module at runtime.

#### Sub-step Generation

Control flow constructs emit sub-steps for condition evaluation:

| Construct | Sub-steps generated |
|-----------|-------------------|
| `for` | Init, condition check (→ true/false), update (→ new value) |
| `while` | Condition check per iteration (→ true), exit (→ false) |
| `do-while` | Condition check after body (→ true), exit (→ false) |
| `if/else` | Condition check (→ true/false) — regular step, not sub-step |

#### Memory Safety Checks

| Check | Where | Behavior |
|-------|-------|----------|
| Stack array bounds (read) | `evaluator.ts` evalSubscript | Error if index < 0 or >= size |
| Stack array bounds (write) | `interpreter.ts` executeAssignment | Error if index < 0 or >= size |
| Heap array bounds (write) | `interpreter.ts` executeAssignment | "Heap buffer overflow" error |
| Null pointer dereference | `evaluator.ts` evalUnary `*` | Error on `*NULL` |
| Division by zero | `evaluator.ts` evalBinary `/` `%` | Error with line number |
| Double free | `memory.ts` free() | Error returned |
| Stack overflow | `interpreter.ts` callFunction | Error at maxFrames (256) |
| Memory leak | `interpreter.ts` detectLeaks | Marks unfreed blocks as "leaked" |
| Use-after-free | `evaluator.ts` / `memory.ts` | Error on read/write through freed pointer |
| Syntax errors | `parser.ts` collectDeepErrors | Recursively scans tree-sitter ERROR nodes |

#### Supported C Features

See [interpreter-status.md](interpreter-status.md) for the complete feature matrix with test coverage.

---

### UI Components

#### CodeEditor

CodeMirror 6 wrapper. Props: `source` (fixed) and `location` (reactive).

- Read-only editor with C/C++ syntax highlighting
- Active step shown via `StateField` decoration (blue background + left border)
- Sub-line mode adds character-range mark decoration
- Scrolls active line into view on change
- Cleans up `EditorView` on unmount

#### MemoryView

Takes `MemoryEntry[]`, flattens scopes into a linear stack, separates heap entries. Renders `ScopeCard` for each scope, `HeapCard` for each heap container.

Manages the drilldown modal — opens when a nested entry is clicked, closes when data changes.

#### ScopeCard / HeapCard

Scope cards show: name, caller info, file:line, and a table of non-scope children. Heap cards show: address, type, size, status (color-coded), value, allocation site. Both pass an `onexpand` callback to `MemoryRow` for opening the drilldown modal.

#### DrilldownModal

Modal overlay for navigating into nested structs/arrays. Maintains a breadcrumb path. Clicking a child with children drills deeper. Escape or backdrop click closes.

#### MemoryRow

Single table row for a variable. Shows name, type, value, address. Clickable if the entry has children (shows `›` indicator). Long values are truncatable with "(more)"/"(less)" toggle.

---

### State Management

**EditorTabStore** (`stores/editor-tabs.svelte.ts`): Manages multi-tab editor state with `localStorage` persistence (key: `crowtools-tabs`). Tracks which tab is active, stores a run cache keyed by tab index, and uses a `runGeneration` counter to abort stale interpretation runs when tabs switch.

**AppMode** (in `+page.svelte`): The page manages which mode the app is in — pre-authored program viewing vs. custom code editing — and routes to the appropriate components.

---

### Sub-steps

Mark steps with `subStep: true` for fine-grained visibility (e.g., for-loop init/check/increment). The last step for a line should be an anchor (`subStep` omitted or `false`).

Sub-steps are only visible when the user enables sub-step mode. In line mode, their ops still apply (snapshots are pre-computed from all steps), but the UI skips over them.

**When to use sub-steps:**
- For-loop mechanics: init (`int i = 0`), condition check (`i < 4`), increment (`i++`)
- While/do-while condition checks (`while: check n > 0 → true`)
- Function call breakdown: evaluate args → push frame → execute → return

**When NOT to use sub-steps:**
- Compound initialization (`struct Point p = {0, 0}`). These are compile-time operations — use a single step.
- if/else condition checks — these are the main event on the if-line and must be anchor steps.

**Anchor rule**: If all steps for a given line are `subStep: true`, validation warns that the last should be promoted to an anchor. Without an anchor, that line is invisible in line mode.

**Column ranges**: Sub-steps can include `colStart`/`colEnd` on the location to highlight specific characters within a line. In line mode, column ranges are automatically stripped — the editor always shows full-line highlights.

**Line numbers**: `location.line` is 1-based and refers to lines within the `source` string. Count carefully — empty lines count.

---

## Implementation Notes

Design choices with non-obvious tradeoffs. For major architectural decisions, see [docs/decisions/](decisions/).

### Sub-step ops always apply

Snapshots are computed from all steps sequentially, regardless of `subStep`. Line mode doesn't skip ops — it skips pausing. This means the snapshot at any visible step is always correct, but it also means a sub-step op that's wrong affects all subsequent snapshots even if the user never sees that sub-step.

### `indexById` rebuilt per op

Inside `applyOps`, the id index is rebuilt for every op in a step. This is O(ops × entries) per step. It's correct (later ops can target entries created by earlier ops in the same step) and fast enough for our scale, but could be optimized to rebuild only when the tree structure changes (addEntry/removeEntry), not on setValue.

### Drilldown modal closes on step

When the memory view's `data` prop changes, the modal closes. This is the v1 behavior. A future improvement would store the drilldown path as a list of ids, re-resolve it against the new snapshot, and keep the modal open if the path still exists.

### EditorView lifecycle

CodeMirror's `EditorView` is created in a Svelte `$effect` and destroyed in its cleanup function. When switching tabs, the editor unmounts via cleanup. Without this, switching programs leaks DOM nodes and event listeners.

### Column range stripping

In line mode, the page orchestrator strips `colStart`/`colEnd` from the location before passing it to CodeEditor. This is done in the orchestrator (not the editor or the data) so the editor doesn't need to know about sub-step mode.

---

## Testing

```bash
npm test          # run all tests
npm run test:watch # watch mode
```

599 tests across 18 test files:

### Engine tests (9 files)

- **snapshot.test.ts** — Core `applyOps` and `buildSnapshots`: add/remove/set, error reporting, immutability
- **snapshot-edge-cases.test.ts** — `setHeapStatus`, deep nesting, multi-op interactions, empty/edge states
- **diff.test.ts** — Added/removed/changed detection, nested entries, empty snapshots
- **navigation.test.ts** — Visible indices filtering, nearest index mapping
- **validate.test.ts** — Duplicate ids, missing addresses, subStep anchor rule
- **substep.test.ts** — Sub-step snapshot correctness, navigation, diffing, scope lifecycle
- **integration.test.ts** — Snapshot building, scope lifecycle, isolation, diffing, navigation with inline programs
- **bugs.test.ts** — Regression tests
- **summary.test.ts** — Display summary computation

### Interpreter tests (9 files)

- **parser.test.ts** — AST conversion for all node types
- **evaluator.test.ts** — Expression evaluation, operators, 32-bit wrapping, pointer scaling
- **interpreter.test.ts** — Statement handling, stdlib, validation, integration pipelines
- **memory.test.ts** — Unified Memory class (scopes, heap, op recording)
- **types-c.test.ts** — Type sizes, alignment, struct layout, TypeRegistry
- **snapshot-regression.test.ts** — Regression safety net (7 programs captured before Memory refactor)
- **worker.test.ts** — Worker message contract
- **value-correctness.test.ts** — Value assertions across all features
- **manual-programs.test.ts** — 38 full C programs through complete pipeline

### Adding tests

Use `interpretAndBuild()` in `value-correctness.test.ts` for value assertions, or write a full-program test in `manual-programs.test.ts` for integration testing.

---

## Deployment

Static site on GitHub Pages via `@sveltejs/adapter-static`.

```bash
npm run dev       # local dev at localhost:5173/CrowCode
npm run build     # static build to build/
npm run preview   # preview static build locally
git push          # GitHub Actions deploys automatically
```

The base path `/CrowCode` is configured in `svelte.config.js` (`paths.base`). The dev server serves at `localhost:5173/CrowCode`, not `/`. Changing the repo name on GitHub Pages requires updating `svelte.config.js`.

Live at: https://CuriousCrow123.github.io/CrowCode/
