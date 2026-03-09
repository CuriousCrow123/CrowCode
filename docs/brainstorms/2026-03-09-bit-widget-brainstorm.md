# Brainstorm: Bit Widget

**Date:** 2026-03-09
**Status:** Complete

## What We're Building

A **Bit widget** — a single square card representing a binary bit. Clicking it flips the card with a 3D animation, toggling between 0 and 1.

**Page change:** Replace the existing example sections (Introduction + InteractiveDemo) in `index.astro` with a new section containing:
- Prose: "This is a bit. Click it to flip it!"
- The Bit widget

Keep the EssayLayout structure (TOC, BaseLayout, etc.).

## Why This Approach

**CSS 3D card flip** using `transform: rotateY(180deg)` with `perspective`. This is the standard, performant way to animate card flips — no canvas or JS animation loops needed. It maps directly to the physical metaphor of flipping a card.

- Front face shows **0**, back face shows **1**
- Both faces are identical in color (no color-coding between states)
- Both faces are stacked with `backface-visibility: hidden`
- A single CSS transition handles the rotation
- Always rotates in the same direction (cumulative rotation, not toggle)
- State derived from cumulative rotation angle

## Key Decisions

1. **Card faces:** 0 on front, 1 on back — plain numbers, identical colors on both sides
2. **Animation:** 3D CSS card flip (always-forward Y-axis rotation, `perspective` on container)
3. **Page structure:** Replace example sections in index.astro, keep EssayLayout
4. **Widget params (tunable via debug panel):**
   - `cardSize` (style) — width/height of the card
   - `fontSize` (style) — size of the 0/1 text
   - `flipDuration` (animation) — transition duration in ms
   - `borderRadius` (style) — card corner rounding
   - `perspective` (style) — 3D perspective depth

## Files to Create/Modify

- **New:** `site/src/components/widgets/Bit.svelte` — the widget
- **New:** `site/src/components/sections/bits/BitIntro.svelte` — section with prose + widget
- **New:** `site/src/pages/sandbox/bit.astro` — sandbox page
- **Modify:** `site/src/pages/sandbox/index.astro` — add sandbox link
- **Modify:** `site/src/pages/index.astro` — replace example sections with BitIntro

## Open Questions

None — design is clear.
