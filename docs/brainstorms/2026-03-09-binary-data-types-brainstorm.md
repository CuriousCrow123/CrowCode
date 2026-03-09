# Brainstorm: Binary Data Type Widgets

**Date:** 2026-03-09
**Status:** Reviewed

## What We're Building

A series of four interactive widgets that bridge the narrative gap between "a single bit represents two states" (BitConnections) and "a grid of bits represents RAM" (BitGrid). The core idea: **multiple bits form a sequence, and the same sequence of bits can represent different things depending on how you interpret it.**

### The Four Widgets

1. **Unsigned Integer** — A row of bits that encodes a decimal number (binary positional notation)
2. **ASCII Character** — The same bits, but mapped to a character via the ASCII table
3. **Signed Integer** — Two's complement: how computers represent negative numbers
4. **Float** — IEEE 754 half-precision: how computers represent decimals

### Narrative Position

These sit **between** "What Can a Bit Represent?" (section 2) and "Bits Everywhere" (section 3) in the curriculum. The progression:

> One bit → multiple bits encode numbers → numbers encode everything → now imagine a whole grid of these

This makes the grid's appearance feel earned rather than arbitrary.

## Why This Approach

### Shared base + variants (like BitGridCore)

A `BitSequenceCore` renderer handles the row of interactive bits. Each data type variant wraps it and adds its interpretation display. This mirrors the established `BitGridCore` + variants pattern:

```
BitSequenceCore (row of interactive bits, flip animation, bidirectional binding)
  ├── BitSequenceUint   (decimal readout, positional notation breakdown)
  ├── BitSequenceAscii  (character display, progressive ASCII table)
  ├── BitSequenceSigned  (sign bit highlight, dual unsigned/signed readout, number line)
  └── BitSequenceFloat  (color-coded sign/exponent/mantissa sections)
```

**Why not separate widgets?** The bit row interaction (click-to-flip, drag-to-scrub value, 3D flip animation) is identical across all four. Duplicating it would mean four copies of the same flip logic and animation code.

**Why not one widget with modes?** Each data type has fundamentally different interpretation UI (ASCII table vs. number line vs. exponent/mantissa breakdown). A single component would become a god widget.

## Key Decisions

### Interaction model: Bidirectional

Users can:
- **Click individual bits** to flip them → decimal/char/float value updates reactively
- **Type a number** in an editable text field → bits update to match
- **Drag-scrub the number** (click-drag left/right on the value display) → bits update smoothly, showing every intermediate binary state

This reinforces the core lesson: bits and their interpretation are two views of the same data.

### Bit count: Start small, grow via prose

Each widget starts with **4 bits** (values 0–15). Prose action buttons expand to 8 bits, showing how range grows exponentially. This keeps the initial visual simple while teaching the scaling concept.

- Unsigned int: starts 4-bit (0–15), grows to 8-bit (0–255)
- ASCII: starts 4-bit, grows to 7-bit (the full ASCII range 0–127)
- Signed int: starts 4-bit (-8 to 7), grows to 8-bit (-128 to 127)
- Float: 16-bit half-precision from the start (can't meaningfully shrink IEEE 754)

### Flip animation: Hybrid based on bit count

- **≤ 8 bits**: 3D card flip (miniature version of the Bit widget's `rotateY`), maintaining visual continuity from the single Bit widget the reader just interacted with
- **> 8 bits**: Simple toggle with glow-pulse (like BitGridCore), since 16+ tiny 3D flips would be noisy and expensive

The transition happens automatically when bits are added via prose actions or param changes. This also naturally prepares the reader for the grid aesthetic.

### ASCII widget: Progressive reveal

1. **Default**: Inline mapping next to the bit sequence: `01000001 = 65 = 'A'`
2. **Prose-driven**: An action button reveals a compact ASCII table below, with the current value's row highlighted
3. **Bidirectional**: Clicking a table entry sets the bits to that value

Non-printable characters (0–31, 127) shown with standard labels: `NUL`, `SOH`, `TAB`, `LF`, `CR`, `DEL`, etc.

### Two's complement: Three progressive layers

Layers are revealed progressively via prose action buttons, matching the "start simple, grow" pattern:

1. **Sign bit emphasis** (visible from the start) — The MSB (most significant bit) is visually distinct (different color or slightly larger). Flipping it dramatically changes the value, illustrating its special role. Only the unsigned decimal readout is shown initially.

2. **Dual interpretation** (revealed by prose action) — A signed decimal readout appears alongside the unsigned one:
   ```
   1 1 1 1 1 1 1 1
   unsigned: 255  |  signed: -1
   ```
   Drives home that bits are just bits — interpretation gives meaning.

3. **Overflow/wraparound** (revealed by prose action) — A circular number line visualization appears alongside the bits. Incrementing past max positive wraps to max negative. Shows why two's complement is elegant (addition just works, no special cases). The number line is an inline SVG/canvas within the widget, not a separate component.

### Float: 16-bit half-precision (IEEE 754)

- **1 sign bit** + **5 exponent bits** + **10 mantissa bits**
- Color-coded sections in the bit row (sign = one color, exponent = another, mantissa = third)
- Decode display shows: `(-1)^sign × 2^(exponent-15) × 1.mantissa`
- Special values highlighted: 0, infinity, NaN, denormalized numbers
- A real standard (used in GPUs and ML), not a toy format

### Number input: Editable + draggable

The decimal/character value display serves dual purpose:
- **Click** to enter edit mode (text input, type a value directly)
- **Click-drag** horizontally to scrub the value up/down (like Figma number inputs)

This keeps the UI compact while offering both precise and exploratory input.

**Note on float scrubbing:** Float values have non-linear distribution (dense near zero, sparse at extremes). The drag-scrub for the float widget should map to the integer bit pattern rather than the decoded float value — dragging increments/decrements the raw bit pattern by 1, which naturally produces non-linear steps in the decoded value. This also teaches how float precision varies across the range.

## BitSequenceCore Responsibilities

The shared base component handles:
- Rendering a horizontal row of bit cells
- Click-to-flip on individual bits
- Hybrid flip animation (3D for ≤8 bits, toggle for >8)
- Accepting `bits: number[]` as a bindable prop (owned by the variant)
- Emitting change events when bits are flipped by the user
- Reduced motion support
- Cell sizing via scoped CSS custom properties

It does **not** handle:
- Interpretation of bits (that's the variant's job)
- Number input/scrubbing (variant-specific, since float input differs from int input)
- Layout of interpretation displays
- The number of bits (set by the variant)

## Resolved Questions

1. **Bit position labels** → Variant decides. BitSequenceCore accepts an optional `labels` array prop. Unsigned int passes powers of 2, float passes S/E/M section labels, signed int highlights the sign bit. Each variant controls what's pedagogically relevant.

2. **Float "start small, grow" pattern** → Float starts at 16 bits. The reader has already learned "more bits = more range" from the unsigned int widget. The float widget's focus is on sign/exponent/mantissa decomposition, not bit scaling.

3. **Shared binary utilities** → Yes, extract `writeValue`, `readValue`, `toBinary` into `site/src/lib/binary.ts`. Update BitGridData to import from there. These functions serve as a natural shared foundation for both the grid and sequence widgets.

4. **Endianness** → MSB-first (left-to-right), matching standard binary notation in textbooks. Real hardware endianness is a separate topic for a later section. Pedagogy over hardware accuracy at this stage.
