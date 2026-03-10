---
title: "feat: C Memory View Widget"
type: feat
status: completed
date: 2026-03-09
origin: docs/brainstorms/2026-03-09-c-memory-view-brainstorm.md
deepened: 2026-03-09
---

# feat: C Memory View Widget

## Enhancement Summary

**Deepened on:** 2026-03-09
**Sections enhanced:** 4 phases + architecture
**Review agents used:** kieran-typescript-reviewer, performance-oracle, code-simplicity-reviewer, architecture-strategist, julik-frontend-races-reviewer, pattern-recognition-specialist, security-sentinel

### Key Improvements

1. **Simplified execution model** — Cut `ExecSubStep`/`expandInstruction`/`execInstruction` entirely. Section calls widget directly via `declareVar`, `assignVar`, `declareAssignVar` returning Promises. Massive reduction in abstraction surface.
2. **Fixed type safety** — `CVariable.value` changed from `initialized: boolean` + `value?: number` dual-track to single `value: number | null` union.
3. **Async lifecycle hardening** — Cancellation token pattern prevents Promise hangs on component destruction; `reset()` cancels in-flight chain before clearing state.
4. **Event bubbling guards** — `transitionend` and `animationend` handlers check `e.target === e.currentTarget` or `e.propertyName`/`e.animationName` to prevent bubbled child events from triggering premature resolution.
5. **Security** — `escapeHtml()` applied before regex tokenization in CodePanel's `highlightSyntax`, even though input is author-controlled.
6. **YAGNI cuts** — Removed `getState()`/`restoreState()`, `annotationWidth` param, `stepDelay` param (animation delay owned by section), CodePanel annotations deferred from v1.

### New Considerations Discovered

- `$state.raw([])` for bits array (256 elements, write-heavy) avoids Svelte 5 deep proxy overhead
- `await tick()` before starting CSS animation sequences ensures DOM has committed the triggering class change
- `canNext`/`canPrev` in section must include `&& !isAnimating` to prevent double-fire during animation
- Replay ("prev") should use `applyImmediate` flag to skip animation, writing all state in a single synchronous pass

---

## Overview

A widget pair that shows how C program instructions modify memory — teaching data types, byte sizes, initialization, and addressing. This is the next narrative step after MemoryTable in the visual essay progression:

1. BitGridRandom — "RAM is bits"
2. BitGridBytes — "bits change in groups of 8"
3. MemoryTable — "every byte has an address, memory is organized into sections"
4. **CMemoryView** — "C instructions allocate and modify specific bytes; different types use different amounts of memory"

(See brainstorm: `docs/brainstorms/2026-03-09-c-memory-view-brainstorm.md`)

## Problem Statement

The visual essay needs to bridge from "memory has addresses" (MemoryTable) to "C code controls what lives at those addresses." Students need to see that `int x;` claims 4 bytes, `char c;` claims 1 byte, uninitialized variables contain garbage, and the variable name maps to the address of its first byte.

## Proposed Solution

Three new components + one utility module:

| File | Type | Purpose |
|------|------|---------|
| `site/src/lib/c-program.ts` | Utility | Type definitions, byte encoding, garbage generation |
| `site/src/components/widgets/CMemoryView.svelte` | Widget | Focused byte grid with variable annotations |
| `site/src/components/widgets/shared/CodePanel.svelte` | Shared component | C code display with syntax highlighting + step controls |
| `site/src/components/sandbox/CMemoryViewDemo.svelte` | Sandbox demo | Section orchestrator for sandbox page |
| `site/src/pages/sandbox/c-memory-view.astro` | Sandbox page | Isolated development |

The **section component** (written per-essay, not a reusable component) composes CodePanel and CMemoryView side-by-side and orchestrates execution.

### Architecture (from brainstorm)

- **New standalone widget** — not an extension of MemoryTable (brainstorm: "the two use cases are fundamentally different")
- **Reuses BitCell** for bit rendering (consistent glow-pulse across the essay)
- **Section is the orchestrator** — owns the program counter, calls widget methods directly
- **Configurable instruction sequence** — the essay author defines the program as data in the section component

### Research Insights — Architecture

**Simplification (code-simplicity-reviewer, pattern-recognition-specialist):**
The original plan had a multi-layered execution model: `CInstruction` → `expandInstruction()` → `ExecSubStep[]` → `execSubStep()` → `execInstruction()`. For ~5 hardcoded instructions, this is over-engineered. The section already knows what each instruction does — it should call the widget directly:

```ts
// Before (over-engineered):
const { subSteps } = expandInstruction(program[pc], variables, sp);
for (const step of subSteps) await memoryView.execSubStep(step);

// After (direct):
await memoryView.declareVar('int', 'x');
await memoryView.assignVar('x', 10);
await memoryView.declareAssignVar('char', 'c', 65);
```

This cuts `ExecSubStep`, `expandInstruction`, `execSubStep`, and `execInstruction` entirely.

**Section as orchestrator (architecture-strategist):**
The section-as-orchestrator pattern is correct — neither widget knows about the other. The section wires `currentLine` to CodePanel and calls CMemoryView imperatively. This is a clean, tested pattern in the codebase (see InteractiveDemo.svelte).

**Async imperative API (pattern-recognition-specialist):**
Promise-returning imperative methods (`declareVar`, `assignVar` returning `Promise<void>`) are a new pattern in this codebase. This is a justified deviation — animation sequencing requires it. Document the pattern for future widgets.

---

## Technical Approach

### Phase 1: Data Model + Utilities

**Goal:** Create `site/src/lib/c-program.ts` with type definitions and byte utilities. Pure TypeScript, no Svelte — fully testable.

#### Type System

```ts
export type CTypeName = 'char' | 'int' | 'float' | 'double';

export const C_TYPE_SIZES: Record<CTypeName, number> = {
  char: 1, int: 4, float: 4, double: 8,
};

/** Color palette for variable annotations (one per variable, cycled) */
export const VAR_COLORS: string[] = [
  'rgba(99, 102, 241, 0.35)',   // indigo
  'rgba(34, 197, 94, 0.35)',    // green
  'rgba(249, 115, 22, 0.35)',   // orange
  'rgba(236, 72, 153, 0.35)',   // pink
  'rgba(234, 179, 8, 0.35)',    // yellow
];
```

#### Instruction Model

```ts
export type CInstruction =
  | { kind: 'declare'; code: string; varName: string; type: CTypeName }
  | { kind: 'assign'; code: string; varName: string; value: number }
  | { kind: 'declare-assign'; code: string; varName: string; type: CTypeName; value: number }
  | { kind: 'eval-assign'; code: string; target: { name: string; type?: CTypeName }; sources: string[]; value: number };
```

> **Simplification note:** Annotations removed from v1 instruction model (YAGNI — defer to v2). The `compute` function removed from `eval-assign`; the section pre-computes the `value` and passes it directly. This keeps the data model pure and eliminates a function-in-data anti-pattern.

#### Runtime State

```ts
export interface CVariable {
  name: string;
  type: CTypeName;
  address: number;      // byte offset in memory region
  size: number;         // C_TYPE_SIZES[type]
  color: string;        // annotation overlay color
  value: number | null; // null = uninitialized (garbage displayed)
}
```

> **Type safety fix (kieran-typescript-reviewer):** Single `value: number | null` replaces the dual-track `initialized: boolean` + `value?: number`. Null means uninitialized, number means assigned. No ambiguity.

#### Core Functions

```ts
/** Convert a value to big-endian byte array for a given type. */
export function valueToBytes(value: number, type: CTypeName): number[]
// Uses DataView for float/double (IEEE 754 big-endian)
// Uses bit shifting for int/char (big-endian)

/** Generate deterministic "garbage" bytes for uninitialized memory. */
export function garbageBytes(address: number, count: number, seed: number): number[]
// Simple seeded PRNG — same garbage on every replay within a session
```

> **Simplification:** `expandInstruction` removed. The section calls widget methods directly — no intermediate sub-step expansion needed. `c-program.ts` is now just types + two pure functions (~40 lines).

#### Phase 1 acceptance criteria

- [x]All types export from `c-program.ts`
- [x]`valueToBytes(10, 'int')` → `[0x00, 0x00, 0x00, 0x0A]` (big-endian)
- [x]`valueToBytes(65, 'char')` → `[0x41]`
- [x]`valueToBytes` handles float/double via DataView IEEE 754
- [x]`garbageBytes` is deterministic for same seed + address
- [x]`CVariable.value` is `number | null` (no dual-track state)

---

### Phase 2: CMemoryView Widget

**Goal:** Byte grid widget with variable annotations, Promise-based animation, and simplified table view.

**File:** `site/src/components/widgets/CMemoryView.svelte`

#### Widget Identity

- `WIDGET_ID = 'c-memory-view'`
- CSS prefix: `--cmv-`

#### paramDefs (7 params)

| name | value | unit | category | min | max | step | description |
|------|-------|------|----------|-----|-----|------|-------------|
| cellSize | 16 | px | grid | 10 | 28 | 1 | Bit cell width/height |
| cellGap | 2 | px | grid | 0 | 6 | 1 | Gap between bit cells |
| fontSize | 11 | px | grid | 0 | 16 | 1 | Bit digit font size |
| glowDuration | 400 | ms | animation | 50 | 1500 | 50 | Bit change glow duration |
| rowGap | 4 | px | style | 0 | 12 | 2 | Vertical gap between byte rows |
| visibleRows | 14 | rows | scroll | 6 | 32 | 1 | Max visible rows before scrolling |
| contextRows | 2 | rows | collapse | 0 | 8 | 1 | Unallocated rows to keep around allocated variables |

> **YAGNI cuts (code-simplicity-reviewer):** `stepDelay` removed — animation delay between steps is owned by the section (it controls the `await` chain, can `setTimeout` between calls if needed). `annotationWidth` removed — use `min-content`/auto-sizing for the annotation column.

Differences from MemoryTable: larger default cellSize (focused view, fewer cells). No `ambientRate` or `addressMode` (no ambient mode, fixed simple addresses).

#### Memory Layout

32 bytes. Stack grows downward — stack pointer starts at `BASE_ADDRESS + TOTAL_BYTES` and decrements by type size on each allocation:

```
Address 0x0100 (byte 0)  ← displayed at top
  ...
Address 0x011F (byte 31) ← stack pointer starts here, grows down
```

Display: **lowest address at top, highest at bottom** — so big-endian bytes read naturally top-to-bottom. (Changed from initial "highest at top" during implementation for readability.)

All 32 bytes initialized with seeded random bits on mount (the "whatever was there before").

#### Column Labels

A `.cmv-header` row above the scroll area provides subtle column labels (Addr, Var, Bits, Hex) using the same flex layout as `.byte-row` so columns align naturally. Styled: `font-size: 0.55rem`, `text-transform: uppercase`, `letter-spacing: 0.06em`, `opacity: 0.4`.

#### Scrollable Container with Auto-Scroll

The byte grid is wrapped in `.cmv-scroll-area` with `overflow-y: auto` and `max-height` computed from `visibleRows * (cellSize + rowGap)`. Row DOM elements are tracked via a Svelte `use:registerRow` action storing refs in a `Map<number, HTMLElement>`. `scrollToAddress(address)` computes the target offset and calls `scrollAreaEl.scrollTo()` — avoids `scrollIntoView` which can scroll the page. Called after `await tick()` in `declareVar`, `assignVar`, `highlightVar`. Respects `reducedMotion` for scroll behavior.

#### Row Collapsing

A derived `collapsedDisplayRows` replaces direct iteration:

- **No variables declared**: show all 32 rows (all dimmed — establishes "memory exists" before any C code runs)
- **Variables exist**: keep allocated rows + `contextRows` unallocated rows on each side. Collapse remaining contiguous unallocated regions into `{ kind: 'ellipsis', count }` placeholder items
- Ellipsis row: `··· {count} bytes ···` — small, italic, faded

When `declareVar` fires: variables update → `collapsedDisplayRows` recomputes → `await tick()` → `scrollToAddress(stackPointer)` smoothly scrolls to the new variable. `reset()` resets scroll position to top and clears the row element map.

#### Rendering — Bits View

```
[Addr]  [Var]  [Bits]                   [Hex]     ← column labels
 0x0100  │      │ 1 0 1 1 0 0 1 1 │ 0xB3    ← unallocated (dimmed)
  ··· 20 bytes ···                               ← collapsed unallocated rows
 0x0115  │      │ 0 1 1 0 1 0 0 1 │ 0x69    ← context row (dimmed)
 0x0116  │      │ 1 0 0 1 0 0 1 0 │ 0x92    ← context row (dimmed)
 0x0117  │      │ 0 0 0 0 0 0 0 0 │ 0x00  ┐
 0x0118  │      │ 0 0 0 0 0 0 0 0 │ 0x00  │ int x (indigo overlay)
 0x0119  │      │ 0 0 0 0 0 0 0 0 │ 0x00  │
 0x011A  │  x   │ 0 0 0 0 1 0 1 0 │ 0x0A  ┘
 0x011B  │  c   │ 0 1 0 0 0 0 0 1 │ 0x41    char c (green overlay)
 0x011C  │      │ 0 0 1 1 1 0 0 1 │ 0x39    ← context row (dimmed)
  ··· 3 bytes ···                                ← collapsed unallocated rows
```

> **Display order**: Lowest address at top, highest at bottom. Variable name labels appear on the first byte (lowest address) of each variable. Big-endian MSB is at the lowest address, reading top-to-bottom.

- Address column: 4-digit hex (simple mode only — no realistic mode needed here)
- Variable annotation column: name on the first byte, colored left-border spanning all bytes
- 8 × BitCell per row (reuses `shared/BitCell.svelte`)
- Hex value column
- Unallocated bytes: dimmed styling, random bits visible
- Variable bytes: colored background overlay via BitCell's `highlightColor` prop

#### Rendering — Table View (Simplified)

```
 Type   │ Name │ Value     │ Address
────────┼──────┼───────────┼─────────
 int    │ x    │ 10        │ 0x011A
 char   │ c    │ 'A' (65)  │ 0x0119
```

Toggle between views via `setViewMode()`. Transition: Svelte `{#if}` with `transition:fade`. A toggle button appears in the widget after the first prose-driven transition.

#### Imperative API

```ts
// Promise-based methods for animated execution (section calls these directly)
export function declareVar(type: CTypeName, name: string): Promise<void>
export function assignVar(name: string, value: number): Promise<void>
export function declareAssignVar(type: CTypeName, name: string, value: number): Promise<void>

// For eval-assign: section reads source values, computes result, then calls these
// Example for `int b = a + 10;`:
//   const aVal = memoryView.getVariable('a')!.value!;
//   await memoryView.highlightVar('a');          // visual: read pulse
//   await memoryView.declareAssignVar('int', 'b', aVal + 10);

export function highlightVar(name: string): Promise<void>  // read-pulse animation

// View control
export function setViewMode(mode: 'bits' | 'table'): void
export function getVariable(name: string): CVariable | undefined

// State control
export function reset(): void
```

> **Simplification (code-simplicity-reviewer):** `execSubStep`, `execInstruction`, `getState()`, `restoreState()` all removed. The widget exposes simple verb-based methods. The section calls them in sequence. For eval-assign, the section reads the source value via `getVariable`, does the arithmetic inline, and calls `declareAssignVar`.

> **Async pattern (pattern-recognition-specialist):** These Promise-returning imperative methods are a new pattern in this codebase (MemoryTable uses fire-and-forget). This is justified — animation sequencing requires it. Add a comment documenting this pattern for future widgets.

#### Animations

| Method | Visual | Resolves when |
|--------|--------|---------------|
| `declareVar` | Annotation bar fades in, bytes show garbage (seeded random) | Annotation fade-in animation ends |
| `assignVar` | Target bytes update, glow-pulse on changed cells | Last glow animation ends |
| `declareAssignVar` | Annotation fades in → then bytes write + glow | Last glow animation ends |
| `highlightVar` | Source variable's bytes pulse with distinct read-highlight color | Pulse animation ends |

#### Research Insights — Animation Safety

**Cancellation token (julik-frontend-races-reviewer, CRITICAL):**
If the component is destroyed mid-animation, Promises hang forever. Use a cancellation token:

```ts
let cancelled = false;

function animateWithGuard(el: HTMLElement, animName: string): Promise<void> {
  return new Promise((resolve) => {
    if (cancelled) { resolve(); return; }
    const onEnd = (e: AnimationEvent) => {
      if (e.animationName !== animName) return; // guard bubbling
      el.removeEventListener('animationend', onEnd);
      resolve();
    };
    el.addEventListener('animationend', onEnd);
    // Timeout fallback (2× glowDuration)
    setTimeout(resolve, values.glowDuration * 2);
  });
}

// In onDestroy / $effect cleanup:
// cancelled = true;
```

**Reset during animation (julik-frontend-races-reviewer, CRITICAL):**
`reset()` must set `cancelled = true`, clear all state synchronously, then set `cancelled = false` for the next chain. Any in-flight Promises resolve immediately via the guard.

**Event bubbling (julik-frontend-races-reviewer, performance-oracle):**
- `animationend`: check `e.animationName` matches expected — BitCell children bubble `animationend` to parent
- `transitionend`: check `e.target === e.currentTarget` or `e.propertyName` — prevents child transitions from triggering parent resolution

**DOM sync (julik-frontend-races-reviewer):**
Call `await tick()` before starting a CSS animation sequence to ensure the DOM has committed any class/state changes that trigger the animation.

**Performance (performance-oracle):**
- Use `$state.raw([])` for the 256-element bits array — write-heavy, no deep reactivity needed. Svelte 5's `$state.raw` avoids proxy overhead for arrays that are replaced wholesale rather than mutated.
- 256 BitCells (32 bytes × 8 bits) is well within Svelte 5's rendering capacity — no virtualization needed.
- For replay ("prev"), batch all byte writes into a single synchronous assignment rather than animating each step.

#### "Prev" / State Rollback

Replay from initial state up to `step - 1` (brainstorm: instruction sequences are short, ~5-10 lines). `reset()` + instant replay. The section calls widget methods with an `immediate: true` option (or a dedicated `applyImmediate` variant) to skip animation during replay.

```ts
// Section's executePrev:
function executePrev() {
  if (isAnimating || pc < 0) return;
  pc--;
  memoryView.reset();
  // Replay instructions 0..pc instantly (no animation)
  for (let i = 0; i <= pc; i++) {
    replayInstruction(program[i]); // calls widget methods with immediate flag
  }
}
```

Garbage bytes are deterministic per session via seeded PRNG — same garbage on every replay.

#### Phase 2 acceptance criteria

- [x]Sandbox page renders 32 bytes of seeded random bits
- [x]`declareVar('int', 'x')` allocates 4 bytes with colored annotation, returns Promise
- [x]`assignVar('x', 10)` writes big-endian bytes with glow animation, returns Promise
- [x]`declareAssignVar('char', 'c', 65)` allocates + writes in sequence
- [x]`highlightVar('a')` pulses source variable bytes with read-highlight color
- [x]Unallocated bytes show dimmed random bits
- [x]Variable annotations show name, colored border, span correct byte count
- [x]`setViewMode('table')` switches to simplified table with fade transition
- [x]`reset()` cancels in-flight animations, clears variables, reinitializes random bits (same seed)
- [x]WidgetDebugPanel renders all 7 params (cellSize, cellGap, fontSize, glowDuration, rowGap, visibleRows, contextRows)
- [x]`prefers-reduced-motion`: animations instant, methods still return Promises that resolve immediately
- [x]BitCell reused with `--bit-cell-*` CSS vars (same as MemoryTable pattern)
- [x]No ambient mode — memory only changes via explicit commands
- [x]Component destruction doesn't leave hanging Promises (cancellation token)
- [x]`animationend`/`transitionend` handlers guard against event bubbling
- [x]Column labels (Addr, Var, Bits, Hex) visible above scroll area
- [x]Scrollable container with auto-scroll to newly allocated variables
- [x]Unallocated rows collapse to ellipsis when variables exist, with configurable context rows
- [x]Display order: lowest address at top, highest at bottom

---

### Phase 3: CodePanel Shared Component

**Goal:** C code display with syntax highlighting and step controls.

**File:** `site/src/components/widgets/shared/CodePanel.svelte`

#### Props

```ts
interface CodePanelProps {
  instructions: CInstruction[];
  currentLine: number;               // -1 = none highlighted
  showControls?: boolean;             // prev/next buttons
  canPrev?: boolean;
  canNext?: boolean;
  onnext?: () => void;
  onprev?: () => void;
}
```

> **Simplification:** `activeSubStep` prop removed — sub-step feedback labels are deferred to v2. The CodePanel in v1 just shows code lines with the current line highlighted and optional step controls. This is sufficient for the teaching narrative.

No `WIDGET_ID`, no `paramDefs`. Follows the shared component pattern (ScrubSlider, BitCell).

#### Syntax Highlighting

Local `highlightSyntax(code: string): string` function — **single-pass tokenizer** for the C subset used in teaching examples:

- **Types**: `int`, `char`, `float`, `double` → `class="hl-type"`
- **Literals**: numbers, char literals (`'A'`) → `class="hl-literal"`
- **Operators**: `+`, `-`, `*`, `/`, `=` → `class="hl-op"`
- **Punctuation**: `;` → no special styling
- **Identifiers/whitespace**: everything else → default (escaped)

Uses a single regex (`TOKEN_RE`) with `exec()` loop — tokenizes first, then builds HTML from each match. This avoids the chained-replacement approach which caused HTML clobbering (operator regex matching `=` inside `<span class="...">` attributes of previously-inserted tags). Output is `{@html}`.

#### Research Insights — Security

**escapeHtml in single-pass tokenizer (security-sentinel):**
Even though code strings are hardcoded by the essay author, `escapeHtml()` is applied to each token individually within the single-pass tokenizer as defense-in-depth:

```ts
function highlightSyntax(code: string): string {
  const TOKEN_RE = /\b(int|char|float|double)\b|'.'|\b\d+(?:\.\d+)?\b|[+\-*/=;]/g;
  let result = '', lastIndex = 0, match;
  while ((match = TOKEN_RE.exec(code)) !== null) {
    if (match.index > lastIndex) result += escapeHtml(code.slice(lastIndex, match.index));
    const escaped = escapeHtml(match[0]);
    if (match[1]) result += `<span class="hl-type">${escaped}</span>`;
    else if (match[0].startsWith("'")) result += `<span class="hl-literal">${escaped}</span>`;
    // ... etc
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < code.length) result += escapeHtml(code.slice(lastIndex));
  return result;
}
```

This prevents any accidental HTML injection if code strings are ever sourced dynamically in the future. Document the constraint in a code comment regardless.

#### Active Line

```css
.code-line.active {
  background: rgba(99, 102, 241, 0.08);
  border-left: 2px solid var(--color-accent);
}
```

#### Step Controls

```svelte
{#if showControls}
  <div class="step-controls">
    <button onclick={onprev} disabled={!canPrev} aria-label="Previous instruction">Prev</button>
    <button onclick={onnext} disabled={!canNext} aria-label="Next instruction">Next</button>
  </div>
{/if}
```

#### Phase 3 acceptance criteria

- [x]Code lines render with minimal syntax highlighting
- [x]`highlightSyntax` uses single-pass tokenizer with `escapeHtml` per token
- [x]Current line has background + left-border highlight
- [x]Step controls render and fire callbacks
- [x]Prev/next disabled at boundaries
- [x]No WIDGET_ID, no paramDefs (shared component pattern)
- [x]Keyboard accessible (buttons are focusable, standard button semantics)

---

### Phase 4: Section Composition + Sandbox

**Goal:** Wire everything together. Build the sandbox page with a demo program.

#### Section Orchestration Pattern

The section component owns the program counter and orchestrates both components directly:

```svelte
<script lang="ts">
  import CMemoryView from '../widgets/CMemoryView.svelte';
  import CodePanel from '../widgets/shared/CodePanel.svelte';
  import type { CInstruction } from '../../lib/c-program';

  const program: CInstruction[] = [
    { kind: 'declare', code: 'int x;', varName: 'x', type: 'int' },
    { kind: 'assign', code: 'x = 10;', varName: 'x', value: 10 },
    { kind: 'declare-assign', code: "char c = 'A';", varName: 'c', type: 'char', value: 65 },
    { kind: 'eval-assign', code: 'int y = x + 32;', target: { name: 'y', type: 'int' }, sources: ['x'], value: 42 },
  ];

  let memoryView: ReturnType<typeof CMemoryView>;
  let pc = $state(-1);
  let isAnimating = $state(false);

  async function executeNext() {
    if (isAnimating || pc >= program.length - 1) return;
    pc++;
    isAnimating = true;

    const instr = program[pc];
    switch (instr.kind) {
      case 'declare':
        await memoryView.declareVar(instr.type, instr.varName);
        break;
      case 'assign':
        await memoryView.assignVar(instr.varName, instr.value);
        break;
      case 'declare-assign':
        await memoryView.declareAssignVar(instr.type, instr.varName, instr.value);
        break;
      case 'eval-assign': {
        // Read source values, highlight, compute, write
        for (const src of instr.sources) {
          await memoryView.highlightVar(src);
        }
        if (instr.target.type) {
          await memoryView.declareAssignVar(instr.target.type, instr.target.name, instr.value);
        } else {
          await memoryView.assignVar(instr.target.name, instr.value);
        }
        break;
      }
    }

    isAnimating = false;
  }

  function executePrev() {
    if (isAnimating || pc < 0) return;
    pc--;
    memoryView.reset();
    // Replay instructions 0..pc instantly (no animation)
    for (let i = 0; i <= pc; i++) {
      replayInstruction(program[i]);
    }
  }
</script>

<div class="cmv-layout">
  <CodePanel instructions={program} currentLine={pc}
    showControls={true}
    canPrev={pc >= 0 && !isAnimating}
    canNext={pc < program.length - 1 && !isAnimating}
    onnext={executeNext} onprev={executePrev} />
  <CMemoryView bind:this={memoryView} />
</div>
```

> **Key fix (kieran-typescript-reviewer):** `canPrev` and `canNext` now include `&& !isAnimating` to prevent double-fire during animation chains.

#### Side-by-Side Layout

```css
.cmv-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
  align-items: start;
}

@media (max-width: 768px) {
  .cmv-layout {
    grid-template-columns: 1fr;
  }
}
```

On mobile: stack vertically, CodePanel on top, CMemoryView below.

#### Sandbox Page

`site/src/pages/sandbox/c-memory-view.astro` — uses SandboxLayout. Contains a demo program with test controls for each imperative method.

Update `site/src/pages/sandbox/index.astro` with link.

#### Phase 4 acceptance criteria

- [x]Sandbox renders CodePanel + CMemoryView side-by-side
- [x]Demo program walks through: `int x;`, `x = 10;`, `char c = 'A';`, `int y = x + 32;`
- [x]Prose action buttons advance program (via section's `executeNext`)
- [x]Step controls on CodePanel also advance/rewind
- [x]CodePanel and CMemoryView stay synchronized
- [x]`canPrev`/`canNext` include `!isAnimating` guard
- [x]"Prev" replays from initial state instantly (correct rollback, no animation)
- [x]Rapid stepping is debounced (isAnimating guard)
- [x]Responsive: stacked on mobile
- [x]Sandbox index updated with new link

## Teaching Concepts Verification

After all phases, verify these concepts are visually communicated:

- [x]**Different data types = different byte counts**: `int x` claims 4 rows, `char c` claims 1 row
- [x]**Declaration without init = garbage**: `int x;` shows random bits in the allocated bytes
- [x]**Variable name = address of first byte**: annotation labels the first byte's row
- [x]**Assignment writes bit patterns**: `x = 10` → bytes update to `0x00 0x00 0x00 0x0A` with glow
- [x]**Evaluation reads and computes**: `int y = x + 32` → read x's bytes (highlight), compute (inline in section), write y's bytes (glow)
- [x]**Simplified table hides complexity**: toggle shows the "shorthand" view (type, name, value, address)

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| New widget vs. extend MemoryTable | New `CMemoryView` widget | MemoryTable is 577 lines with complex race conditions; use cases are different (brainstorm) |
| Execution orchestration | Section calls widget methods directly | No intermediate sub-step abstraction; section owns the sequencing logic inline |
| Data model scope | Types + 2 pure functions (~40 lines) | `expandInstruction` cut — section handles orchestration; `compute` function cut — section pre-computes values |
| Syntax highlighting | Single-pass regex tokenizer with per-token `escapeHtml` | Chained replacements caused HTML clobbering; single-pass avoids it; no library needed |
| State rollback ("prev") | Replay from initial state (instant, no animation) | Instruction sequences are short (~5-10 lines); replay is instant |
| Garbage values | Seeded PRNG, deterministic per session | Same garbage on every replay — consistent experience |
| Endianness | Big-endian (brainstorm) | Conceptual simplicity; avoids endianness rabbit hole |
| Addresses | Grow downward, 4-digit hex | Realistic stack convention; simple addressing |
| Display order | Lowest address at top | Big-endian reads naturally top-to-bottom; changed from initial "highest at top" for readability |
| Column labels | Subtle header row (Addr, Var, Bits, Hex) | Self-documenting display; same flex layout as byte rows for alignment |
| Row collapsing | Ellipsis for unallocated regions, configurable context rows | Focuses attention on allocated variables; avoids overwhelming 32-row flat list |
| Scrollable container | Auto-scroll to new variables, user can scroll freely | Keeps relevant rows visible without page-level scroll interference |
| Mobile layout | Stack vertically (code above, memory below) | Both must be visible for teaching value |
| Float encoding | IEEE 754 via DataView, no explanation | Brainstorm: "just show the bytes" — existing float widgets cover IEEE 754 |
| Table view transition | `{#if}` + `transition:fade` | Simple cross-fade; morphing is unnecessary complexity |
| Async API pattern | Promise-returning `export function` methods | New pattern in codebase, justified by animation sequencing needs |
| Bits array reactivity | `$state.raw([])` | Write-heavy, 256 elements — avoid Svelte 5 deep proxy overhead |
| Animation lifecycle | Cancellation token + timeout fallback | Prevents Promise hangs on destroy; guards against missing events |
| CodePanel annotations | Deferred to v2 | v1 focuses on syntax highlighting + active line; annotations add complexity without core teaching value |

## Dependencies & Risks

- **No regression risk**: CMemoryView is entirely new. MemoryTable not touched. BitCell reused as-is.
- **Promise lifecycle**: Cancellation token pattern prevents hangs on component destruction. Timeout fallback (2× glowDuration) guards against `animationend` not firing.
- **Event bubbling**: `animationend`/`transitionend` handlers check `e.animationName`/`e.target` to prevent child events from triggering parent resolution.
- **`{@html}` in CodePanel**: `escapeHtml()` applied before tokenization as defense-in-depth, even though code strings are author-controlled.
- **32 bytes capacity**: `double` (8) + 2 `int`s (8) + `char` (1) = 17 bytes. Plenty for teaching. Won't overflow for typical 5-variable demos.
- **No expression parser**: Section computes values inline (e.g., `value: 42` for `x + 32`). No need to parse C expressions.

## System-Wide Impact

- **New shared utility** `c-program.ts`: Type definitions + 2 pure functions. No side effects. ~40 lines.
- **New shared component** `CodePanel.svelte`: Follows established pattern (props + callbacks, no paramDefs).
- **BitCell reuse**: CMemoryView uses BitCell identically to MemoryTable (same CSS custom property pattern).
- **No global tokens**: All styling via scoped `--cmv-` and `--bit-cell-*` CSS custom properties.
- **New async pattern**: Promise-returning imperative API documented for future widget reference.

## Verification

1. `npm run dev` — sandbox page at `/sandbox/c-memory-view` loads
2. Step through demo program — each instruction modifies memory correctly
3. "Prev" correctly rolls back state (instant replay, deterministic garbage)
4. Toggle simplified table view — shows correct variable summary
5. Resize to mobile — components stack vertically
6. Destroy component mid-animation — no hanging Promises or console errors
7. `npm run build` — no build errors
8. Existing sandbox pages unaffected
9. Column labels visible and aligned with byte-row columns
10. Scroll area auto-scrolls to newly allocated variables
11. Unallocated rows collapse to ellipsis between allocated variables
12. User can freely scroll between steps; reset returns scroll to top
13. Display shows lowest address at top, big-endian bytes read top-to-bottom

## Sources & References

### Origin

- **Brainstorm document:** [docs/brainstorms/2026-03-09-c-memory-view-brainstorm.md](docs/brainstorms/2026-03-09-c-memory-view-brainstorm.md) — Key decisions: standalone widget, random garbage for uninitialized memory, big-endian, real C with annotations, flexible interaction, configurable instruction sequence, addresses grow downward.

### Internal References

- MemoryTable widget (pattern reference): `site/src/components/widgets/MemoryTable.svelte`
- BitCell shared component (reused): `site/src/components/widgets/shared/BitCell.svelte`
- Binary utilities (reused): `site/src/lib/binary.ts` — `writeUint`, `readUint`, `toHex`
- Param system: `site/src/lib/params.ts`
- Section composition pattern: `site/src/components/sections/example/InteractiveDemo.svelte`
- Shared component pattern: `site/src/components/widgets/shared/ScrubSlider.svelte`
- Animation strategy: `docs/decisions/003-widget-animation-strategy.md`
- Widget implementation guide: `docs/archive/WIDGET_IMPLEMENTATION_GUIDE.md`
- Animation patterns: `docs/archive/ANIMATION_PATTERNS.md`

### Review Agents

Enhanced by 7 parallel review agents (2026-03-09):
- **kieran-typescript-reviewer**: Type safety fixes (`value: number | null`), `canNext`/`canPrev` guards
- **performance-oracle**: `$state.raw` for bits array, event bubbling guards, batch replay
- **code-simplicity-reviewer**: Cut sub-step model, reduce c-program.ts, cut YAGNI params/methods
- **architecture-strategist**: Validated section-as-orchestrator, async API justification
- **julik-frontend-races-reviewer**: Cancellation token, reset safety, `await tick()`, event guards
- **pattern-recognition-specialist**: Async imperative API documentation, declarative data model
- **security-sentinel**: `escapeHtml()` defense-in-depth for CodePanel
