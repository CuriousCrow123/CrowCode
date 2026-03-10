---
title: "feat: Instruction Sub-Step Decomposition"
type: feat
status: completed
date: 2026-03-09
origin: docs/brainstorms/2026-03-09-c-memory-view-brainstorm.md
deepened: 2026-03-09
---

# feat: Instruction Sub-Step Decomposition

## Enhancement Summary

**Deepened on:** 2026-03-09
**Agents used:** TypeScript Reviewer, Performance Oracle, Code Simplicity Reviewer, Architecture Strategist, Frontend Races Reviewer, Pattern Recognition Specialist, Security Sentinel, CSS Research (Explore)

### Key Improvements

1. **Upgrade cancellation to generation counter** — 3 agents independently flagged the `cancelled` boolean as the top risk. Sub-steps double the replay call count, making orphaned async chains a real problem. ~10 lines of change in CMemoryView.
2. **Rename `action.type` → `action.kind`** — Codebase convention uses `kind` for all discriminated unions. `type` collides with `CTypeName` semantics.
3. **Replace `{ type: 'none' }` with `action: null`** — Simpler representation for compute steps (no memory change).
4. **Merge Phase 3 into Phase 4** — Red tint is a one-line ternary that only makes sense in context of sub-step execution.
5. **Cache invalidation on backward navigation** — Must clear entries for instructions *after* current pc to prevent stale labels on re-forward.
6. **`ch`-unit constraint documentation** — Works for our monospace + ASCII-only subset, but professional editors avoid `ch` units. Document fragility and constraints.

### New Considerations Discovered

- Orphaned `scrollToAddress` calls after replay fire 400ms later (generation counter fixes this)
- `waitForGlow` RAF polling has no clean escape when timeout fires first (generation counter fixes this too)
- Sub-expression overlay must be a child of `<code>`, not `.code-line`, for correct `ch` positioning
- Pre-existing MemoryTable issues found (transitionend/animationend bubbling) — tracked separately, not in scope

---

## Overview

Break down each C instruction into visible sub-steps — declare, read, compute, assign — with corresponding code sub-expression highlighting and distinct memory animations per phase. Currently, clicking "Next" executes an entire instruction at once (e.g., `int y = x + 32;` runs as one step). After this change, each instruction decomposes into 2-4 sub-steps the user steps through individually, seeing exactly which part of the code maps to which memory operation.

(See brainstorm: `docs/brainstorms/2026-03-09-c-memory-view-brainstorm.md` — this extends the CMemoryView widget built in the initial plan.)

## Problem Statement

The current CMemoryView demo executes complete instructions per step. For `int y = x + 32;`, the user sees the line highlight and all memory changes happen at once. This hides the conceptual decomposition: declaring y (allocating garbage bytes), reading x (fetching its value), computing x + 32, and writing the result to y. These are distinct operations the CPU performs, and making them visible is the core teaching goal.

Additionally, uninitialized memory (after `declare` but before `assign`) looks identical to assigned memory — there's no visual signal that the bytes are garbage and potentially dangerous to read.

## Proposed Solution

Four changes across existing files — no new files created:

| File | Change |
|------|--------|
| `site/src/lib/c-program.ts` | Add `CSubStep` type + `decomposeInstruction()` function |
| `site/src/components/widgets/shared/CodePanel.svelte` | Add sub-expression highlight overlay + status label |
| `site/src/components/widgets/CMemoryView.svelte` | Red-tinted highlight for uninitialized variables |
| `site/src/components/sandbox/CMemoryViewDemo.svelte` | Replace instruction-level stepping with sub-step stepping |

### Architecture

The decomposition lives in the **data model** (`c-program.ts`), not the widget. A pure function `decomposeInstruction()` takes an instruction and returns an ordered array of `CSubStep` objects. The **orchestrator** (demo/section) flattens all sub-steps and iterates through them, calling the same CMemoryView imperative API that already exists (`declareVar`, `highlightVar`, `assignVar`). No new widget API methods needed.

CodePanel gets a minimal enhancement: a positioned overlay for sub-expression highlighting using `ch` units (monospace font = 1 character = 1 `ch`). This avoids modifying the existing `highlightSyntax` HTML output.

## Technical Approach

### Phase 1: Data Model — `CSubStep` type and decomposition

**File:** `site/src/lib/c-program.ts`

#### Sub-step type

```ts
export type CSubStepKind = 'declare' | 'read' | 'compute' | 'assign';

export interface CSubStep {
  kind: CSubStepKind;
  /** Substring of the instruction's `code` to highlight (found via indexOf) */
  highlight: string;
  /** Human-readable status label */
  label: string;
  /** Action to perform on the memory view, or null for compute (no memory change) */
  action:
    | { kind: 'declareVar'; typeName: CTypeName; varName: string }
    | { kind: 'assignVar'; varName: string; value: number }
    | { kind: 'highlightVar'; varName: string }
    | null;
}
```

Each sub-step carries:
- `kind` — visual category (controls highlight color + memory tint)
- `highlight` — substring to find in the code line for sub-expression highlighting
- `label` — status text (e.g., "Declare y (4 bytes, uninitialized)")
- `action` — what to call on CMemoryView (maps 1:1 to existing imperative API), or `null` for compute steps

> **Research insight:** Action discriminant uses `kind` (not `type`) to match the codebase convention — `CInstruction` uses `kind`, and `type` collides with `CTypeName` semantics. `null` replaces `{ type: 'none' }` since compute steps have no memory operation — `if (!step.action) { /* pause */ }` is cleaner than a switch case. (TypeScript Reviewer, Simplicity Reviewer, Pattern Recognition)

#### Decomposition function

```ts
export function decomposeInstruction(
  instr: CInstruction,
  getVarValue?: (name: string) => number | null,
): CSubStep[]
```

`getVarValue` is optional — used for `eval-assign` to read source variable values for labels (e.g., "Read x → 10"). When omitted (instant replay), labels show without values.

**Decomposition rules per instruction kind:**

| Kind | Sub-steps |
|------|-----------|
| `declare` | 1: declare |
| `assign` | 1: assign |
| `declare-assign` | 2: declare → assign |
| `eval-assign` | 3-4: declare target (if new type) → read each source → compute → assign |

**Example:** `{ kind: 'eval-assign', code: 'int y = x + 32;', target: { name: 'y', type: 'int' }, sources: ['x'], value: 42 }`

→ Sub-steps:
1. `{ kind: 'declare', highlight: 'int y', label: 'Declare y (4 bytes, uninitialized)', action: { kind: 'declareVar', typeName: 'int', varName: 'y' } }`
2. `{ kind: 'read', highlight: 'x', label: 'Read x → 10', action: { kind: 'highlightVar', varName: 'x' } }`
3. `{ kind: 'compute', highlight: 'x + 32', label: '10 + 32 = 42', action: null }`
4. `{ kind: 'assign', highlight: 'y = x + 32', label: 'Assign y = 42', action: { kind: 'assignVar', varName: 'y', value: 42 } }`

**Substring matching:** `highlight` is found via `code.indexOf(highlight)`. For our hardcoded C teaching examples, this is unambiguous. Document the constraint that the highlight substring must appear exactly once in the code string.

#### Phase 1 acceptance criteria

- [x] `CSubStep` and `CSubStepKind` types exported from `c-program.ts`
- [x] `decomposeInstruction()` correctly decomposes all 4 instruction kinds
- [x] `declare` → 1 sub-step, `assign` → 1 sub-step, `declare-assign` → 2, `eval-assign` → 3-4
- [x] `getVarValue` callback used for read/compute labels when provided
- [x] `highlight` substrings are valid substrings of `instr.code`
- [x] Type-checks with `npm run build`

---

### Phase 2: CodePanel Sub-Expression Highlighting

**File:** `site/src/components/widgets/shared/CodePanel.svelte`

#### New props

```ts
interface CodePanelProps {
  // ... existing props ...
  /** Character range within active line to highlight */
  subHighlight?: { start: number; end: number; kind: CSubStepKind };
  /** Status label below step controls */
  statusLabel?: string;
}
```

#### Sub-expression highlight overlay

Render a positioned `<span>` overlay **inside the `<code>` element** (not `.code-line`), using `ch` units for character-accurate positioning in monospace font:

```svelte
<code style="position: relative;">
  {@html highlightSyntax(instr.code)}
  {#if idx === currentLine && subHighlight}
    <span
      class="sub-highlight sub-highlight--{subHighlight.kind}"
      style="left: {subHighlight.start}ch; width: {subHighlight.end - subHighlight.start}ch"
    ></span>
  {/if}
</code>
```

The overlay must be a child of `<code>` (which gets `position: relative`), **not** `.code-line` — otherwise the line number `<span>` width would offset `ch` positioning. The overlay is a semi-transparent background strip with `position: absolute` — it doesn't interfere with the syntax-highlighted text above it.

> **Research insight: `ch` units.** Professional editors (CodeMirror, Monaco) avoid `ch` units, preferring `canvas.measureText()` or DOM measurement for pixel-accurate positioning. However, `ch` units work for our constrained case: (1) true monospace font via `var(--font-mono)`, (2) no HTML-expanding characters in the C subset, (3) no `letter-spacing` or `padding` on syntax spans. Add a defensive CSS rule `code span { letter-spacing: normal; padding: 0; }` and document the constraint. If this proves fragile, fall back to `canvas.measureText()` with a cached char-width. (CSS Research, Performance Oracle, Pattern Recognition)

**Color mapping per sub-step kind:**

| Kind | Color | Rationale |
|------|-------|-----------|
| `declare` | `rgba(239, 68, 68, 0.15)` (red tint) | Danger — uninitialized garbage |
| `read` | `rgba(99, 102, 241, 0.15)` (indigo) | Matches existing read-pulse |
| `compute` | `rgba(234, 179, 8, 0.15)` (yellow) | Intermediate computation |
| `assign` | `rgba(34, 197, 94, 0.15)` (green) | Success — value written |

#### Status label

Below step controls (or below code lines if controls hidden):

```svelte
{#if statusLabel}
  <div class="status-label">
    <span class="status-arrow">▸</span> {statusLabel}
  </div>
{/if}
```

Styled: `font-size: 0.7rem`, `color: var(--color-text-muted)`, `padding: 0.4rem 0.75rem`, `font-style: italic`.

#### `ch`-unit safety

The C subset used in teaching examples contains no HTML-special characters (`<`, `>`, `&`, `"`), so `ch` units map 1:1 to source characters. The `escapeHtml` calls in `highlightSyntax` don't alter character count for this subset. Document this constraint in a code comment. Add a defensive CSS rule to ensure syntax-highlighted spans don't introduce spacing drift:

```css
.code-line code span { letter-spacing: normal; padding: 0; }
```

#### Phase 2 acceptance criteria

- [x] `subHighlight` prop renders a colored overlay at correct character positions
- [x] Overlay colors differ by `kind` (red, indigo, yellow, green)
- [x] `statusLabel` prop renders below step controls with subtle styling
- [x] Overlay doesn't interfere with syntax highlighting or line highlighting
- [x] Works with existing `currentLine` prop (overlay only shows on active line)
- [x] No `subHighlight` = no overlay (backward compatible)
- [x] No `statusLabel` = no label (backward compatible)

---

### Phase 3: CMemoryView Enhancements (Red Tint + Generation Counter)

**File:** `site/src/components/widgets/CMemoryView.svelte`

#### 3a. Uninitialized variable red tint

When a variable has `value === null` (declared but not yet assigned), its bytes should display with a reddish tint instead of the normal variable color. This visually communicates "these bytes are garbage — don't trust them."

Add a constant:

```ts
const UNINITIALIZED_TINT = 'rgba(239, 68, 68, 0.20)'; // red with low opacity
```

In the byte-row template, when computing the highlight color for BitCell:

```ts
// Current: always uses variable's color
const highlightColor = owningVar ? owningVar.color : undefined;

// New: red tint if uninitialized
const highlightColor = owningVar
  ? (owningVar.value === null ? UNINITIALIZED_TINT : owningVar.color)
  : undefined;
```

When `assignVar` sets `v.value = value`, the variable's normal color takes over automatically on the next render cycle — no additional cleanup needed.

#### 3b. Replace `cancelled` boolean with generation counter

> **Research insight (critical — 3 agents flagged independently):** The current `cancelled` boolean in `reset()` (set `true` → clear state → set `false` synchronously) has a vulnerability window. After `reset()` finishes, `cancelled` is already `false`, so orphaned async chains from prior `declareVar`/`assignVar` calls resume after `await tick()` and fire stale `scrollToAddress` calls and `setTimeout` callbacks. Sub-steps double the number of replay calls per "Prev" click, making this measurably worse. (Performance Oracle, Frontend Races Reviewer, Pattern Recognition)

Replace the `cancelled` boolean with a monotonic generation counter:

```ts
let generation = $state(0);

export function reset() {
  generation++;  // invalidate all outstanding async chains
  stackPointer = BASE_ADDRESS + TOTAL_BYTES;
  variables = [];
  bits = initBits();
  prevBits = new Uint8Array(bits);
  glowingCells = new Set();
  highlightedVars = new Set();
}

export async function declareVar(type: CTypeName, name: string): Promise<void> {
  const gen = generation;
  // ... synchronous state mutations ...
  await tick();
  if (generation !== gen) return;  // stale chain, bail
  scrollToAddress(stackPointer);
  if (reducedMotion || generation !== gen) return;
  await new Promise<void>(r => setTimeout(r, values.glowDuration));
  if (generation !== gen) return;
}

// Same pattern for assignVar, highlightVar
```

~10 lines of change total. Eliminates orphaned `scrollToAddress`, `setTimeout`, and `waitForGlow` RAF polling chains.

#### Phase 3 acceptance criteria

- [x] Declared-but-unassigned variables show red-tinted bytes
- [x] After assignment, normal variable color returns
- [x] Red tint is subtle (not alarming, but noticeable)
- [x] Existing glow-pulse animation still works on top of red tint
- [x] `reset()` returns to normal (no lingering red)
- [x] Generation counter prevents stale async chains after `reset()`
- [x] Rapid "Prev" clicking doesn't produce orphaned scroll/glow animations
- [x] `waitForGlow` exits cleanly when generation changes

---

### Phase 4: Sub-Step Orchestration in Demo

**File:** `site/src/components/sandbox/CMemoryViewDemo.svelte`

Replace instruction-level stepping with sub-step-level stepping.

#### Navigation model

```ts
// Flatten all instructions into sub-steps
const allSubSteps = $derived(
  program.flatMap((instr, instrIdx) =>
    decomposeInstruction(instr, (name) => memoryView?.getVariable(name)?.value ?? null)
      .map(step => ({ ...step, instrIdx }))
  )
);

let pc = $state(-1); // indexes into allSubSteps (not program)
```

Each "Next" click increments `pc` and executes `allSubSteps[pc]`. CodePanel receives:
- `currentLine = pc >= 0 ? allSubSteps[pc].instrIdx : -1`
- `subHighlight = { start, end, kind }` — computed from `allSubSteps[pc].highlight` via `code.indexOf()`
- `statusLabel = allSubSteps[pc].label`

#### Executing a sub-step

```ts
async function executeSubStep(step: CSubStep & { instrIdx: number }) {
  if (!step.action) {
    // Compute step — no memory change, brief pause for comprehension
    // setTimeout is acceptable here (no DOM element to animate, unlike ADR 003's preference
    // for animation-driven timing). This is a deliberate conceptual delay.
    await new Promise(r => setTimeout(r, values?.glowDuration ?? 400));
    return;
  }
  switch (step.action.kind) {
    case 'declareVar':
      await memoryView.declareVar(step.action.typeName, step.action.varName);
      break;
    case 'assignVar':
      await memoryView.assignVar(step.action.varName, step.action.value);
      break;
    case 'highlightVar':
      await memoryView.highlightVar(step.action.varName);
      break;
  }
}
```

#### Backward navigation

Same approach as before — reset + instant replay:

```ts
function executePrev() {
  if (isAnimating || pc < 0) return;
  pc--;
  memoryView.reset();
  // Replay sub-steps 0..pc instantly
  for (let i = 0; i <= pc; i++) {
    replaySubStep(allSubSteps[i]);
  }
}

function replaySubStep(step: CSubStep & { instrIdx: number }) {
  // Fire-and-forget: synchronous state mutations run before first await.
  // Generation counter in CMemoryView ensures orphaned async continuations
  // (scrollToAddress, waitForGlow) bail out after reset().
  if (!step.action) return; // compute — no memory state change
  switch (step.action.kind) {
    case 'declareVar':
      void memoryView.declareVar(step.action.typeName, step.action.varName);
      break;
    case 'assignVar':
      void memoryView.assignVar(step.action.varName, step.action.value);
      break;
    case 'highlightVar':
      break; // transient visual, skip during replay
  }
}
```

**Key insight:** `read` and `compute` sub-steps are **transient** — they don't change memory state. During replay, they're skipped entirely. Only `declare` and `assign` are stateful.

#### `decomposeInstruction` and `getVarValue` timing

The `allSubSteps` derived uses `getVarValue` to populate labels. But during replay, variables may not exist yet. Solution: `getVarValue` returns `null` when the variable doesn't exist → labels show "Read x" instead of "Read x → 10". This is acceptable for instant replay (no one reads the labels during replay).

For forward execution, `decomposeInstruction` is called when the user clicks "Next" — at that point, source variables already exist from prior steps. So labels are correct during normal stepping.

**Caching:** Sub-steps are computed once per instruction when first reached, stored in a Map, and cleared on reset. This avoids reactive recomputation of labels when `variables` state changes (which would cause flickering). The `getVarValue` callback reads current widget state at the moment of computation — labels capture point-in-time values.

```ts
// Cache is safe because sub-steps are computed when the instruction is first reached
// (source variables already exist from prior steps) and cleared on reset.
// The cache is imperative (not $state) — it must not trigger reactive re-derivation.
let cachedSubSteps: Map<number, (CSubStep & { instrIdx: number })[]> = new Map();

function getSubStepsForInstruction(instrIdx: number): (CSubStep & { instrIdx: number })[] {
  if (!cachedSubSteps.has(instrIdx)) {
    const steps = decomposeInstruction(
      program[instrIdx],
      (name) => memoryView?.getVariable(name)?.value ?? null,
    ).map(step => ({ ...step, instrIdx }));
    cachedSubSteps.set(instrIdx, steps);
  }
  return cachedSubSteps.get(instrIdx)!;
}
```

**Reset clears the full cache:** `cachedSubSteps.clear()`.

**Backward navigation invalidation:** When `executePrev` decrements `pc`, clear cache entries for all instructions after the new `pc` position. This prevents stale labels if the user goes back then forward again (source variable values may differ on the second pass).

```ts
function executePrev() {
  if (isAnimating || pc < 0) return;
  pc--;
  // Clear cache entries for instructions beyond current position
  const currentInstrIdx = pc >= 0 ? allSubSteps[pc].instrIdx : -1;
  for (const key of cachedSubSteps.keys()) {
    if (key > currentInstrIdx) cachedSubSteps.delete(key);
  }
  memoryView.reset();
  for (let i = 0; i <= pc; i++) replaySubStep(allSubSteps[i]);
}
```

> **Research insight:** Architecture Strategist identified that without this invalidation, a prev-then-forward sequence could show stale labels (e.g., "Read x → 10" after x was changed to 20). The Pattern Recognition Specialist and TypeScript Reviewer also recommended documenting the cache safety invariant with a code comment.

#### Total sub-step count for demo program

| Instruction | Sub-steps |
|-------------|-----------|
| `int x;` | 1 (declare) |
| `x = 10;` | 1 (assign) |
| `char c = 'A';` | 2 (declare, assign) |
| `int y = x + 32;` | 4 (declare, read x, compute, assign) |
| **Total** | **8 sub-steps** |

User steps through 8 "Next" clicks instead of 4 — each with a distinct code highlight and memory animation.

#### Phase 4 acceptance criteria

- [x] "Next" advances one sub-step (not one instruction)
- [x] "Prev" goes back one sub-step with correct state
- [x] Code line highlighting tracks instruction index (same line for all sub-steps of one instruction)
- [x] Sub-expression overlay highlights the relevant code portion per sub-step
- [x] Status label updates per sub-step
- [x] `declare` sub-step shows red-tinted garbage bytes
- [x] `read` sub-step shows sustained highlight on source variable (outline + indigo tint, cleared on next step)
- [x] `compute` sub-step shows label only, brief pause, no memory change
- [x] `assign` sub-step writes bytes with glow animation
- [x] Reset clears sub-step cache and returns to initial state
- [x] Rapid clicking is guarded by `isAnimating`
- [x] `canPrev`/`canNext` correctly reflect sub-step boundaries
- [x] Step controls disabled during animation

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Where decomposition lives | `c-program.ts` (pure function) | Data model concern, not widget concern. Keeps widget API unchanged. (Architecture Strategist: confirmed correct layer) |
| Action discriminant field | `action.kind` (not `action.type`) | Matches codebase convention — `CInstruction` uses `kind`. `type` collides with `CTypeName` semantics. (TypeScript Reviewer, Pattern Recognition) |
| Compute action representation | `action: null` (not `{ type: 'none' }`) | Simpler — `if (!step.action)` is cleaner than a switch case. (Simplicity Reviewer, TypeScript Reviewer) |
| Sub-expression highlighting | `ch`-unit positioned overlay inside `<code>` | Avoids modifying `highlightSyntax`. Overlay must be child of `<code>` (not `.code-line`) for correct positioning. `ch` works for monospace ASCII subset but add defensive CSS. (CSS Research, Performance Oracle) |
| Highlight substring matching | `code.indexOf(highlight)` | Hardcoded teaching examples are unambiguous. Simple > clever. |
| Compute sub-step | Status label + `setTimeout` pause, no memory change | Computation is conceptual — no bytes change. `setTimeout` acceptable here (no DOM element to animate, per ADR 003). (Pattern Recognition) |
| Navigation granularity | Sub-step level (not instruction) | The whole point — each sub-step is a teachable moment. |
| Replay of transient steps | Skip `read`/`compute` during replay, prefix `void` on fire-and-forget | They don't modify memory state. `void` prefix documents intentionally discarded promises. (TypeScript Reviewer) |
| Sub-step caching | Eager per-instruction, invalidate forward entries on prev | Avoids reactive recomputation. Clear entries beyond current `pc` on backward nav to prevent stale labels. (Architecture Strategist) |
| Red tint for uninitialized | `rgba(239, 68, 68, 0.20)` conditional on `value === null` | Same red base as CodePanel `declare` color. Opacity differs (0.20 vs 0.15) — intentional: overlay on memory cells vs. overlay on code text. (Pattern Recognition) |
| Cancellation model | Generation counter (replaces `cancelled` boolean) | Sub-steps double replay call count. Boolean has vulnerability window after `reset()`. Counter is ~10 LOC, eliminates entire class of stale-chain bugs. (Performance Oracle, Frontend Races, Pattern Recognition) |

## Edge Cases (from SpecFlow analysis + agent reviews)

- **Table view during sub-steps**: Table view now has parallel animations — row fade-in on declare, indigo tint on read (sustained highlight), value glow on assign, red "???" for uninitialized. Both views stay in sync via shared `highlightedVars` and `glowingVarNames` state.
- **Replay safety**: The reset-and-replay approach works for sub-steps because CMemoryView's state mutations (`stackPointer`, `variables`, `bits[]`) happen synchronously within `declareVar`/`assignVar` *before* the first `await`. The generation counter ensures orphaned async continuations (scroll, glow, waitForGlow RAF polling) bail out after `reset()`. (Performance Oracle, Frontend Races)
- **Multi-source `eval-assign`**: If `sources: ['x', 'y']`, each source gets its own `read` sub-step in left-to-right order. The sub-step count varies by instruction — the orchestrator handles this via the flat `allSubSteps` array.
- **Stale cache on backward-then-forward navigation**: If the user goes back and the program allowed variable modification (future feature), cached sub-steps for instructions after the current `pc` could contain stale labels. The `executePrev` function clears cache entries beyond the new position. (Architecture Strategist)
- **`setTimeout` in compute step during rapid interaction**: If "Prev" fires during the compute pause, the pending `setTimeout` is orphaned. The `isAnimating` guard prevents re-entry, and the generation counter ensures the orphaned timeout's completion doesn't corrupt state. (Performance Oracle)
- **Glow burst on backward navigation**: After `reset()` + synchronous replay, the `$effect` that diffs `bits` detects all changes at once and glows all variable bytes simultaneously. This is the existing behavior for instruction-level replay and is acceptable — the glow fires briefly and fades. (Performance Oracle)
- **Progress indicator**: Defer to v2. The status label provides enough context for short programs (~8 sub-steps). A "Step 2/4" indicator could be added later if programs grow longer.
- **FOUT (Flash of Unstyled Text)**: `ch`-unit overlay positioning could be wrong during font loading. Low risk: step controls are user-initiated, happening seconds after page load. If needed, gate on `document.fonts.ready`. (Frontend Races)

## Dependencies & Risks

- **No new files**: All changes are to existing files. Low blast radius.
- **Backward compatibility**: New CodePanel props are optional. Existing usage without `subHighlight`/`statusLabel` is unchanged. (Pattern Recognition: "first time a shared component is extended with optional props — document convention in CLAUDE.md")
- **CMemoryView API unchanged**: Same `declareVar`, `assignVar`, `highlightVar` methods. No new widget API surface. (Architecture Strategist: confirmed correct — orchestrator owns stepping, widget owns memory visualization)
- **CMemoryView internal change**: Generation counter replaces `cancelled` boolean. This is a refactor of the cancellation model, not a new API. All callers unaffected.
- **`ch`-unit assumption**: Relies on monospace font for character-accurate positioning. Defended by `font-family: var(--font-mono)` and defensive CSS `code span { letter-spacing: normal; padding: 0; }`. If fragile in practice, fall back to `canvas.measureText()`. (CSS Research)
- **`indexOf` ambiguity**: If a highlight substring appears multiple times in the code, the first match is used. For our teaching examples, this doesn't happen. Add dev-mode validation: `if (code.indexOf(highlight) !== code.lastIndexOf(highlight)) console.warn(...)`. (TypeScript Reviewer)
- **`decomposeInstruction` label computation**: `getVarValue` reads current widget state. If called before the variable exists (during replay), returns `null` → label omits value. Acceptable.
- **Pre-existing MemoryTable issues discovered** (tracked separately, not in scope): `transitionend`/`animationend` event bubbling from child BitCells, `prevBits` not synced in `reset()`. (Frontend Races Reviewer)

## Verification

1. `npm run build` — no errors
2. `/sandbox/c-memory-view` — sub-steps work for all 4 instructions
3. `int x;` → 1 step: declare with red tint
4. `x = 10;` → 1 step: assign with glow
5. `char c = 'A';` → 2 steps: declare (red), assign (glow)
6. `int y = x + 32;` → 4 steps: declare y (red), read x (pulse), compute (label only), assign y (glow)
7. "Prev" correctly rolls back sub-steps
8. Reset returns to initial state
9. Sub-expression highlights match the correct code portion
10. Status label describes each sub-step clearly
11. Reduced motion: animations instant, labels still show
12. Mobile layout: stacked, everything visible

## Sources & References

### Origin

- **CMemoryView plan:** [docs/plans/2026-03-09-feat-c-memory-view-widget-plan.md](docs/plans/2026-03-09-feat-c-memory-view-widget-plan.md) — base widget this extends
- **Brainstorm:** [docs/brainstorms/2026-03-09-c-memory-view-brainstorm.md](docs/brainstorms/2026-03-09-c-memory-view-brainstorm.md)

### Internal References

- CMemoryView widget: `site/src/components/widgets/CMemoryView.svelte`
- CodePanel shared component: `site/src/components/widgets/shared/CodePanel.svelte`
- CInstruction types: `site/src/lib/c-program.ts`
- Demo orchestrator: `site/src/components/sandbox/CMemoryViewDemo.svelte`
- Animation patterns: `docs/archive/ANIMATION_PATTERNS.md`
- Animation strategy decision: `docs/decisions/003-widget-animation-strategy.md`
