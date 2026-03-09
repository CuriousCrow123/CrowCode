# ADR 003: Widget Animation Strategy

**Date:** 2026-03-09
**Status:** Accepted

## Context

The Bit widget's 3D card flip exposed a limitation of CSS transitions: they decompose `rotateY()` into matrices for interpolation, so `rotateY(360deg)` = `rotateY(0deg)` in matrix form. This makes directional animations (always-forward rotation) non-deterministic with CSS transitions.

As the essay grows with more widgets (coding curriculum), we'll encounter a mix of simple state changes and complex directional/sequential animations.

## Decision

**Per-widget animation choice.** Each widget picks its own animation approach based on its needs:

- **CSS transitions** — for simple A↔B state changes (hover, toggle, slide). Use `--transition-fast`/`--transition-normal` or widget animation params piped via CSS custom properties.
- **Web Animations API** — for directional, sequential, or complex animations where CSS transitions break down. Animation timing comes from widget `params` (keeping the debug panel in control). Check `prefers-reduced-motion` via `matchMedia` in JS.
- **setInterval + visibility observer** — for continuous animations (canvas, grid cell updates). Existing pattern, unchanged.

No shared animation layer or utility. Widgets are self-contained.

## Consequences

- Widgets remain fully independent — no new shared abstractions
- Animation params still flow through the existing `Param` system regardless of approach
- Developers choose the simplest tool that works for each widget
- `prefers-reduced-motion` handling varies by approach: CSS transitions get it free from the global rule; WAAPI widgets must check it themselves
