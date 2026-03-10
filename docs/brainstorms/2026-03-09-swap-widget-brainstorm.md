# Brainstorm: Swap Algorithm Widget

**Date:** 2026-03-09
**Status:** Draft

## What We're Building

An interactive orchestrator (like CPrintfDemo) that teaches why temporary variables are necessary for swapping two values. It uses a **tabbed two-program approach**:

1. **"Naive" tab** — the broken swap (`a = b; b = a;`) where the first assignment overwrites `a`'s value and the swap fails (both end up as `'Z'`).
2. **"Correct" tab** — the temp-variable swap (`char temp = a; a = b; b = temp;`) where all values are preserved and the swap succeeds.

The contrast between the two is the core pedagogical moment — the user steps through the broken version, sees data loss firsthand, then switches to the correct version and sees how `temp` solves the problem.

## Why This Approach

- **Broken-then-fixed contrast** is the most compelling way to teach the concept. Telling someone "you need a temp variable" is forgettable; watching data disappear makes it stick.
- **Tabbed programs** keep the UI compact (one CodePanel + one CMemoryView) while letting the user freely compare both approaches. CMemoryView resets on tab switch.
- **Reuses existing infrastructure** — CMemoryView, CodePanel, the CInstruction/CSubStep model, and the stepping pattern from CPrintfDemo. No new shared components needed.

## Key Decisions

1. **Two programs, one orchestrator** — A tab bar switches between the naive and correct program. Shared CMemoryView and CodePanel reset state on tab change.
2. **Data: `char a = 'A'`, `char b = 'Z'`** — Characters are visually distinct in both table and bit views. ASCII values (65, 90) are interesting in the bit view.
3. **Default to table view** — Keeps focus on the value-level story. Users can toggle to bits view if curious about the raw memory.
4. **Follows CPrintfDemo orchestrator pattern** — Lives in `components/sandbox/`, not `components/widgets/`. Uses `bind:this` on CMemoryView, same `pc`/`executed`/`cachedSubSteps` stepping model, same async/generation-counter cancellation.
5. **No new CInstruction kinds needed** — The swap can be expressed with existing `declare-assign`, `assign`, and `eval-assign` instruction kinds.

## Programs

### Naive (Broken) Swap

```c
char a = 'A';
char b = 'Z';
// Swap a and b
a = b;       // a is now 'Z' — original 'A' is lost!
b = a;       // b is 'Z' too — both are 'Z'
```

Sub-steps: declare a → assign 'A', declare b → assign 'Z', read b → assign a (glow), read a → assign b (glow, but value is 'Z' not 'A').

### Correct Swap

```c
char a = 'A';
char b = 'Z';
// Swap a and b using temp
char temp = a;  // save a's value
a = b;          // overwrite a with b
b = temp;       // restore a's original value into b
```

Sub-steps: declare a → assign 'A', declare b → assign 'Z', read a → declare temp → assign temp, read b → assign a (glow), read temp → assign b (glow).

## Scope

### In Scope

- CSwapDemo orchestrator with tab bar (Naive / Correct)
- CodePanel + CMemoryView composition (same layout as CPrintfDemo minus StdoutPanel)
- Step-by-step sub-step decomposition with highlights and glow
- Sandbox page at `/sandbox/c-swap.astro`

### Out of Scope

- XOR swap or arithmetic swap variants
- Prose sections or essay integration (that comes later)
- Custom visual effects beyond what CMemoryView already supports

## Open Questions

None — design is well-scoped and follows established patterns.
