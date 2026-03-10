---
title: "feat: Add C array visualization widget with dual-view architecture"
type: feat
status: active
date: 2026-03-09
origin: docs/brainstorms/2026-03-09-array-widget-brainstorm.md
deepened: 2026-03-09
---

# feat: Add C array visualization widget with dual-view architecture

## Enhancement Summary

**Deepened on:** 2026-03-09
**Review agents used:** TypeScript Reviewer, Pattern Recognition Specialist, Performance Oracle, Code Simplicity Reviewer, Architecture Strategist, Frontend Races Reviewer

### Key Improvements

1. **Reduce instruction kinds from 6 to 2** — Only `declare-array` and `array-index-read` are genuinely new. Reuse `declare-pointer-assign` for `int *p = arr`, `assign` for `p++`. Handle pointer arithmetic and OOB in the orchestrator, not the data model. Saves ~80 LOC in `c-program.ts`.
2. **Increase `TOTAL_BYTES` constant to 64** instead of adding `totalBytes`/`baseAddress` props. One line change, zero API surface growth, backward-compatible (collapsed ellipsis handles extra unallocated rows).
3. **Fix `*p` after `p++` bug** — The plan's reuse of `deref-read-assign` with `targetName: 'arr'` would read the wrong value. Use `pointer-arith-deref` with `offset: 0` instead, computing the target index from the pointer's stored address.
4. **Add `elementValues` array to `CVariable`** — The existing `value: number | null` field cannot represent per-element array data. Add `elementValues?: (number | null)[]` for the table view.
5. **Use typed `highlightedElement` state** instead of `"arr:2"` string key encoding in `highlightedVars`.
6. **Move CArrayStrip to `widgets/`** not `widgets/shared/` — It has internal state and an imperative API with a generation counter. This matches the widget pattern (like CMemoryView), not the shared component pattern (like CodePanel).
7. **Make `showMath` a boolean toggle button** instead of a 0/1 paramDef slider. Follow CMemoryView's "Show table"/"Show bits" toggle pattern.

### Critical Bugs to Fix First

1. **`glowingCells.add()` mutation in CMemoryView** (line 127) — violates Svelte 5 reactivity. Must use `glowingCells = new Set([...glowingCells, ...changed])`. Same for `.delete()` in `handleGlowEnd` (line 135). This becomes more visible with 64 bytes.

### Race Condition Mitigations

1. **Generation check after every `await`** in dual-view `executeSubStep` — Without this, a reset during animation causes phantom writes to the already-reset second view.
2. **Do NOT use `$effect` for array size change** — Use an explicit handler. `$effect` fires after `$derived(program)` re-derives, creating a window where `program` has changed but `pc`/`executed` reference the old program, causing out-of-bounds crashes.
3. **CArrayStrip methods must mutate state synchronously before any `await`** — Required for fire-and-forget replay during `executePrev`. The async tail (animation) is cancellable by generation counter, but the state mutation must happen immediately.

## Overview

Build a `CArrayDemo` orchestrator widget that teaches C arrays through a progressive 4-act narrative: memory layout → indexing → pointer arithmetic → out-of-bounds access. The widget introduces a **dual-view architecture** (new `CArrayStrip` + existing `CMemoryView`) linked by color-coded highlighting.

(see brainstorm: `docs/brainstorms/2026-03-09-array-widget-brainstorm.md`)

## Problem Statement / Motivation

Arrays are the bridge between "variables hold values" and "memory is a sequence of bytes." Students struggle with: why `arr[2]` skips 8 bytes, why `arr` and `&arr[0]` are the same, and how `[]` is pointer arithmetic in disguise. The existing CPointerDemo teaches pointer basics but never shows contiguous memory blocks. This widget fills that gap by making both the logical (indexed elements) and physical (raw bytes) perspectives simultaneously visible.

## Proposed Solution

### Component Structure

```
CArrayDemo.svelte              (orchestrator — builds program, drives step engine)
├── CodePanel.svelte            (shared — C code with sub-expression highlighting)
├── CArrayStrip.svelte          (NEW widget — horizontal cell strip with pointer arrow)
└── CMemoryView.svelte          (widget — byte-addressable RAM, extended for arrays)
```

**CArrayStrip location:** `site/src/components/widgets/CArrayStrip.svelte` (NOT `widgets/shared/`). It has internal `$state`, a generation counter, and an imperative `export function` API — matching the widget archetype (like CMemoryView), not the stateless shared component archetype (like CodePanel, StdinBufferStrip).

**Layout:** CodePanel left column. CArrayStrip stacked above CMemoryView in the right column. On mobile (≤768px), all three stack vertically: CodePanel → CArrayStrip → CMemoryView.

### 4-Act Program (fixed size 4)

```c
// Act 1: Declaration and memory layout
int arr[4] = {10, 20, 30, 40};

// Act 2: Array indexing
int x = arr[1];
int y = arr[3];

// Act 3: Pointer arithmetic equivalence
int *p = arr;
int a = *(p + 1);
int b = *(p + 2);
p++;
int c = *p;

// Act 4: Out-of-bounds (danger zone)
int bad = arr[4];    // undefined behavior
```

Array size is fixed at 4 for the initial implementation. The 4-act narrative is designed around 4 elements and covers the full teaching progression. Size tunability (3–6 via paramDefs) can be added later as a follow-up with minimal refactoring — the program generation function is already parameterized.

## Technical Approach

### Phase 0: Pre-requisite Bug Fix (CMemoryView)

Fix the Svelte 5 Set mutation bug before proceeding:

```typescript
// CMemoryView.svelte, line 126-129: change from .add() to reassignment
if (changed.length > 0) {
  glowingCells = new Set([...glowingCells, ...changed]);
}

// CMemoryView.svelte, line 134-136: change from .delete() to reassignment
function handleGlowEnd(index: number) {
  glowingCells = new Set([...glowingCells].filter((i) => i !== index));
}
```

Also increase `TOTAL_BYTES` from 32 to 64 on line 35. The existing collapsed display logic (`collapsedDisplayRows`) handles extra unallocated rows gracefully via ellipsis.

### Phase 1: Data Model Extensions (`c-program.ts`)

#### New CInstruction Kinds (2 new, not 6)

```typescript
// Array declaration with initializer list
| {
    kind: 'declare-array';
    code: string;
    varName: string;         // 'arr'
    elementType: CTypeName;  // 'int'
    values: number[];        // [10, 20, 30, 40]
  }

// Array indexing read: int x = arr[i]  (also used for OOB with index >= array size)
| {
    kind: 'array-index-read';
    code: string;
    varName: string;         // 'x' (target variable)
    type: CTypeName;         // 'int'
    arrayName: string;       // 'arr'
    index: number;           // 1 (or N for OOB)
  }
```

Pointer operations reuse existing instruction kinds:
- `int *p = arr;` → `declare-pointer-assign` with `targetName: 'arr'`
- `int a = *(p + 1);` → `pointer-arith-deref` (new, see below — needed for offset)
- `p++;` → `assign` with computed new address value
- `int c = *p;` → `pointer-arith-deref` with `offset: 0`

One additional instruction kind is needed for pointer arithmetic + dereference because the existing `deref-read-assign` calls `getVarValue(targetName)` which returns the whole-variable value — wrong for arrays. The new kind carries `offset` and `arrayName` for correct element resolution:

```typescript
// Pointer arithmetic + dereference: int a = *(p + offset)
| {
    kind: 'pointer-arith-deref';
    code: string;
    varName: string;         // 'a' (target variable)
    type: CTypeName;         // 'int'
    ptrName: string;         // 'p'
    offset: number;          // 1 (or 0 for plain *p)
    arrayName: string;       // 'arr'
    elementType: CTypeName;  // 'int' (needed for sizeof in address arithmetic)
  }
```

**Total: 3 new CInstruction kinds** (`declare-array`, `array-index-read`, `pointer-arith-deref`).

#### New CSubStep Action Kinds (3 new)

```typescript
// Extend CSubStep.action union:
| { kind: 'declareArray'; elementType: CTypeName; varName: string; count: number }
| { kind: 'assignArrayElement'; arrayName: string; index: number; value: number }
| { kind: 'highlightArrayElement'; arrayName: string; index: number }
```

Strip-specific visual concerns (pointer arrow position, arithmetic display, OOB ghost cell) are handled directly in the orchestrator's `executeSubStep`, not routed through `CSubStep.action`. This keeps `decomposeInstruction` focused on memory operations.

**Note:** The 6 new action kinds extend only `CSubStep.action`, NOT `CSubStepKind`. The sub-steps themselves reuse existing kinds (`declare`, `read`, `compute`, `assign`, `pointer-assign`) which map to `SUB_STEP_COLORS` for CodePanel highlighting.

#### Sub-Step Decomposition

**`declare-array` (`int arr[4] = {10, 20, 30, 40}`):**
- 1 `declare` sub-step: `action: { kind: 'declareArray', elementType: 'int', varName: 'arr', count: 4 }`
- N `assign` sub-steps: `action: { kind: 'assignArrayElement', arrayName: 'arr', index: i, value: values[i] }`
- Total: **N + 1** sub-steps

**`array-index-read` (`int x = arr[1]`):**
- 1 `declare` sub-step: `action: { kind: 'declareVar', typeName: 'int', varName: 'x' }`
- 1 `read` sub-step: `action: { kind: 'highlightArrayElement', arrayName: 'arr', index: 1 }`
- 1 `assign` sub-step: `action: { kind: 'assignVar', varName: 'x', value: elementValue }`
- Total: **3** sub-steps
- For OOB (index >= array size): same structure but `read` step triggers danger styling. Orchestrator detects OOB condition from `index >= arrayElements` at execute time.

**`pointer-arith-deref` (`int a = *(p + 1)`):**
- 1 `declare` sub-step: `action: { kind: 'declareVar', typeName: 'int', varName: 'a' }`
- 1 `compute` sub-step: `action: null` (orchestrator handles arrow slide + math display)
- 1 `read` sub-step: `action: { kind: 'highlightArrayElement', arrayName: 'arr', index: resolvedIndex }`
- 1 `assign` sub-step: `action: { kind: 'assignVar', varName: 'a', value: elementValue }`
- Total: **4** sub-steps

**Reused `declare-pointer-assign` (`int *p = arr`):**
- 3 sub-steps (declare + read + pointer-assign) — existing decomposition works. Orchestrator adds strip pointer arrow in the dispatch.

**Reused `assign` for `p++`:**
- 1 sub-step — orchestrator computes `currentPtrValue + C_TYPE_SIZES[elementType]` and emits `{ kind: 'assignVar', varName: 'p', value: newAddr }`. Arrow slide and math handled in dispatch.

#### `countSubSteps` and `decomposeInstruction`

Add 3 new cases. `pointer-arith-deref` decomposition uses `getVarValue(ptrName)` to read the current pointer address and computes the target element index as `(ptrAddr - arrayBaseAddr) / elementSize + offset`. This resolves `*p` after `p++` correctly.

### Phase 2: CMemoryView Extensions

#### Array Variable Model

```typescript
export interface CVariable {
  // ... existing fields ...
  arrayElements?: number;       // number of elements (only set for arrays)
  elementValues?: (number | null)[];  // per-element values for table view
}
```

`elementType` is derivable from `type` and `arrayElements` (`size / arrayElements` gives element size) — omitting it avoids redundancy. The `elementValues` array tracks per-element values for the table view, since the existing `value: number | null` field cannot represent N values.

#### Increase TOTAL_BYTES

```typescript
// CMemoryView.svelte, line 35
const TOTAL_BYTES = 64;  // was 32; supports arrays up to 6 ints + ~8 scalar variables
```

No props needed. `BASE_ADDRESS` stays `0x0100`. The collapsed display logic already handles the extra unallocated rows.

#### New Imperative Methods

```typescript
// Allocate array block (N * elementSize bytes)
export async function declareArray(
  elementType: CTypeName, name: string, count: number
): Promise<void>

// Assign one array element (writes bytes at base + index * elementSize)
export async function assignArrayElement(
  name: string, index: number, value: number
): Promise<void>

// Highlight a specific array element's bytes
export function highlightArrayElement(
  name: string, index: number, color?: string
): void

// Highlight bytes past array end (for OOB visualization — red tint)
export function highlightOob(name: string, index: number): void
```

#### Element-Level Highlighting

Use a separate typed state variable instead of overloading `highlightedVars` string keys:

```typescript
let highlightedElement: { arrayName: string; index: number; color: string } | null = $state(null);
```

The `highlightArrayElement` method sets this. `clearHighlights()` clears both `highlightedVars` and `highlightedElement`. Template logic computes which byte rows fall within the highlighted element's address range:

```typescript
// In displayRows template — check if this byte row is within the highlighted element
const elementAddr = v.address + highlightedElement.index * elementSize;
const isHighlighted = address >= elementAddr && address < elementAddr + elementSize;
```

#### Display Changes

**Bits view:** Array rows show `arr[0]`, `arr[1]`, etc. labels on each element's first byte. The left border color spans all rows of the array.

**Table view:** Array elements render as grouped rows:
```
Type   | Name    | Value | Address
int[4] | arr[0]  | 10    | 0x0110
       | arr[1]  | 20    | 0x0114
       | arr[2]  | 30    | 0x0118
       | arr[3]  | 40    | 0x011C
```

### Phase 3: CArrayStrip Component (New Widget)

`site/src/components/widgets/CArrayStrip.svelte`

Widget component with imperative API and internal state. No `WIDGET_ID` or `paramDefs` (receives configuration from the orchestrator).

#### Visual Design

```
      [0]       [1]       [2]       [3]
  ┌─────────┬─────────┬─────────┬─────────┐
  │   10    │   20    │   30    │   40    │
  └─────────┴─────────┴─────────┴─────────┘
       ↑ p
  0x0110 + 1×4 = 0x0114    (shown when "show math" is on)
```

#### Imperative API (7 methods)

```typescript
export function declareArray(name: string, elementType: CTypeName, count: number): void
export function assignElementValue(index: number, value: number): void  // "assign" verb matches CMemoryView convention
export function highlightElement(index: number, color?: string): void
export function clearHighlights(): void
export function setPointer(name: string, index: number): void
export async function movePointer(name: string, toIndex: number): Promise<void>
export function reset(): void
```

Arithmetic display and OOB ghost cell are passed as **reactive props** from the orchestrator, not imperative calls:

```typescript
interface CArrayStripProps {
  arithmeticDisplay?: { base: string; offset: number; size: number; result: string } | null;
  oobIndex?: number | null;  // shows ghost cell at this index when set
}
```

This eliminates `showArithmetic`, `hideArithmetic`, and `showOobCell` methods. The orchestrator sets these as reactive state that flows into the strip via props. Simpler and more aligned with Svelte's reactive model.

#### Critical Implementation Contract

All imperative methods **must** perform synchronous state mutations before their first `await`. This is required for fire-and-forget replay during `executePrev`:

```typescript
export async function movePointer(name: string, toIndex: number): Promise<void> {
  // SYNCHRONOUS state update first — this is what replay depends on
  pointers = new Map([...pointers, [name, toIndex]]);
  // THEN animate (cancellable by generation counter)
  const gen = generation;
  if (reducedMotion) return;
  await transitionPromise;
  if (gen !== generation) return;
}
```

`reset()` must be fully synchronous: set all state, increment generation, done. No `await`, no `tick()`.

#### Animation

- **Pointer arrow slide:** CSS `transform: translateX(calc(var(--pointer-index) * (var(--cell-width) + var(--cell-gap))))` — avoids layout reflow that `left` transitions cause. GPU-composited.
- **Cell appear:** CSS `@keyframes` slide-in
- **Element highlight:** CSS `background` transition
- **OOB ghost cell:** Red hatched CSS background via `repeating-linear-gradient`, scale-in animation
- All animations check `prefers-reduced-motion`

### Phase 4: CArrayDemo Orchestrator

`site/src/components/sandbox/CArrayDemo.svelte`

Follows CPointerDemo pattern: generation counter, cached sub-steps, flat executed array, pc-based navigation.

#### Program Generation

```typescript
function buildProgram(): CInstruction[] {
  return [
    // Act 1: Declaration
    { kind: 'declare-array', code: 'int arr[4] = {10, 20, 30, 40};',
      varName: 'arr', elementType: 'int', values: [10, 20, 30, 40] },

    // Act 2: Indexing
    { kind: 'array-index-read', code: 'int x = arr[1];',
      varName: 'x', type: 'int', arrayName: 'arr', index: 1 },
    { kind: 'array-index-read', code: 'int y = arr[3];',
      varName: 'y', type: 'int', arrayName: 'arr', index: 3 },

    // Act 3: Pointer arithmetic
    { kind: 'declare-pointer-assign', code: 'int *p = arr;',
      varName: 'p', targetType: 'int', targetName: 'arr' },
    { kind: 'pointer-arith-deref', code: 'int a = *(p + 1);',
      varName: 'a', type: 'int', ptrName: 'p', offset: 1,
      arrayName: 'arr', elementType: 'int' },
    { kind: 'pointer-arith-deref', code: 'int b = *(p + 2);',
      varName: 'b', type: 'int', ptrName: 'p', offset: 2,
      arrayName: 'arr', elementType: 'int' },
    { kind: 'assign', code: 'p++;',
      varName: 'p', value: 0 },  // value computed at decomposition time
    { kind: 'pointer-arith-deref', code: 'int c = *p;',
      varName: 'c', type: 'int', ptrName: 'p', offset: 0,
      arrayName: 'arr', elementType: 'int' },

    // Act 4: Out-of-bounds
    { kind: 'array-index-read', code: 'int bad = arr[4];',
      varName: 'bad', type: 'int', arrayName: 'arr', index: 4 },
  ];
}

const program = buildProgram();  // static, not $derived (fixed array size)
```

Note: `p++` uses `assign` with a placeholder value. The `decomposeInstruction` callback resolves the actual new address via `getVarValue('p') + C_TYPE_SIZES['int']`.

#### Show Math Toggle

Simple `$state(false)` boolean, not a paramDef. Toggle button in the UI following CMemoryView's "Show table"/"Show bits" pattern:

```typescript
let showMath = $state(false);
```

The arithmetic display is passed as a reactive prop to CArrayStrip:

```typescript
let arithmeticDisplay = $state<{ base: string; offset: number; size: number; result: string } | null>(null);
```

Set by the orchestrator during `slidePointer`-equivalent logic; cleared at the start of each step.

#### Dual-View Dispatch with Generation Safety

```typescript
async function executeSubStep(step: CSubStep & { instrIdx: number }, gen: number) {
  memoryView.clearHighlights();
  strip.clearHighlights();
  arithmeticDisplay = null;  // clear arithmetic display reactively

  if (!step.action) {
    await new Promise((r) => setTimeout(r, 400));
    if (gen !== generation) return;  // check after every await
    return;
  }

  switch (step.action.kind) {
    case 'declareVar':
      await memoryView.declareVar(step.action.typeName, step.action.varName, step.action.targetType);
      if (gen !== generation) return;  // check after every await
      break;
    case 'declareArray':
      await memoryView.declareArray(step.action.elementType, step.action.varName, step.action.count);
      if (gen !== generation) return;
      strip.declareArray(step.action.varName, step.action.elementType, step.action.count);
      break;
    case 'assignArrayElement':
      await memoryView.assignArrayElement(step.action.arrayName, step.action.index, step.action.value);
      if (gen !== generation) return;
      strip.assignElementValue(step.action.index, step.action.value);
      break;
    case 'highlightArrayElement': {
      const instr = program[step.instrIdx];
      const isOob = instr.kind === 'array-index-read' && step.action.index >= getArraySize(step.action.arrayName);
      if (isOob) {
        oobIndex = step.action.index;  // reactive prop triggers ghost cell
        memoryView.highlightOob(step.action.arrayName, step.action.index);
      } else {
        memoryView.highlightArrayElement(step.action.arrayName, step.action.index);
        strip.highlightElement(step.action.index);
      }
      break;
    }
    case 'assignVar':
      await memoryView.assignVar(step.action.varName, step.action.value);
      if (gen !== generation) return;
      // For pointer assign, also update strip arrow
      if (isPointerVar(step.action.varName)) {
        const targetIndex = computeArrayIndex(step.action.value);
        strip.setPointer(step.action.varName, targetIndex);
      }
      break;
    case 'highlightVar':
      memoryView.highlightVar(step.action.varName);
      break;
  }
}
```

#### Replay (executePrev)

```typescript
function replaySubStep(step: CSubStep & { instrIdx: number }, isLast: boolean) {
  if (!step.action) return;
  switch (step.action.kind) {
    case 'declareVar':
      void memoryView.declareVar(step.action.typeName, step.action.varName, step.action.targetType);
      break;
    case 'declareArray':
      void memoryView.declareArray(step.action.elementType, step.action.varName, step.action.count);
      strip.declareArray(step.action.varName, step.action.elementType, step.action.count);
      break;
    case 'assignArrayElement':
      void memoryView.assignArrayElement(step.action.arrayName, step.action.index, step.action.value);
      strip.assignElementValue(step.action.index, step.action.value);
      break;
    case 'highlightArrayElement':
      if (isLast) {
        memoryView.highlightArrayElement(step.action.arrayName, step.action.index);
        strip.highlightElement(step.action.index);
      }
      break;
    case 'assignVar':
      void memoryView.assignVar(step.action.varName, step.action.value);
      if (isPointerVar(step.action.varName)) {
        // Use setPointer (instant, no animation) — NOT movePointer
        strip.setPointer(step.action.varName, computeArrayIndex(step.action.value));
      }
      break;
    case 'highlightVar':
      if (isLast) memoryView.highlightVar(step.action.varName);
      break;
  }
}
```

Key: replay uses `strip.setPointer` (instant) NOT `strip.movePointer` (animated). Animation during replay would be disorienting and block the replay loop.

#### isAnimating Lock Timing

Set `isAnimating = true` before updating `pc`, not after, to prevent keyboard repeat from slipping through:

```typescript
async function executeNext() {
  const nextPc = pc + 1;
  if (isAnimating || nextPc >= totalSubSteps) return;
  isAnimating = true;  // lock FIRST
  // ... expand sub-steps, update pc ...
}
```

### Phase 5: CodePanel Syntax Highlighting Update

Add `[]` and `{}` to the tokenizer regex as punctuation:

```typescript
const TOKEN_RE =
  /\b(int|char|float|double)\b|\b(printf|scanf)\b|"[^"]*"|'.'|\b\d+(?:\.\d+)?\b|[+\-*/=;,()&\[\]{}]/g;
```

### Phase 6: Sandbox Page

`site/src/pages/sandbox/c-array.astro`

```astro
---
import SandboxLayout from '../../layouts/SandboxLayout.astro';
import CArrayDemo from '../../components/sandbox/CArrayDemo.svelte';
---
<SandboxLayout title="C Arrays" description="Visualizes array memory layout, indexing, and pointer arithmetic equivalence — showing how arr[i] and *(arr+i) access the same bytes.">
  <CArrayDemo client:load />
</SandboxLayout>
```

## Acceptance Criteria

### Functional Requirements

- [ ] **Act 1:** Stepping through `int arr[4] = {10,20,30,40}` allocates 16 contiguous bytes in CMemoryView, fills CArrayStrip cells one by one with glow animation
- [ ] **Act 2:** `arr[i]` highlights the correct element in both views with matching color; value is read and assigned to a new variable
- [ ] **Act 3:** `int *p = arr` shows pointer arrow in strip at index 0; pointer arithmetic slides the arrow and optionally shows math
- [ ] **Act 3:** `*(p + offset)` dereferences correctly, showing the element the pointer reaches
- [ ] **Act 3:** `p++` updates pointer value and arrow position; subsequent `*p` reads `arr[1]` (value 20), NOT arr[0]
- [ ] **Act 4:** `arr[4]` shows red/hatched ghost cell in strip, red-tinted bytes past array end in CMemoryView
- [ ] **Show math toggle:** Button toggles arithmetic display; immediately reactive via prop; does not affect step count
- [ ] **Prev/Next navigation:** Stepping backward replays both views correctly (instant strip positioning, no animation)
- [ ] **Reset:** Clears both views, resets pc, re-initializes garbage bytes
- [ ] **View mode toggle:** CMemoryView bits↔table toggle works correctly with array grouping in both modes
- [ ] **Color linking:** When an element is highlighted, both CArrayStrip cell and CMemoryView bytes use the same color
- [ ] **Responsive:** Layout adapts to mobile (stacked columns); CArrayStrip handles 4 elements without overflow
- [ ] **Generation safety:** Every `await` in `executeSubStep` is followed by `if (gen !== generation) return;`

### Non-Functional Requirements

- [ ] **Accessibility:** CArrayStrip has ARIA roles, pointer position announced via `aria-live="polite"`, `prefers-reduced-motion` respected
- [ ] **Performance:** Pointer slide uses CSS `transform` (GPU-composited), not `left` (triggers layout reflow)
- [ ] **Backward compatibility:** `TOTAL_BYTES` increase is transparent; collapsed display handles extra rows; all existing demos unchanged

## Implementation Phases

### Phase 0: CMemoryView Bug Fix + Capacity
- [x] Fix `glowingCells` Set mutation bug (`.add()` → reassignment)
- [x] Increase `TOTAL_BYTES` from 32 to 64
- **Files:** `site/src/components/widgets/CMemoryView.svelte`

### Phase 1: Data Model (`c-program.ts`)
- [x] Add 3 new `CInstruction` kinds (`declare-array`, `array-index-read`, `pointer-arith-deref`)
- [x] Add 3 new `CSubStep.action` kinds (`declareArray`, `assignArrayElement`, `highlightArrayElement`)
- [x] Implement `countSubSteps` and `decomposeInstruction` for new kinds
- **Files:** `site/src/lib/c-program.ts`

### Phase 2: CMemoryView Extensions
- [x] Add `arrayElements` and `elementValues` to `CVariable` interface
- [x] Add `highlightedElement` state for element-level highlighting
- [x] Implement `declareArray`, `assignArrayElement`, `highlightArrayElement`, `highlightOob`
- [x] Update bits view display for array element labels
- [x] Update table view display for array element grouping
- **Files:** `site/src/components/widgets/CMemoryView.svelte`

### Phase 3: CArrayStrip Component
- [x] Create widget with imperative API (7 methods)
- [x] Arithmetic display and OOB as reactive props from orchestrator
- [x] CSS `transform`-based pointer slide animation
- **Files:** `site/src/components/widgets/CArrayStrip.svelte`

### Phase 4: CArrayDemo Orchestrator
- [x] Static program (fixed size 4)
- [x] Dual-view dispatch with generation checks after every `await`
- [x] `replaySubStep` for both views (instant strip positioning)
- [x] showMath as boolean toggle button
- **Files:** `site/src/components/sandbox/CArrayDemo.svelte`

### Phase 5: CodePanel + Sandbox Page
- [x] Update CodePanel tokenizer regex for `[]` and `{}`
- [x] Create sandbox page
- **Files:** `site/src/components/widgets/shared/CodePanel.svelte`, `site/src/pages/sandbox/c-array.astro`

## Dependencies & Risks

| Risk | Mitigation |
|------|-----------|
| CMemoryView `TOTAL_BYTES` increase affects existing demos | Collapsed display handles extra rows; no visible change |
| Array grouping in bits view is visually complex | Keep annotation simple — `arr[i]` label on first byte of each element |
| `*p` after `p++` reads wrong value | Use `pointer-arith-deref` with `offset: 0`, not `deref-read-assign` with `targetName: 'arr'` |
| Dual-view dispatch races | Generation check after every `await`; synchronous-first method contract |
| CArrayStrip overflow on narrow viewports | Set min-cell-width, allow horizontal scroll |
| Replay writes to reset views | Fire-and-forget pattern; synchronous mutations before first `await` |

## Sources & References

- **Origin brainstorm:** [docs/brainstorms/2026-03-09-array-widget-brainstorm.md](docs/brainstorms/2026-03-09-array-widget-brainstorm.md) — Key decisions: dual-view architecture, color-coded linking, progressive narrative, out-of-bounds inclusion
- **Pointer widget plan:** [docs/plans/2026-03-09-feat-pointer-visualization-widget-plan.md](docs/plans/2026-03-09-feat-pointer-visualization-widget-plan.md) — Established orchestrator pattern, sub-step decomposition, CMemoryView API
- **Existing orchestrator pattern:** [site/src/components/sandbox/CPointerDemo.svelte](site/src/components/sandbox/CPointerDemo.svelte)
- **C program engine:** [site/src/lib/c-program.ts](site/src/lib/c-program.ts)
- **CMemoryView component:** [site/src/components/widgets/CMemoryView.svelte](site/src/components/widgets/CMemoryView.svelte)
- **CodePanel component:** [site/src/components/widgets/shared/CodePanel.svelte](site/src/components/widgets/shared/CodePanel.svelte)
