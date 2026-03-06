# Brainstorm: C Programs & Memory Tracing — Chapter 8

**Date:** 2026-03-06
**Status:** Draft
**Builds on:** [Pointers, Arrays & Heap brainstorm](2026-03-05-pointers-arrays-heap-brainstorm.md)
**Lab context:** Lab 7B (pointers, sizeof, arrays, function passing) and Lab 7C (heap allocation, pointer-only variables, sentinel loops)

## What We're Building

A capstone chapter that shows complete C programs executing step-by-step, with memory displayed as a structured table (Data Type | Name | Value | Address). This synthesizes all concepts from Ch1-7 into working programs students can trace.

### Pedagogical Arc

```
Ch7 (Heap)          → "malloc returns a pointer — your only handle to heap memory"
    ↓
Ch8 (Programs)      → "Let's see complete programs — watch every instruction update memory"
```

The bridge from Ch7: "You've seen bits become numbers, numbers fill memory, variables name locations, pointers grab addresses, arrays lay out contiguously, and malloc claims heap space. Now let's see it all work together in complete programs."

---

## Why a Memory Table?

Previous chapters used specialized visualizations:
- Box view (VariableViewer) — "named containers" mental model
- RAM view (bit-level) — "bytes in memory" understanding
- Dual-zone view (HeapAllocator) — stack/heap distinction

Now students need a **practical debugging view** — the kind they'll see in actual tools. The table format (Type | Name | Value | Address) maps directly to:
- Debugger variable watches
- printf output from Lab 7B
- Mental models for tracing code on paper

---

## Widget: MemoryTracer

### Core Design

A program selector + code stepper + memory table + output panel.

**Layout:** Side-by-side on desktop (code left, memory+output right), stacked on mobile.

**Program selector:** Horizontal pills at the top. 4 programs, ordered by complexity.

### Programs

1. **"Variables & Types"** — `int a = 10; double b = 3.14; char c = 'X';` + printf for each showing value, address, sizeof. Maps to Lab 7B Part 1 (basic variables).

2. **"Pointers"** — Adds `int *px = &x; double *py = &y; char *pz = &z;` + printf for pointers. Maps to Lab 7B Part 1 (pointer half). Shows pointer values are addresses, all pointers are 8 bytes.

3. **"Arrays & sizeof"** — `int arr[5] = {10,20,30,40,50};` + sizeof tricks + pass to function. Maps to Lab 7B Part 2. Shows contiguous memory, array_size calculation, sizeof shrink in function.

4. **"Heap Averager"** — malloc-based program with pointer-only variables, sentinel loop pattern. Maps to Lab 7C. Shows heap allocation, all data on heap, pointer-only stack.

### Memory Table Format

| Type | Name | Value | Address |
|------|------|-------|---------|
| int | a | 10 | 0xBFFFF000 |
| double | b | 3.14 | 0xBFFEFFF8 |
| char | c | 'X' | 0xBFFEFFF7 |

- New rows glow when added
- Changed values flash
- Pointer values shown as hex addresses
- Scope column appears when functions are involved (e.g., "main" vs "printArray")
- Rows removed when scope exits (function returns)

### Output Panel

Shows printf output accumulating as steps progress. Each new line highlights briefly. This directly shows students what their Lab 7B programs should print.

---

## Key Decisions

1. **Single widget with program selector** — not 4 separate widgets. Keeps essay clean, shows progression, avoids repetitive section structure.

2. **Table format** — not box or byte view. This is the practical debugging mental model and matches the lab output format students are asked to produce.

3. **Side-by-side layout** — code left, memory+output right. Debugger feel — see code and memory simultaneously. Stacks on mobile.

4. **Snapshot-based stepping** — pre-compute all states per program (proven pattern from HeapAllocator). Enables bidirectional stepping.

5. **Programs as data** — Define programs in a separate `lib/programs.ts` file to keep the widget code clean and make programs easy to add/modify.

6. **Output panel mirrors lab requirements** — Students see what printf should produce, connecting the visualization to their actual assignments.

7. **Scope handling for function calls** — In Program 3 (Arrays), when the function is called, new variables appear with a scope label ("printArray"). When the function returns, those variables disappear. This teaches scope visually.

---

## Resolved Questions

- **How many programs?** 4 — maps to the two labs (7B Part 1, 7B Part 1 pointers, 7B Part 2, 7C)
- **Include sizeof in table?** No — keep the 4 columns the user requested (Type, Name, Value, Address). sizeof is shown through the printf output instead.
- **How to show pointer→target relationship?** Pointer values displayed as hex addresses that visually match the target's Address column. No SVG arrows — the table format makes the connection through matching hex values.
