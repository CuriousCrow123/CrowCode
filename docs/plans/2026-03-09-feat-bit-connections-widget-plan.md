---
title: "feat: Add BitConnections widget with drag-to-connect wires"
type: feat
status: completed
date: 2026-03-09
origin: docs/brainstorms/2026-03-09-bit-connections-brainstorm.md
---

# feat: Add BitConnections widget with drag-to-connect wires

## Overview

A BitConnections widget showing a Bit card (left) with a draggable port, connected via SVG bezier wires to four two-state target items (right): light bulb, TRUE/FALSE card, black/white card, coin. Flipping the bit flips all connected targets. Second section on the index page, below BitIntro.

## Acceptance Criteria

- [x] Bit card (left) reuses existing `Bit.svelte` with flip animation
- [x] Port dot on Bit's right edge; port dots on each target's left edge
- [x] Drag from Bit port → bezier wire follows cursor → drop on target port = connect
- [x] Multiple simultaneous connections supported (max one wire per target)
- [x] Flipping the bit propagates state to all connected targets
- [x] Disconnected targets are visually inert (dimmed)
- [x] Connected targets show their current state matching the bit value
- [x] Disconnect by dragging from a connected target's port into empty space
- [x] Drag to empty space = cancel, no state change
- [x] SVG wires recompute on window resize
- [x] Widget debug panel with tunable params
- [x] No global spatial token references
- [x] Sandbox page at `/sandbox/bit-connections`
- [x] Section `<h2 id="bit-connections">` for TOC
- [x] Touch support: pointer events API, `touch-action: none` on drag zones
- [x] `prefers-reduced-motion`: target transitions are instant

## Architecture Decisions

### 1. Extending Bit.svelte (see brainstorm)

`Bit.svelte` currently exposes `toggle()` and `reset()` but no way to observe flips. Add an `onflip` callback prop:

```svelte
// Bit.svelte addition
let { onflip }: { onflip?: (value: 0 | 1) => void } = $props();

// Inside flip(), after toggling:
onflip?.(isFlipped ? 1 : 0);
```

BitConnections passes `onflip` to know when the user clicked the bit, and propagates to connected targets.

### 2. Port dot separation from Bit button

The port dot is a **sibling element** positioned absolutely over the Bit card's right edge — NOT a child of the `<button>`. This cleanly separates click (flip) from drag (wire). The port has its own `pointerdown` handler.

### 3. SVG overlay

An `<svg>` element inside the widget root div:
- `position: absolute; inset: 0; overflow: visible; pointer-events: none`
- `viewBox` matches root div's client dimensions
- Individual wire `<path>` elements have `pointer-events: none`
- Recomputed on resize via `ResizeObserver`
- Coordinates: `getBoundingClientRect()` of ports, offset by the root div's rect

### 4. Pointer Events API

Use unified Pointer Events (`pointerdown`, `pointermove`, `pointerup`) instead of separate mouse/touch handlers. Set `touch-action: none` on port dots to prevent scroll interference during drag.

## Implementation

### 1. Extend `Bit.svelte` — add `onflip` callback

Add `onflip` prop. Fire it after state toggle in `flip()`. Non-breaking change — existing usage without the prop is unaffected.

### 2. `site/src/components/widgets/BitConnections.svelte` (new)

The main widget. Contains:
- The Bit widget (via composition, not inheritance)
- Four target items rendered inline (not separate components — they're simple enough)
- Port dots (sibling divs with absolute positioning)
- SVG overlay for wires
- Drag state machine
- Connection state

**paramDefs:**

| name | value | unit | category | min | max | step | description |
|------|-------|------|----------|-----|-----|------|-------------|
| portSize | 12 | px | style | 6 | 24 | 1 | Port dot diameter |
| wireWidth | 2 | px | style | 1 | 6 | 0.5 | Wire stroke width |
| wireTension | 0.4 | | style | 0.1 | 1.0 | 0.05 | Bezier curve tension (control point offset as fraction of horizontal distance) |
| targetSize | 4 | rem | style | 2 | 8 | 0.25 | Target card width and height |
| columnGap | 6 | rem | style | 2 | 12 | 0.5 | Gap between bit column and targets column |
| targetGap | 1 | rem | style | 0.25 | 3 | 0.25 | Vertical gap between target cards |
| inertOpacity | 0.3 | | style | 0.1 | 0.6 | 0.05 | Opacity of disconnected targets |

**State:**

```typescript
let connections = $state<Set<string>>(new Set());  // target IDs: 'bulb', 'trueFalse', 'bwCard', 'coin'
let bitValue = $state<0 | 1>(0);                   // mirrors Bit's isFlipped
let dragging = $state<{ from: 'bit' | string; cursorX: number; cursorY: number } | null>(null);
```

**Target definitions:**

```typescript
const targets = [
  { id: 'bulb',      label: 'Light bulb',    states: ['Off', 'On'] },
  { id: 'trueFalse', label: 'TRUE / FALSE',  states: ['FALSE', 'TRUE'] },
  { id: 'bwCard',    label: 'Black & White',  states: ['White', 'Black'] },
  { id: 'coin',      label: 'Coin',           states: ['Tails', 'Heads'] },
] as const;
```

**Target visuals (state 0 → state 1):**

| Target | 0-state | 1-state |
|--------|---------|---------|
| Light bulb | Dim circle, muted color | Bright circle, yellow glow (box-shadow) |
| TRUE/FALSE | Text "FALSE", muted | Text "TRUE", accent color |
| Black/white | White background | Black background (inverted text) |
| Coin | Text "T" (tails) | Text "H" (heads) |

When disconnected: all targets at `inertOpacity`, no state distinction visible.

**Drag state machine:**

1. `pointerdown` on Bit port → `dragging = { from: 'bit', cursorX, cursorY }`
2. `pointermove` (on window) → update `dragging.cursorX/Y`, render temp wire
3. `pointerup` on target port → add target to `connections`, clear `dragging`
4. `pointerup` elsewhere → clear `dragging` (cancel)

For disconnect:
1. `pointerdown` on connected target port → remove from `connections`, `dragging = { from: targetId, ... }`
2. `pointermove` → render temp wire from target port to cursor
3. `pointerup` on Bit port → re-add to `connections`
4. `pointerup` elsewhere → stays disconnected

**Bezier wire rendering:**

```typescript
function wirePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = (x2 - x1) * params.wireTension;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}
```

**Imperative API:**
- `export function connectAll()` — connects all four targets
- `export function disconnectAll()` — clears all connections

### 3. `site/src/components/sections/bits/BitRepresentations.svelte` (new)

Section with prose explaining that a bit can represent any two-state thing.

```svelte
<section>
  <div class="prose">
    <h2 id="bit-representations">What Can a Bit Represent?</h2>
    <p>
      Pretty simple right? A single bit can be either 0 or 1.
      And it can represent various things that have two states:
    </p>
  </div>
  <Figure>
    <BitConnections bind:this={widget} />
  </Figure>
</section>
```

### 4. `site/src/pages/sandbox/bit-connections.astro` (new)

Follow sandbox/counter.astro pattern with `client:load`.

### 5. `site/src/pages/sandbox/index.astro` (modify)

Add `<li><a href="/sandbox/bit-connections">Bit Connections</a></li>`.

### 6. `site/src/pages/index.astro` (modify)

Add BitRepresentations section below BitIntro:

```astro
<EssayLayout title="CrowCode">
  <BitIntro client:visible />
  <BitRepresentations client:visible />
</EssayLayout>
```

## Keyboard Accessibility (deferred)

Drag-to-connect is pointer-only in v1. Port dots get `aria-label` and `tabindex="0"`. Future: Enter on Bit port enters "connect mode", then Enter on a target port creates the wire.

## Sources

- **Origin brainstorm:** [docs/brainstorms/2026-03-09-bit-connections-brainstorm.md](docs/brainstorms/2026-03-09-bit-connections-brainstorm.md) — drag-to-connect, bezier wires, multiple connections, inert disconnected targets
- **Animation strategy:** [docs/decisions/003-widget-animation-strategy.md](docs/decisions/003-widget-animation-strategy.md) — per-widget animation choice (WAAPI for Bit, CSS for targets)
- **Bit widget:** [site/src/components/widgets/Bit.svelte](site/src/components/widgets/Bit.svelte) — imperative API, needs `onflip` extension
- **Widget pattern:** [site/src/components/widgets/Counter.svelte](site/src/components/widgets/Counter.svelte) — paramDefs, loadParams, WidgetDebugPanel
- **Section pattern:** [site/src/components/sections/bits/BitIntro.svelte](site/src/components/sections/bits/BitIntro.svelte) — bind:this, Figure, h2 id
