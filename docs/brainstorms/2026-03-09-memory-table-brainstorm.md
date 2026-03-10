# Brainstorm: Memory Table Widget

**Date:** 2026-03-09
**Status:** Complete

## What We're Building

A byte-addressable memory table widget that presents RAM as rows of 8 bits, each with a hex address. This is the next narrative step after BitGridBytes — showing that every byte in memory has a unique address.

The widget displays a vertical table where each row is:
```
0x0000  │ 0 1 1 0 0 1 0 1 │  0x65
```
Address (hex) — 8 bit cells with glow-pulse — decoded byte value (hex).

**Memory sections** (Text, Data, BSS, Heap, Stack, Kernel) appear as subtle left-margin labels with thin colored bars. Rows between sections can collapse into `...` ellipsis rows to represent the vast address space that can't be shown visually.

**Phased approach:**
- **v1 (this plan):** Full table with configurable addresses, section annotations, collapse/expand, static + ambient modes
- **v2 (future):** Animated transition from BitGridBytes flat grid into this table view, triggered by prose

## Why This Approach

**New standalone widget, designed for future BitGridBytes transition**

- Follows the established "separate widgets, not modes" architecture from the BitGrid system
- Keeps BitGridBytes simple (it already does its job well)
- Data model uses a flat `bits[]` array like all BitGrid variants, so a future transition can share/hand off the array between widgets
- The table layout is fundamentally different from BitGridCore's flat CSS grid — different enough to warrant its own rendering

**Extract shared BitCell component**

Rather than reusing BitGridCore (one instance per row is wasteful) or duplicating glow-pulse CSS, extract a tiny `BitCell.svelte` shared component from BitGridCore's cell logic. Both BitGridCore and MemoryTable can use it.

- Lives in `components/widgets/shared/BitCell.svelte` (follows the ScrubSlider pattern)
- No WIDGET_ID, no paramDefs — receives all config via props
- Handles: rendering 0/1, glow-pulse animation on value change, highlight color, color-only mode
- BitGridCore refactored to use BitCell internally (keeps its API identical)

**Configurable address format**

- `startAddress` (number) and `addressDigits` (4 or 8) as paramDefs
- Default: `startAddress=0`, `addressDigits=4` → simple `0x0000` sequential addresses
- Tunable via debug panel to realistic 32-bit ranges (e.g. `startAddress=0x08048000`, `addressDigits=8`)
- The toggle between "simple" and "realistic" is just changing these two params

## Key Decisions

### Layout: Table with three columns

```
┌─────────────────────────────────────────────┐
│ SECTION  ADDRESS    BITS          VALUE      │
│                                              │
│ ┃ TEXT   0x0000  │ 0 1 1 0 0 1 0 1 │  0x65  │
│ ┃        0x0001  │ 1 0 0 1 1 0 1 0 │  0x9A  │
│ ┃        0x0002  │ 0 0 0 0 0 0 0 0 │  0x00  │
│          ···  (3 more bytes)  ···            │
│ ┃ DATA   0x0005  │ 1 1 0 0 1 1 0 0 │  0xCC  │
│ ┃        0x0006  │ 0 1 0 1 0 1 0 1 │  0x55  │
│          ···                                 │
│ ┃ STACK  0xBFFE  │ 1 1 1 1 0 0 0 0 │  0xF0  │
│ ┃        0xBFFF  │ 0 0 1 1 0 0 1 1 │  0x33  │
└─────────────────────────────────────────────┘
```

- **Address column:** Monospace hex, left-aligned. Width adapts to `addressDigits`.
- **Bit cells column:** 8 cells per row using shared BitCell component. Glow-pulse on change.
- **Value column:** Decoded byte in hex (e.g. `0x65`). Updates reactively.
- **Section annotations:** Thin colored bar on the left margin with small rotated or vertical label. Only the first visible row of each section shows the label. The bar spans all rows in the section.

### Section model

Sections are defined as data, not hardcoded markup:

```ts
interface MemorySection {
  label: string;        // e.g. 'TEXT', 'STACK'
  startAddress: number; // absolute address
  visibleBytes: number; // how many bytes to actually show
  totalBytes: number;   // conceptual total (for the "..." display)
  color: string;        // left-bar color
}
```

Default sections follow a simplified C memory layout:
- Text (program code) — starts low
- Data (initialized globals)
- BSS (uninitialized globals)
- Heap (grows up)
- *gap* (collapsed, shows "...")
- Stack (grows down, near top)
- Kernel (highest addresses, greyed out / inaccessible)

Each section shows `visibleBytes` rows with real bit cells, then a `...` ellipsis row indicating `totalBytes - visibleBytes` more exist. The ellipsis row is clickable/expandable (reveals more rows, up to a cap).

### Collapse/expand behavior

- Each section has a collapsed state (shows only the `...` row) and an expanded state (shows `visibleBytes` rows + `...` for remainder)
- Imperative API: `collapse(sectionLabel)`, `expand(sectionLabel)`, `collapseAll()`, `expandAll()`
- The gap between heap and stack is always collapsed (just a `...` row with no section label)
- Collapse/expand animates via CSS `max-height` transition or Svelte `slide` transition

### Byte behavior: Static + ambient modes

- Default: **static** — bytes hold initial values, only change via imperative API
- `setAmbient(true)` — enables random flips on all (or selected) bytes, like BitGridRandom
- `writeByte(address, value)` — imperative write with glow animation
- `highlightRow(address)` — temporarily highlight a specific row (for prose-driven attention)

### Data model (designed for future BitGridBytes transition)

- Internal `bits: number[]` array, same pattern as all BitGrid variants
- `bits.length = totalVisibleBytes * 8` (only visible bytes have actual bits)
- Each section knows its byte offset into this array
- For future transition: BitGridBytes and MemoryTable could share a bits array via a parent section component, with an animated DOM morph between layouts

### Widget CSS prefix

`--mt-` (memory table)

## Resolved Questions

1. **Relationship to BitGridBytes** — New standalone widget, but data model compatible for a future animated transition. The transition itself is v2.

2. **Address format** — Configurable via `startAddress` and `addressDigits` params. Simple sequential by default, tunable to realistic 32-bit ranges.

3. **Bit rendering** — Extract shared `BitCell.svelte` from BitGridCore. Both BitGridCore and MemoryTable use it.

4. **Section annotations** — Left-margin colored bars with small labels. Sections are data-driven, not hardcoded.

5. **Collapse scope** — In v1. Sections can collapse/expand. The heap-stack gap is always collapsed.

6. **Byte behavior** — Configurable: static by default, ambient mode toggleable via imperative API.

## Open Questions

None — all resolved.

## Future Considerations (not for v1)

- Animated transition from BitGridBytes flat grid into this table layout (triggered by prose)
- Address bus visualization (showing CPU reading/writing specific addresses)
- Pointer visualization (arrows from one address to another)
- Multi-byte value display (interpreting 2 or 4 consecutive bytes as int16/int32)
- Write-through animation (CPU sends value, dot travels wire, byte updates)
- Endianness toggle (big-endian vs little-endian byte ordering)
