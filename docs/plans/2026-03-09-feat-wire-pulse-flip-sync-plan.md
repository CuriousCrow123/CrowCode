---
title: "feat: Sync bus wire pulses with bit flip events"
type: feat
status: active
date: 2026-03-09
---

# Sync Bus Wire Pulses with Bit Flip Events

Wire pulses on the CPU-RAM bus should visually correspond with actual bit flips. More flips = more visible pulses, giving the reader an intuitive sense of data transfer activity.

## Problem

**BitGridBytes:** `startWireAnimation()` overwrites the single `wireProgress` scalar each time, so rapid flips restart the dot mid-flight. Only one dot is ever visible regardless of flip rate.

**BitGridData:** Wire fires on a fixed 100ms throttle (`lastWireTime` check) completely decoupled from bit changes. The physics loop writes to bits at 60fps, but the wire pulses at a constant rate — no visual correlation between activity and pulses.

## Proposed Solution

### 1. Multi-dot wire animation (both widgets)

Replace the single `wireProgress: number` state with an array of dot objects:

```typescript
// site/src/components/widgets/BitGridBytes.svelte
interface WireDot {
  id: number;
  startTime: number;
}

let wireDots: WireDot[] = $state([]);
let dotIdCounter = 0;
```

A single `requestAnimationFrame` loop updates a reactive `wireNow` timestamp each frame. The SVG template derives each dot's progress as `(wireNow - dot.startTime) / wireSpeed`. Completed dots (progress >= 1) are filtered out. The rAF loop self-terminates when the array is empty.

```typescript
let wireNow = $state(0); // updated each rAF frame, drives SVG progress
let wireRafId = 0;

function tickWireDots(now: number) {
  wireNow = now;
  wireDots = wireDots.filter(d => (now - d.startTime) / params.wireSpeed < 1);
  if (wireDots.length > 0) {
    wireRafId = requestAnimationFrame(tickWireDots);
  } else {
    wireRafId = 0;
  }
}

function spawnDot() {
  if (wireDots.length >= 8) wireDots = wireDots.slice(1); // drop oldest
  wireDots = [...wireDots, { id: dotIdCounter++, startTime: performance.now() }];
  if (!wireRafId) wireRafId = requestAnimationFrame(tickWireDots);
}
```

SVG renders `{#each wireDots}` with `{@const progress = (wireNow - dot.startTime) / params.wireSpeed}`. Cap at **8 concurrent dots** — oldest dropped when exceeded.

### 2. BitGridBytes: already 1:1, just allow concurrency

Currently, the byte flip is *deferred* until the dot arrives (`onComplete` callback). With multi-dot, **flip immediately and spawn a dot simultaneously** — the dot becomes a visual echo of the flip, not a gate. This simplifies the model (no pending flip queue) and means flips happen at the expected `flipInterval` cadence regardless of `wireSpeed`.

- [x] Replace `wireProgress`/`pendingByteIndex`/`wireAnimationId` with `wireDots`/`wireNow`/`wireRafId`
- [x] Byte flip loop: call `flipByte(startBit)` immediately, then `spawnDot()` if `cpuVisible`
- [x] Remove `startWireAnimation()` and its `onComplete` callback pattern
- [x] SVG: `{#each wireDots}` rendering two circles per dot (ADDR + DATA bus, DATA delayed by 0.15)
- [x] Wire rAF cleanup: single rAF drives all dots via `wireNow`; self-terminates when array empty

### 3. BitGridData: tie pulses to actual data bit changes

- [x] Add a `prevDataBits` snapshot (plain `Uint8Array`, not `$state`) — only tracks the first `dataBits` indices
- [x] After `writeValue()` for x and y, compare against `prevDataBits`. If any bit differs → `spawnDot()`
- [x] Keep min-interval throttle at 50ms between spawns (avoids 60fps visual spam)
- [x] Ambient random flips do NOT trigger wire pulses (they represent background RAM noise, not CPU transfers)
- [x] Remove the old `lastWireTime` / fixed 100ms throttle logic
- [x] Add `document.hidden` guard to physics rAF loop (currently missing — ambient loop has it, physics doesn't)

Both widgets duplicate the dot-animation pattern (~15 lines). No shared module — the widgets are independent and extraction isn't warranted.

## Acceptance Criteria

- [ ] BitGridBytes: rapid flips (low `flipInterval`) show multiple dots in flight simultaneously
- [ ] BitGridBytes: slow flips (high `flipInterval`) show clean single-dot pulses as before
- [ ] BitGridData: wire pulses fire when data bits (x, y) actually change, not on a timer
- [ ] BitGridData: no wire pulse when only ambient bits flip
- [ ] BitGridData: high ball velocity (many bit changes/sec) produces visibly denser pulses
- [ ] BitGridData: physics loop pauses when `document.hidden`
- [ ] Both: max 8 concurrent dots (oldest dropped when exceeded)
- [ ] Both: `prefers-reduced-motion` still skips all dot rendering
- [ ] Both: CPU hidden mode still works (no dots rendered, bits still flip)
- [ ] Both: `wireSpeed` param still controls per-dot travel time
- [ ] Build passes, no new Svelte warnings

## Files to Modify

- `site/src/components/widgets/BitGridBytes.svelte` — multi-dot state, `spawnDot()`, SVG `{#each}`, rAF loop
- `site/src/components/widgets/BitGridData.svelte` — `prevDataBits` snapshot, change detection, `spawnDot()`, physics `document.hidden` guard, remove fixed throttle

## Sources

- Current wire animation: [BitGridBytes.svelte:124-141](site/src/components/widgets/BitGridBytes.svelte#L124-L141)
- Current throttled wire: [BitGridData.svelte:208-212](site/src/components/widgets/BitGridData.svelte#L208-L212)
- Existing change detection pattern (for glow): [BitGridCore.svelte:46-66](site/src/components/widgets/BitGridCore.svelte#L46-L66)
- Animation strategy ADR: [docs/decisions/003-widget-animation-strategy.md](docs/decisions/003-widget-animation-strategy.md)
