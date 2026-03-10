# Brainstorm: C Array Visualization Widget

**Date:** 2026-03-09
**Status:** Draft

## What We're Building

A `CArrayDemo` widget that teaches C arrays through a progressive, two-act narrative:

1. **Act 1 — Arrays as contiguous memory:** Declare `int arr[4] = {10, 20, 30, 40}`, show how 16 consecutive bytes are laid out in RAM, access elements via `arr[i]` syntax.
2. **Act 2 — Array-pointer equivalence:** Introduce `int *p = arr`, demonstrate that `p+1 == &arr[1]`, `*(p+2) == arr[2]`, and that `[]` is syntactic sugar for pointer arithmetic + dereference.

The widget uses a **dual-view architecture**:
- **Array strip** (top): A horizontal row of cells showing the logical array — index labels above, values inside, pointer position indicated by an arrow below.
- **CMemoryView** (bottom): The existing byte-addressable RAM view showing raw bytes, addresses, and variable annotations.

The two views are linked by **color-coded highlighting** — when `arr[2]` is active, both the cell in the strip and the corresponding 4-byte range in CMemoryView highlight in the same color. No physical connector lines.

### Address Arithmetic Display

Pointer arithmetic calculations are shown with a **togglable "show math" mode**:
- **Default (arrows only):** An arrow in the array strip points from the pointer to the target element. The student infers the 4-byte stride from addresses shown in CMemoryView.
- **Show math mode:** Displays the calculation inline: `0x1000 + 2 × 4 = 0x1008`, making the `sizeof(int)` scaling factor explicit.

## Why This Approach

### Dual view over single view
The core insight of arrays is that they're *both* a logical sequence of indexed elements *and* a physical region of contiguous bytes. A single view forces the student to imagine one perspective while seeing the other. The dual view makes both perspectives simultaneously visible, with color linking them.

### Progressive narrative
Starting with memory layout before introducing pointer equivalence prevents cognitive overload. The student first builds a mental model of "array = contiguous block," then discovers that pointers can navigate that same block — the pointer arithmetic becomes intuitive because they already *see* the addresses.

### Cell strip design
Horizontal boxes mimic how arrays are drawn on whiteboards and in textbooks. This familiar visual metaphor reduces the learning barrier compared to novel representations.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Learning progression | Contiguous memory first, then pointer arithmetic | Builds mental model incrementally |
| Visualization | Dual view: array strip + CMemoryView | Shows both logical and physical perspectives |
| Array strip style | Horizontal cell strip (boxes with index/value) | Familiar textbook visual metaphor |
| View linking | Color-coded highlighting (no connector lines) | Clean, uncluttered, easy to follow |
| Address math | Togglable: arrows by default, "show math" optional | Accommodates different learning speeds |
| Architecture | Single CArrayDemo orchestrator, reuses CMemoryView | Follows existing patterns (CSwapDemo, CPointerDemo) |
| Array strip component | New shared component: `CArrayStrip.svelte` | Reusable in future array-related widgets |

## Example Program (3 Acts)

```c
// Act 1: Declaration and memory layout
int arr[4] = {10, 20, 30, 40};  // array size tunable (3-6), default 4

// Act 2: Array indexing
int x = arr[1];    // x = 20
int y = arr[3];    // y = 40

// Act 3: Pointer arithmetic equivalence
int *p = arr;       // p points to arr[0]
int a = *(p + 1);   // same as arr[1] = 20
int b = *(p + 2);   // same as arr[2] = 30
p++;                // p now points to arr[1]
int c = *p;         // c = 20

// Act 4: Out-of-bounds (danger zone)
int bad = arr[4];   // undefined behavior! Past the end of the array
```

### Step Decomposition (Key Moments)

**Act 1 — `int arr[4] = {10, 20, 30, 40}`:**
1. Allocate 16 bytes in CMemoryView (grouped block with bracket)
2. Sub-steps: write each element one by one (arr[0]=10, arr[1]=20, ...), with cell strip cells filling in sequentially and corresponding bytes glowing in CMemoryView

**Act 2 — `int x = arr[1]`:**
1. Highlight arr[1] in strip (color A)
2. Highlight bytes 4-7 in CMemoryView (same color A)
3. Read value 20
4. Assign to x (glow animation)

**Act 3 — `int *p = arr`:**
1. Show pointer arrow in strip pointing to arr[0]
2. Show p's value as address in CMemoryView

**Act 3 — `*(p + 1)`:**
1. (If "show math" on) Display: `p + 1 → 0x1000 + 1×4 = 0x1004`
2. Arrow slides from arr[0] to arr[1] in strip
3. Dereference: highlight arr[1], read value
4. Assign to variable a

## Component Structure

```
CArrayDemo.svelte          (orchestrator — paramDefs, step engine, prose actions)
├── CodePanel.svelte        (shared — highlighted C code)
├── CArrayStrip.svelte      (NEW shared — horizontal cell strip with pointer arrow)
└── CMemoryView.svelte      (shared — byte-addressable RAM, extended for array grouping)
```

### CArrayStrip API (imperative, called by orchestrator)

- `declareArray(name, elementType, values)` — render cells with indices and values
- `highlightElement(index, color)` — highlight a cell
- `clearHighlights()` — clear all highlights
- `setPointer(name, index)` — show pointer arrow at element
- `movePointer(name, fromIndex, toIndex)` — animate pointer arrow movement
- `showArithmetic(base, offset, elementSize, result)` — display math calculation
- `hideArithmetic()` — hide math display
- `reset()` — clear everything

### CMemoryView Extensions Needed

- **Array grouping:** `declareArray(name, type, count)` that creates a grouped block with bracket/label, where each element is a sub-row with index notation (arr[0], arr[1], ...)
- **Element-level highlighting:** `highlightElement(arrayName, index, color)` to highlight specific elements within an array group
- **Color parameter on highlight:** Current `highlightVar` uses a single highlight style; need to support named colors for cross-view linking

## Visual Feedback Patterns

| Action | Array Strip | CMemoryView |
|--------|-------------|-------------|
| Declare array | Cells appear one-by-one (slide in) | Bytes glow one element at a time |
| Read arr[i] | Cell i highlights (color A) | Bytes for element i highlight (color A) |
| Assign from array | Cell i pulses, then fades | Bytes glow, value copies to target var |
| Set pointer | Arrow appears below cell | Pointer variable shows address |
| Pointer arithmetic | Arrow slides to new position | (If show-math on) Calculation displayed |
| Dereference *p | Pointed-to cell highlights | Pointed-to bytes highlight |

## Resolved Questions

1. **Array size:** Tunable parameter (3-6 range) via widget debug panel. Default 4 elements. Step engine and layout must adapt dynamically to array size.

2. **Out-of-bounds access:** Yes, include as a final step in Act 3. Show `arr[N]` or `*(p+N)` accessing beyond the array boundary — pointer/highlight visually goes past the last cell into "unknown territory" with a visual danger indicator (red highlight, hatched cell).

3. **String arrays:** Separate widget later (`CStringDemo`). Keep this widget focused on `int` arrays. Strings introduce null terminators and char encoding which deserve dedicated treatment.

## Open Questions

None — all questions resolved.
