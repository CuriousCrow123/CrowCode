---
title: "feat: Binary Data Type Widgets"
type: feat
status: completed
date: 2026-03-09
origin: docs/brainstorms/2026-03-09-binary-data-types-brainstorm.md
---

# Binary Data Type Widgets

## Enhancement Summary

**Deepened on:** 2026-03-09
**Sections enhanced:** All phases + cross-cutting concerns
**Research agents used:** architecture-strategist, performance-oracle, code-simplicity-reviewer, pattern-recognition-specialist, frontend-design reviewer, Context7 (Svelte 5), web research (WAAPI, IEEE 754, CSS 3D, drag-scrub, SVG)

### Key Improvements

1. **Code fixes:** `$derived.by()` for complex derivations, single `export function setValue` (no duplicate), optional `perspective`/`flipDuration` props in Core
2. **Performance:** Mutate-then-reassign pattern for bit flips during drag-scrub (avoids array allocation on every pointermove), event delegation for ASCII table (128 cells), glow set mutation optimization
3. **Design:** Visual differentiation between 0/1 bit states, segment gaps in float bit row, responsive handling for 16-bit float (572px overflow), editable value affordances, formula display as visual blocks
4. **Simplification:** Add binary.ts functions per-phase (not all 8 upfront), consider collapsing Phases 1+2 since Core cannot be tested alone, each variant hardcodes its animation mode (no reactive threshold — no variant ever crosses the 8-bit boundary)

### New Considerations Discovered

- **Float responsive overflow:** 16 cells at 32px + gaps = 572px, exceeds mobile viewport. Needs flex-wrap at 8-bit boundary or reduced cell size.
- **ASCII 4-bit UX:** All values 0-15 are control characters. Users see only abbreviations (NUL, SOH...) until bits grow — prose must address this.
- **Drag-scrub on touch:** `touch-action: pan-y` may not work reliably on iOS Safari. Test needed. Click-vs-drag threshold should be 5-8px, not 3px.
- **Number line at 8 bits:** 256 values on a 200px circle is too dense. Only label every 16th/32nd value; show ticks for the rest.
- **No variant crosses the 8-bit animation threshold:** Uint/ASCII/Signed are always <=8 (3D flip). Float is always 16 (toggle). The reactive threshold switching code is dead code — each variant can hardcode its mode.

---

## Overview

Four interactive widgets that bridge the narrative gap between "a single bit represents two states" (BitConnections, section 2) and "a grid of bits represents RAM" (BitGrid, section 3). A shared `BitSequenceCore` renderer provides the interactive bit row; four variants wrap it with different interpretation displays: unsigned integer, ASCII character, signed integer (two's complement), and IEEE 754 half-precision float.

**Core insight the widgets teach:** the same sequence of bits can represent completely different things depending on how you interpret them.

**Narrative position:** Between sections 2 and 3. The progression: one bit -> multiple bits encode numbers -> numbers encode everything -> now imagine a whole grid of these.

## Proposed Solution

### Architecture: Shared base + variants

Mirrors the established `BitGridCore` + variants pattern (see brainstorm: `docs/brainstorms/2026-03-09-binary-data-types-brainstorm.md`).

```
site/src/lib/binary.ts               (shared utilities, extracted from BitGridData)
site/src/components/widgets/
  BitSequenceCore.svelte              (prop-driven renderer, no WIDGET_ID)
  BitSequenceUint.svelte              (variant: unsigned integer)
  BitSequenceAscii.svelte             (variant: ASCII character)
  BitSequenceSigned.svelte            (variant: two's complement signed integer)
  BitSequenceFloat.svelte             (variant: IEEE 754 half-precision float)
site/src/pages/sandbox/
  bit-sequence-uint.astro
  bit-sequence-ascii.astro
  bit-sequence-signed.astro
  bit-sequence-float.astro
```

**Why not separate widgets?** The bit row interaction (click-to-flip, drag-scrub, 3D flip animation) is identical across all four. Duplicating it means four copies of the same interaction code.

**Why not one widget with modes?** Each data type has fundamentally different interpretation UI. A single component would become a god widget.

## Technical Approach

### Shared Interaction Specs

These apply to all variants via BitSequenceCore.

#### Click-to-flip

Each bit cell is a `<button>` element. Clicking toggles the bit (0->1 or 1->0). The variant's `bits` array is mutated via a callback prop (`onbitchange`), following the same pattern as Bit.svelte's `onflip` callback.

> **Design insight:** Visually differentiate 0 and 1 states beyond the digit. Give the "1" state a subtle `--color-accent` background tint (e.g., `rgba(77, 159, 255, 0.08)`) or brighter text color. This makes binary patterns scannable at a glance without reading each digit.

#### Hybrid flip animation

- **<= 8 bits:** Miniature 3D card flip using WAAPI, matching the Bit widget's `rotateY` animation. Each cell has `perspective`, `transform-style: preserve-3d`, `backface-visibility: hidden`, front face showing 0 and back face showing 1. An `isAnimating` guard per cell prevents double-flips.
- **> 8 bits:** Instant text swap with glow-pulse animation (same `@keyframes glow-pulse` as BitGridCore). No 3D transform overhead.

> **Simplification insight:** No variant ever crosses the 8-bit threshold at runtime. Uint/ASCII/Signed are always <=8 bits. Float is always 16 bits. Rather than reactive threshold switching in BitSequenceCore, each variant should hardcode its animation mode and pass a `mode: '3d' | 'toggle'` prop to Core. This eliminates dead code and simplifies the rendering path.

> **Performance insight (CSS 3D):** Use `perspective` on the parent container (not per-cell), so all cells share the same 3D space. At 48px cells, use `perspective: 200-300px` (lower than Bit.svelte's 600px) for a proportional effect. 8 cells x 2 faces = 16 compositor layers, well within GPU budgets. WAAPI animations run on the compositor thread. ([CSS 3D Transforms — Perspective](https://3dtransforms.desandro.com/perspective))

#### Click-to-edit on value readout

1. User clicks the decimal/character value display
2. An inline `<input type="text">` replaces the display text, pre-filled with the current value, auto-selected
3. **Enter** or **blur** commits the edit: parse the input, clamp to valid range, update bits
4. **Escape** cancels: revert to previous value, exit edit mode
5. Invalid input (NaN, empty string): revert to previous value
6. Out-of-range values: clamp to `[min, max]` for the current bit width

The edit input is part of the **variant**, not BitSequenceCore. Each variant handles parsing differently (decimal for uint/signed, character for ASCII, float for float).

> **Design insight:** Add a visual affordance that the value is editable. Use `cursor: text` on hover, and a subtle dotted bottom border in `--color-text-muted` that transitions to solid `--color-accent` on hover. This is consistent with the existing `button.action` pattern. Size the `<input>` to match the display text (same `--font-mono`, same `font-size`) to avoid layout shift on activation.

> **Touch consideration:** On touch devices, auto-selection triggers selection handles. Use `inputmode="numeric"` for decimal inputs. Only call `input.select()` when pointer type is fine (`matchMedia('(pointer: fine)')`).

#### Drag-scrub on value readout

1. User clicks and holds on the decimal/character value display (no movement threshold — scrub is active immediately, edit mode activates on click-without-drag)
2. Horizontal drag increments/decrements the value
3. **Sensitivity:** Base rate of 1 increment per 4px of drag. For ranges larger than 256, scale to `Math.max(1, Math.floor(maxRange / 256))` increments per 4px, so the full range is always reachable within ~1024px of drag
4. **Wrapping:** Values wrap at boundaries (max+1 -> min, min-1 -> max)
5. **Pointer capture:** `setPointerCapture()` on `pointerdown` so dragging continues outside the element
6. **Cursor:** `cursor: ew-resize` during drag
7. **Touch:** `touch-action: pan-y` on the value display so horizontal drag captures while vertical scrolling still works
8. **Reduced motion:** Does not affect drag-scrub (it's user-initiated, not continuous animation)

**Distinguishing click from drag:** Track `pointerdown` position. If `pointermove` exceeds 5px horizontal distance, enter drag mode. On `pointerup`, if still within 5px, treat as click (enter edit mode). (5px is more forgiving on touch devices than the originally considered 3px.)

> **Drag-scrub best practices** ([setPointerCapture guide](https://blog.r0b.io/post/creating-drag-interactions-with-set-pointer-capture-in-java-script/)):
> - Use `setPointerCapture()` to ensure continuous event delivery even during rapid movement
> - Add `user-select: none` on the value display during drag to prevent text selection
> - Handle `pointercancel` event to clean up drag state (reset `isDragging`, release capture)
> - iOS Safari handles `touch-action` differently from Chrome — test `touch-action: pan-y` on iOS; may need `touch-action: none` with manual vertical scroll passthrough via `pointerType` checks

**Float scrubbing:** Increments/decrements the raw 16-bit integer bit pattern by 1 per step (not the decoded float value). This produces non-linear steps in the decoded value, naturally teaching how float precision varies across the range (see brainstorm).

#### Bit count growth

When a variant grows its bit count (e.g., 4 -> 8 via prose action):
- **Unsigned/ASCII:** Zero-extension. New bits are prepended on the MSB (left) side, set to 0. The numeric value is preserved.
- **Signed:** Sign-extension. New bits are prepended on the MSB side, set to the current sign bit value. The signed value is preserved (e.g., `1101` (-3) -> `11111101` (-3)).
- **Visual:** New bit cells fade in from the left with a brief `opacity` transition (200ms). The existing bits slide right to make room.
- **Animation:** If growing past the 8-bit threshold, all cells switch from 3D to toggle mode simultaneously (no per-cell transition needed — the CSS simply changes).

#### Labels

BitSequenceCore accepts an optional `labels: string[]` prop (same length as `bits`). If provided, each label is rendered below its corresponding bit cell in a small, muted font. The variant decides what to pass:
- **Uint:** Powers of 2 (`"8"`, `"4"`, `"2"`, `"1"` for 4-bit)
- **ASCII:** No labels (the character display is the focus)
- **Signed:** Bit indices (`"3"`, `"2"`, `"1"`, `"0"`) with the MSB labeled `"sign"` in accent color
- **Float:** Segment labels (`"S"`, `"E"`, `"E"`, `"E"`, `"E"`, `"E"`, `"M"`, ...) color-coded to match segments

#### Reduced motion

Follows ADR 003. If `prefers-reduced-motion: reduce` matches:
- 3D flip animation is skipped (instant state change, matching Bit.svelte's behavior)
- Glow-pulse is suppressed (existing global CSS rule handles this)
- Bit count growth transition is instant (no fade/slide)

### BitSequenceCore Props

```typescript
let {
  bits,
  cellSize,
  cellGap,
  fontSize,
  mode = '3d',
  perspective = 300,
  flipDuration = 350,
  glowDuration = 300,
  glowColor = 'var(--color-accent)',
  labels,
  sectionColors,
  sectionGaps,
  onbitchange,
}: {
  bits: number[];
  cellSize: number;         // px
  cellGap: number;          // px
  fontSize: number;         // px (digit size)
  mode?: '3d' | 'toggle';  // animation mode (variant decides, not reactive threshold)
  perspective?: number;     // px (3D depth, used in '3d' mode only)
  flipDuration?: number;    // ms (3D flip duration, used in '3d' mode only)
  glowDuration?: number;    // ms (toggle glow pulse, used in 'toggle' mode only)
  glowColor?: string;       // glow pulse color (default: var(--color-accent))
  labels?: string[];        // optional labels below each cell
  sectionColors?: Record<string, { indices: number[]; color: string }>;  // color groups (same shape as BitGridCore's highlights)
  sectionGaps?: number[];   // indices after which to insert a wider gap (e.g., [0, 5] for float S|EEEEE|MMMM...)
  onbitchange?: (index: number, value: 0 | 1) => void;
} = $props();
```

- No WIDGET_ID, no paramDefs, no WidgetDebugPanel (matching BitGridCore pattern)
- `bits` is read-only from Core's perspective — mutations go through `onbitchange` callback
- `sectionColors` reuses the same `{ indices, color }` shape as BitGridCore's `highlights` prop (named `sectionColors` here since it describes semantic segments, not arbitrary highlights)
- `mode` is set by the variant (not computed from `bits.length`). Uint/ASCII/Signed pass `'3d'`, Float passes `'toggle'`. This eliminates dead reactive threshold code.
- `perspective` and `flipDuration` are optional with defaults — Float variant omits them since it uses toggle mode
- `glowColor` matches BitGridCore's optional prop for consistency
- `sectionGaps` allows inserting wider gaps between segment boundaries (e.g., float's sign/exponent/mantissa groups)

> **Note:** BitSequenceCore is an **interactive renderer** (cells are clickable buttons), unlike BitGridCore which is a **passive renderer** (cells are spans). The `onbitchange` callback is what makes this distinction — Core delegates mutations upward, never modifying `bits` itself.

### BitSequenceCore CSS Prefix

`--bsc-` (bit-sequence-core)

---

## Implementation Phases

### Phase 1: Foundation

Extract shared utilities and build BitSequenceCore.

#### 1a. `site/src/lib/binary.ts`

Extract from BitGridData.svelte and add new functions:

```typescript
// --- Existing (extracted from BitGridData) ---

/** Write an unsigned integer to a bits array at a given offset (MSB-first). */
export function writeUint(bits: number[], offset: number, value: number, numBits: number): void;

/** Read an unsigned integer from a bits array at a given offset (MSB-first). */
export function readUint(bits: number[], offset: number, numBits: number): number;

/** Format an integer as a binary string, zero-padded to numBits. */
export function toBinary(value: number, numBits: number): string;

// --- New (for signed integer variant) ---

/** Convert an unsigned integer to its two's complement signed value for a given bit width. */
export function toSigned(unsigned: number, numBits: number): number;

/** Convert a signed integer to its two's complement unsigned representation for a given bit width. */
export function fromSigned(signed: number, numBits: number): number;

// --- New (for float variant) ---

/** Decode a 16-bit pattern to an IEEE 754 half-precision float. Returns the float value. */
export function float16Decode(bits16: number): number;

/** Encode a float value to a 16-bit IEEE 754 half-precision bit pattern. */
export function float16Encode(value: number): number;

/** Classify a 16-bit float pattern: 'normal' | 'subnormal' | 'zero' | 'infinity' | 'nan'. */
export function float16Classify(bits16: number): string;
```

**Rename note:** `writeValue` -> `writeUint` and `readValue` -> `readUint` for clarity. Update BitGridData.svelte imports accordingly.

**Two's complement implementation:**
```typescript
export function toSigned(unsigned: number, numBits: number): number {
  const max = 1 << numBits;
  const half = max >> 1;
  return unsigned >= half ? unsigned - max : unsigned;
}

export function fromSigned(signed: number, numBits: number): number {
  const max = 1 << numBits;
  return signed < 0 ? signed + max : signed;
}
```

**IEEE 754 half-precision implementation:**
```typescript
export function float16Decode(bits16: number): number {
  const sign = (bits16 >> 15) & 1;
  const exp = (bits16 >> 10) & 0x1f;
  const mant = bits16 & 0x3ff;
  const s = sign ? -1 : 1;

  if (exp === 0) {
    // Subnormal or zero
    return s * (2 ** -14) * (mant / 1024);
  } else if (exp === 31) {
    // Infinity or NaN
    return mant === 0 ? s * Infinity : NaN;
  } else {
    // Normal
    return s * (2 ** (exp - 15)) * (1 + mant / 1024);
  }
}

export function float16Encode(value: number): number {
  if (isNaN(value)) return 0x7e00; // canonical NaN
  if (!isFinite(value)) return value > 0 ? 0x7c00 : 0xfc00;
  if (value === 0) return Object.is(value, -0) ? 0x8000 : 0;

  const sign = value < 0 ? 1 : 0;
  const abs = Math.abs(value);

  // Subnormal range
  if (abs < 2 ** -14) {
    const mant = Math.round(abs / (2 ** -14) * 1024);
    return (sign << 15) | mant;
  }

  // Normal range
  let exp = Math.floor(Math.log2(abs));
  let mant = Math.round((abs / (2 ** exp) - 1) * 1024);
  if (mant === 1024) { exp++; mant = 0; }
  const biasedExp = exp + 15;

  if (biasedExp >= 31) return (sign << 15) | 0x7c00; // overflow to Inf
  if (biasedExp <= 0) return (sign << 15); // underflow to zero

  return (sign << 15) | (biasedExp << 10) | mant;
}

export function float16Classify(bits16: number): 'zero' | 'subnormal' | 'normal' | 'infinity' | 'nan' {
  const exp = (bits16 >> 10) & 0x1f;
  const mant = bits16 & 0x3ff;
  if (exp === 0) return mant === 0 ? 'zero' : 'subnormal';
  if (exp === 31) return mant === 0 ? 'infinity' : 'nan';
  return 'normal';
}
```

**Update BitGridData.svelte:** Replace inline `writeValue`/`readValue`/`toBinary` with imports from `binary.ts`. The function names change to `writeUint`/`readUint`. No behavioral change.

#### 1b. `site/src/components/widgets/BitSequenceCore.svelte`

Prop-driven renderer for a horizontal row of interactive bit cells.

**Responsibilities:**
- Render a row of bit cells (horizontal flexbox or inline-flex, not CSS grid)
- Click-to-flip on individual cells via `onbitchange` callback
- Hybrid animation: 3D flip for `bits.length <= 8`, glow-pulse toggle for `bits.length > 8`
- Optional labels rendered below cells
- Optional section color highlighting (for float segments)
- Reduced motion support

**DOM structure (3D mode, <= 8 bits):**
```html
<div class="bit-sequence-core" style="--bsc-cell-size: ...px; --bsc-gap: ...px; ...">
  {#each bits as bit, i}
    <div class="bit-cell">
      <button class="card" class:flipped={bit === 1}
              onclick={() => handleFlip(i)}
              aria-label="Bit {bits.length - 1 - i}: {bit}">
        <span class="face front">0</span>
        <span class="face back">1</span>
      </button>
      {#if labels?.[i]}
        <span class="label" style={labelColor}>{labels[i]}</span>
      {/if}
    </div>
  {/each}
</div>
```

**DOM structure (toggle mode, > 8 bits):**
```html
<div class="bit-sequence-core">
  {#each bits as bit, i}
    <div class="bit-cell">
      <button class="cell" class:glow={glowingCells.has(i)}
              class:active={bit === 1}
              onclick={() => handleFlip(i)}
              onanimationend={() => handleGlowEnd(i)}>
        {bit}
      </button>
      {#if labels?.[i]}
        <span class="label">{labels[i]}</span>
      {/if}
    </div>
  {/each}
</div>
```

**3D flip logic** (adapted from Bit.svelte):
```typescript
const animatingCells = new Set<number>();

function handleFlip(index: number) {
  if (animatingCells.has(index)) return;
  const newValue = bits[index] === 0 ? 1 : 0;
  onbitchange?.(index, newValue as 0 | 1);

  if (bits.length <= 8 && !reducedMotion?.matches) {
    animatingCells.add(index);
    const el = cellEls[index];
    const from = newValue === 1 ? 0 : 180;
    const to = from + 180;
    el.animate(
      [{ transform: `rotateY(${from}deg)` }, { transform: `rotateY(${to}deg)` }],
      { duration: flipDuration, easing: 'ease' },
    ).onfinish = () => { animatingCells.delete(index); };
  }
}
```

**Change detection for glow-pulse mode** (adapted from BitGridCore):
```typescript
let prevBits = new Uint8Array(0);
let glowingCells: Set<number> = $state(new Set());

$effect(() => {
  if (bits.length <= 8) return; // 3D mode, no glow needed
  if (prevBits.length !== bits.length) {
    prevBits = new Uint8Array(bits);
    return;
  }
  const changed: number[] = [];
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] !== prevBits[i]) changed.push(i);
  }
  if (changed.length > 0) {
    for (const idx of changed) glowingCells.add(idx);
    glowingCells = new Set(glowingCells); // mutate-then-reassign avoids intermediate array spread
  }
  prevBits = new Uint8Array(bits);
});
```

**Section colors:** Same approach as BitGridCore's `highlights` — each cell checks the flattened map for its index and applies a `--bsc-section-color` custom property if present.

**paramDefs table (for reference — these live in each variant, not Core):**

Recommended shared param names across variants:

| name | default | unit | category | description |
|------|---------|------|----------|-------------|
| cellSize | 48 | px | style | Bit cell width and height |
| cellGap | 8 | px | style | Gap between bit cells |
| fontSize | 20 | px | style | Digit size in bit cells |
| perspective | 400 | px | style | 3D perspective depth (used <=8 bits) |
| flipDuration | 350 | ms | animation | 3D flip animation duration |
| glowDuration | 300 | ms | animation | Glow-pulse duration (used >8 bits) |

#### Phase 1 files:

| Action | File |
|--------|------|
| Create | `site/src/lib/binary.ts` |
| Modify | `site/src/components/widgets/BitGridData.svelte` (update imports) |
| Create | `site/src/components/widgets/BitSequenceCore.svelte` |

> **Simplification note:** Only create the functions needed per phase. Phase 1 creates `writeUint`, `readUint`, `toBinary` (extracted from BitGridData). Add `toSigned`/`fromSigned` in Phase 4. Add `float16Decode`/`float16Encode`/`float16Classify` in Phase 5. This avoids writing untestable code for phases that don't exist yet.

#### Phase 1 acceptance criteria:

- [ ] `binary.ts` exports `writeUint`, `readUint`, `toBinary` (Phase 1 scope; add `toSigned`/`fromSigned` in Phase 4, `float16*` in Phase 5)
- [ ] BitGridData.svelte uses `writeUint`/`readUint`/`toBinary` from `binary.ts` instead of inline functions
- [ ] BitGridData sandbox page (`/sandbox/bit-grid-data`) still works identically
- [ ] BitSequenceCore renders a row of interactive bit cells
- [ ] 3D flip animation works for 8 or fewer bits
- [ ] Glow-pulse toggle works for more than 8 bits
- [ ] Labels render below cells when provided
- [ ] Section colors highlight cells when provided
- [ ] Reduced motion skips 3D animation

---

> **Simplification option:** Phase 1 (Core) has no standalone sandbox page and cannot be tested in isolation. Consider collapsing Phases 1 and 2 into a single phase where BitSequenceUint includes the bit row inline. After Phase 3 (ASCII), extract the shared bit row into BitSequenceCore based on real usage rather than speculation (Rule of Three). This makes the first deliverable a testable, end-to-end working widget.

### Phase 2: BitSequenceUint

The first and simplest variant. Establishes the pattern for all subsequent variants.

#### `site/src/components/widgets/BitSequenceUint.svelte`

**WIDGET_ID:** `'bit-sequence-uint'`
**CSS prefix:** `--bsu-`

**State:**
```typescript
let bits: number[] = $state(Array(params.bitCount).fill(0));
let isEditing = $state(false);
let editValue = $state('');
let isDragging = $state(false);
let dragStartX = 0;
let dragStartValue = 0;
```

**Derived values:**
```typescript
let decimalValue = $derived(readUint(bits, 0, bits.length));
let binaryString = $derived(toBinary(decimalValue, bits.length));
let maxValue = $derived((1 << bits.length) - 1);
let labels = $derived(
  Array.from({ length: bits.length }, (_, i) =>
    String(1 << (bits.length - 1 - i))
  )
);
```

**Bit change handler:**
```typescript
function handleBitChange(index: number, value: 0 | 1) {
  bits[index] = value;
  bits = bits; // mutate-then-reassign triggers Svelte reactivity without array copy
}
```

**Value-to-bits (bidirectional):**
```typescript
function setValue(n: number) {
  const clamped = Math.max(0, Math.min(maxValue, Math.round(n)));
  const newBits = Array(bits.length).fill(0);
  writeUint(newBits, 0, clamped, bits.length);
  bits = newBits;
}
```

**Drag-scrub implementation:**
```typescript
function handlePointerDown(e: PointerEvent) {
  dragStartX = e.clientX;
  dragStartValue = decimalValue;
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
}

function handlePointerMove(e: PointerEvent) {
  const dx = e.clientX - dragStartX;
  if (!isDragging && Math.abs(dx) > 3) {
    isDragging = true;
  }
  if (isDragging) {
    const sensitivity = Math.max(1, Math.floor((maxValue + 1) / 256));
    const delta = Math.floor(dx / 4) * sensitivity;
    let newValue = dragStartValue + delta;
    // Wrap
    const range = maxValue + 1;
    newValue = ((newValue % range) + range) % range;
    setValue(newValue);
  }
}

function handlePointerUp(e: PointerEvent) {
  if (!isDragging) {
    // Was a click, not a drag — enter edit mode
    isEditing = true;
  }
  isDragging = false;
}
```

**Imperative API** (the `setValue` function above IS the exported one — define it once as `export function`):
```typescript
// setValue is defined above as export function — no duplicate needed
export function setBitCount(n: number) {
  // Zero-extension: preserve value, prepend 0s
  const currentValue = readUint(bits, 0, bits.length);
  const newBits = Array(n).fill(0);
  writeUint(newBits, 0, Math.min(currentValue, (1 << n) - 1), n);
  bits = newBits;
}
export function reset() {
  bits = Array(bits.length).fill(0);
}
```

**Template layout:**

```
┌──────────────────────────────────────────┐
│  [0] [1] [0] [1]        ← BitSequenceCore
│   8   4   2   1          ← labels (powers of 2)
│                                          │
│  = 5                     ← decimal readout (click to edit, drag to scrub)
└──────────────────────────────────────────┘
```

**paramDefs:**

| name | default | unit | category | description |
|------|---------|------|----------|-------------|
| cellSize | 48 | px | style | Bit cell width and height |
| cellGap | 8 | px | style | Gap between bit cells |
| fontSize | 20 | px | style | Digit size in bit cells |
| perspective | 400 | px | style | 3D perspective depth |
| flipDuration | 350 | ms | animation | 3D flip animation duration |
| glowDuration | 300 | ms | animation | Glow-pulse duration |
| valueFontSize | 2 | rem | style | Decimal value display size |
| bitCount | 4 | | behavior | Number of bits (4 or 8) |

#### Phase 2 files:

| Action | File |
|--------|------|
| Create | `site/src/components/widgets/BitSequenceUint.svelte` |
| Create | `site/src/pages/sandbox/bit-sequence-uint.astro` |

#### Phase 2 acceptance criteria:

- [ ] Clicking individual bits flips them with 3D animation and updates decimal readout
- [ ] Clicking decimal value enters edit mode; typing a number updates bits
- [ ] Drag-scrubbing decimal value updates bits smoothly with wrapping
- [ ] Labels show powers of 2 below each bit cell
- [ ] `setBitCount(8)` grows to 8 bits with zero-extension (value preserved, new bits fade in)
- [ ] `setValue(n)` sets the decimal value and updates bits
- [ ] `reset()` zeros all bits
- [ ] WidgetDebugPanel renders with all paramDefs
- [ ] Sandbox page at `/sandbox/bit-sequence-uint` works with `client:load`

---

### Phase 3: BitSequenceAscii

#### `site/src/components/widgets/BitSequenceAscii.svelte`

**WIDGET_ID:** `'bit-sequence-ascii'`
**CSS prefix:** `--bsa-`

**State:**
```typescript
let bits: number[] = $state(Array(params.bitCount).fill(0));
let showTable = $state(false);
let isEditing = $state(false);
```

**Derived values:**
```typescript
let decimalValue = $derived(readUint(bits, 0, bits.length));
let char = $derived(asciiChar(decimalValue));
let isPrintable = $derived(decimalValue >= 32 && decimalValue <= 126);
```

**ASCII character mapping:**
```typescript
const CONTROL_CHARS: Record<number, string> = {
  0: 'NUL', 1: 'SOH', 2: 'STX', 3: 'ETX', 4: 'EOT', 5: 'ENQ',
  6: 'ACK', 7: 'BEL', 8: 'BS',  9: 'TAB', 10: 'LF', 11: 'VT',
  12: 'FF', 13: 'CR', 14: 'SO', 15: 'SI', 16: 'DLE', 17: 'DC1',
  18: 'DC2', 19: 'DC3', 20: 'DC4', 21: 'NAK', 22: 'SYN', 23: 'ETB',
  24: 'CAN', 25: 'EM', 26: 'SUB', 27: 'ESC', 28: 'FS', 29: 'GS',
  30: 'RS', 31: 'US', 127: 'DEL',
};

function asciiChar(code: number): string {
  if (code in CONTROL_CHARS) return CONTROL_CHARS[code];
  if (code >= 32 && code <= 126) return String.fromCharCode(code);
  return '?'; // out of ASCII range
}
```

**ASCII table component (inline, not separate):**

A 16-column x 8-row grid showing values 0-127. Each cell shows the decimal value and character (or control abbreviation). The current value's cell is highlighted with accent color. Clicking a cell calls `setValue(code)`.

```
┌──────────────────────────────────────────┐
│  [0] [1] [0] [0] [0] [0] [1]  ← bits    │
│                                          │
│  = 65 = 'A'              ← inline mapping│
│                                          │
│  ┌─────────────────────┐  ← ASCII table  │
│  │ 0 NUL  1 SOH  ...   │    (revealed    │
│  │ ...                  │     by prose)   │
│  │ 64 @  [65 A] 66 B   │  ← highlighted  │
│  │ ...                  │                 │
│  └─────────────────────┘                  │
└──────────────────────────────────────────┘
```

**Character edit mode:** Clicking the character display enters edit mode. Typing a single printable character sets the bits to its ASCII code. For control characters, the user types the decimal value instead.

**Imperative API:**
```typescript
export function setValue(code: number) { /* clamp to [0, (1 << bits.length) - 1] */ }
export function setBitCount(n: number) { /* zero-extension */ }
export function showAsciiTable() { showTable = true; }
export function hideAsciiTable() { showTable = false; }
export function reset() { bits = Array(bits.length).fill(0); }
```

**paramDefs:**

| name | default | unit | category | description |
|------|---------|------|----------|-------------|
| cellSize | 48 | px | style | Bit cell width and height |
| cellGap | 8 | px | style | Gap between bit cells |
| fontSize | 20 | px | style | Digit size in bit cells |
| perspective | 400 | px | style | 3D perspective depth |
| flipDuration | 350 | ms | animation | 3D flip animation duration |
| glowDuration | 300 | ms | animation | Glow-pulse duration |
| valueFontSize | 2 | rem | style | Value display size |
| charFontSize | 3 | rem | style | Character display size |
| bitCount | 4 | | behavior | Number of bits (4 or 7) |

**Note on 4-bit starting state:** At 4 bits, all values (0-15) are control characters. The inline mapping shows `0101 = 5 = 'ENQ'` — the abbreviation appears in a muted style. The prose should say something like: "Right now we can only represent control codes. Let's add more bits to reach the printable characters."

> **Design insights for ASCII table:**
> - **Responsive:** 16 columns at 40px = 640px, overflows mobile. Use `overflow-x: auto` with subtle gradient fade on edges to indicate scroll. This preserves the conventional ASCII table layout that CS students recognize.
> - **Cell hierarchy:** Show the **character** prominently (large, centered), with the **decimal** as small superscript. Control characters appear in muted/italic style.
> - **Visual grouping:** The ASCII table has natural groups: control (0-31), punctuation/digits (32-63), uppercase (64-95), lowercase (96-127). Add subtle background color bands for these groups.
> - **Performance:** Use event delegation — single `onclick` handler on the grid parent with `data-code` attributes, instead of 128 individual click handlers. Saves ~128 closure allocations.
> - **Reveal animation:** The table should fade in with `translateY(8px)` + `opacity: 0 -> 1` over 300ms. Optionally stagger-reveal cells at ~5ms per cell for a cascade effect.

#### Phase 3 files:

| Action | File |
|--------|------|
| Create | `site/src/components/widgets/BitSequenceAscii.svelte` |
| Create | `site/src/pages/sandbox/bit-sequence-ascii.astro` |

#### Phase 3 acceptance criteria:

- [ ] Inline mapping shows `bits = decimal = character` reactively
- [ ] Control characters (0-31, 127) display with standard abbreviations in muted style
- [ ] Printable characters (32-126) display in highlighted style
- [ ] `showAsciiTable()` reveals the full 16x8 ASCII table with current value highlighted
- [ ] Clicking an ASCII table cell sets the bits to that character's value
- [ ] Click-to-edit on character display: typing a printable char sets bits to its code
- [ ] Drag-scrub on decimal value works with wrapping
- [ ] `setBitCount(7)` grows to 7 bits with zero-extension
- [ ] Sandbox page at `/sandbox/bit-sequence-ascii` works

---

### Phase 4: BitSequenceSigned

The most complex variant, with three progressive reveal stages.

#### `site/src/components/widgets/BitSequenceSigned.svelte`

**WIDGET_ID:** `'bit-sequence-signed'`
**CSS prefix:** `--bss-`

**State:**
```typescript
let bits: number[] = $state(Array(params.bitCount).fill(0));
let stage: 1 | 2 | 3 = $state(1);
```

**Derived values:**
```typescript
let unsignedValue = $derived(readUint(bits, 0, bits.length));
let signedValue = $derived(toSigned(unsignedValue, bits.length));
let signBit = $derived(bits[0]); // MSB
let maxUnsigned = $derived((1 << bits.length) - 1);
let maxSigned = $derived((1 << (bits.length - 1)) - 1);
let minSigned = $derived(-(1 << (bits.length - 1)));
let labels = $derived(
  Array.from({ length: bits.length }, (_, i) =>
    i === 0 ? 'sign' : String(bits.length - 1 - i)
  )
);
```

**Progressive reveal stages:**

**Stage 1** (default): Sign bit is visually highlighted (accent color background on MSB cell via `sectionColors` prop). Only unsigned decimal readout shown. User can flip bits and see the unsigned value change. Flipping the sign bit causes a dramatic value jump (e.g., 3 -> 11 at 4 bits).

**Stage 2** (revealed by prose action): A second readout appears below the unsigned one showing the signed interpretation. Both update reactively.
```
unsigned: 13  |  signed: -3
```
The sign bit label gets a tooltip or annotation explaining "this bit determines the sign."

**Stage 3** (revealed by prose action): A circular number line SVG appears below the readouts. The circle shows all possible values arranged clockwise:
- Outer ring: unsigned values 0, 1, 2, ... maxUnsigned
- Inner ring: signed values 0, 1, 2, ... maxSigned, minSigned, minSigned+1, ... -1
- A dot/arrow indicates the current value's position
- The dot moves reactively as bits change
- Clicking on the circle sets the bits to that value (interactive)

**Number line SVG specification:**
```
        0
       / \
    -1/   \1      ← signed labels (inner)
   15/     \      ← unsigned labels (outer)
     |     |2
  -2 |     |
   14|     |
     \    /3
   -3 \  /
    13  \/
     ...
        8/-8 ← the wraparound point
```

The SVG is approximately 240x240px (increased from 200px for legibility). Values are placed at equal angular intervals around the circle. A colored arc highlights the positive range (0 to maxSigned) in `--color-accent` (blue) and the negative range (minSigned to -1) in `--color-error` (red/salmon). The current value is indicated with a filled circle (radius 6-8px with subtle glow/shadow) plus a radial line from center creating a "clock hand" effect.

> **Scaling for 8 bits:** At 8 bits (256 values), label only every 16th or 32nd value (powers of 2, 0, -1, min, max). Show unlabeled ticks for the rest. The educational insight (positive/negative ranges sharing a circle, wraparound at the boundary) is communicated by the colored arcs, not by reading every number.
>
> **Value change animation:** When bits change, animate the indicator dot around the circle to its new position (taking the shorter arc path) using WAAPI on a `<g>` rotation. For large jumps (e.g., flipping the sign bit), the dot traveling halfway around creates a visceral connection between bit flips and value changes.
>
> **Click hit targets:** At 4 bits (16 values), each angular segment is ~47px of arc — fine. At 8 bits (256 values), each is ~3px — too small. Snap clicks to the nearest labeled value, not every individual value.
>
> **Responsive:** SVGs scale naturally with `viewBox`. Ensure the container uses `max-width: 100%; height: auto;`.

**Signed edit mode:** After Stage 2, both readouts are editable. Editing the unsigned value clamps to `[0, maxUnsigned]`. Editing the signed value clamps to `[minSigned, maxSigned]`. Either edit updates the bits accordingly.

**Signed drag-scrub:** Scrubs the unsigned value (0 to maxUnsigned, wrapping). The signed readout updates reactively.

**Bit count growth:** Sign-extension. When growing from 4 to 8 bits, the MSB (sign bit) is replicated into the new positions. The signed value is preserved.

**Imperative API:**
```typescript
export function setValue(n: number) { /* set unsigned value */ }
export function setSignedValue(n: number) {
  const unsigned = fromSigned(n, bits.length);
  setValue(unsigned);
}
export function setBitCount(n: number) {
  // Sign-extension
  const currentSigned = signedValue;
  const newBits = Array(n).fill(0);
  const newUnsigned = fromSigned(
    Math.max(-(1 << (n - 1)), Math.min((1 << (n - 1)) - 1, currentSigned)),
    n
  );
  writeUint(newBits, 0, newUnsigned, n);
  bits = newBits;
}
export function setStage(s: 1 | 2 | 3) { stage = s; }
export function reset() {
  bits = Array(bits.length).fill(0);
  stage = 1;
}
```

**paramDefs:**

| name | default | unit | category | description |
|------|---------|------|----------|-------------|
| cellSize | 48 | px | style | Bit cell width and height |
| cellGap | 8 | px | style | Gap between bit cells |
| fontSize | 20 | px | style | Digit size in bit cells |
| perspective | 400 | px | style | 3D perspective depth |
| flipDuration | 350 | ms | animation | 3D flip animation duration |
| glowDuration | 300 | ms | animation | Glow-pulse duration |
| valueFontSize | 2 | rem | style | Value display size |
| numberLineSize | 200 | px | style | Circular number line diameter |
| bitCount | 4 | | behavior | Number of bits (4 or 8) |

#### Phase 4 files:

| Action | File |
|--------|------|
| Create | `site/src/components/widgets/BitSequenceSigned.svelte` |
| Create | `site/src/pages/sandbox/bit-sequence-signed.astro` |

#### Phase 4 acceptance criteria:

- [ ] Stage 1: sign bit highlighted with accent color, only unsigned readout shown
- [ ] Stage 2: signed readout appears alongside unsigned, both update reactively
- [ ] Stage 3: circular number line SVG appears, shows dual unsigned/signed labeling
- [ ] Number line dot moves as bits change
- [ ] Clicking on number line sets the bits to that value
- [ ] `setStage(n)` controls progressive reveal
- [ ] `setBitCount(8)` sign-extends (signed value preserved)
- [ ] Both readouts are editable/scrubbable after Stage 2
- [ ] Sandbox page at `/sandbox/bit-sequence-signed` works

---

### Phase 5: BitSequenceFloat

#### `site/src/components/widgets/BitSequenceFloat.svelte`

**WIDGET_ID:** `'bit-sequence-float'`
**CSS prefix:** `--bsf-`

**State:**
```typescript
// Always 16 bits for half-precision
let bits: number[] = $state(Array(16).fill(0));
```

**Derived values:**
```typescript
let bits16 = $derived(readUint(bits, 0, 16));
let decodedValue = $derived(float16Decode(bits16));
let classification = $derived(float16Classify(bits16));

let sign = $derived(bits[0]);
let exponent = $derived(readUint(bits, 1, 5));
let mantissa = $derived(readUint(bits, 6, 10));

// Section colors for BitSequenceCore
let sectionColors = $derived({
  sign: { indices: [0], color: 'rgba(239, 68, 68, 0.2)' },         // red
  exponent: { indices: [1,2,3,4,5], color: 'rgba(59, 130, 246, 0.2)' }, // blue
  mantissa: { indices: [6,7,8,9,10,11,12,13,14,15], color: 'rgba(34, 197, 94, 0.2)' }, // green
});

let labels = $derived([
  'S',
  'E','E','E','E','E',
  'M','M','M','M','M','M','M','M','M','M',
]);
```

**Decode formula display:**

For normal numbers:
```
(-1)^0 x 2^(15-15) x (1 + 0/1024) = 1.0
  sign    exponent     mantissa
```

For subnormal numbers:
```
(-1)^0 x 2^(-14) x (512/1024) = 0.5
  sign   fixed     mantissa
```

For special values:
```
+Infinity    (exponent=31, mantissa=0)
NaN          (exponent=31, mantissa!=0)
+0 / -0     (exponent=0, mantissa=0)
```

The formula updates reactively. Each component (sign, exponent, mantissa) is color-coded to match the bit row section colors.

**Value display:**
```typescript
let displayValue = $derived.by(() => {
  switch (classification) {
    case 'infinity': return sign ? '-Infinity' : '+Infinity';
    case 'nan': return 'NaN';
    case 'zero': return sign ? '-0' : '0';
    default: {
      // Format with appropriate precision
      const v = decodedValue;
      if (Math.abs(v) < 0.001 || Math.abs(v) > 99999) {
        return v.toExponential(4);
      }
      return v.toPrecision(5);
    }
  }
});
```

**Float-specific drag-scrub:** Increments/decrements the raw 16-bit unsigned pattern by 1, not the decoded float. This naturally demonstrates how float precision varies across the range.

> **Scrub edge cases:** Scrubbing through the 16-bit space passes through subnormals, normals, infinity, and NaN. Display a classification badge next to the decoded value: "normal", "subnormal", "zero", "+Inf", "NaN" — styled as a small pill/badge with a muted background. The formula display should update to show the applicable formula (normal vs subnormal vs special).
>
> **IEEE 754 reference:** ES2025 now has native `Float16Array` support ([petamoriken/float16](https://github.com/petamoriken/float16)), but our manual implementation is correct for this teaching context — we need bit-level access and custom display, not array operations.

**Edit mode for float:** User types a decimal number. `float16Encode` converts it to the nearest representable half-precision value. The bits update accordingly. Values outside representable range map to +/-Infinity.

**No bit count growth.** Float is fixed at 16 bits. No `setBitCount` API.

> **Responsive concern:** 16 cells at 32px + 4px gaps = 572px — overflows mobile (375px). Solutions in priority order:
> 1. Reduce default `cellSize` to 24px → `24*16 + 4*15 = 444px` (still tight)
> 2. Allow the bit row to wrap into two lines (8+8) on narrow viewports via `flex-wrap: wrap` with container query
> 3. Make the bit row horizontally scrollable with `overflow-x: auto` as fallback
>
> Option 2 is recommended: the wrap falls within the mantissa, which is conceptually fine. Add a visual continuation indicator (bracket or background).

> **Formula display design:** Break the formula into vertically aligned visual blocks rather than a single line of text. Each component (sign, exponent, mantissa) should be a distinct block with its color-coded background, a subtext label, and multiplication signs as connecting operators. This transforms a dense formula into a readable diagram. The `formulaFontSize` default should be 1.1rem (not 0.9rem) since this is the most informationally dense part of the widget.

> **Segment gaps:** Pass `sectionGaps: [0, 5]` to BitSequenceCore to insert wider gaps after index 0 (sign) and index 5 (end of exponent). This creates the visual `S | EEEEE | MMMM...` grouping without literal dividers.

**Imperative API:**
```typescript
export function setValue(f: number) {
  const pattern = float16Encode(f);
  const newBits = Array(16).fill(0);
  writeUint(newBits, 0, pattern, 16);
  bits = newBits;
}
export function reset() {
  bits = Array(16).fill(0); // +0
}
export function setSpecial(kind: 'zero' | 'negzero' | 'inf' | 'neginf' | 'nan') {
  const patterns = { zero: 0, negzero: 0x8000, inf: 0x7c00, neginf: 0xfc00, nan: 0x7e00 };
  const newBits = Array(16).fill(0);
  writeUint(newBits, 0, patterns[kind], 16);
  bits = newBits;
}
```

**Template layout:**
```
┌──────────────────────────────────────────────────────┐
│  [S] [E][E][E][E][E] [M][M][M][M][M][M][M][M][M][M]│
│   S   E  E  E  E  E   M  M  M  M  M  M  M  M  M  M │ ← labels
│  red   blue            green                         │ ← section colors
│                                                      │
│  = 1.0                            ← decoded value    │
│                                                      │
│  (-1)^0 x 2^(15-15) x 1.0 = 1.0  ← formula          │
│   sign    exponent     mantissa                      │
│                        (color-coded to match bits)   │
└──────────────────────────────────────────────────────┘
```

**paramDefs:**

| name | default | unit | category | description |
|------|---------|------|----------|-------------|
| cellSize | 28 | px | style | Bit cell width and height (smaller for 16 cells; 28*16+4*15=508px fits most viewports) |
| cellGap | 4 | px | style | Gap between bit cells |
| fontSize | 12 | px | style | Digit size in bit cells |
| glowDuration | 300 | ms | animation | Glow-pulse duration (always >8 bits, no 3D flip) |
| valueFontSize | 2 | rem | style | Decoded value display size |
| formulaFontSize | 1.1 | rem | style | Formula display size (increased for readability) |

Note: No `perspective` or `flipDuration` params since float is always 16 bits (toggle mode, passed as `mode="toggle"` to Core).

#### Phase 5 files:

| Action | File |
|--------|------|
| Create | `site/src/components/widgets/BitSequenceFloat.svelte` |
| Create | `site/src/pages/sandbox/bit-sequence-float.astro` |

#### Phase 5 acceptance criteria:

- [ ] 16 bit cells with color-coded sections (sign=red, exponent=blue, mantissa=green)
- [ ] Section labels (S, E, M) below each cell
- [ ] Decoded float value updates reactively as bits flip
- [ ] Formula display shows color-coded breakdown, updates reactively
- [ ] Subnormal formula switches to `2^(-14) * (m/1024)` form
- [ ] Special values display: +0, -0, +Infinity, -Infinity, NaN
- [ ] Drag-scrub increments raw bit pattern (not decoded value)
- [ ] Click-to-edit: typing a decimal encodes via `float16Encode`
- [ ] `setSpecial('inf')` etc. sets special bit patterns
- [ ] Sandbox page at `/sandbox/bit-sequence-float` works

---

## System-Wide Impact

### Interaction Graph

- BitSequenceCore is a pure renderer — no side effects, no global state
- Each variant is a self-contained widget following the established pattern (paramDefs, loadParams, WidgetDebugPanel)
- `binary.ts` extraction changes BitGridData's import paths but no behavior
- No impact on existing sections, pages, or other widgets

### Error Propagation

- Value editing: invalid input is caught at the variant level, reverted to previous value. No error propagation.
- Float encoding: `float16Encode` handles all edge cases (NaN, Infinity, -0). No uncaught exceptions.
- Bit array mutations: always create new arrays, no shared references.

### State Lifecycle Risks

- localStorage: each variant uses its own `widget-params-${WIDGET_ID}` key. No conflicts with existing widgets.
- No server-side state. All state is ephemeral (component state) or persisted to localStorage (param overrides only).

### API Surface Parity

- No external APIs. All interaction is local to the browser.
- Each variant's imperative API is consistent: `setValue()`, `reset()`, and variant-specific methods.

## Acceptance Criteria

### Functional Requirements

- [ ] All four variant widgets render and are interactive
- [ ] BitSequenceCore supports both 3D flip (<=8 bits) and glow-pulse toggle (>8 bits)
- [ ] Bidirectional editing works: flip bits -> value updates; edit value -> bits update
- [ ] Drag-scrub works on value displays with wrapping
- [ ] Bit count growth preserves values (zero-extension for unsigned, sign-extension for signed)
- [ ] ASCII table reveals progressively and is interactive
- [ ] Two's complement reveals three progressive stages
- [ ] Float shows color-coded segments with decode formula
- [ ] Float handles all special values (0, -0, Inf, -Inf, NaN, subnormals)
- [ ] Each variant has a working sandbox page

### Non-Functional Requirements

- [ ] Reduced motion support: 3D flips skipped, glow-pulse suppressed
- [ ] `binary.ts` functions are pure and have no side effects
- [ ] No global spatial token references in any widget (per CLAUDE.md separation rule)
- [ ] All paramDefs use scoped CSS custom properties with the correct prefix

### Quality Gates

- [ ] BitGridData sandbox page still works after `binary.ts` extraction
- [ ] Each sandbox page loads without console errors
- [ ] All widgets render correctly at default param values
- [ ] Dev build includes WidgetDebugPanel for each variant
- [ ] Production build excludes debug panels

## Dependencies & Prerequisites

- Phase 1 must complete before Phases 2-5 (BitSequenceCore is required by all variants)
- Phases 2-5 can be built in any order, but the recommended sequence (Uint -> ASCII -> Signed -> Float) matches the narrative flow
- No external dependencies. All code uses standard Web APIs (WAAPI, Pointer Events, SVG)

## Sources & References

### Origin

- **Brainstorm document:** [docs/brainstorms/2026-03-09-binary-data-types-brainstorm.md](docs/brainstorms/2026-03-09-binary-data-types-brainstorm.md)
- Key decisions carried forward: shared base + variants architecture, bidirectional interaction, start-small-grow pattern, hybrid flip animation, progressive reveal for ASCII and two's complement, 16-bit half-precision for float, MSB-first display, extract shared binary.ts

### Internal References

- BitGridCore pattern: `site/src/components/widgets/BitGridCore.svelte`
- Bit 3D flip animation: `site/src/components/widgets/Bit.svelte`
- Binary utilities source: `site/src/components/widgets/BitGridData.svelte`
- Variant widget pattern: `site/src/components/widgets/BitGridRandom.svelte`
- Param system: `site/src/lib/params.ts`
- Section composition: `site/src/components/sections/bits/BitIntro.svelte`
- Sandbox page pattern: `site/src/pages/sandbox/bit-grid-random.astro`
- Animation strategy: `docs/decisions/003-widget-animation-strategy.md`
- Widget param system: `docs/decisions/002-per-widget-params.md`

### External References

- [CSS 3D Transforms — Perspective](https://3dtransforms.desandro.com/perspective) — Use perspective on parent container for shared 3D space
- [Pointer Events — setPointerCapture](https://blog.r0b.io/post/creating-drag-interactions-with-set-pointer-capture-in-java-script/) — Drag interaction best practices
- [IEEE 754 Half-Precision — petamoriken/float16](https://github.com/petamoriken/float16) — ES2025 Float16Array ponyfill (reference, not dependency)
- [Half-precision floating-point format](https://en.wikipedia.org/wiki/Half-precision_floating-point_format) — IEEE 754 binary16 specification
- [Web Animation Performance Tier List](https://motion.dev/magazine/web-animation-performance-tier-list) — WAAPI and CSS animation performance comparison
- [Programmatic SVG Segmented Circles](https://www.hendrik-erz.de/post/guide-programmatically-draw-segmented-circles-or-ring-indicators-with-svg) — SVG circular visualization techniques
