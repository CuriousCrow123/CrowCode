# Brainstorm: C Memory View Widget

**Date**: 2026-03-09
**Status**: Complete
**Next step**: `/ce:plan`

## Context

This is the next narrative step in the visual essay after MemoryTable. The MemoryTable shows the "zoomed out" RAM view (sections, addresses, ambient bit activity). Now we need to "zoom in" and show how **C program instructions** actually modify memory — teaching data types, sizes, initialization, and addressing.

### Essay progression

1. BitGridRandom — "RAM is bits"
2. BitGridBytes — "bits change in groups of 8"
3. MemoryTable — "every byte has an address, memory is organized into sections"
4. **CMemoryView** — "C instructions allocate and modify specific bytes; different types use different amounts of memory"

## What We're Building

Two new components that work together, composed side-by-side by a section:

### `CMemoryView` widget (`components/widgets/CMemoryView.svelte`)

A focused byte grid showing a small memory region (e.g., 16–32 bytes). Each row: address | 8 bit cells | hex value. Key features:

- **Variable annotations**: colored overlays/labels showing which bytes belong to which declared variable (e.g., `int x` highlights 4 consecutive bytes in one color with the name "x" on the first byte's row)
- **Uninitialized memory**: when a variable is declared without assignment (`int x;`), its bytes show random bit patterns — teaching that memory has whatever was there before
- **Assignment animation**: when a value is assigned (`x = 10;`), the affected bytes glow and update to the correct bit pattern
- **Simplified table toggle**: can transition (prose-driven or toggle button) to a compact table view showing: data type | variable name | value | address — communicating "this is the abstraction we'll use going forward"
- **Address display**: simple 4-digit hex addresses for the focused region
- **Endianness**: big-endian (MSB at lowest address) for conceptual clarity
- Reuses `BitCell.svelte` from shared components

### `CodePanel` shared component (`components/widgets/shared/CodePanel.svelte`)

Displays C code with syntax highlighting and annotations. Features:

- Real C syntax with color highlighting (keywords, types, identifiers, literals)
- Annotations on code parts (e.g., "data type" label above `int`, "variable name" label above `x`)
- Current instruction highlight (which line is "executing")
- Optional step-through controls (prev/next buttons) — can be hidden when prose drives the progression
- No `paramDefs` or `WIDGET_ID` — pure shared component receiving data via props

### Section composition

A section component composes them side-by-side:
- CodePanel on the left, CMemoryView on the right
- Prose action buttons can trigger "execute next instruction" which advances both
- Step controls on the CodePanel can also advance both
- Both stay in sync regardless of what drives the progression

## Why This Approach

- **Separation of concerns**: memory view and code panel are independent, reusable components
- **Follows established patterns**: CMemoryView is a standard widget (paramDefs, imperative API, sandbox page); CodePanel is a standard shared component (props + callbacks)
- **MemoryTable stays untouched**: the full RAM overview widget remains simple and focused on its purpose
- **Reuses BitCell**: consistent bit rendering across the essay

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| New widget vs. extend MemoryTable | New `CMemoryView` widget | MemoryTable is already 577 lines with complex race conditions; the two use cases are fundamentally different |
| Uninitialized memory display | Random bits on declaration | Teaches that memory contains whatever was there before — the core lesson |
| Endianness | Big-endian (conceptual) | Avoids the endianness rabbit hole; keeps focus on data types and sizes |
| Code display | Real C with annotations | Students should read real syntax, but annotations help identify parts (type, name, value) |
| Interaction model | Flexible — prose-driven AND step-through | Sometimes the essay narrative drives it, sometimes the student explores freely |
| Simplified table | Prose-driven transition + toggle | First transition happens narratively ("now that we understand, here's the shorthand"), then toggle lets student switch back |
| Layout | Side by side | Code and memory visible simultaneously; highlights connect instruction to affected bytes |
| Code panel | Shared component (not widget) | No paramDefs needed — it's a display component driven by the parent |

## Teaching Concepts

The widget sequence should communicate:

1. **Different data types = different byte counts**: `int` = 4 bytes, `float` = 4 bytes, `char` = 1 byte, `double` = 8 bytes
2. **Declaration without initialization = garbage**: `int x;` claims 4 bytes but they contain random data
3. **Variable name = address of first byte**: even though `int x` spans 4 bytes, "x" refers to the address of byte 0
4. **Assignment writes specific bit patterns**: `x = 10` writes `0x00 0x00 0x00 0x0A` across 4 bytes
5. **Evaluation reads and computes**: `int b = a + 10;` reads a's bytes, adds 10, writes result to b's bytes

## Resolved Questions

1. **Stack growth direction**: Addresses grow downward (realistic). Stack pointer starts at top of memory region and decrements. Display order: **lowest address at top, highest at bottom** — so big-endian bytes read naturally top-to-bottom. (Changed from initial "higher addresses at top" during implementation for readability.)
2. **Float representation**: Just show the bytes — don't explain IEEE 754 encoding here. The existing float widgets in the essay already cover that topic.
3. **Expression evaluation visualization**: Show detailed steps — read source variable's bytes, compute result, write to destination bytes. Three distinct visual steps with annotations.
4. **Demo instruction sequence**: Configurable — the widget accepts any instruction sequence as data. The essay author defines the specific demo in the section component. This keeps the widget generic and reusable for different teaching scenarios.

## Implementation Notes (added during build)

The following features were added during implementation beyond the initial brainstorm scope:

- **Column labels**: Subtle header row (Addr, Var, Bits, Hex) above the byte grid for self-documenting display
- **Row collapsing**: Unallocated memory regions collapse into ellipsis indicators (`··· N bytes ···`), keeping a configurable number of context rows visible around allocated variables. When no variables exist, all 32 rows are shown.
- **Scrollable container with auto-scroll**: The byte grid is contained in a scrollable area that automatically scrolls to show newly allocated variables. User can freely scroll between steps.
- **Single-pass syntax tokenizer**: CodePanel's `highlightSyntax` uses a single-pass regex tokenizer instead of chained replacements — the chained approach caused HTML clobbering where operators matched inside previously-inserted `<span>` attributes.
