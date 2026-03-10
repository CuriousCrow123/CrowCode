# Brainstorm: Functions, Stack Frames, and Scope

**Date:** 2026-03-09
**Status:** Draft

## What We're Building

A visual teaching module that introduces C functions, stack frames, and scope — extending the existing CMemoryView and CPointerDemo widgets. The learner will see stack frames push and pop in the memory grid as functions are called and return, observe that arguments are copies (pass-by-value), and discover that same-named variables in different scopes don't interfere.

### Placement in Essay

After the swap section. Swap provides the natural motivation: "the broken swap showed values don't change — now let's see *why* by looking at what happens when you call a function."

### Example Programs (Progressive Tabs)

1. **Tab 1 — Simple function call:** `int double(int x)` called from `main`. Demonstrates frame push (new frame appears with its own `x`), return value assignment, and frame pop. Minimal complexity.

2. **Tab 2 — Scope isolation:** `main` has `int x = 5`, calls `void setX(int x)` which sets its local `x = 99`. After return, `main`'s `x` is still 5. Shows same-named variables coexisting in separate frames without interference.

3. **Tab 3 — Broken swap as function:** The familiar `swap(a, b)` but now as a function call. The learner sees values copied into the callee's frame, swapped there, then the frame pops — and `main`'s values are unchanged. Direct callback to the swap lesson, now with the "why" revealed.

4. **Tab 4 — Recursion (factorial):** `int factorial(int n)` called with `n = 3`. Multiple frames of the same function stack up (`factorial(3)` → `factorial(2)` → `factorial(1)`), then unwind one by one. Visually dramatic — the stack grows tall and shrinks back. Tests and demonstrates that the frame model handles same-function nesting.

## Why This Approach

### Approach A: Extend CMemoryView with frame awareness (Chosen)

Add `pushFrame(name)` and `popFrame()` methods directly to CMemoryView. Frames are tracked as a stack of `{ name, startAddress }` entries. Frame dividers render as colored horizontal bars with function name labels between frame boundaries in the byte grid.

**Why this over alternatives:**

- **Single continuous address space** — pedagogically accurate; the real stack is one contiguous region, not separate boxes. Students see frames stacking up in the same memory grid they already know.
- **Builds on existing infrastructure** — the `stackPointer` already grows downward. Frame boundaries are just bookmarks in that growth. Variable allocation via `declareVar` works unchanged within a frame.
- **Consistent with existing patterns** — imperative API via `export function`, generation counter for async cancellation, glow/highlight feedback.

**Rejected alternatives:**

- **Separate StackFrame wrapper (B):** Multiple CMemoryView instances would break address continuity between frames and duplicate garbage memory state. More orchestration complexity for a worse mental model.
- **Visual-only overlay (C):** No proper frame-pop capability (can't selectively remove variables without full reset + replay). Fragile positioning tied to CMemoryView internals.

## Key Decisions

### CMemoryView Extensions

- **Frame stack data structure:** Array of `{ name: string, baseAddress: number }`. `pushFrame` records the current stack pointer as the frame boundary; `popFrame` restores it and removes all variables in the popped frame.
- **Frame divider visual:** Horizontal bar spanning the full grid width at the byte row where a frame boundary exists. Colored with a subtle tint. Function name label left-aligned on the bar.
- **Divider animation:** The divider bar animates in (slide/fade) on `pushFrame`. On `popFrame`, the popped frame's rows collapse (slide together) into the divider, which then disappears. This makes the "stack shrinking" visceral.
- **Table view:** Frame dividers also appear in table view as section headers.

### CodePanel Extensions

- **Call stack breadcrumb:** A small indicator (e.g., `main > swap`) showing the current call chain. Appears above or below the code listing.
- **All functions visible:** Code panel shows all function definitions top-to-bottom in a single scrollable panel. The active line is highlighted as usual. When execution enters a callee, the highlight jumps to the function body.
- **Function boundaries:** Visual separator (subtle line or extra spacing) between function definitions in the code listing.

### c-program.ts Extensions

New instruction kinds:
- `call` — triggers `pushFrame`, copies argument values into new frame's parameters
- `return` — triggers `popFrame`, optionally assigns return value to caller's variable

New sub-step kinds:
- `push-frame` — action: push a new frame onto CMemoryView
- `copy-arg` — action: declare parameter variable and assign argument value (reuses existing declare + assign actions)
- `pop-frame` — action: pop the top frame from CMemoryView
- `assign-return` — action: assign return value to caller's variable after pop

### Orchestrator (CFunctionDemo)

- Follows existing orchestrator pattern exactly (pc, isAnimating, executed, generation counter)
- Tracks a logical call stack to feed CodePanel breadcrumb
- Tab-based program selection (4 tabs matching the progressive examples)
- Step controls work across function boundaries — "Next" steps into function bodies, through frame push/pop

## Resolved Questions

1. **Should `popFrame` animate variable removal?** → **Collapse animation.** The popped frame's rows slide together and collapse into the divider, which then disappears. More dramatic than instant removal, and makes the "stack shrinking" metaphor visible.

2. **Return value flow visualization:** → **Two-phase: pop then assign.** Pop the frame first (with collapse animation), then assign the return value to the caller's variable with a glow. The gap between pop and assign makes the "value survived the pop" moment visible.

3. **Should we show the return address?** → **No, skip it.** Too much detail for this stage. Focus on variables, arguments, and scope. Return addresses can be introduced in a later, more advanced section.

4. **Recursion:** → **Include a recursion tab (Tab 4).** `factorial(3)` demonstrates multiple frames of the same function stacking up. Visually dramatic and thoroughly tests the frame model. Designed into the data structures from day one.
