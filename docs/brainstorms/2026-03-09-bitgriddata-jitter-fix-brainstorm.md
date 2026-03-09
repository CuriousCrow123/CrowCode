# Brainstorm: BitGridData Animation Jitter Fix

**Date:** 2026-03-09
**Status:** Reverted (approach tried and rolled back — see Outcome)

## What We're Building

Smooth interpolation for the BitGridData canvas ball, eliminating the visible teleporting/stepping caused by the deferred wire-dot update pattern. Also a merged single-rAF-loop architecture and a light doc refresh.

## Problem

After implementing deferred bit writes (bits only update when wire dots arrive), the canvas ball exhibits severe jitter:

1. **Discrete teleporting**: Ball freezes for ~400ms (wireSpeed), then jumps to the dot's carried position. At 60fps that's ~24 frozen frames then a sudden jump.
2. **Stale values on arrival**: Dots carry values from spawn time. By arrival, physics has moved on — the ball jumps to a 400ms-old position.
3. **8-bit quantization**: Only 256 discrete x-positions across the canvas (~1.5px steps). Minor but additive.
4. **Two separate rAF loops**: Physics tick and wire dot tick run independently. Up to 16ms sync gap between dot completion and the next canvas render.

## Why This Approach

**Smooth interpolation** — the canvas ball lerps toward the decoded (bit-derived) target position each frame. This preserves the visual causality (bits drive animation) while eliminating teleporting. The ball glides smoothly to where the bits say it should be.

Why not ghost rendering? It's a cool effect but adds visual complexity to an already dense widget. The lerp is invisible to the reader — they just see a smooth ball that happens to be driven by bits.

Why not just reducing wireSpeed? Smaller steps help but don't eliminate the fundamental discreteness. Interpolation does.

**Merged rAF loop** — ticking wire dots inside the physics loop eliminates an entire class of timing issues. One loop, one frame, zero sync gap. When a dot completes, the target position updates in the same frame the canvas renders.

## Key Decisions

### Interpolation strategy

Use exponential lerp (`displayX += (targetX - displayX) * lerpFactor * dt`) each physics frame. The `lerpFactor` should be high enough that the ball feels responsive (~10-15 range, tunable via params) but low enough to smooth out the quantization steps.

- `displayX` / `displayY`: the smoothed canvas position (what gets rendered)
- `decodedX` / `decodedY`: the target (set when wire dots arrive, i.e. what the bits say)
- Lerp runs every physics frame at 60fps, so the ball moves smoothly toward the target

### Merged rAF loop

Eliminate the separate `tickWireDots` rAF loop. Instead, check for completed dots at the start of each physics tick:
- Iterate `wireDots`, find completed ones (progress >= 1), apply latest completed values
- Filter to active dots only
- Update `wireNow` for SVG rendering
- Remove `wireRafId` and the standalone `tickWireDots` function

### CPU-hidden path

When CPU is hidden, bits write immediately and decodedX/Y update instantly. The lerp still runs but converges in 1-2 frames — effectively instant. No special case needed.

### Doc evergreen pass

Quick pass on completed plans/brainstorms:
- Update frontmatter status fields where stale
- Add brief Implementation Notes to wire-pulse-flip-sync plan noting the deferred-write and interpolation additions
- No full rewrites

## Resolved Questions

1. **Should interpolation be parameterized?** Yes — add a `lerpSpeed` param so the debug panel can tune responsiveness.
2. **Does this affect BitGridBytes?** No — BitGridBytes doesn't have a canvas animation driven by bit values. Its wire dots are purely visual echoes.
3. **Should the ball snap to the sine curve or follow decoded y directly?** Follow decoded y directly via lerp. The quantization means the ball may be slightly off-curve, but at 8-bit that's <1px. At 16-bit it's invisible.

## Outcome

The lerp interpolation + merged rAF loop were implemented as described. However, the deferred-write model with lerp caused persistent jitter that could not be fully resolved:

1. **Wrap-aware lerp** caused the ball to slide backward across the entire canvas at the wavelength boundary
2. **Cold start** — `displayNormX/Y` initialized at 0 caused a slide-from-origin on first frame
3. **Dot completion ordering** — `spawnDot` ran before completion check, dropping the oldest (about-to-complete) dot before its values were applied

Fixes were attempted for all three (wrap-aware lerp in normalized space, -1 sentinel for snap-on-first-frame, reordering completion check before spawn), but the result remained "slightly better" rather than smooth.

**Decision:** Reverted to immediate bit writes from physics. The canvas renders directly from physics state. Wire dots are purely visual echoes. The **merged rAF loop** (ticking wire dots inside the physics loop) was the one surviving improvement — it eliminates the separate `tickWireDots` rAF and its 16ms sync gap.

## Open Questions

None — all resolved.
