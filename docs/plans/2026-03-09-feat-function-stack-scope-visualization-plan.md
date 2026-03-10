---
title: "feat: Function, Stack Frame, and Scope Visualization"
type: feat
status: active
date: 2026-03-09
deepened: 2026-03-10
origin: docs/brainstorms/2026-03-09-functions-stack-scope-brainstorm.md
---

# Function, Stack Frame, and Scope Visualization

## Enhancement Summary

**Deepened on:** 2026-03-10
**Sections enhanced:** 5 (Phase 1, Phase 2, Phase 3, Phase 4, Risks)
**Research areas:** Svelte 5 transition patterns, sub-expression highlight edge cases, collapse animation strategies, orchestrator tab-switching patterns

### Key Improvements
1. **Collapse animation strategy resolved** — use CSS `@keyframes` with ghost rows (consistent with existing CMemoryView patterns, avoids CSS max-height pitfalls)
2. **Sub-highlight offset pre-computation** — prevent `indexOf` failures for duplicate variable names across scopes (e.g., Tab 2's two `x` variables, Tab 3's two `a`/`b` pairs)
3. **Garbage byte restoration bug fix** — `popFrame` loop bounds corrected; must iterate freed addresses not from `stackPointer` (already restored) but from a captured range
4. **`assign-return` source line mapping** — the `assign-return` sub-step highlights the *caller's* code line, not the callee's return line. Added `returnSourceLine` field to `return` instruction

## Overview

Add a visual teaching module that shows C function calls, stack frames, and variable scope in the CMemoryView memory grid. The learner steps through programs that call functions and sees frames push onto the stack (with a labeled divider bar), arguments copied into the callee's scope, and frames collapse off the stack on return. Four progressive tabs build from a simple call through scope isolation, broken swap, and recursion.

This extends three existing components (CMemoryView, CodePanel, c-program.ts) and adds one new orchestrator (CFunctionDemo) plus a sandbox page.

## Problem Statement / Motivation

The essay currently teaches variables, memory layout, printf/scanf, pointers, and swap — but all code executes in a single flat scope. The swap demo shows *that* values don't change but not *why*. Functions and stack frames are the missing explanation: pass-by-value copies arguments into a new frame, and the frame disappears on return.

(See brainstorm: `docs/brainstorms/2026-03-09-functions-stack-scope-brainstorm.md` — placement after swap section)

## Proposed Solution

### Approach: Extend CMemoryView with frame awareness (Brainstorm Approach A)

Add `pushFrame(name)` and `popFrame()` methods directly to CMemoryView. Frames are tracked as a stack of `{ name, baseAddress, varCountAtPush }` entries. Frame dividers render as colored horizontal bars with function name labels. The memory grid remains a single continuous address space — pedagogically accurate and visually consistent with what students already know.

**Rejected alternatives** (see brainstorm):
- Separate StackFrame wrapper (B) — breaks address continuity, duplicates garbage state
- Visual-only overlay (C) — no proper frame-pop, fragile positioning

## Technical Approach

### Architecture

Four layers of change, each building on the previous:

```
┌─────────────────────────────────────────────────┐
│  CFunctionDemo (orchestrator)                   │
│  - 4 tabbed programs with call stack tracking   │
│  - executeSubStep dispatch for new actions      │
├─────────────┬───────────────────────────────────┤
│  CodePanel  │  CMemoryView                      │
│  + codeLines│  + pushFrame / popFrame            │
│  + callStack│  + frame dividers                  │
│  + sourceLine│ + scope-aware getVariable         │
├─────────────┴───────────────────────────────────┤
│  c-program.ts                                   │
│  + call / return instruction kinds              │
│  + push-frame / pop-frame sub-step kinds        │
└─────────────────────────────────────────────────┘
```

### Implementation Phases

#### Phase 1: Core Data Model (c-program.ts)

**New CInstruction variants:**

```typescript
| { kind: 'call'; code: string; functionName: string;
    args: { paramName: string; paramType: CTypeName; argSource: string }[];
    returnTarget?: { name: string; type: CTypeName };
    sourceLine: number }
| { kind: 'return'; code: string;
    valueSource?: string;     // variable to read return value from (in callee scope)
    returnValue?: number;     // pre-computed return value (for labels)
    returnToVar?: string;     // caller's variable to assign to (from call instruction)
    returnToType?: CTypeName; // type of caller's variable
    sourceLine: number }
```

Design decisions:
- `call` carries the `returnTarget` so the orchestrator can pass it to the corresponding `return`'s decomposition via `DecomposeOptions`
- `returnToVar` on `return` is populated by the orchestrator at program definition time (programs are static, values are known)
- `sourceLine` is required (not optional) for function instructions since they never map 1:1 to code lines
- For void functions (Tab 2, Tab 3): `returnTarget` is omitted on `call`, `returnToVar` is omitted on `return`
- For simple returns (`return 1`): `valueSource` is omitted, `returnValue` is baked in

**Add `sourceLine?: number` to all existing CInstruction variants** (optional, defaults to instruction index for backwards compat).

### Research Insights: Phase 1

**Pre-compute highlightOffset for call/return sub-steps.** The current `indexOf` approach in orchestrators fails when the same highlight text appears multiple times in a code line. This is critical for:
- Tab 2: `setX(x)` — reading `x` from caller and declaring `x` in callee both highlight `x` in different source lines
- Tab 3: `swap(a, b)` — two arguments read from caller, each needs a distinct offset in the code string
- Tab 4: Same source line (`int sub = factorial(n - 1);`) used by multiple recursive calls

**Mitigation:** Follow the CPrintfDemo pattern — walk the code string sequentially during `decomposeInstruction` and pre-compute `highlightOffset` for each sub-step. For `call` instructions, track position through the argument list:

```typescript
// In decomposeInstruction for 'call':
let argOffset = instr.code.indexOf('(') + 1; // start after opening paren
for (const arg of instr.args) {
  const argStart = instr.code.indexOf(arg.argSource, argOffset);
  steps.push({
    kind: 'read',
    highlight: arg.argSource,
    highlightOffset: argStart,  // pre-computed, not runtime indexOf
    // ...
  });
  argOffset = argStart + arg.argSource.length;
}
```

**`assign-return` source line mapping:** After `popFrame`, the `assign-return` sub-step assigns the return value to the *caller's* variable. The CodePanel highlight must jump back to the caller's line, not stay on the callee's `return` line. Add `returnSourceLine?: number` to the `return` instruction:

```typescript
| { kind: 'return'; code: string;
    valueSource?: string;
    returnValue?: number;
    returnToVar?: string;
    returnToType?: CTypeName;
    returnSourceLine?: number;  // caller's source line for assign-return highlight
    sourceLine: number }
```

The orchestrator sets `returnSourceLine` from the corresponding `call` instruction's `sourceLine`. The `assign-return` sub-step uses `returnSourceLine` for its `sourceLine` mapping.

**New CSubStep action kinds:**

```typescript
| { kind: 'pushFrame'; name: string }
| { kind: 'popFrame' }
```

`copy-arg` and `assign-return` don't need new action kinds — they reuse existing `declareVar` + `assignVar` actions.

**decomposeInstruction for `call`** (N = number of arguments):

| Step | Kind | Highlight | Action |
|------|------|-----------|--------|
| 1..N | `read` | `args[i].argSource` | `highlightVar(args[i].argSource)` |
| N+1 | `push-frame` | `functionName(...)` | `pushFrame(functionName)` |
| N+2..N+1+N | `copy-arg` (declare) | `args[i].paramName` | `declareVar(paramType, paramName)` |
| N+2+N..N+1+2N | `copy-arg` (assign) | `args[i].paramName` | `assignVar(paramName, value)` |

Interleave declare+assign per argument: for each arg, one declare then one assign.

Total sub-steps for `call`: `N (reads) + 1 (push) + 2*N (declare+assign) = 3N + 1`

**decomposeInstruction for `return`:**

| Step | Kind | Highlight | Action |
|------|------|-----------|--------|
| 1 (if valueSource) | `read` | `valueSource` | `highlightVar(valueSource)` |
| 2 | `pop-frame` | `return ...` | `popFrame()` |
| 3 (if returnToVar) | `assign-return` | caller's assignment expr | `assignVar(returnToVar, value)` |

For void/no-value return: just `pop-frame` (1 step).
For value return with source: `read` + `pop-frame` + `assign-return` (3 steps).
For literal return (`return 1`): `pop-frame` + `assign-return` (2 steps).

**countSubSteps:** Mirror the decomposition logic. `call`: `3 * args.length + 1`. `return`: `(valueSource ? 1 : 0) + 1 + (returnToVar ? 1 : 0)`.

**Files:** `site/src/lib/c-program.ts`

#### Phase 2: CMemoryView Frame Awareness

**New state:**

```typescript
interface StackFrame {
  name: string;
  baseAddress: number;       // stackPointer value when frame was pushed
  varCountAtPush: number;    // variables.length when frame was pushed
}

let frameStack: StackFrame[] = $state([]);
let poppingFrame: { frame: StackFrame; vars: CVariable[] } | null = $state(null);
```

**New exported functions:**

```typescript
export async function pushFrame(name: string): Promise<void> {
  const gen = generation;
  frameStack = [...frameStack, { name, baseAddress: stackPointer, varCountAtPush: variables.length }];
  await tick();
  if (generation !== gen) return;
  // Divider slide-in animation (CSS transition on the divider element)
  await new Promise(r => setTimeout(r, DIVIDER_ANIM_DURATION));
}

export async function popFrame(): Promise<void> {
  const gen = generation;
  const frame = frameStack[frameStack.length - 1];
  const removedVars = variables.slice(frame.varCountAtPush);

  // 1. Start collapse animation (set poppingFrame for rendering)
  poppingFrame = { frame, vars: removedVars };

  // 2. Actually remove variables and restore stack pointer
  variables = variables.slice(0, frame.varCountAtPush);
  stackPointer = frame.baseAddress;
  frameStack = frameStack.slice(0, -1);

  // 3. Re-initialize freed bytes to garbage
  for (let i = stackPointer; i < frame.baseAddress; i++) {
    const byteIdx = i - BASE_ADDRESS;
    const garbageByte = garbageBytes(i, 1, SEED)[0];
    for (let bit = 0; bit < 8; bit++) {
      bits[byteIdx * 8 + bit] = (garbageByte >> (7 - bit)) & 1;
    }
  }
  prevBits = new Uint8Array(bits);  // prevent glow on garbage restore

  await tick();
  if (generation !== gen) return;

  // 4. Wait for collapse animation
  await new Promise(r => setTimeout(r, COLLAPSE_ANIM_DURATION));
  if (generation !== gen) return;

  poppingFrame = null;
}
```

Key design choices:
- **Synchronous-first mutations** — `frameStack`, `variables`, `stackPointer` all update before the first `await`. This ensures replay (fire-and-forget) works correctly.
- **`poppingFrame` state** — holds the removed frame data during the collapse animation. The rendering logic uses this to show the collapsing rows with a CSS class. After the animation duration, `poppingFrame` is cleared.
- **Garbage restoration** — freed bytes return to deterministic garbage (using the same seed), matching the initial state. `prevBits` is updated to prevent the glow-detection `$effect` from treating restored garbage as "changed bits."

### Research Insights: Phase 2

**Collapse animation: use CSS `@keyframes`, not Svelte transitions or CSS max-height.**

CMemoryView uses zero Svelte `transition:` directives — all animations use CSS `@keyframes` with `onanimationend` cleanup. The collapse animation should follow this established pattern rather than introducing Svelte transitions:

1. **Ghost rows pattern:** When `poppingFrame` is set, `collapsedDisplayRows` injects the removed frame's rows as "ghost" `DisplayItem`s (using `poppingFrame.vars` to reconstruct their addresses). These ghost rows render with a `.collapsing` CSS class.

2. **CSS animation:**
```css
@keyframes frame-collapse {
  from { max-height: var(--row-height); opacity: 1; }
  to { max-height: 0; opacity: 0; padding: 0; margin: 0; }
}
.byte-row.collapsing {
  animation: frame-collapse var(--collapse-duration, 300ms) ease-in forwards;
  overflow: hidden;
}
.frame-divider.collapsing {
  animation: frame-collapse var(--collapse-duration, 300ms) ease-in 50ms forwards; /* slight delay */
}
```

3. **Completion detection:** The *last* collapsing row's `onanimationend` clears `poppingFrame`. Use a counter or check `poppingFrame.vars` length. This follows the same pattern as `glowingCells` cleanup via `onanimationend` in BitCell.

4. **Why not Svelte `out:slide`?** CMemoryView's `collapsedDisplayRows` is a derived value — removing variables immediately changes the derived array, causing Svelte to remove DOM nodes before any transition can play. The ghost-row approach decouples state mutation from visual removal.

5. **Why not CSS `max-height` transition?** Transitions on `max-height` require knowing the target height. `@keyframes` with `forwards` fill mode avoids this — `max-height` in `from` can use a CSS custom property set per row height, and the animation handles the interpolation.

6. **Reduced motion:** Check `reducedMotion` before setting `poppingFrame`. If true, skip the ghost rows entirely — `poppingFrame` stays null and rows disappear instantly.

**`popFrame` garbage restoration — corrected loop bounds:**

The original pseudocode has a bug:
```typescript
// BUG: stackPointer was already restored to frame.baseAddress
for (let i = stackPointer; i < frame.baseAddress; i++) { ... }
// This iterates 0 times since stackPointer === frame.baseAddress
```

Fix: capture the old stack pointer *before* restoring it:
```typescript
const freedStart = stackPointer;  // current SP (lowest address of popped frame)
const freedEnd = frame.baseAddress; // SP before this frame existed
// Restore stack pointer
stackPointer = frame.baseAddress;
// Now restore garbage for the freed range
for (let i = freedStart; i < freedEnd; i++) { ... }
```

Wait — re-examining: `stackPointer` before pop is the *current* SP (below the popped frame's vars). `frame.baseAddress` is where SP was *when the frame was pushed* (above the frame's vars). So `stackPointer < frame.baseAddress` and the freed range is `[stackPointer, frame.baseAddress)`. The bug is that we set `stackPointer = frame.baseAddress` before the loop, so the loop sees `i = frame.baseAddress` and doesn't iterate. **Capture the range before restoring:**

```typescript
const freedStart = stackPointer;       // lowest address occupied by popped frame
const freedEnd = frame.baseAddress;    // first address above popped frame
variables = variables.slice(0, frame.varCountAtPush);
stackPointer = frame.baseAddress;      // restore AFTER capturing freedStart
frameStack = frameStack.slice(0, -1);

for (let i = freedStart; i < freedEnd; i++) {
  const byteIdx = i - BASE_ADDRESS;
  const garbageByte = garbageBytes(i, 1, SEED)[0];
  for (let bit = 0; bit < 8; bit++) {
    bits[byteIdx * 8 + bit] = (garbageByte >> (7 - bit)) & 1;
  }
}
prevBits = new Uint8Array(bits);
```

**Scope-aware variable lookup:**

Change `getVariable(name)` from `variables.find(v => v.name === name)` to reverse search:

```typescript
export function getVariable(name: string): CVariable | undefined {
  for (let i = variables.length - 1; i >= 0; i--) {
    if (variables[i].name === name) return variables[i];
  }
  return undefined;
}
```

This returns the most recently declared variable with that name (innermost scope), matching C's shadowing semantics. Safe for existing demos since they have no name collisions.

Apply the same reverse-search to `getAddress`, `getAddressRaw`, `assignVar`, and `highlightVar`.

**Frame divider rendering (bits view):**

Extend `DisplayItem` union:

```typescript
type DisplayItem =
  | { kind: 'row'; row: DisplayRow }
  | { kind: 'ellipsis'; startAddress: number; endAddress: number; count: number }
  | { kind: 'frame-divider'; name: string; address: number }
```

In `collapsedDisplayRows` derivation: after building the keep set, insert `frame-divider` items at each frame's `baseAddress`. Frame boundary addresses are always included in the `keepSet` (never collapsed into ellipsis).

Frame divider HTML: a full-width bar with `background: rgba(255, 255, 255, 0.08)`, a 1px top border in `rgba(255, 255, 255, 0.2)`, and the function name as left-aligned text in muted color. Animates in via `@keyframes divider-slide-in` (opacity 0→1, translateY).

**Collapse animation rendering:**

When `poppingFrame` is set, inject ghost rows from `poppingFrame.vars` into `collapsedDisplayRows` at their original addresses. Ghost rows render as `.byte-row.collapsing` with `@keyframes frame-collapse` (max-height + opacity to 0, 300ms ease-in, `forwards` fill). The frame divider also gets `.collapsing` with a 50ms delay. The last ghost row's `onanimationend` clears `poppingFrame`.

For reduced motion: skip `poppingFrame` entirely — rows disappear instantly.

**Frame divider rendering (table view):**

Insert a section header row spanning all columns at each frame boundary:

```html
<tr class="frame-header">
  <td colspan="4">{frame.name}()</td>
</tr>
```

Styled with a subtle top border and muted text.

**Reset extension:**

```typescript
export function reset(): void {
  generation++;
  variables = [];
  frameStack = [];       // NEW
  poppingFrame = null;   // NEW
  stackPointer = BASE_ADDRESS + TOTAL_BYTES;
  // ... existing reset logic ...
}
```

**Files:** `site/src/components/widgets/CMemoryView.svelte`

#### Phase 3: CodePanel Extensions

**New optional props:**

```typescript
interface CodePanelProps {
  // ... existing props ...
  codeLines?: string[];        // NEW: if provided, render these instead of instructions
  callStack?: string[];        // NEW: e.g. ['main', 'double'] → "main > double"
  functionBoundaries?: number[]; // NEW: line indices after which to show a separator
}
```

**codeLines rendering:**

When `codeLines` is provided, the `{#each}` iterates over `codeLines` instead of `instructions`:

```svelte
{#each (codeLines ?? instructions.map(i => i.code)) as line, idx}
  <div class="code-line" class:active={idx === currentLine}>
    <span class="line-number">{idx + 1}</span>
    <code>
      {@html highlightSyntax(line)}
      {#if idx === currentLine && subHighlights}
        <!-- sub-expression overlays unchanged -->
      {/if}
    </code>
  </div>
{/each}
```

Backwards compatible: existing demos don't pass `codeLines`, so they render `instructions` as before.

**callStack breadcrumb:**

Rendered above the code listing when `callStack` has more than one entry:

```svelte
{#if callStack && callStack.length > 1}
  <div class="call-stack-breadcrumb">
    {#each callStack as fn, i}
      {#if i > 0}<span class="separator">›</span>{/if}
      <span class:active={i === callStack.length - 1}>{fn}()</span>
    {/each}
  </div>
{/if}
```

Styled as small monospace text with muted color. The active (current) function is white/full-opacity.

**Function boundaries:**

When `functionBoundaries` is provided, lines at those indices get an extra `border-bottom` in the separator color. For natural visual separation, empty lines in `codeLines` already create gaps.

### Research Insights: Phase 3

**Sub-highlight positioning with `codeLines`:** When CodePanel renders from `codeLines` instead of `instructions`, the orchestrator must compute `subHighlights` against the *source line text* (from `codeLines[sourceLine]`), not the instruction's `code` field. These may differ — `code` is the instruction's display text while `codeLines[sourceLine]` is the actual rendered line (which may include leading whitespace/indentation).

**Fix:** The orchestrator should use `codeLines[currentSourceLine]` as the base string for `indexOf`/offset calculations. Since `highlightOffset` is pre-computed during `decomposeInstruction` (per Phase 1 research insight), it must be computed against the `codeLines` text, not the instruction `code`. Add the source line text to `DecomposeOptions`:

```typescript
interface DecomposeOptions {
  // ... existing ...
  getSourceLine?: (instrIdx: number) => string;  // returns codeLines[sourceLine]
}
```

**callStack breadcrumb — always show for function demos:** The plan says "render when `callStack.length > 1`". But even when only `main` is active, showing the breadcrumb provides visual consistency and avoids a layout shift when the first function is called. Consider always rendering it when `callStack` is provided (even with just `['main']`), but styling the single entry more subtly.

**Files:** `site/src/components/widgets/shared/CodePanel.svelte`

#### Phase 4: CFunctionDemo Orchestrator

Follows the established orchestrator pattern exactly (see `CPointerDemo.svelte`, `CSwapDemo.svelte`).

**State variables:**

```typescript
let memoryView: ReturnType<typeof CMemoryView>;
let pc = $state(-1);
let isAnimating = $state(false);
let executed: (CSubStep & { instrIdx: number })[] = $state([]);
let cachedSubSteps = new Map<number, (CSubStep & { instrIdx: number })[]>();
let generation = 0;
let activeTab = $state(0);
let callStack: string[] = $state(['main']); // NEW: for breadcrumb
```

**Program definitions (4 tabs):**

Each tab defines `{ codeLines: string[], instructions: CInstruction[] }`.

**Tab 1 — Simple function call (`double`):**

```
codeLines:
  0: "int double(int x) {"
  1: "    int result = x * 2;"
  2: "    return result;"
  3: "}"
  4: ""
  5: "int main() {"
  6: "    int a = 5;"
  7: "    int b = double(a);"
  8: "}"

instructions:
  0: { kind: 'declare-assign', code: 'int a = 5;', varName: 'a', type: 'int', value: 5, sourceLine: 6 }
  1: { kind: 'call', code: 'int b = double(a);', functionName: 'double',
       args: [{ paramName: 'x', paramType: 'int', argSource: 'a' }],
       returnTarget: { name: 'b', type: 'int' }, sourceLine: 7 }
  2: { kind: 'eval-assign', code: 'int result = x * 2;',
       target: { name: 'result', type: 'int' }, sources: ['x'], value: 10, sourceLine: 1 }
  3: { kind: 'return', code: 'return result;', valueSource: 'result',
       returnValue: 10, returnToVar: 'b', returnToType: 'int', sourceLine: 2 }
```

Memory usage: main frame (a: 4B, b: 4B) + double frame (x: 4B, result: 4B) = 16B peak. Fits in 32B.

**Tab 2 — Scope isolation (`setX`):**

```
codeLines:
  0: "void setX(int x) {"
  1: "    x = 99;"
  2: "}"
  3: ""
  4: "int main() {"
  5: "    int x = 5;"
  6: "    setX(x);"
  7: "    // x is still 5!"
  8: "}"

instructions:
  0: { kind: 'declare-assign', code: 'int x = 5;', varName: 'x', type: 'int', value: 5, sourceLine: 5 }
  1: { kind: 'call', code: 'setX(x);', functionName: 'setX',
       args: [{ paramName: 'x', paramType: 'int', argSource: 'x' }], sourceLine: 6 }
  2: { kind: 'assign', code: 'x = 99;', varName: 'x', value: 99, sourceLine: 1 }
  3: { kind: 'return', code: '}', sourceLine: 2 }  // implicit void return
  4: { kind: 'comment', code: '// x is still 5!', label: 'main\'s x is unchanged: 5', sourceLine: 7 }
```

Memory: main (x: 4B) + setX (x: 4B) = 8B peak.

**Tab 3 — Broken swap as function:**

```
codeLines:
  0: "void swap(int a, int b) {"
  1: "    int temp = a;"
  2: "    a = b;"
  3: "    b = temp;"
  4: "}"
  5: ""
  6: "int main() {"
  7: "    int a = 3;"
  8: "    int b = 7;"
  9: "    swap(a, b);"
  10: "    // a=3, b=7 unchanged!"
  11: "}"

instructions:
  0: { kind: 'declare-assign', code: 'int a = 3;', varName: 'a', type: 'int', value: 3, sourceLine: 7 }
  1: { kind: 'declare-assign', code: 'int b = 7;', varName: 'b', type: 'int', value: 7, sourceLine: 8 }
  2: { kind: 'call', code: 'swap(a, b);', functionName: 'swap',
       args: [
         { paramName: 'a', paramType: 'int', argSource: 'a' },
         { paramName: 'b', paramType: 'int', argSource: 'b' }
       ], sourceLine: 9 }
  3: { kind: 'declare-assign', code: 'int temp = a;', varName: 'temp', type: 'int', value: 3, sourceLine: 1 }
  4: { kind: 'assign', code: 'a = b;', varName: 'a', value: 7, sourceLine: 2 }
  5: { kind: 'assign', code: 'b = temp;', varName: 'b', value: 3, sourceLine: 3 }
  6: { kind: 'return', code: '}', sourceLine: 4 }
  7: { kind: 'comment', code: '// a=3, b=7 unchanged!', label: 'main\'s a and b are unchanged', sourceLine: 10 }
```

Memory: main (a: 4B, b: 4B) + swap (a: 4B, b: 4B, temp: 4B) = 20B peak. Fits in 32B.

**Tab 4 — Recursion (`factorial(3)`):**

```
codeLines:
  0: "int factorial(int n) {"
  1: "    if (n <= 1) return n;"
  2: "    int sub = factorial(n - 1);"
  3: "    return n * sub;"
  4: "}"
  5: ""
  6: "int main() {"
  7: "    int result = factorial(3);"
  8: "}"

instructions:
  0: { kind: 'call', code: 'int result = factorial(3);', functionName: 'factorial',
       args: [{ paramName: 'n', paramType: 'int', argSource: null, argValue: 3 }],
       returnTarget: { name: 'result', type: 'int' }, sourceLine: 7 }
  // factorial(3): n=3, n>1
  1: { kind: 'comment', code: '// n=3, not base case', label: 'n = 3 > 1, recurse', sourceLine: 1 }
  2: { kind: 'call', code: 'int sub = factorial(n - 1);', functionName: 'factorial',
       args: [{ paramName: 'n', paramType: 'int', argSource: null, argValue: 2 }],
       returnTarget: { name: 'sub', type: 'int' }, sourceLine: 2 }
  // factorial(2): n=2, n>1
  3: { kind: 'comment', code: '// n=2, not base case', label: 'n = 2 > 1, recurse', sourceLine: 1 }
  4: { kind: 'call', code: 'int sub = factorial(n - 1);', functionName: 'factorial',
       args: [{ paramName: 'n', paramType: 'int', argSource: null, argValue: 1 }],
       returnTarget: { name: 'sub', type: 'int' }, sourceLine: 2 }
  // factorial(1): n=1, base case
  5: { kind: 'comment', code: '// n=1, base case!', label: 'n = 1 ≤ 1, base case!', sourceLine: 1 }
  6: { kind: 'return', code: 'return n;', valueSource: 'n',
       returnValue: 1, returnToVar: 'sub', returnToType: 'int', sourceLine: 1 }
  // back in factorial(2)
  7: { kind: 'eval-assign', code: 'return n * sub;',
       target: null, sources: ['n', 'sub'], value: 2, sourceLine: 3 }
  8: { kind: 'return', code: 'return n * sub;',
       returnValue: 2, returnToVar: 'sub', returnToType: 'int', sourceLine: 3 }
  // back in factorial(3)
  9: { kind: 'eval-assign', code: 'return n * sub;',
       target: null, sources: ['n', 'sub'], value: 6, sourceLine: 3 }
  10: { kind: 'return', code: 'return n * sub;',
       returnValue: 6, returnToVar: 'result', returnToType: 'int', sourceLine: 3 }
```

Memory: main (result: 4B) + factorial(3) (n: 4B, sub: 4B) + factorial(2) (n: 4B, sub: 4B) + factorial(1) (n: 4B) = 24B peak. Fits in 32B.

Note: For recursive calls where `argSource` is null, we need to extend the `call` instruction args to support literal values via `argValue?: number` (used when the argument is a computed expression like `n - 1`). The sub-step label would show the computed value directly.

**executeSubStep dispatch (new cases):**

```typescript
case 'pushFrame':
  callStack = [...callStack, step.action.name];
  await memoryView.pushFrame(step.action.name);
  break;
case 'popFrame':
  callStack = callStack.slice(0, -1);
  await memoryView.popFrame();
  break;
```

All other sub-step actions (`declareVar`, `assignVar`, `highlightVar`) dispatch unchanged.

**replaySubStep dispatch (new cases):**

```typescript
case 'pushFrame':
  callStack = [...callStack, step.action.name];
  void memoryView.pushFrame(step.action.name); // fire-and-forget
  break;
case 'popFrame':
  callStack = callStack.slice(0, -1);
  void memoryView.popFrame(); // fire-and-forget
  break;
```

**Derived state for CodePanel:**

```typescript
const currentSourceLine = $derived(
  currentStep ? program.instructions[currentStep.instrIdx].sourceLine ?? currentStep.instrIdx : -1
);
```

This maps the current instruction to the correct `codeLines` index for CodePanel's `currentLine` prop.

**Main frame auto-push:**

The orchestrator pushes a "main" frame automatically when the demo initializes or resets. This is done as a setup step before the first user-visible instruction, not as a sub-step the user clicks through:

```typescript
function initMainFrame() {
  callStack = ['main'];
  void memoryView.pushFrame('main');
}
```

Called in `resetDemo()` after `memoryView.reset()`.

**Layout:** Same 2-column grid as CPointerDemo. Left: CodePanel with `codeLines`, `callStack`, `currentLine`. Right: CMemoryView.

### Research Insights: Phase 4

**Tab switching pattern (from CSwapDemo analysis):** CSwapDemo's `switchTab` guards against redundant switches (`if (tab === activeTab) return`), then calls `handleReset()` which increments `generation`, clears `cachedSubSteps`, resets `pc`, and calls `memoryView.reset()`. CFunctionDemo must additionally:
1. Reset `callStack` to `['main']`
2. Re-push the main frame via `initMainFrame()`
3. Guard against switching during collapse animation (generation counter handles this)

**Replay correctness with frames:** During `executePrev`, the replay loop calls `replaySubStep` for steps 0..pc. For `pushFrame`/`popFrame` actions, the fire-and-forget pattern works because state mutations are synchronous. However, `popFrame` also sets `poppingFrame` (for the ghost-row animation). During replay, `poppingFrame` should NOT be set — we want instant removal. Add a `skipAnimation` parameter:

```typescript
export async function popFrame(skipAnimation = false): Promise<void> {
  // ... synchronous mutations ...
  if (skipAnimation || reducedMotion) {
    // No ghost rows, no animation
    return;
  }
  poppingFrame = { frame, vars: removedVars };
  // ... animation ...
}
```

The replay path calls `void memoryView.popFrame(true)` to skip animation.

**callStack replay:** The orchestrator's `callStack` must also be rebuilt during replay. Each `replaySubStep` that handles `pushFrame`/`popFrame` actions updates `callStack` synchronously, so after replay completes, `callStack` reflects the correct call chain at `pc`.

**Files:** `site/src/components/sandbox/CFunctionDemo.svelte`

#### Phase 5: Sandbox Page

Create `site/src/pages/sandbox/c-function.astro`:

```astro
---
import SandboxLayout from '../../layouts/SandboxLayout.astro';
import CFunctionDemo from '../../components/sandbox/CFunctionDemo.svelte';
---
<SandboxLayout title="C Functions" description="Stack frames, scope, and pass-by-value">
  <CFunctionDemo client:load />
</SandboxLayout>
```

**Files:** `site/src/pages/sandbox/c-function.astro`

## System-Wide Impact

### Interaction Graph

- `CFunctionDemo` → calls `CMemoryView.pushFrame/popFrame/declareVar/assignVar/highlightVar/clearHighlights/reset`
- `CFunctionDemo` → passes `codeLines`, `callStack`, `currentLine`, `subHighlights` to `CodePanel`
- `c-program.ts` `decomposeInstruction` → new branches for `call` and `return` kinds → produces sub-steps with `pushFrame`/`popFrame` actions
- `CMemoryView.getVariable` → now searches in reverse (affects all callers, but no behavior change for existing demos with unique names)

### Error Propagation

- `pushFrame`/`popFrame` are async with generation counter guard — orphaned chains bail cleanly
- Tab switching calls `resetDemo()` which increments generation and calls `memoryView.reset()` — cancels all in-flight animations including collapse
- `popFrame` collapse animation uses `setTimeout` guarded by generation check — if reset occurs mid-collapse, the timeout resolves but generation mismatch prevents state mutation

### State Lifecycle Risks

- **Partial popFrame**: If generation changes between `variables = variables.slice(...)` (sync) and `poppingFrame = null` (after animation), the `poppingFrame` state could linger. Mitigated: `reset()` sets `poppingFrame = null`.
- **Variable array consistency**: `popFrame` removes variables and restores `stackPointer` atomically (same synchronous block). No partial state possible between these two mutations.
- **Garbage byte restoration**: After `popFrame`, freed bytes are restored to deterministic garbage. `prevBits` is synced to prevent false glow detection.

### API Surface Parity

CMemoryView gains two new public methods (`pushFrame`, `popFrame`). Existing methods are unchanged. No breaking changes — all existing orchestrators work without modification.

CodePanel gains three new optional props (`codeLines`, `callStack`, `functionBoundaries`). All are optional with backwards-compatible defaults. Existing orchestrators don't pass these props and render unchanged.

## Acceptance Criteria

### Functional Requirements

- [ ] `pushFrame(name)` adds a labeled frame divider to the memory grid and begins a new scope
- [ ] `popFrame()` removes the top frame's variables, restores stack pointer, and plays collapse animation
- [ ] Variables with the same name in different frames are independently accessible (scope isolation)
- [ ] `getVariable`, `assignVar`, `highlightVar`, `getAddress` all use reverse-search (innermost scope first)
- [ ] Frame dividers appear in both bits view and table view
- [ ] CodePanel renders `codeLines` when provided, with `currentLine` indexing into `codeLines`
- [ ] Call stack breadcrumb shows the current call chain (e.g., `main > factorial > factorial`)
- [ ] Tab 1 (double): demonstrates frame push, argument copy, return value assignment, frame pop
- [ ] Tab 2 (setX): demonstrates same-named variables in different scopes don't interfere
- [ ] Tab 3 (broken swap): demonstrates pass-by-value — caller's variables unchanged after swap returns
- [ ] Tab 4 (factorial): demonstrates 3 recursive frames stacking and unwinding
- [ ] All 4 tabs fit within 32-byte memory limit at peak
- [ ] Step backward (Prev) works correctly across frame boundaries via reset+replay
- [ ] Tab switching cancels in-flight animations and resets cleanly
- [ ] `reset()` clears frame stack and poppingFrame state

### Non-Functional Requirements

- [ ] Collapse animation respects `prefers-reduced-motion` (instant removal)
- [ ] pushFrame/popFrame follow synchronous-first async pattern (replay-safe)
- [ ] No regressions in existing demos (CMemoryViewDemo, CPointerDemo, CSwapDemo, CPrintfDemo, CScanfDemo)
- [ ] Sandbox page accessible at `/sandbox/c-function`

## Dependencies & Risks

**Dependencies:**
- Existing CMemoryView widget (extending, not replacing)
- Existing CodePanel component (adding optional props)
- Existing c-program.ts instruction model (adding new kinds to union)

**Risks:**
- **Collapse animation complexity**: ~~CSS `max-height` transitions don't work well with unknown heights.~~ **Resolved:** Use CSS `@keyframes` with ghost rows and `onanimationend` cleanup — consistent with existing CMemoryView glow pattern. No Svelte transitions needed (CMemoryView uses zero `transition:` directives). Fall back to instant removal if animation proves too complex.
- **Variable name collision edge cases**: Reverse-search in `getVariable` assumes the most recently declared variable is always the "correct" one. This holds for C scoping but could break if the orchestrator declares variables out of order. Mitigate: orchestrators always declare in execution order (which they already do).
- **Recursive frame labeling**: Multiple frames named "factorial" could be confusing. Consider appending argument value: `factorial(3)`, `factorial(2)`, `factorial(1)`. The `pushFrame` name parameter is a freeform string, so this works naturally.
- **Sub-highlight `indexOf` collisions**: When the same variable name appears multiple times in a code line (e.g., `swap(a, b)` where `a` and `b` also exist elsewhere), `indexOf` finds the wrong occurrence. **Resolved:** Pre-compute `highlightOffset` during `decomposeInstruction` by walking the code string sequentially (see Phase 1 research insights).
- **`assign-return` highlights wrong line**: After `popFrame`, the assign sub-step must highlight the *caller's* source line, not the callee's. **Resolved:** Added `returnSourceLine` field to `return` instruction (see Phase 1 research insights).
- **`popFrame` garbage loop bug**: Original pseudocode restores `stackPointer` before the garbage loop, causing zero iterations. **Resolved:** Capture `freedStart = stackPointer` before restoration (see Phase 2 research insights).

## Sources & References

### Origin

- **Brainstorm document:** [docs/brainstorms/2026-03-09-functions-stack-scope-brainstorm.md](docs/brainstorms/2026-03-09-functions-stack-scope-brainstorm.md) — Key decisions carried forward: Approach A (extend CMemoryView), collapse animation on popFrame, two-phase return (pop then assign), no return address, 4 progressive tabs including recursion

### Internal References

- CMemoryView widget: `site/src/components/widgets/CMemoryView.svelte`
- c-program.ts: `site/src/lib/c-program.ts`
- CodePanel: `site/src/components/widgets/shared/CodePanel.svelte`
- CPointerDemo (reference orchestrator): `site/src/components/sandbox/CPointerDemo.svelte`
- CSwapDemo (reference orchestrator): `site/src/components/sandbox/CSwapDemo.svelte`
- Animation strategy ADR: `docs/decisions/003-widget-animation-strategy.md`
- Sub-step decomposition plan: `docs/plans/2026-03-09-feat-instruction-sub-step-decomposition-plan.md`
