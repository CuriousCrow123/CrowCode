# CrowTools Architecture

CrowTools is an interactive C memory visualizer. Users step through pre-authored C programs and see the memory layout change at each instruction — stack frames, local variables, heap allocations, and scope lifecycle.

## Principles

1. **State is truth.** The UI reads snapshots (`MemoryEntry[]`). Operations are an authoring format that produces snapshots. Everything downstream sees snapshots only.
2. **Every entry is addressable.** A stable `id` field on every `MemoryEntry` enables diffing, animation keys, modal tracking, and op targeting.
3. **Snapshots are diffable.** `diffSnapshots()` compares two snapshots by `id`, producing added/removed/changed sets.
4. **Navigation is independent.** Step index management knows nothing about memory or code. Sub-step toggle, play/pause, and future features (breakpoints, search) are all index filters.
5. **Views are independent.** Code editor and memory view both read from the current step. Neither knows about the other.

## System Overview

```
Program (source + steps with ops)
        │
        ▼
   buildSnapshots()          ← runs once on load
        │
        ▼
   MemoryEntry[][]           ← pre-computed, O(1) access
        │
   ┌────┴────┐
   ▼         ▼
CodeEditor  MemoryView       ← independent views
   ▲         ▲
   │         │
   └────┬────┘
        │
  ProgramStepper             ← orchestrator, owns navigation state
        │
  StepControls               ← prev/next/play/speed/sub-step toggle
```

## Directory Structure

```
src/lib/
├── api/
│   └── types.ts                    Core type definitions
├── engine/
│   ├── snapshot.ts                 applyOps, buildSnapshots, indexById
│   ├── diff.ts                     diffSnapshots
│   ├── validate.ts                 validateProgram
│   ├── navigation.ts               getVisibleIndices, nearestVisibleIndex
│   ├── builders.ts                 Authoring helpers (scope, variable, set, etc.)
│   ├── index.ts                    Barrel export
│   ├── snapshot.test.ts            Core ops: add/remove/set, errors, immutability
│   ├── snapshot-edge-cases.test.ts Deep nesting, multi-op, heap status, empty states
│   ├── diff.test.ts                Added/removed/changed, nested, empty
│   ├── navigation.test.ts          Visible indices, nearest index, empty cases
│   ├── validate.test.ts            Duplicate ids, missing addresses, anchor rules
│   ├── builders.test.ts            All entry and op builders
│   ├── substep.test.ts             Sub-step snapshot correctness, navigation, diffing, scope lifecycle
│   ├── integration.test.ts         Real programs build, snapshot isolation, scope lifecycle
│   └── bugs.test.ts                Regression: visiblePosition = -1
├── programs/
│   ├── basics.ts                   Sample: structs, pointers, malloc/free, function calls
│   ├── loops.ts                    Sample: for-loops with sub-step granularity
│   ├── programs.test.ts            Validates all programs: line numbers, ids, snapshots, modes
│   └── index.ts                    Barrel export
├── components/
│   ├── ProgramStepper.svelte       Orchestrator — owns state, wires everything
│   ├── CodeEditor.svelte           CodeMirror 6 wrapper, read-only, line/range highlight
│   ├── StepControls.svelte         Navigation UI (prev/next/play/speed/sub-step)
│   ├── MemoryView.svelte           Renders scope cards + heap card from MemoryEntry[]
│   ├── ScopeCard.svelte            Stack frame card with variable table
│   ├── HeapCard.svelte             Heap allocation table with status coloring
│   ├── MemoryRow.svelte            Single variable row (name, type, value, address)
│   └── DrilldownModal.svelte       Modal for navigating into nested structs/arrays
├── summary.ts                      Computes display summaries for nested values
├── summary.test.ts                 Leaf/struct/array/pointer/nested summarization
└── types.ts                        Re-exports from api/types.ts
```

## Data Model

### MemoryEntry

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

### Program, ProgramStep, SnapshotOp

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

Four op types cover all memory changes:

| Op | Purpose |
|---|---|
| `addEntry` | Insert a new entry (scope, variable, struct field, heap block) |
| `removeEntry` | Remove an entry and all its children |
| `setValue` | Change an entry's value |
| `setHeapStatus` | Change a heap block's status (allocated/freed/leaked) |

All ops target entries by `id`.

## Engine

### Snapshot Pipeline

```
[] (empty)
  → applyOps([], step[0].ops) → snapshot[0]
  → applyOps(snapshot[0], step[1].ops) → snapshot[1]
  → ...
```

`buildSnapshots(program)` runs this pipeline once on load, producing `MemoryEntry[][]`. Every snapshot is an independent deep clone — mutating one cannot corrupt another. Access to any step is O(1). Backward stepping is just `snapshots[index - 1]`.

### Diffing

`diffSnapshots(prev, next)` flat-walks both trees, indexes entries by `id`, and compares:

- **added**: ids in `next` not in `prev`
- **removed**: ids in `prev` not in `next`
- **changed**: ids in both where `value` differs

Used for: changed-value highlighting, entry appear/disappear animations (future).

### Navigation

Navigation is decoupled from the snapshot engine. It manages:

- `getVisibleIndices(steps, subStepMode)` — returns which step indices are visible in the current mode
- `nearestVisibleIndex(visibleIndices, currentIndex)` — maps an arbitrary index to the nearest visible one

Sub-step toggle: steps with `subStep: true` are hidden in line mode. Toggling mid-program uses `nearestVisibleIndex` to remap position.

In line mode, `colStart`/`colEnd` are stripped from the location passed to the editor — full-line highlight only. Sub-step mode preserves character-range highlighting. This stripping happens in `ProgramStepper`'s `editorLocation` derived value, not in the data.

**Critical invariant**: Snapshots are pre-computed from *all* steps (including sub-steps). Line mode doesn't skip ops — it skips *pausing*. The snapshot at anchor step N already reflects every sub-step op from 0 to N. This means sub-step toggle never changes the state at any visible step, only which intermediate states are visible.

**`visiblePosition` safety**: `visibleIndices.indexOf(internalIndex)` can return -1 when the internal index is on a non-visible step (e.g., during toggle). ProgramStepper guards this with a fallback to `nearestVisibleIndex`.

### Builders

Ergonomic helpers for authoring programs:

```ts
// Create entries
scope(id, name, scopeInfo?)
variable(id, name, type, value, address, children?)
heapBlock(id, type, address, heapInfo, children?)

// Create ops
addScope(parentId, entry)    // → addEntry op
addVar(parentId, entry)      // → addEntry op
set(id, value)               // → setValue op
free(id)                     // → setHeapStatus op (freed)
remove(id)                   // → removeEntry op
```

### Validation

`validateProgram(program)` builds all snapshots and checks for:

- Duplicate ids within a snapshot
- Missing addresses on non-scope entries
- `subStep` anchor rule violations (all steps for a line being sub-steps)

Runs at dev/load time. Errors include step number and specific message.

## Components

### ProgramStepper (Orchestrator)

Owns all state:

- `internalIndex` — position in the full step list
- `playing`, `speed`, `subStepMode` — playback state
- `snapshots` — pre-computed via `buildSnapshots` ($derived, runs once)
- `editorLocation` — strips column ranges in line mode
- `diff` — computed between previous and current visible step

Provides data to children via props. Handles keyboard shortcuts (Arrow keys, Space, S).

### CodeEditor

CodeMirror 6 wrapper. Props: `source` (fixed) and `location` (reactive).

- Read-only editor with C/C++ syntax highlighting
- Active step shown via `StateField` decoration (blue background + left border)
- Sub-line mode adds character-range mark decoration
- Scrolls active line into view on change
- Cleans up `EditorView` on unmount

### MemoryView

Takes `MemoryEntry[]`, flattens scopes into a linear stack, separates heap entries. Renders `ScopeCard` for each scope, `HeapCard` for each heap container.

Manages the drilldown modal — opens when a nested entry is clicked, closes when data changes (e.g., stepping).

### ScopeCard / HeapCard

Scope cards show: name, caller info, file:line, and a table of non-scope children.

Heap cards show: address, type, size, status (color-coded), value, allocation site.

Both pass an `onexpand` callback to `MemoryRow` for opening the drilldown modal.

### DrilldownModal

Modal overlay for navigating into nested structs/arrays. Maintains a breadcrumb path. Clicking a child with children drills deeper. Clicking breadcrumb segments navigates back. Escape or backdrop click closes.

### MemoryRow

Single table row for a variable. Shows name, type, value, address. Clickable if the entry has children (shows `›` indicator). Long values are truncatable with "(more)"/"(less)" toggle.

## Authoring Programs

Programs are TypeScript files in `src/lib/programs/`. Use the builder helpers:

```ts
import { scope, variable, heapBlock, addScope, addVar, set, alloc, free, remove } from '$lib/engine';

export const myProgram: Program = {
    name: 'My Program',
    source: `int main() { ... }`,
    steps: [
        {
            location: { line: 2 },
            description: 'Declare x = 5',
            ops: [
                addScope(null, scope('main', 'main()')),
                addVar('main', variable('x', 'x', 'int', '5', '0x7ffc0060')),
            ],
        },
        // ... more steps
    ],
};
```

### Sub-steps

Mark steps with `subStep: true` for fine-grained visibility (e.g., for-loop init/check/increment). The last step for a line should be an anchor (`subStep` omitted or `false`).

Sub-steps are only visible when the user enables sub-step mode. In line mode, their ops still apply (snapshots are pre-computed from all steps), but the UI skips over them.

**When to use sub-steps:**
- For-loop mechanics: init (`int i = 0`), condition check (`i < 4`), increment (`i++`)
- Function call breakdown: evaluate args → push frame → execute → return
- Short-circuit evaluation: `ptr && ptr->valid`

**When NOT to use sub-steps:**
- Compound initialization (`struct Point p = {0, 0}`, `int arr[4] = {1,2,3,4}`). These are compile-time operations with no meaningful intermediate state — use a single step.

**Anchor rule**: If all steps for a given line are `subStep: true`, validation warns that the last should be promoted to an anchor. Without an anchor, that line is invisible in line mode.

**Column ranges**: Sub-steps can include `colStart`/`colEnd` on the location to highlight specific characters within a line (e.g., the `i++` part of a for-loop header). In line mode, column ranges are automatically stripped — the editor always shows full-line highlights.

### Line numbers

Line numbers in `location.line` are 1-based and refer to lines within the `source` string. Count carefully — empty lines count.

## Testing

```bash
npm test          # run all tests
npm run test:watch # watch mode
```

144 tests across 11 test files:

### Engine unit tests

- **snapshot.test.ts** (11) — Core `applyOps` and `buildSnapshots`: add/remove/set, error reporting, immutability, intra-step op targeting
- **snapshot-edge-cases.test.ts** (22) — `setHeapStatus` (freed/leaked/errors/immutability), deep nesting (4 levels: set/remove/add), multi-op interactions (add+set, add+remove, remove+set-error, parent-removes-children), empty/edge states, scope lifecycle, heap lifecycle
- **diff.test.ts** (6) — Added/removed/changed detection, nested entries, empty snapshots, first-step-from-empty
- **navigation.test.ts** (6) — Visible indices filtering (sub-step/line/all-anchor/empty), nearest index mapping, empty case
- **validate.test.ts** (8) — Empty program, valid program, duplicate ids, missing addresses, scope address exemption, subStep anchor rule, mixed sub/anchor lines, cross-step validation
- **builders.test.ts** (18) — All entry builders (scope with/without opts, heapContainer default/custom id, variable with/without children, heapBlock with/without children) and all op builders (addScope, addVar, addChild, alloc, set, free, leak, remove)

### Sub-step tests

- **substep.test.ts** (15) — The most critical test file. Covers:
  - **Snapshot correctness**: anchor includes all prior sub-step ops, incremental state visible in sub-step mode, anchor with no ops, ops compound across for-loop iterations, line-mode jump reflects sub-step mutations
  - **Navigation edge cases**: all-substep program (empty line mode), no-substep program (modes identical), sub-step as first/last step, toggle at every position in 10-step mix, nearest-picks-closest
  - **Diffing**: incremental diff between sub-steps, line-mode diff skips intermediate states
  - **Scope lifecycle**: for-loop scope appears/disappears across sub-steps, loop variable visibility in line mode

### Integration and regression tests

- **integration.test.ts** (11) — Both real programs build without engine errors, first/last snapshot correctness, for-scope appears/disappears, snapshot isolation under mutation, diff validity across all steps, first-step-from-empty diff
- **programs.test.ts** (26) — Per-program validation suite (runs for basics + loops): has steps/source/name, builds without errors, passes validation, all line numbers in source range, all column ranges within line length, unique ids per snapshot, snapshot isolation, line/sub-step mode coverage, first step creates entries
- **bugs.test.ts** (4) — Regression: `visiblePosition = -1` when `indexOf` misses sub-step indices, demonstrating wrong next/prev behavior and the fix via `nearestVisibleIndex`

### Utility tests

- **summary.test.ts** (9) — Leaf values, empty children, struct summary (`{...}`), array previews (<=3, ==3, >3 elements with "...N more"), recursive struct-array, pointer types, struct-array type detection

### Adding tests for new programs

When adding a new program to `src/lib/programs/`, add it to the `programs.test.ts` file by calling `testProgram('name', myProgram)`. This automatically runs 13 validation checks against it.

## Known Edge Cases and Design Decisions

### Snapshot pre-computation tradeoff

All snapshots are pre-computed on load via `structuredClone` per step. At ~25-50 steps with small snapshots, this is negligible. At 1000+ steps or large snapshots, memory usage grows linearly. If this becomes a problem, the fix is checkpoint-based computation (store full snapshots every N steps, replay from nearest checkpoint) — a ~20 line change to `buildSnapshots` with zero component changes, since everything downstream sees `MemoryEntry[]` via props.

### Sub-step ops always apply

Snapshots are computed from all steps sequentially, regardless of `subStep`. Line mode doesn't skip ops — it skips pausing. This means the snapshot at any visible step is always correct, but it also means a sub-step op that's wrong (e.g., sets a bad value) affects all subsequent snapshots even if the user never sees that sub-step.

### `indexById` rebuilt per op

Inside `applyOps`, the id index is rebuilt for every op in a step. This is O(ops × entries) per step. It's correct (later ops can target entries created by earlier ops in the same step) and fast enough for our scale, but could be optimized to rebuild only when the tree structure changes (addEntry/removeEntry), not on setValue.

### Drilldown modal closes on step

When the memory view's `data` prop changes, the modal closes. This is the v1 behavior. A future improvement would store the drilldown path as a list of ids, re-resolve it against the new snapshot, and keep the modal open if the path still exists.

### EditorView lifecycle

CodeMirror's `EditorView` is created in a Svelte `$effect` and destroyed in its cleanup function. When switching programs (via `{#key}` in the page), the entire ProgramStepper unmounts, triggering cleanup. Without this, switching programs leaks DOM nodes and event listeners.

### Column range stripping

In line mode, `ProgramStepper` strips `colStart`/`colEnd` from the location before passing it to CodeEditor. This is done in the orchestrator (not the editor or the data) so the editor doesn't need to know about sub-step mode, and program authors don't need separate locations per mode.

## Deployment

Static site on GitHub Pages via `@sveltejs/adapter-static`.

```bash
npm run dev       # local dev at localhost:5173/CrowTools
npm run build     # static build to build/
npm run preview   # preview static build locally
git push          # GitHub Actions deploys automatically
```

Live at: `https://CuriousCrow123.github.io/CrowTools/`
