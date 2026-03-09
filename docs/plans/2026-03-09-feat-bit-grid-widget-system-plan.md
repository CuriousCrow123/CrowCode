---
title: "feat: BitGrid Widget System"
type: feat
status: completed
date: 2026-03-09
origin: docs/brainstorms/2026-03-09-bit-grid-system-brainstorm.md
---

# feat: BitGrid Widget System

## Overview

A composable bit-grid widget system that visualizes how computers represent and manipulate data as binary. Built as a thin shared renderer (BitGridCore) plus three variant widgets (BitGridRandom, BitGridBytes, BitGridData), each with its own sandbox page. (See brainstorm: `docs/brainstorms/2026-03-09-bit-grid-system-brainstorm.md`)

The system progresses through three narrative layers:
1. **Random activity** — bits flip continuously, showing RAM is always busy
2. **Byte-addressable** — bits flip 8-at-a-time with a CPU sending signals, foreshadowing bytes
3. **Data-bound** — byte groups encode x,y values driving a sine-wave ball animation, showing bits represent meaningful data

## Problem Statement / Motivation

The visual essay needs to show that everything in a computer is bits — and that those bits are constantly being manipulated by the CPU. The current Bit widget shows a single bit; this system scales that up to grids of hundreds of bits with different behavioral modes, building the reader's intuition about memory, bytes, and data representation.

## Proposed Solution

### Architecture (from brainstorm)

**Thin base, fat variants** — BitGridCore is a prop-driven pure renderer with no internal bit state. Each variant widget owns its bits array, timing logic, layout, and overlays. This aligns with the project's "widgets are self-contained" convention.

```
BitGridRandom
└── BitGridCore

BitGridBytes
├── CPU block + bus wire SVG (inline markup)
└── BitGridCore

BitGridData
├── CPU block + bus wire SVG (inline markup)
├── Decode panel (inline sidebar)
├── Canvas sine-wave animation (inline)
└── BitGridCore
```

### BitGridCore — Shared Renderer

**File:** `site/src/components/widgets/BitGridCore.svelte`

Not a full widget (no WIDGET_ID, no WidgetDebugPanel). A Svelte component imported by variants.

**Props (passed by variant):**
- `bits: number[]` — the reactive bit array, owned by variant
- `cols: number` — grid column count (no `rows` prop — grid auto-wraps based on `bits.length / cols`)
- `cellSize: number` — cell width/height in px
- `cellGap: number` — gap between cells in px
- `fontSize: number` — 0/1 digit size in px (0 = color-only mode, no text)
- `glowDuration: number` — glow-pulse duration in ms
- `glowColor?: string` — CSS color for the glow effect (default: `var(--color-accent)`). Not a paramDef (Param only supports numbers) — passed as a fixed prop from the variant.
- `highlights?: Record<string, { indices: number[]; color: string }>` — named highlight groups (for decode panel coloring in BitGridData)

**Change detection:** Maintains an internal `prevBits` snapshot (Uint8Array). On each reactive update, diffs `bits` against `prevBits` to find changed indices. Adds a `.glow` CSS class to changed cells, which triggers a CSS `@keyframes` animation. After `glowDuration` ms, the class is removed (via `animationend` event listener, not setTimeout).

**Rendering:** CSS grid of `<span>` elements. Each span shows `0` or `1` in monospace font (or just background color if fontSize is 0). The grid uses `display: grid; grid-template-columns: repeat(cols, cellSize); gap: cellGap`.

**Glow animation CSS:**
```css
@keyframes glow-pulse {
  0% { color: var(--glow-color); text-shadow: 0 0 6px var(--glow-color); }
  100% { color: inherit; text-shadow: none; }
}
.cell.glow {
  animation: glow-pulse var(--glow-duration) ease-out forwards;
}
```

**Overlapping flips:** If a cell gets the `.glow` class while already glowing, the `animationend` listener on the previous animation fires immediately (because we remove and re-add the class, forcing reflow). This restarts the animation cleanly.

**Reduced motion:** The global CSS rule (`animation-duration: 0.01ms !important`) handles this automatically — glow becomes instant. No additional JS check needed for CSS animations.

### Visibility Observer Pattern

All three variants run continuous animations that must pause when off-screen.

**Pattern (inline in each variant, not a shared utility):**
```ts
let containerEl: HTMLDivElement;
let isVisible = $state(false);

$effect(() => {
  const observer = new IntersectionObserver(
    ([entry]) => { isVisible = entry.isIntersecting; },
    { threshold: 0 }
  );
  observer.observe(containerEl);
  return () => observer.disconnect();
});

$effect(() => {
  if (!isVisible) return;
  const id = setInterval(() => {
    if (document.hidden) return; // skip ticks when tab is backgrounded
    /* flip logic */
  }, params.flipInterval);
  return () => clearInterval(id);
});
```

This ensures the interval only runs while the widget is in the viewport. Each variant implements this directly (no shared utility — follows "no shared animation layer" from ADR 003).

### Widget CSS Prefixes (from brainstorm)

| Component | Prefix |
|-----------|--------|
| BitGridCore | (none — styles via props from variant) |
| BitGridRandom | `--bgr-` |
| BitGridBytes | `--bgb-` |
| BitGridData | `--bgd-` |

## Technical Approach

### Phase 1: BitGridCore + BitGridRandom

**Goal:** Shared grid renderer and the simplest variant — random bit flipping with CRT glow.

#### Files to create

**`site/src/components/widgets/BitGridCore.svelte`**
- Prop-driven grid renderer as described above
- CSS grid of spans with glow-pulse animation
- Change detection via Uint8Array diff
- Highlights prop support
- No paramDefs or WidgetDebugPanel (not a full widget)

**`site/src/components/widgets/BitGridRandom.svelte`**
- Full widget following the (a)-(g) pattern
- WIDGET_ID: `'bit-grid-random'`
- Owns a `$state` bits array (initialized to random 0/1 values)
- setInterval-based random flipping gated by IntersectionObserver
- Imports and renders BitGridCore, passing bits + style params as props

paramDefs for BitGridRandom:
```
| name          | value | unit | category  | min  | max   | step | description                    |
|---------------|-------|------|-----------|------|-------|------|--------------------------------|
| cols          | 32    |      | grid      | 8    | 64    | 8    | Grid columns                   |
| rows          | 16    |      | grid      | 4    | 32    | 4    | Grid rows                      |
| cellSize      | 14    | px   | grid      | 8    | 24    | 1    | Cell width/height              |
| cellGap       | 2     | px   | grid      | 0    | 6     | 1    | Gap between cells              |
| fontSize      | 10    | px   | grid      | 0    | 16    | 1    | Digit size (0 = color only)    |
| glowDuration  | 300   | ms   | animation | 50   | 1000  | 50   | Glow-pulse animation duration  |
| flipInterval  | 80    | ms   | behavior  | 16   | 500   | 16   | Time between flip batches      |
| flipsPerTick  | 3     |      | behavior  | 1    | 20    | 1    | Bits flipped per interval tick |
```

**Grid resize behavior:** When `cols` or `rows` changes via the debug panel, the variant reactively resizes its `$state` bits array to `cols * rows`. New cells are initialized to random 0/1. Truncated cells are dropped. Use a `$effect` that watches `params.cols` and `params.rows`.

Imperative API:
- `start()` — resume flipping
- `stop()` — pause flipping
- `reset()` — re-randomize all bits

**`site/src/pages/sandbox/bit-grid-random.astro`**
- Standard sandbox page template
- `<BitGridRandom client:load />`

**Update `site/src/pages/sandbox/index.astro`**
- Add "Bit Grid: Random" link

#### Acceptance criteria
- [x] Grid renders with configurable cols/rows
- [x] Bits flip randomly at the configured rate
- [x] Glow-pulse animation fires on each flip
- [x] Animation pauses when scrolled off-screen (IntersectionObserver)
- [x] Animation pauses when tab is hidden (`document.hidden` check inside interval)
- [x] Debug panel shows all params, sliders adjust in real-time
- [x] Params persist to localStorage
- [x] Respects `prefers-reduced-motion` (glow suppressed by global CSS rule, flips still happen)
- [x] `start()`, `stop()`, `reset()` work correctly
- [x] Sandbox page loads and functions

### Phase 2: BitGridBytes + CPU Block + Bus Wires

**Goal:** Byte-at-a-time flipping with a side-by-side CPU visualization connected by animated bus wires.

**Note:** The "byte-addressable" address-table transformation described in the curriculum is OUT OF SCOPE for this plan. BitGridBytes v1 is the byte-flipping grid + CPU + wires only. The transformation is a separate future feature.

#### Files to create

**`site/src/components/widgets/BitGridBytes.svelte`**
- Full widget following the (a)-(g) pattern
- WIDGET_ID: `'bit-grid-bytes'`
- Owns bits array, flips in groups of 8 consecutive bits
- Byte selection: picks a random byte-aligned index (i.e., `Math.floor(Math.random() * totalBytes) * 8`)
- Byte boundaries visualized via alternating subtle background tint on even/odd byte groups
- Side-by-side layout: CPU block (left) + grid (right)
- CPU block: styled `<div>` with "CPU" label, simple chip-like appearance using borders and monospace font
- CPU visibility togglable via `showCpu` prop (default true) and imperative API
- SVG overlay between CPU and grid for bus wire animation
- Bus wire: SVG `<path>` with a traveling `<circle>` animated via `requestAnimationFrame` + `getPointAtLength()`
- Wire animation triggers when a byte flips: dot travels CPU→RAM, lands, then byte glows and flips
- On mobile/narrow viewports: CPU stacks above grid (flex-direction: column)

paramDefs for BitGridBytes:
```
| name           | value | unit | category  | min  | max   | step | description                     |
|----------------|-------|------|-----------|------|-------|------|---------------------------------|
| cols           | 32    |      | grid      | 8    | 64    | 8    | Grid columns (must be 8-aligned)|
| rows           | 8     |      | grid      | 2    | 16    | 2    | Grid rows                       |
| cellSize       | 14    | px   | grid      | 8    | 24    | 1    | Cell width/height               |
| cellGap        | 2     | px   | grid      | 0    | 6     | 1    | Gap between cells               |
| fontSize       | 10    | px   | grid      | 0    | 16    | 1    | Digit size (0 = color only)     |
| glowDuration   | 300   | ms   | animation | 50   | 1000  | 50   | Glow-pulse animation duration   |
| flipInterval   | 500   | ms   | behavior  | 100  | 2000  | 100  | Time between byte flips         |
| wireSpeed      | 400   | ms   | animation | 100  | 1000  | 50   | Dot travel time along wire      |
| cpuSize        | 80    | px   | style     | 40   | 120   | 10   | CPU block width/height          |
| wireWidth      | 2     | px   | style     | 1    | 4     | 0.5  | Bus wire stroke width           |
| dotSize        | 6     | px   | style     | 3    | 12    | 1    | Traveling dot radius            |
```

Imperative API:
- `start()` / `stop()` — control flipping
- `showCpu()` / `hideCpu()` — toggle CPU visibility
- `reset()` — re-randomize bits

**`site/src/pages/sandbox/bit-grid-bytes.astro`**
- Standard sandbox page

**Update `site/src/pages/sandbox/index.astro`**

#### Acceptance criteria
- [x] Bits flip 8-at-a-time at byte-aligned boundaries
- [x] Byte groups have visual separators (alternating tint)
- [x] CPU block renders beside the grid with "CPU" label
- [x] SVG bus wire connects CPU to grid
- [x] Traveling dot animates along wire when byte flips
- [x] Dot arrives at grid, then target byte glows and flips (sequenced)
- [x] CPU can be shown/hidden via API
- [x] Layout stacks vertically on narrow viewports
- [x] Off-screen pausing works
- [x] Reduced motion: dots hidden, glow suppressed, flips still happen
- [x] Debug panel with all params
- [x] Sandbox page loads

### Phase 3: BitGridData + Sine Wave Animation + Decode Panel

**Goal:** Byte groups encode x,y integers that drive a canvas sine-wave ball animation, with a decode panel showing binary-to-decimal conversion.

#### Physics model: Ball on a sine track

The ball is constrained to a sine curve `y = A * sin(2pi * x / wavelength)` as a track. Gravity acts downward. No friction. Energy is conserved.

The parametric position along the curve is `s` (arc length parameter). The physics uses:
- Slope at position: `dy/dx = A * 2pi/wavelength * cos(2pi * x / wavelength)`
- Tangential acceleration from gravity: `a_t = -g * sin(theta)` where `theta = atan(dy/dx)`
- Velocity updated: `v += a_t * dt`
- Position updated: `x += v * cos(theta) * dt`, `y` derived from `sin(x)`

The ball wraps seamlessly at left/right edges (periodic boundary: `x = x % wavelength`).

Initial conditions: ball starts at a peak with zero velocity, falls under gravity. With no friction and energy conservation, the ball oscillates forever — faster through valleys, slower over peaks.

**Data flow:** Physics simulation (rAF loop) → computes x, y as floats → maps to integer range (0-255 for 8-bit, 0-65535 for 16-bit) → writes binary representation to bits array → BitGridCore renders the updated bits → decode panel reads the same values.

#### Files to create

**`site/src/components/widgets/BitGridData.svelte`**
- Full widget following the (a)-(g) pattern
- WIDGET_ID: `'bit-grid-data'`
- Owns bits array; x and y bytes are the first 2 (or 4 in 16-bit mode) bytes, remaining bits flip randomly as ambient noise
- Physics simulation runs in rAF loop, gated by visibility
- Canvas element renders below the grid: shows sine curve + rolling ball
- Decode panel: inline `<div>` sidebar showing `x: [binary] = [decimal]` and `y: [binary] = [decimal]` updating in real-time with monospace font
- CPU block + bus wire (same pattern as BitGridBytes), dot animates at throttled rate (~10hz cap, not every frame)
- CPU toggleable via prop/API
- Bit depth switchable via paramDef (8 or 16)
- Layout: vertical stack — grid on top, canvas below. CPU to the left if visible.
- Highlighted bytes: x-bytes in cyan, y-bytes in magenta, passed via `highlights` prop to BitGridCore
- On mobile: everything stacks vertically

paramDefs for BitGridData:
```
| name            | value  | unit | category  | min   | max    | step | description                      |
|-----------------|--------|------|-----------|-------|--------|------|----------------------------------|
| cols            | 16     |      | grid      | 8     | 32     | 8    | Grid columns                     |
| rows            | 4      |      | grid      | 2     | 8      | 2    | Grid rows                        |
| cellSize        | 14     | px   | grid      | 8     | 24     | 1    | Cell width/height                |
| cellGap         | 2      | px   | grid      | 0     | 6      | 1    | Gap between cells                |
| fontSize        | 10     | px   | grid      | 0     | 16     | 1    | Digit size                       |
| glowDuration    | 300    | ms   | animation | 50    | 1000   | 50   | Glow-pulse duration              |
| bitDepth        | 8      |      | behavior  | 8     | 16     | 8    | Bits per value (8 or 16)         |
| gravity         | 500    |      | physics   | 100   | 2000   | 100  | Gravity strength                 |
| curveAmplitude  | 60     | px   | physics   | 20    | 120    | 10   | Sine wave amplitude              |
| curveWavelength | 200    | px   | physics   | 100   | 400    | 20   | Sine wave wavelength             |
| ballSize        | 8      | px   | style     | 4     | 16     | 1    | Ball radius                      |
| canvasHeight    | 160    | px   | style     | 80    | 300    | 10   | Animation canvas height          |
| wireSpeed       | 400    | ms   | animation | 100   | 1000   | 50   | Bus wire dot travel time         |
| cpuSize         | 80     | px   | style     | 40    | 120    | 10   | CPU block size                   |
| ambientRate     | 200    | ms   | behavior  | 50    | 1000   | 50   | Ambient random flip interval     |
```

Imperative API:
- `start()` / `stop()` — control simulation
- `showCpu()` / `hideCpu()` — toggle CPU
- `setBitDepth(8 | 16)` — switch bit depth
- `reset()` — reset ball to starting position

**`site/src/pages/sandbox/bit-grid-data.astro`**
- Standard sandbox page

**Update `site/src/pages/sandbox/index.astro`**

#### Canvas rendering details
- Background: transparent (inherits widget background)
- Sine curve: thin line in `--color-text-muted`
- Ball: filled circle in `--color-accent`
- DPI-aware: scale by `window.devicePixelRatio`
- Width: matches grid width (responsive)
- Reduced motion: show static frame with ball at current position, no animation. Display a note "(animation paused — reduced motion)".

#### Acceptance criteria
- [x] Physics simulation produces smooth ball motion along sine curve
- [x] Ball wraps seamlessly at edges (periodic boundary)
- [x] Ball accelerates through valleys, decelerates at peaks
- [x] x,y values correctly encoded as binary in the bits array
- [x] Decode panel shows real-time binary + decimal for x and y
- [x] Highlighted bytes (x=cyan, y=magenta) visible in grid
- [x] Canvas renders ball + sine curve below grid
- [x] Canvas is DPI-aware
- [x] CPU + wire animation works (throttled, not per-frame)
- [x] Bit depth switchable between 8 and 16
- [x] Ambient random flips on non-data bits
- [x] Off-screen pausing
- [x] Reduced motion handling (static canvas frame)
- [x] Debug panel with all params
- [x] Sandbox page loads

## System-Wide Impact

- **No existing code modified** (except sandbox index.astro to add links)
- **Performance**: Three continuously-animating widgets could be on one page. IntersectionObserver ensures only visible widgets run. DOM rendering of 512 cells with CSS animations is the performance boundary — test on mobile before Phase 2.
- **Accessibility**: Grids are purely observational (`role="img"` with `aria-label`). Canvas gets a text alternative. All prose triggers are keyboard-accessible via existing `button.action` styling.

## Acceptance Criteria (System-Level)

- [x] All three variant widgets render correctly in their sandbox pages
- [x] BitGridCore is a clean shared component with no widget-level concerns
- [x] Each variant has its own paramDefs and WidgetDebugPanel
- [x] No global spatial tokens (`--space-*`, `--radius-*`) referenced in any widget CSS
- [x] Animations pause when off-screen and when tab is hidden
- [x] `prefers-reduced-motion` is respected in all variants
- [x] Sandbox index lists all three new widgets
- [x] No regressions to existing widgets (Counter, Bit, BitConnections)

## Dependencies & Risks

- **Performance risk**: 512+ DOM elements with CSS animations may jank on mobile. Mitigation: parameterize grid size, start with conservative defaults, test early.
- **Physics accuracy**: The sine-track ball physics requires a numerical integrator. Euler method may accumulate energy drift over time. Mitigation: use Verlet integration or clamp total energy.
- **SVG wire complexity**: Bus wire animation between CPU and grid requires `getPointAtLength()` which may have cross-browser quirks. Mitigation: test in Safari and Firefox early.

## Future Considerations (not in scope)

- Byte-addressable address-table transformation (BitGridBytes Phase 2)
- Prose trigger transitions between variants in the essay
- Integration into main narrative sections
- Additional data visualizations (color values, text encoding)
- Address bus visualization
- Canvas fallback renderer for large grids

## Sources & References

### Origin

- **Brainstorm document:** [docs/brainstorms/2026-03-09-bit-grid-system-brainstorm.md](docs/brainstorms/2026-03-09-bit-grid-system-brainstorm.md) — Key decisions carried forward: thin base / fat variants architecture, glow-pulse animation, prop-driven data model, side-by-side CPU layout, parameterized bit depth.

### Internal References

- Widget pattern: `site/src/components/widgets/Counter.svelte` (canonical template)
- Animation strategy: `docs/decisions/003-widget-animation-strategy.md`
- Token separation: `docs/decisions/002-per-widget-params.md`
- Param system: `site/src/lib/params.ts`
- Animation patterns: `docs/archive/ANIMATION_PATTERNS.md`
- Widget guide: `docs/archive/WIDGET_IMPLEMENTATION_GUIDE.md`

## Implementation Notes (post-completion)

Minor deviations from the plan discovered during implementation:

- **BitGridCore has no `rows` prop**: Grid auto-wraps via `grid-template-columns: repeat(cols, cellSize)` and `bits.length / cols` determines the row count implicitly. Plan listed `rows` as a prop.
- **Wire animation uses simple `<line>` + `cx={progress * width}`**: Not `getPointAtLength()` as suggested in Dependencies & Risks. The straight-line bus is simpler and sufficient.
- **`prevBits` must NOT be `$state`**: Using `$state` caused an infinite `$effect` loop (reading and writing the same reactive in one effect). Fixed to plain `Uint8Array`.
- **Bits initialization**: Using `$state([])` (empty) with a resize `$effect` instead of `$state(randomBits(...))` to avoid Svelte 5 `state_referenced_locally` warning.
- **Element refs need `$state()`**: All `bind:this` refs (`containerEl`, `cpuEl`, etc.) must be declared with `$state()` in Svelte 5.

### Follow-up plan

- **Wire-flip sync**: [docs/plans/2026-03-09-feat-wire-pulse-flip-sync-plan.md](docs/plans/2026-03-09-feat-wire-pulse-flip-sync-plan.md) — makes wire pulses correspond with actual bit flip events (multi-dot, change-detection-based).
