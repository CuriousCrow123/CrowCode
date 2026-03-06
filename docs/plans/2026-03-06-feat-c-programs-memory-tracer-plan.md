---
title: "feat: Add C Programs & Memory Tracer chapter with interactive MemoryTracer widget"
type: feat
status: active
date: 2026-03-06
origin: docs/brainstorms/2026-03-06-c-programs-memory-tracer-brainstorm.md
---

# feat: Add C Programs & Memory Tracer Chapter

## Overview

Add Chapter 8 ("Programs in Action") to the visual essay — a capstone chapter with a single interactive `MemoryTracer` widget that lets students load different C programs and step through execution, watching a memory table (Data Type | Name | Value | Address) update in real-time with printf output accumulating below.

## Problem Statement / Motivation

Students completing Labs 7B and 7C need to understand how complete C programs update memory. The existing chapters teach isolated concepts (variables, pointers, arrays, heap) but don't show them working together in full programs. Students need:

1. A way to trace program execution step-by-step
2. A memory view matching the debugging/printf format they use in labs
3. Multiple programs covering all C instruction types from their assignments
4. Visual connection between code lines and memory state changes

## Proposed Solution

### Widget: `MemoryTracer.svelte`

A single widget with 4 selectable programs, each showing C code alongside a live memory table.

**Layout (desktop ≥768px):**
```
┌──────────────────────────────────────────────────────────┐
│  [Variables & Types] [Pointers] [Arrays & sizeof] [Heap] │
├──────────────────────────┬───────────────────────────────┤
│  Code                    │  Memory                       │
│  ← Step 3/8 →            │  Type   Name  Value   Address │
│                          │  int    a     10      0xBF... │
│  1  int a = 10;          │  double b     3.14    0xBF... │
│  2  double b = 3.14;     │  char   c     'X'     0xBF... │
│  3▸ char c = 'X';        │                               │
│  4  printf(...);         ├───────────────────────────────┤
│                          │  Output                       │
│  ┌─ description ────┐    │  > a: value=10, addr=0xBF..   │
│  │ Declare c = 'X'  │    │  > sizeof(a) = 4 bytes        │
│  └──────────────────┘    │                               │
└──────────────────────────┴───────────────────────────────┘
```

**Layout (mobile <768px):** Stacked vertically — program tabs → code panel → memory table → output.

### Section: `sections/programs/ProgramsInAction.svelte`

Prose introduces the chapter as a synthesis — "you've learned all the pieces, now watch complete programs run." Action buttons trigger stepping and program switching.

### Data: `lib/programs.ts`

Program definitions as typed data. Each program has:
- `id`, `title`, `description`
- `code: string[]` — source lines
- `steps: ProgramStep[]` — pre-computed snapshots with memory state and output

### Programs

#### Program 1: "Variables & Types" (Lab 7B Part 1, first half)
```c
int a = 10;
double b = 3.14;
char c = 'X';
printf("a: value=%d, addr=%p, sizeof=%lu\n", a, &a, sizeof(a));
printf("b: value=%.2f, addr=%p, sizeof=%lu\n", b, &b, sizeof(b));
printf("c: value=%c, addr=%p, sizeof=%lu\n", c, &c, sizeof(c));
```
6 steps. Shows three data types occupying different memory sizes.

#### Program 2: "Pointers" (Lab 7B Part 1, second half)
```c
int x = 42;
double y = 3.14;
char z = 'A';
int *px = &x;
double *py = &y;
char *pz = &z;
printf("px: value=%p, sizeof=%lu\n", px, sizeof(px));
printf("py: value=%p, sizeof=%lu\n", py, sizeof(py));
printf("pz: value=%p, sizeof=%lu\n", pz, sizeof(pz));
```
9 steps. Shows pointer values ARE addresses. All pointers are 8 bytes.

#### Program 3: "Arrays & sizeof" (Lab 7B Part 2)
```c
int arr[5] = {10, 20, 30, 40, 50};
int array_size = sizeof(arr) / sizeof(int);
printf("Array: %lu bytes\n", sizeof(arr));
printf("Elements: %d\n", array_size);
printArray(arr, array_size);  // function call
```
Plus function:
```c
void printArray(const int *arr, int size) {
    printf("sizeof pointer: %lu\n", sizeof(arr));
    for (int i = 0; i < size; i++)
        printf("arr[%d] = %d\n", i, arr[i]);
}
```
~12 steps. Shows sizeof(arr)=20 in main, sizeof(arr)=8 in function (decay). Function call creates new scope with pointer parameter.

#### Program 4: "Heap Averager" (Lab 7C)
```c
int *count = (int*)malloc(sizeof(int));
double *sum = (double*)malloc(sizeof(double));
double *input = (double*)malloc(sizeof(double));
*count = 0;
*sum = 0.0;
// sentinel loop (3 iterations shown)
*input = 5.5;  *sum += *input;  (*count)++;
*input = 3.2;  *sum += *input;  (*count)++;
*input = 7.1;  *sum += *input;  (*count)++;
double *avg = (double*)malloc(sizeof(double));
*avg = *sum / *count;
printf("Count: %d, Average: %.3f\n", *count, *avg);
```
~16 steps. Stack only has pointers. All data on heap. Region column shows stack vs heap.

## Technical Approach

### Architecture

```
lib/programs.ts          — Program data definitions + types
widgets/MemoryTracer.svelte  — Main widget (program selector + stepper + table + output)
sections/programs/ProgramsInAction.svelte  — Section wrapper with prose
pages/index.astro        — Add ProgramsInAction after DynamicMemory
pages/sandbox/memory-tracer.astro  — Sandbox page
```

### Implementation Phases

#### Phase 1: Data Layer (`lib/programs.ts`)
- [ ] Define TypeScript interfaces: `MemoryEntry`, `OutputLine`, `ProgramStep`, `Program`
- [ ] Implement all 4 programs with pre-computed step snapshots
- [ ] Use realistic addresses (stack: 0xBFFFF000 descending, heap: 0x0804B000 ascending)

#### Phase 2: Widget (`widgets/MemoryTracer.svelte`)
- [ ] Program selector (horizontal pills)
- [ ] Code panel with step controls (reuse existing code-stepper CSS pattern)
- [ ] Memory table (4 columns: Type, Name, Value, Address)
- [ ] Output panel (printf results accumulating)
- [ ] Row glow on new/changed entries
- [ ] Scope labels when functions are active
- [ ] Responsive layout (side-by-side → stacked at <768px)
- [ ] Widget param system (font sizes, table cell sizes)
- [ ] WidgetDebugPanel integration

#### Phase 3: Section + Pages
- [ ] Create `sections/programs/ProgramsInAction.svelte` with prose narrative
- [ ] Add to `pages/index.astro` after DynamicMemory
- [ ] Create `pages/sandbox/memory-tracer.astro`
- [ ] Add to sandbox index

#### Phase 4: Polish
- [ ] Verify build passes
- [ ] Test stepping forward/back across all programs
- [ ] Test program switching resets state
- [ ] Responsive layout works on mobile viewport

## Acceptance Criteria

### Functional
- [ ] 4 programs selectable via tab pills
- [ ] Step forward/back through each program
- [ ] Memory table shows Type, Name, Value, Address columns
- [ ] New rows glow when added
- [ ] Changed values flash
- [ ] Output panel shows printf results
- [ ] Program 3 shows scope change (main → printArray → main)
- [ ] Program 4 shows stack vs heap regions
- [ ] Switching programs resets to step 0

### Non-Functional
- [ ] Follows existing widget pattern (paramDefs, loadParams, WidgetDebugPanel)
- [ ] Uses scoped CSS custom properties (no global spatial tokens)
- [ ] Matches existing design language (colors, fonts, borders)
- [ ] Responsive layout (side-by-side on desktop, stacked on mobile)
- [ ] Build passes with no errors

### Quality
- [ ] Code stepper CSS matches existing widgets
- [ ] Programs use realistic memory addresses
- [ ] Printf output matches what students would see in their terminals
- [ ] Section prose follows concrete-first pedagogical approach
- [ ] Sandbox page exists for isolated development

## Sources & References

- **Origin brainstorm:** [docs/brainstorms/2026-03-06-c-programs-memory-tracer-brainstorm.md](docs/brainstorms/2026-03-06-c-programs-memory-tracer-brainstorm.md)
- **Pattern reference:** `site/src/components/widgets/HeapAllocator.svelte` (snapshot-based stepping)
- **Pattern reference:** `site/src/components/widgets/VariableViewer.svelte` (code stepper CSS)
- **Section pattern:** `site/src/components/sections/pointers/AddressesAsValues.svelte`
- **Shared utils:** `site/src/lib/memory.ts` (hexAddr, hexByte)
