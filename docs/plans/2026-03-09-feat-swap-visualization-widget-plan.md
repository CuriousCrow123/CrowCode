---
title: "feat: Add swap algorithm visualization widget"
type: feat
status: completed
date: 2026-03-09
origin: docs/brainstorms/2026-03-09-swap-widget-brainstorm.md
---

# feat: Add Swap Algorithm Visualization Widget

## Overview

An interactive orchestrator demonstrating why temporary variables are necessary for swapping two values. Uses a **tabbed two-program approach**: a broken naive swap (data loss) vs a correct temp-variable swap, both stepping through CMemoryView in table mode. (see brainstorm: docs/brainstorms/2026-03-09-swap-widget-brainstorm.md)

## Proposed Solution

Build `CSwapDemo.svelte` following the CPrintfDemo orchestrator pattern — compose CodePanel + CMemoryView (no StdoutPanel), add a tab bar to switch between the naive and correct programs, and reset all state on tab switch.

Requires one shared-library change: skip the redundant "compute" sub-step in `decomposeInstruction` for simple variable-to-variable assignments (`a = b` produces `"90 = 90"` label, which is meaningless).

## Technical Considerations

- **No new CInstruction kinds** — swap operations use existing `declare-assign` and `eval-assign` (see brainstorm decision #5)
- **Orchestrator generation counter** — tab switching during an in-flight `executeNext` can leave a stale continuation that incorrectly clears `isAnimating`. Add a local generation counter (same pattern as CMemoryView) to guard against this race.
- **Compute sub-step skip** — modifies the shared `decomposeInstruction` in `c-program.ts`. Must be backward-compatible with CMemoryViewDemo's `int y = x + 32;` where the compute step IS valuable. Condition: skip only when `sources.length === 1` and the expression equals the source name exactly.

## Acceptance Criteria

- [x] Sandbox page at `/sandbox/c-swap` with two tabs: "Naive" and "Correct"
- [x] Naive program: `char a='A', b='Z'; a=b; b=a;` — both end as `'Z'`
- [x] Correct program: `char a='A', b='Z'; char temp=a; a=b; b=temp;` — swap succeeds
- [x] CMemoryView defaults to table view, resets on tab switch
- [x] Tab switch cancels in-flight animations safely (no stuck `isAnimating`)
- [x] Stepping forward/backward works correctly for both programs
- [x] `eval-assign` with single source + simple expression skips compute sub-step
- [x] Existing CPrintfDemo and CMemoryViewDemo unaffected by `decomposeInstruction` change

## Implementation Plan

### Phase 1: Skip compute sub-step for simple assignments

**File:** `site/src/lib/c-program.ts`

In `decomposeInstruction`, `eval-assign` case (line 213): after computing `exprParts`, check if it's a simple copy (`sources.length === 1 && exprParts === sources[0]`). If so, skip the compute sub-step — go straight from read to assign.

In `countSubSteps` (used by orchestrators for `totalSubSteps`): apply the same condition so counts stay in sync.

```ts
// decomposeInstruction, eval-assign case:
const isSimpleCopy = instr.sources.length === 1 && exprParts === instr.sources[0];
if (!isSimpleCopy) {
  steps.push({ kind: 'compute', ... });
}

// countSubSteps:
case 'eval-assign': {
  const expr = instr.code.slice(instr.code.indexOf('=') + 1).replace(';', '').trim();
  const isSimpleCopy = instr.sources.length === 1 && expr === instr.sources[0];
  return (instr.target.type ? 1 : 0) + instr.sources.length + (isSimpleCopy ? 0 : 1) + 1;
}
```

**Validation:** CMemoryViewDemo's `int y = x + 32;` has `sources: ['x']` and `exprParts = 'x + 32'` — `'x + 32' !== 'x'`, so the compute step is preserved. CPrintfDemo has no `eval-assign` instructions, so unaffected.

### Phase 2: Build CSwapDemo orchestrator

**File:** `site/src/components/sandbox/CSwapDemo.svelte`

Follow CPrintfDemo's architecture exactly, with these differences:

1. **No StdoutPanel** — simpler two-column layout (CodePanel | CMemoryView)
2. **Two programs** — `naiveProgram` and `correctProgram` as `CInstruction[]` arrays
3. **Tab state** — `activeTab: 'naive' | 'correct'` controls which program is active
4. **Tab bar** — full-width above the two-panel grid, using ARIA `role="tablist"` / `role="tab"` / `role="tabpanel"` semantics
5. **Orchestrator generation counter** — local `generation` variable incremented on tab switch and reset; `executeNext` captures it and bails after await if stale
6. **Default table view** — call `memoryView.setViewMode('table')` on mount and tab switch

#### Program definitions

```ts
const naiveProgram: CInstruction[] = [
  { kind: 'declare-assign', code: "char a = 'A';", varName: 'a', type: 'char', value: 65 },
  { kind: 'declare-assign', code: "char b = 'Z';", varName: 'b', type: 'char', value: 90 },
  { kind: 'eval-assign', code: 'a = b;', target: { name: 'a' }, sources: ['b'], value: 90 },
  { kind: 'eval-assign', code: 'b = a;', target: { name: 'b' }, sources: ['a'], value: 90 },
];

const correctProgram: CInstruction[] = [
  { kind: 'declare-assign', code: "char a = 'A';", varName: 'a', type: 'char', value: 65 },
  { kind: 'declare-assign', code: "char b = 'Z';", varName: 'b', type: 'char', value: 90 },
  { kind: 'eval-assign', code: 'char temp = a;', target: { name: 'temp', type: 'char' }, sources: ['a'], value: 65 },
  { kind: 'eval-assign', code: 'a = b;', target: { name: 'a' }, sources: ['b'], value: 90 },
  { kind: 'eval-assign', code: 'b = temp;', target: { name: 'b' }, sources: ['temp'], value: 65 },
];
```

#### Sub-step counts (with compute skip)

- **Naive:** 2+2+2+2 = **8 sub-steps**
- **Correct:** 2+2+3+2+2 = **11 sub-steps**

#### Tab switch handler

```ts
function switchTab(tab: 'naive' | 'correct') {
  if (tab === activeTab) return;
  activeTab = tab;
  handleReset(); // clears pc, executed, cache, isAnimating; resets memoryView
}
```

`handleReset` already sets `isAnimating = false` and calls `memoryView.reset()`, so tab-during-animation is safe. The orchestrator generation counter (incremented in `handleReset`) ensures stale `executeNext` continuations bail.

#### Derived state

`program` is derived from `activeTab`. `totalSubSteps` recomputes when `program` changes. `subHighlights` follows CPrintfDemo's pattern (no printf-specific dual-highlight needed).

### Phase 3: Sandbox page

**File:** `site/src/pages/sandbox/c-swap.astro`

```astro
---
import SandboxLayout from '../../layouts/SandboxLayout.astro';
import CSwapDemo from '../../components/sandbox/CSwapDemo.svelte';
---
<SandboxLayout title="C Swap" description="Demonstrates the swap algorithm — why temporary variables are necessary to exchange two values without data loss.">
  <CSwapDemo client:load />
</SandboxLayout>
```

## Sources

- **Origin brainstorm:** [docs/brainstorms/2026-03-09-swap-widget-brainstorm.md](docs/brainstorms/2026-03-09-swap-widget-brainstorm.md) — key decisions: tabbed programs, char a='A'/b='Z', table view default, reuse existing CInstruction types
- **CPrintfDemo orchestrator:** [site/src/components/sandbox/CPrintfDemo.svelte](site/src/components/sandbox/CPrintfDemo.svelte) — primary pattern reference
- **c-program.ts data model:** [site/src/lib/c-program.ts](site/src/lib/c-program.ts) — `decomposeInstruction`, `countSubSteps`, `eval-assign` decomposition
