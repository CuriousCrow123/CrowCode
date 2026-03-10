---
title: "feat: Memory Table Widget"
type: feat
status: active
date: 2026-03-09
origin: docs/brainstorms/2026-03-09-memory-table-brainstorm.md
---

# feat: Memory Table Widget

## Enhancement Summary

**Deepened on:** 2026-03-09
**Sections enhanced:** All major sections
**Review agents used:** Architecture Strategist, Performance Oracle, Code Simplicity Reviewer, Pattern Recognition Specialist, Frontend Races Reviewer, Context7 (Svelte 5 docs), CSS animation research, ARIA accessibility research

### Key Improvements
1. **Fixed critical race conditions**: writeByte + expand timing, ambient vs writeByte overlap, collapse glow burst, highlightRow timer overlap
2. **Performance fix**: Use Svelte 5 reactive Set mutations (`.add()`/`.delete()`) instead of Set recreation — O(1) vs O(n) per glow event
3. **CSS prefix collision fixed**: Renamed `--bc-` to `--bit-cell-` to avoid collision with BitConnections
4. **Collapse animation upgraded**: Use `grid-template-rows: 0fr/1fr` instead of `max-height` — no height guessing, proper easing
5. **highlightRow redesigned**: Use `@keyframes` + `animationend` instead of `setTimeout` — follows established pattern, eliminates race conditions
6. **Reduced API surface**: Cut from 12 to 8 methods (cut collapseAll, expandAll, clearHighlights, reset)
7. **Reduced paramDefs**: Cut from 9 to 7 (cut barWidth, addressFontSize)
8. **formatByteCount inlined**: Not added to binary.ts (display utility, not binary math)

### New Considerations Discovered
- Ambient flips must skip collapsed sections (prevents glow burst on re-expand)
- writeByte must add per-byte write protection to prevent ambient overwrite
- writeByte on collapsed section must defer glow until expand transition completes
- Pass constant cell props via CSS custom properties from parent, not per-cell props (halves signal subscriptions)

---

## Overview

A byte-addressable memory table widget that presents RAM as rows of 8 bits, each with a hex address. This is the next narrative step after BitGridBytes — showing that every byte in memory has a unique address. (See brainstorm: `docs/brainstorms/2026-03-09-memory-table-brainstorm.md`)

The system consists of:
1. **BitCell** — A shared presentational component extracted from BitGridCore's cell rendering. Used by both BitGridCore (refactored) and MemoryTable.
2. **MemoryTable** — A full widget displaying a table of byte rows with hex addresses, memory section annotations, collapse/expand, and static/ambient modes.

The table progresses the visual essay's narrative:
- BitGridRandom → "RAM is full of bits changing constantly"
- BitGridBytes → "Those bits change 8 at a time — in bytes"
- **MemoryTable** → "Every byte has a unique address — memory is organized into sections"

## Problem Statement / Motivation

The visual essay needs to show that RAM is byte-addressable — every byte has a unique numeric address. The existing BitGridBytes widget shows byte-level activity but has no concept of addresses or memory organization. The MemoryTable bridges from "bytes exist" to "bytes live at addresses, organized into sections (text, data, heap, stack)."

## Proposed Solution

### Architecture (from brainstorm)

**New standalone widget**, following the "separate widgets, not modes" convention. Data model (flat `bits[]` array) is compatible with a future animated transition from BitGridBytes (see brainstorm: Future Considerations).

**Extract shared BitCell component** from BitGridCore's inline cell rendering. BitCell is purely presentational — receives all data via props, fires `onglowend` callback. BitGridCore refactored to use BitCell internally (zero behavioral change). MemoryTable uses BitCell directly for each row's 8 cells. (See brainstorm: "Extract shared BitCell" decision)

### Research Insights: BitCell Extraction

**Architecture reviewer note:** Consider deferring the BitGridCore refactor — extract BitCell for MemoryTable's use only, leave BitGridCore's inline `<span>` rendering intact. This eliminates regression risk to three working widgets. The refactor can happen later when there's a concrete need (e.g., the animated transition from BitGridBytes to MemoryTable).

**Simplicity reviewer note:** Two consumers may not justify the extraction. MemoryTable could inline its own cell rendering (~35 lines of CSS) and avoid the shared component entirely. However, the brainstorm explicitly decided on extraction, so we proceed with it — but defer the BitGridCore refactor.

**Decision:** Create BitCell for MemoryTable. Defer BitGridCore refactor to a separate follow-up task. This gives us the shared component without risking regressions.

### SpecFlow-informed design decisions

The following gaps were identified by SpecFlow analysis and resolved here:

- **`writeByte()` / `highlightRow()` on collapsed section**: Auto-expand the section, **defer the action until expand completes** (see Race Condition Fixes below). Prose authors expect to see the result.
- **`writeByte()` to invisible address** (beyond `visibleBytes`): No-op. Only visible rows have backing bits. Document this constraint.
- **BitCell glow state ownership**: Parent owns the glowing state (`glowing` prop). BitCell fires `onglowend` when the CSS animation completes. BitCell is presentational.
- **Ellipsis row interaction**: Not clickable in v1. Collapse/expand is controlled exclusively via imperative API from prose. Simplifies the interaction model.
- **Mobile layout**: Horizontal scroll (`overflow-x: auto`), matching BitGridBytes' pattern.
- **BitCells non-interactive**: Rendered as `<span>` elements (not buttons), matching BitGridCore.
- **Ambient mode + sections**: Flips visible bytes in **expanded sections only** (skip collapsed and KERNEL). Per-section control deferred.
- **KERNEL section**: Visually dimmed (lower opacity on cells). `writeByte()` to KERNEL addresses is a no-op.
- **Initial byte values**: BSS = zeros. TEXT = fixed values resembling ASCII. HEAP/STACK = random. DATA = fixed values.
- **Collapse state persistence**: Not persisted. Resets on page reload. All sections start expanded (except the heap-stack gap).
- **`highlightRow()` visual**: Background tint via CSS `@keyframes` + `animationend` (not setTimeout). Stackable. Self-cleaning.
- **Ellipsis text for large gaps**: Inline helper function, not added to `binary.ts`.

## Technical Approach

### Phase 1: BitCell + Shared Infrastructure

**Goal:** Create BitCell, add hex utility. **Do NOT refactor BitGridCore** — that is deferred to a follow-up task.

#### `site/src/components/widgets/shared/BitCell.svelte` — CREATE

Purely presentational component. Receives all config via props, fires callback on animation end.

**Props (minimized — constant-per-grid values via CSS custom properties):**

```ts
interface BitCellProps {
  bit: number;              // 0 or 1
  glowing?: boolean;        // parent controls this
  highlightColor?: string;  // background tint color
  dimmed?: boolean;         // reduced opacity (for KERNEL section)
  onglowend?: () => void;   // fired when glow animation completes
}
```

### Research Insights: BitCell Props

**Performance oracle recommendation:** Pass constant-per-grid values (`cellSize`, `fontSize`, `glowDuration`, `glowColor`) via inherited CSS custom properties on the parent container instead of as individual props to each BitCell. This reduces per-instance signal subscriptions from ~8 to ~4, cutting overhead roughly in half:

```svelte
<!-- Parent sets CSS vars once on the container -->
<div style="--bit-cell-size: {params.cellSize}px; --bit-cell-font-size: {params.fontSize}px; --bit-cell-glow-duration: {params.glowDuration}ms;">
  {#each rowBits as bit, i}
    <BitCell {bit} glowing={glowingCells.has(offset + i)} onglowend={() => handleGlowEnd(offset + i)} />
  {/each}
</div>
```

BitCell's CSS reads these via `var(--bit-cell-size)` inherited from the parent. Only the per-cell-varying props (`bit`, `glowing`, `highlightColor`, `dimmed`, `onglowend`) are passed as actual props.

**Rendering:** Single `<span>` with:
- `class:glow={glowing}` for the glow-pulse animation
- `class:color-only` when `--bit-cell-font-size` is `0` (use CSS `font-size: 0` check)
- `class:dimmed={dimmed}` for KERNEL rows
- Inline style for highlight color only (other values inherited via CSS vars)
- `onanimationend` calls `onglowend`

**CSS:** Carries over the glow-pulse keyframes from BitGridCore:
- `@keyframes glow-pulse` (text mode)
- `@keyframes glow-pulse-color-only` (color-only mode)
- Uses `--bit-cell-` prefix for scoped CSS custom properties

**No WIDGET_ID, no paramDefs, no WidgetDebugPanel.** Follows the shared component pattern established by ScrubSlider.

#### `site/src/lib/binary.ts` — ADD `toHex`

```ts
/** Format an integer as a hex string, zero-padded to `digits` and prefixed with `0x`. */
export function toHex(value: number, digits: number): string {
  return '0x' + value.toString(16).toUpperCase().padStart(digits, '0');
}
```

### Research Insights: `formatByteCount`

**Pattern reviewer note:** `formatByteCount` is a display/formatting utility, not a binary encoding function. The `binary.ts` doc comment says "Shared binary encoding/decoding utilities." It doesn't belong there.

**Decision:** Inline `formatByteCount` as a local helper in MemoryTable.svelte. It's only used for the gap ellipsis text and doesn't warrant a shared utility.

#### Phase 1 acceptance criteria

- [x] BitCell renders a single cell with glow-pulse animation
- [x] BitCell supports `dimmed` prop (lower opacity)
- [x] BitCell supports `highlightColor`, color-only mode
- [x] BitCell reads `--bit-cell-size`, `--bit-cell-font-size`, `--bit-cell-glow-duration`, `--bit-cell-glow-color` from inherited CSS custom properties
- [x] `toHex(255, 2)` returns `'0xFF'`, `toHex(0, 8)` returns `'0x00000000'`
- [x] No changes to existing widgets (BitGridCore refactor deferred)

### Phase 2: MemoryTable Widget

**Goal:** Full memory table widget with sections, addresses, collapse/expand, and behavior modes.

#### Data model

**MemorySection interface** (defined in the widget file):

```ts
interface MemorySection {
  type: 'section' | 'gap';  // discriminant for rendering
  label: string;             // e.g. 'TEXT', 'STACK'
  color: string;             // left-bar CSS color
  visibleBytes: number;      // rows shown when expanded
  totalBytes: number;        // conceptual total (for "..." text)
  init: number[] | 'zero' | 'random';  // initial byte values
  dimmed?: boolean;          // true for KERNEL (reduced opacity)
}
```

### Research Insights: Data Model

**Architecture reviewer:** Model the heap-stack gap as data (`type: 'gap'`), not hardcoded. This avoids a refactor when the gap becomes interactive (pointer visualization, address-bus animation). Small change, big future payoff.

**Simplicity reviewer:** Collapsed `initMode` + `fixedValues` into a single `init` field. `number[]` = fixed values, `'zero'` = all zeros, `'random'` = random bytes. Cleaner union type.

**Runtime state per section:**
```ts
interface SectionState {
  collapsed: boolean;      // true = only "..." row visible
  byteOffset: number;      // offset into the bits[] array
}
```

**Address computation:**

Two presets controlled by an `addressMode` param (0 = simple, 1 = realistic):

| Section | Simple (4-digit) | Realistic (8-digit) |
|---------|-----------------|---------------------|
| TEXT | 0x0000 | 0x08048000 |
| DATA | 0x0010 | 0x08049000 |
| BSS | 0x0020 | 0x0804A000 |
| HEAP | 0x0030 | 0x0804B000 |
| (gap) | — | — |
| STACK | 0x00E0 | 0xBFFFF000 |
| KERNEL | 0x00F0 | 0xC0000000 |

The address for row `r` within section `s` is: `sectionStartAddress + r`.

**Bits array:** `bits.length = totalVisibleBytes * 8`, where `totalVisibleBytes = sum(section.visibleBytes)`. Each section's `byteOffset` into this array is computed on mount. Bits persist even when collapsed (collapse is a display concern, not a data concern).

#### `site/src/components/widgets/MemoryTable.svelte` — CREATE

Full widget following the (a)-(g) pattern from CLAUDE.md.

- **WIDGET_ID:** `'memory-table'`
- **CSS prefix:** `--mt-`

**paramDefs (trimmed from 9 to 7):**

| name | value | unit | category | min | max | step | description |
|------|-------|------|----------|-----|-----|------|-------------|
| cellSize | 14 | px | grid | 8 | 24 | 1 | Bit cell width/height |
| cellGap | 2 | px | grid | 0 | 6 | 1 | Gap between bit cells |
| fontSize | 10 | px | grid | 0 | 16 | 1 | Digit size (0 = color only) |
| glowDuration | 300 | ms | animation | 50 | 1000 | 50 | Glow-pulse duration |
| addressMode | 0 | | behavior | 0 | 1 | 1 | Address preset (0=simple, 1=realistic) |
| ambientRate | 200 | ms | behavior | 50 | 1000 | 50 | Ambient random flip interval |
| sectionGap | 4 | px | style | 0 | 12 | 2 | Vertical gap between sections |

### Research Insights: paramDefs

**Simplicity reviewer:** Cut `barWidth` (hardcode to 3px) and `addressFontSize` (use same `fontSize` or hardcode to 10px). These are micro-tuning params with no narrative value. If needed later, add them.

Note: `addressMode` is a 0/1 toggle, rendered as a two-position slider (same pattern as `bitDepth` in BitGridData).

**Imperative API (trimmed from 12 to 8):**

```ts
export function start()                    // resume ambient mode
export function stop()                     // pause ambient mode
export function setAmbient(on: boolean)    // toggle ambient mode
export function writeByte(address: number, value: number)  // write + glow
export function highlightRow(address: number)              // row highlight
export function collapse(label: string)    // collapse a section
export function expand(label: string)      // expand a section
export function reset()                    // reinitialize all bytes
```

### Research Insights: API Surface

**Simplicity reviewer:** Cut `collapseAll()`, `expandAll()`, `clearHighlights()`. Prose can call `collapse()` per-section. Highlights self-clear via `animationend`. `reset()` kept for sandbox convenience.

**`writeByte` behavior:**
1. Resolve address to section + byte offset **at call time** (immune to later addressMode changes)
2. If section is collapsed → auto-expand, **queue the write** until expand completes
3. If address is beyond `visibleBytes` → no-op (only visible rows have bits)
4. If section is KERNEL (dimmed) → no-op
5. Write 8 bits via `writeUint(bits, byteOffset * 8, value, 8)`
6. Add byte offset to `writeProtected` map with 2-second expiry (prevents ambient overwrite)
7. Glow-pulse fires automatically via change detection

### Research Insights: Race Condition Fixes (from Frontend Races Reviewer)

**Race 1: writeByte + expand timing.** If the section is collapsed and uses a CSS transition to expand, the glow-pulse fires inside `overflow: hidden` and `animationend` fires invisibly. By the time the section is visible, the glow has already ended.

**Fix:** Queue pending writes. Flush when expand transition completes:

```ts
let pendingWrites: Array<{ byteOffset: number; value: number }> = [];

export function writeByte(address: number, value: number) {
  const byteOffset = resolveByteOffset(address); // resolve NOW, not later
  if (byteOffset == null) return;

  const section = resolveSectionForOffset(byteOffset);
  if (section?.dimmed) return;

  if (section?.collapsed) {
    expand(section.label);
    pendingWrites.push({ byteOffset, value });
    return; // flushed on transitionend
  }
  doWriteByte(byteOffset, value);
}

function doWriteByte(byteOffset: number, value: number) {
  const newBits = [...bits];
  writeUint(newBits, byteOffset * 8, value, 8);
  bits = newBits;
  writeProtected.set(byteOffset, performance.now() + 2000);
}
```

The expand function's `transitionend` handler calls `flushPendingWrites()`. A 500ms timeout fallback guards against `transitionend` not firing (reduced motion, detached element).

**Race 2: Ambient mode vs writeByte overlap.** Ambient can overwrite a freshly written value.

**Fix:** Per-byte write protection with timed expiry:

```ts
let writeProtected = new Map<number, number>(); // byteOffset → expiry timestamp

// In the ambient setInterval:
const now = performance.now();
const protectedExpiry = writeProtected.get(byteIdx);
if (protectedExpiry && now < protectedExpiry) continue; // skip this byte
```

**Race 3: Collapse during ambient = glow burst on re-expand.** If ambient flips bytes in a collapsed section, all changes accumulate. On re-expand, the `prevBits` diff triggers glow on every changed cell simultaneously.

**Fix:** Gate ambient flips on section collapse state — skip bytes in collapsed sections:

```ts
// In ambient setInterval:
const section = resolveSectionForOffset(byteIdx);
if (section?.collapsed || section?.dimmed) continue;
```

**Race 4: highlightRow timer overlap.** Multiple calls on the same address can cause the first timeout to remove the highlight prematurely.

**Fix:** Redesigned to use `@keyframes` + `animationend` instead of `setTimeout` (see below).

**`highlightRow` behavior (redesigned):**

### Research Insights: highlightRow Pattern

**Pattern reviewer:** The codebase uses `@keyframes` + `animationend` for timed visual feedback (glow-pulse in BitGridCore, BitSequenceCore). No widget uses `setTimeout` for visual effects. Using setTimeout introduces race conditions and cleanup concerns.

**Fix:** Use the established pattern:

```css
@keyframes highlight-fade {
  0% { background-color: var(--mt-highlight-color); }
  100% { background-color: transparent; }
}

.row.highlighted {
  animation: highlight-fade 1.5s ease-out forwards;
}
```

1. Resolve address to section + row index
2. If section is collapsed → auto-expand, queue highlight (same as writeByte)
3. Add row to `highlightedRows` Set
4. Row gets `.highlighted` CSS class which triggers the `highlight-fade` keyframe
5. `animationend` on the row calls `highlightedRows.delete(address)` — self-cleaning, no setTimeout
6. If the same row is highlighted again mid-animation, the animation restarts (remove + re-add class with forced reflow)

#### Layout

```
┌──────────────────────────────────────────────────────┐
│ ┃ TEXT  0x0000  0 1 1 0 0 1 0 1   0x65              │
│ ┃       0x0001  1 0 0 1 1 0 1 0   0x9A              │
│ ┃       0x0002  0 0 0 0 0 0 0 0   0x00              │
│ ┃       ··· 13 more bytes ···                        │
│                                                      │
│ ┃ DATA  0x0010  1 1 0 0 1 1 0 0   0xCC              │
│ ┃       0x0011  0 1 0 1 0 1 0 1   0x55              │
│ ┃       ··· 14 more bytes ···                        │
│                                                      │
│ ┃ BSS   0x0020  0 0 0 0 0 0 0 0   0x00              │
│ ┃       0x0021  0 0 0 0 0 0 0 0   0x00              │
│ ┃       ··· 14 more bytes ···                        │
│                                                      │
│ ┃ HEAP  0x0030  1 0 1 1 0 0 1 0   0xB2              │
│ ┃       0x0031  0 1 1 0 1 1 0 0   0x6C              │
│ ┃       ··· 14 more bytes ···                        │
│                                                      │
│         ··· free space ···                            │
│                                                      │
│ ┃ STACK 0x00E0  1 1 1 1 0 0 0 0   0xF0              │
│ ┃       0x00E1  0 0 1 1 0 0 1 1   0x33              │
│ ┃       ··· 14 more bytes ···                        │
│                                                      │
│ ┃ KERN  0x00F0  ░ ░ ░ ░ ░ ░ ░ ░   ░░               │
│ ┃       0x00F1  ░ ░ ░ ░ ░ ░ ░ ░   ░░               │
│ ┃       ··· 14 more bytes ···                        │
└──────────────────────────────────────────────────────┘
```

**DOM structure:** CSS Grid layout (not `<table>` — better styling control). ARIA roles for accessibility:

```html
<div class="memory-table" role="table" aria-label="Byte-addressable memory">
  <!-- Per section -->
  <div class="section" role="rowgroup" aria-label="TEXT section">
    <div class="section-bar" style="--mt-section-color: {color}">
      <span class="section-label">TEXT</span>
    </div>
    <div class="section-rows">
      <!-- Per visible byte row -->
      <div class="row" role="row">
        <span class="address" role="cell">0x0000</span>
        <div class="byte-cells" role="cell">
          <!-- 8 x BitCell -->
        </div>
        <span class="hex-value" role="cell">0x65</span>
      </div>
      <!-- Ellipsis row -->
      <div class="ellipsis-row" role="row">
        <span>··· 13 more bytes ···</span>
      </div>
    </div>
  </div>
  <!-- Gap (modeled as MemorySection with type: 'gap') -->
  <div class="gap-row" role="row">
    <span>··· free space ···</span>
  </div>
</div>
```

### Research Insights: ARIA Semantics

Per [MDN ARIA table role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/table_role): When CSS `display` overrides native table semantics (as with `display: grid`), use ARIA table roles to restore semantics. The structure above follows this pattern correctly. `role="rowgroup"` on sections is appropriate per [MDN rowgroup role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/rowgroup_role).

**Section bar:** A thin vertical `<div>` positioned absolutely on the left, spanning the full height of the section's rows. The label appears on the first row only (using `position: absolute; top: 0`). Uses `--mt-section-color` CSS variable per section. Bar width hardcoded to 3px.

**Collapse/expand animation:**

### Research Insights: Collapse Animation

**Problem with `max-height`:** CSS `max-height` transitions require a concrete pixel value for the expanded state. If the value is too large, the animation timing distorts — the visible transition appears to start late. This is a [well-known anti-pattern](https://css-tricks.com/using-css-transitions-auto-dimensions/).

**Modern solution: `grid-template-rows: 0fr / 1fr`** — The `fr` unit is animatable in CSS Grid. Wrap section rows in a grid container and transition between `0fr` (collapsed) and `1fr` (expanded). The inner content needs `overflow: hidden` on a wrapper. This produces correctly-eased animation at any content height with no JavaScript measurement. [CSS-Tricks: CSS Grid auto height transitions](https://css-tricks.com/css-grid-can-do-auto-height-transitions/)

```css
.section-rows-wrapper {
  display: grid;
  grid-template-rows: 1fr;
  transition: grid-template-rows var(--transition-normal);
}

.section-rows-wrapper.collapsed {
  grid-template-rows: 0fr;
}

.section-rows-inner {
  overflow: hidden;
}
```

The ellipsis row stays **outside** the collapsible wrapper. Reduced motion: instant transition (handled by global CSS rule that zeroes transition durations).

Browser support: `grid-template-rows` animation is supported in all modern browsers (Chrome 107+, Firefox 66+, Safari 16+).

**`transitionend` handler:** Flushes pending writes and highlights queued during collapse→expand transitions.

**Responsive:** `overflow-x: auto` on the widget container. On narrow viewports (< 600px), the table scrolls horizontally. No column hiding or stacking needed — the minimum width (~230px for 4-digit addresses) fits most phones.

#### Default sections configuration

```ts
const SECTIONS: MemorySection[] = [
  { type: 'section', label: 'TEXT',  color: 'rgba(99, 102, 241, 0.6)',  visibleBytes: 3, totalBytes: 16, init: [0x48, 0x65, 0x6C] },
  { type: 'section', label: 'DATA',  color: 'rgba(34, 197, 94, 0.6)',   visibleBytes: 2, totalBytes: 16, init: [0xCC, 0x55] },
  { type: 'section', label: 'BSS',   color: 'rgba(234, 179, 8, 0.6)',   visibleBytes: 2, totalBytes: 16, init: 'zero' },
  { type: 'section', label: 'HEAP',  color: 'rgba(249, 115, 22, 0.6)',  visibleBytes: 2, totalBytes: 16, init: 'random' },
  { type: 'gap',     label: '',      color: 'transparent',               visibleBytes: 0, totalBytes: 0,  init: 'zero' },
  { type: 'section', label: 'STACK', color: 'rgba(236, 72, 153, 0.6)',  visibleBytes: 2, totalBytes: 16, init: 'random' },
  { type: 'section', label: 'KERN',  color: 'rgba(107, 114, 128, 0.4)', visibleBytes: 2, totalBytes: 16, init: 'random', dimmed: true },
];
```

Colors are chosen to be visually distinct against a dark background and not conflict with existing `--color-accent` (indigo) or `--color-highlight` (orange).

#### Change detection for glow-pulse

### Research Insights: Set Performance

**Performance oracle (critical fix):** The current BitGridCore pattern recreates the `glowingCells` Set on every add/remove:

```ts
// CURRENT (O(n) per operation):
glowingCells = new Set([...glowingCells, ...changed]);       // add
glowingCells = new Set(glowingCells);                        // remove after delete
```

**Fix:** Svelte 5's `$state` wraps Sets with a reactive proxy. `.add()` and `.delete()` mutations are tracked automatically:

```ts
// FIXED (O(1) per operation):
let glowingCells: Set<number> = $state(new Set());

// In the change detection $effect:
for (const idx of changed) {
  glowingCells.add(idx);  // Svelte 5 tracks this mutation
}

// In handleGlowEnd:
function handleGlowEnd(index: number) {
  glowingCells.delete(index);  // Svelte 5 tracks this mutation
}
```

**Caveat:** Verify that `glowingCells.has(i)` in the template triggers re-renders with mutation-based updates. The existing Set recreation may have been a workaround for an early Svelte 5 limitation — test before committing.

MemoryTable implements this optimized pattern:
- Internal `prevBits: Uint8Array` (not reactive)
- `$effect` diffs `bits` against `prevBits`, populates `glowingCells` via `.add()`
- Each BitCell receives `glowing={glowingCells.has(bitIndex)}` and fires `onglowend`

This is duplicated from BitGridCore, not shared. The logic is ~20 lines and tightly coupled to each component's rendering cycle.

#### Ambient mode

Same pattern as BitGridRandom, with section and write-protection gating:

```ts
$effect(() => {
  if (!isVisible || !running || !ambient) return;
  const id = setInterval(() => {
    if (document.hidden) return;
    const now = performance.now();
    // Pick a random visible byte
    const byteIdx = Math.floor(Math.random() * totalVisibleBytes);

    // Skip collapsed sections, KERNEL, and write-protected bytes
    const section = resolveSectionForByteOffset(byteIdx);
    if (section?.collapsed || section?.dimmed) return;
    const protectedExpiry = writeProtected.get(byteIdx);
    if (protectedExpiry && now < protectedExpiry) return;

    // Flip the byte
    const newBits = [...bits];
    const bitStart = byteIdx * 8;
    for (let j = 0; j < 8; j++) {
      newBits[bitStart + j] = Math.round(Math.random());
    }
    bits = newBits;
  }, params.ambientRate);
  return () => clearInterval(id);
});
```

Visibility observer follows the standard inline pattern (IntersectionObserver + `isVisible` state).

#### `site/src/pages/sandbox/memory-table.astro` — CREATE

Standard sandbox page:
```astro
---
import SandboxLayout from '../../layouts/SandboxLayout.astro';
import MemoryTable from '../../components/widgets/MemoryTable.svelte';
---
<SandboxLayout title="Memory Table" description="Byte-addressable RAM visualization with hex addresses, memory sections, and collapse/expand.">
  <MemoryTable client:load />
</SandboxLayout>
```

#### `site/src/pages/sandbox/index.astro` — UPDATE

Add link: `<li><a href="/sandbox/memory-table">Memory Table</a></li>`

### Phase 2 acceptance criteria

- [x] Table renders with all 6 sections + gap
- [x] Each row shows: hex address | 8 bit cells | hex byte value
- [x] Addresses update when `addressMode` toggles between simple (4-digit) and realistic (8-digit)
- [x] Section bars render as thin colored vertical lines on the left margin
- [x] Section labels appear on the first row of each section
- [x] Ellipsis rows show remaining byte count (human-readable for large numbers)
- [x] `collapse()` / `expand()` animate sections (`grid-template-rows: 0fr/1fr`)
- [x] Gap row is always collapsed and not expandable
- [x] KERNEL section is visually dimmed
- [x] `writeByte()` updates bits + triggers glow-pulse
- [x] `writeByte()` auto-expands collapsed sections and defers glow until visible
- [x] `writeByte()` to KERNEL or invisible address is a no-op
- [x] `writeByte()` adds 2-second write protection (ambient skips protected bytes)
- [x] `highlightRow()` shows background tint via `@keyframes` + `animationend`
- [x] `highlightRow()` auto-expands collapsed sections
- [x] `setAmbient(true)` starts random flips on expanded, non-KERNEL visible bytes
- [x] `setAmbient(false)` stops flips
- [x] Ambient mode skips collapsed sections and write-protected bytes
- [x] Static mode: bytes hold initial values, no flips
- [x] Visibility observer pauses ambient mode when off-screen
- [x] `document.hidden` check skips ticks when tab is backgrounded
- [x] `prefers-reduced-motion`: glow suppressed (global CSS), collapse instant
- [x] Debug panel shows all params, sliders adjust in real-time
- [x] Params persist to localStorage
- [x] Horizontal scroll on narrow viewports
- [x] ARIA roles: `role="table"`, `role="rowgroup"`, `role="row"`, `role="cell"`
- [x] Sandbox page loads and functions
- [x] No regressions to existing widgets

## System-Wide Impact

- **BitGridCore NOT touched**: BitCell extraction is for MemoryTable only. BitGridCore refactor deferred to a follow-up task. Zero regression risk to existing widgets.
- **binary.ts additions**: One new pure function (`toHex`). No changes to existing functions. No consumers affected.
- **Performance**: MemoryTable with 6 sections × 2-3 visible bytes = ~15 rows × 8 cells = ~120 BitCell instances. Well within acceptable range. Constant cell props via CSS custom properties minimize per-instance signal overhead.
- **No global tokens**: All styling via scoped `--mt-` CSS custom properties and `--bit-cell-` on BitCell. No `--space-*` or `--radius-*` references.

## Acceptance Criteria (System-Level)

- [x] Phase 1: BitCell created, toHex added, no existing code changed
- [x] Phase 2: MemoryTable renders correctly in sandbox
- [x] All existing sandbox pages work identically (no code was changed)
- [x] No global spatial tokens referenced in any new widget CSS
- [x] Animations pause when off-screen and when tab is hidden
- [x] `prefers-reduced-motion` respected throughout
- [x] Sandbox index lists the new widget

## Dependencies & Risks

- **No regression risk**: BitGridCore is NOT refactored in this plan. BitCell is a new file only consumed by MemoryTable.
- **BitCell component overhead**: ~120 instances in MemoryTable is well within acceptable range for Svelte 5. CSS custom property inheritance minimizes per-instance prop count.
- **addressMode param as slider**: A 0-1 slider is unconventional but follows the same pattern as `bitDepth` in BitGridData.
- **Section address gaps**: In realistic mode, the gap between HEAP end and STACK start is ~3 billion. The gap's ellipsis text uses a local `formatByteCount()` helper.
- **grid-template-rows animation**: Requires Chrome 107+, Firefox 66+, Safari 16+. All supported by this project's browser targets.
- **Svelte 5 Set reactivity**: The optimized `.add()`/`.delete()` pattern (no Set recreation) must be verified to trigger template re-renders. If Svelte 5's proxy doesn't track `.has()` reads, fall back to Set recreation.

## Future Considerations (not in scope)

- **BitGridCore refactor to use BitCell** — Deferred follow-up task. Extract when there's a concrete need (e.g., animated transition from BitGridBytes)
- Animated transition from BitGridBytes flat grid into MemoryTable (prose-triggered DOM morph)
- Address bus visualization (CPU reading/writing specific addresses)
- Pointer visualization (arrows from one address to another)
- Multi-byte value display (int16/int32 interpretation of consecutive bytes)
- Endianness toggle (big-endian vs little-endian)
- Per-section ambient mode control
- `readByte(address)` imperative API
- Expandable ellipsis rows (click to reveal more rows)
- Write-through animation (CPU sends value, dot travels wire, byte updates)
- `collapseAll()`, `expandAll()`, `clearHighlights()` convenience methods (add when prose needs them)

## Sources & References

### Origin

- **Brainstorm document:** [docs/brainstorms/2026-03-09-memory-table-brainstorm.md](docs/brainstorms/2026-03-09-memory-table-brainstorm.md) — Key decisions carried forward: standalone widget with future transition compatibility, BitCell extraction from BitGridCore, configurable address format, left-margin section annotations, static + ambient behavior modes.

### Internal References

- Widget pattern: `site/src/components/widgets/BitGridRandom.svelte` (canonical template)
- Shared component pattern: `site/src/components/widgets/shared/ScrubSlider.svelte`
- BitGridCore (reference for glow-pulse pattern): `site/src/components/widgets/BitGridCore.svelte`
- Binary utilities: `site/src/lib/binary.ts`
- Param system: `site/src/lib/params.ts`
- Animation strategy: `docs/decisions/003-widget-animation-strategy.md`
- Token separation: `docs/decisions/002-per-widget-params.md`
- BitGrid system plan: `docs/plans/2026-03-09-feat-bit-grid-widget-system-plan.md` (implementation notes section)

### External References

- [CSS Grid auto height transitions](https://css-tricks.com/css-grid-can-do-auto-height-transitions/) — `grid-template-rows: 0fr/1fr` technique
- [MDN: ARIA table role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/table_role) — When CSS display overrides native semantics
- [MDN: ARIA rowgroup role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/rowgroup_role) — Grouping rows by section
- [Chrome DevBlog: Performant expand/collapse](https://developer.chrome.com/blog/performant-expand-and-collapse) — Performance comparison of collapse techniques

## Implementation Notes

### Widget CSS prefix

| Component | Prefix |
|-----------|--------|
| BitCell | `--bit-cell-` |
| MemoryTable | `--mt-` |

### Svelte 5 patterns to follow (from BitGrid implementation notes)

- `prevBits` must NOT be `$state` — use plain `Uint8Array` to avoid infinite `$effect` loops
- Element refs (`containerEl`, etc.) must use `$state()` for `bind:this`
- Initialize `bits` as `$state([])` with a resize `$effect`, not inline initialization
- Use `$state(new Set())` for `glowingCells` and `highlightedRows` — mutate with `.add()`/`.delete()`, verify `.has()` triggers re-renders
- Resolve addresses to byte offsets at call time, not in deferred callbacks (prevents addressMode toggle race)
