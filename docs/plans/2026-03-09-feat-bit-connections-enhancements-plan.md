---
title: "feat: Add snap-to-port, wire pulse animation, and target visual improvements"
type: feat
status: completed
date: 2026-03-09
---

# feat: Add snap-to-port, wire pulse animation, and target visual improvements

## Overview

Three enhancements to the existing BitConnections widget: (1) magnetic snap-to-port when dragging wires near a target, (2) a visual pulse that travels along connected wires when the bit flips — targets only change state when the pulse arrives, and (3) improved target visuals for the black/white card (remove "0"/"1" text) and coin (replace text with a coin graphic).

## Acceptance Criteria

- [x] Dragging a wire within `snapRadius` of a port snaps the wire endpoint to that port's center
- [x] Snapped port shows visual feedback (scale + glow)
- [x] Releasing while snapped connects the wire (no need for exact cursor placement)
- [x] Snap works for both connect (bit → target) and reconnect (target → bit) flows
- [x] Flipping the bit triggers a pulse dot that travels along each connected wire
- [x] Each target's state changes only when the pulse reaches its port (not instantly)
- [x] Multiple pulses animate simultaneously (one per connected wire, same start time)
- [x] `prefers-reduced-motion`: pulses are skipped, targets update instantly
- [x] Pulse works correctly when bit is flipped rapidly (interrupts in-flight pulses)
- [x] Black/white card shows only color (no "0"/"1" text), neutral gray when disconnected
- [x] Coin target displays a circular coin graphic instead of "Tails"/"Heads" text
- [x] New params added to debug panel: `snapRadius`, `pulseDuration`, `pulseSize`
- [x] All existing behavior (connect, disconnect, resize recompute) still works

## Architecture Decisions

### 1. Snap detection: distance-based in `handlePointerMove`

During drag, compute distance from cursor to each candidate port. If within `snapRadius`, update drag state with `snappedTo` target ID. The `dragWire` derivation uses the snapped port's center instead of cursor position. On `pointerup`, if snapped, connect to the snapped target — `elementFromPoint` becomes a fallback.

Extend the `dragging` state type:

```typescript
let dragging = $state<{
  from: 'bit' | string;
  cursorX: number;
  cursorY: number;
  snappedTo?: string | null;
} | null>(null);
```

### 2. Pulse animation: SVG `<circle>` + `requestAnimationFrame`

Use `getPointAtLength()` on the SVG `<path>` elements to position a pulse `<circle>` along each wire. This keeps everything in the SVG coordinate system (no CSS offset-path needed). Per ADR 003, animation timing comes from widget params and `prefers-reduced-motion` is checked in JS.

**Why not stroke-dashoffset?** Stroke-dashoffset animates the wire itself (a drawing effect). We want a discrete dot traveling along the wire — `getPointAtLength` is the right tool.

**Why not WAAPI?** SVG attribute animation (`cx`, `cy`) isn't well-supported by WAAPI. `requestAnimationFrame` with `getPointAtLength` is the standard approach and gives fine-grained control over timing.

### 3. Deferred target state: `targetStates` record

Currently, target visual state is derived directly from `bitValue`. With pulse animation, targets need independent state that updates only when their pulse arrives:

```typescript
let targetStates = $state<Record<string, 0 | 1>>({});
```

Template reads `targetStates[target.id]` instead of `bitValue` for connected target visuals. When a pulse completes for target X, `targetStates[X] = bitValue`. When a target is first connected, its state is set immediately (no pulse for initial connection).

### 4. Rapid flip handling

If the bit is flipped while pulses are in-flight:
- Cancel all in-flight pulse animations (via stored `cancelAnimationFrame` IDs)
- Start new pulses with the new `bitValue`
- This prevents targets from briefly showing an old value

Store active animation frame IDs:

```typescript
let activePulses = $state<Map<string, number>>(new Map()); // targetId → rAF id
```

### 5. Coin visual: inline SVG circle

Replace text with a styled `<div>` containing a circle shape (CSS border-radius) with metallic-looking border. Show "H" or "T" in a serif font centered inside. Keeps implementation simple — no external SVG icons needed.

## Implementation

### 1. Add new paramDefs to `BitConnections.svelte`

Add three params to the existing `paramDefs` array:

```typescript
{ name: 'snapRadius',    value: 24,  unit: 'px', category: 'behavior',  min: 8,   max: 64,   step: 2,   description: 'Distance threshold for wire snap-to-port' },
{ name: 'pulseDuration', value: 400, unit: 'ms', category: 'animation', min: 100, max: 2000, step: 50,  description: 'Time for pulse to travel along wire' },
{ name: 'pulseSize',     value: 6,   unit: 'px', category: 'style',     min: 3,   max: 16,   step: 1,   description: 'Pulse dot radius' },
```

### 2. Snap-to-port logic in `BitConnections.svelte`

**Modify `handlePointerMove`:**

```typescript
function handlePointerMove(e: PointerEvent) {
  if (!dragging) return;

  const cursorLocal = {
    x: e.clientX - (rootEl?.getBoundingClientRect().left ?? 0),
    y: e.clientY - (rootEl?.getBoundingClientRect().top ?? 0),
  };

  // Determine candidate ports based on drag direction
  let snappedTo: string | null = null;

  if (dragging.from === 'bit') {
    // Dragging from bit — check all unconnected target ports
    for (const t of targets) {
      if (connections.has(t.id)) continue;
      const pos = portCenter(targetPortEls[t.id]);
      if (!pos) continue;
      const dist = Math.hypot(cursorLocal.x - pos.x, cursorLocal.y - pos.y);
      if (dist < params.snapRadius) { snappedTo = t.id; break; }
    }
  } else {
    // Dragging from disconnected target — check bit port
    const bitPos = portCenter(bitPortEl);
    if (bitPos) {
      const dist = Math.hypot(cursorLocal.x - bitPos.x, cursorLocal.y - bitPos.y);
      if (dist < params.snapRadius) snappedTo = 'bit';
    }
  }

  dragging = { ...dragging, cursorX: e.clientX, cursorY: e.clientY, snappedTo };
}
```

**Modify `dragWire` derivation:** When `dragging.snappedTo` is set, use the snapped port's center as the wire endpoint instead of the cursor position.

**Modify `handlePointerUp`:** If `dragging.snappedTo` is set, connect to that target (skip `elementFromPoint`). Fall back to `elementFromPoint` if not snapped.

**Visual feedback:** Add `.snapping` class to port when it's the snap target:

```css
.port.snapping {
  transform: scale(1.5);
  box-shadow: 0 0 12px var(--color-accent);
}
```

### 3. Pulse animation system in `BitConnections.svelte`

**New state:**

```typescript
let targetStates = $state<Record<string, 0 | 1>>({});
let activePulses = $state<Map<string, number>>(new Map());
let pulsePositions = $state<Map<string, { x: number; y: number }>>(new Map());
```

**Modified `handleBitFlip`:**

```typescript
function handleBitFlip(value: 0 | 1) {
  bitValue = value;

  // Cancel in-flight pulses
  for (const [, id] of activePulses) cancelAnimationFrame(id);
  activePulses = new Map();
  pulsePositions = new Map();

  if (reducedMotion?.matches || connections.size === 0) {
    // Instant update
    for (const id of connections) targetStates[id] = value;
    targetStates = { ...targetStates };
    return;
  }

  // Start pulse for each connected wire
  for (const targetId of connections) {
    startPulse(targetId, value);
  }
}
```

**`startPulse` function:**

```typescript
function startPulse(targetId: string, value: 0 | 1) {
  // Find the SVG path element for this wire
  const pathEl = rootEl?.querySelector(`path[data-wire="${targetId}"]`) as SVGPathElement | null;
  if (!pathEl) { targetStates[targetId] = value; targetStates = { ...targetStates }; return; }

  const totalLength = pathEl.getTotalLength();
  const startTime = performance.now();

  function step(now: number) {
    const progress = Math.min((now - startTime) / params.pulseDuration, 1);
    const point = pathEl!.getPointAtLength(progress * totalLength);

    pulsePositions.set(targetId, { x: point.x, y: point.y });
    pulsePositions = new Map(pulsePositions);

    if (progress < 1) {
      activePulses.set(targetId, requestAnimationFrame(step));
    } else {
      // Pulse arrived — update target state
      targetStates[targetId] = value;
      targetStates = { ...targetStates };
      activePulses.delete(targetId);
      activePulses = new Map(activePulses);
      pulsePositions.delete(targetId);
      pulsePositions = new Map(pulsePositions);
    }
  }

  activePulses.set(targetId, requestAnimationFrame(step));
}
```

**SVG pulse circles:** Add to the SVG overlay after wire paths:

```svelte
{#each [...pulsePositions] as [id, pos] (id)}
  <circle
    cx={pos.x}
    cy={pos.y}
    r={params.pulseSize}
    fill="var(--color-accent)"
    opacity="0.9"
  />
{/each}
```

**Wire path `data-wire` attribute:** Add `data-wire={wire.id}` to each connected wire `<path>` so `startPulse` can find the SVG element.

**Template change for target state:** Replace `bitValue` with `targetStates[target.id]` in target visual logic:

```svelte
{@const stateIndex = isConnected ? (targetStates[target.id] ?? 0) : 0}
```

**Connection initialization:** When a wire is first connected, set `targetStates[targetId] = bitValue` immediately (no pulse for initial connection).

**Cleanup:** Add `$effect` cleanup to cancel any in-flight animations on unmount:

```typescript
$effect(() => {
  return () => {
    for (const [, id] of activePulses) cancelAnimationFrame(id);
  };
});
```

### 4. Black/white card visual improvement in `BitConnections.svelte`

**Template change:**

```svelte
{:else if target.id === 'bwCard'}
  <div class="bw-inner"></div>
```

Remove all text content. The CSS already handles the visual state via background-color transitions. When disconnected, show a neutral state (existing `--color-bg-raised` from `.target-card`).

### 5. Coin visual improvement in `BitConnections.svelte`

**Template change:**

```svelte
{:else if target.id === 'coin'}
  <div class="coin-face">
    <span class="coin-letter">{isConnected ? (stateIndex === 1 ? 'H' : 'T') : '?'}</span>
  </div>
```

**New CSS:**

```css
/* Coin */
.coin-face {
  width: 80%;
  aspect-ratio: 1;
  border-radius: 50%;
  border: 3px solid var(--color-border);
  display: grid;
  place-items: center;
  background: var(--color-bg-raised);
  transition: border-color var(--transition-normal), background var(--transition-normal);
}

.target-card.connected .coin-face {
  border-color: #b8860b;
  background: linear-gradient(135deg, #f0d060, #c9a030);
}

.coin-letter {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--color-text-muted);
  transition: color var(--transition-normal);
}

.target-card.connected .coin-letter {
  color: #5c3a00;
}
```

Remove the old `.coin-text` styles.

## Sources

- **Base widget plan:** [docs/plans/2026-03-09-feat-bit-connections-widget-plan.md](docs/plans/2026-03-09-feat-bit-connections-widget-plan.md) — original BitConnections architecture
- **Animation strategy:** [docs/decisions/003-widget-animation-strategy.md](docs/decisions/003-widget-animation-strategy.md) — per-widget WAAPI/rAF choice, reducedMotion pattern
- **Widget pattern:** [site/src/components/widgets/BitConnections.svelte](site/src/components/widgets/BitConnections.svelte) — current implementation with drag state machine, SVG wires, paramDefs
- **SVG animation patterns:** [docs/archive/ANIMATION_PATTERNS.md](docs/archive/ANIMATION_PATTERNS.md) — `getTotalLength()`/`getPointAtLength()` pattern, stroke-dashoffset, staggered timeouts
- **MDN getPointAtLength:** https://developer.mozilla.org/en-US/docs/Web/API/SVGGeometryElement/getPointAtLength
