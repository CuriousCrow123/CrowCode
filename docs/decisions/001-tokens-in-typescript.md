# ADR 001: Spatial tokens defined in TypeScript, not CSS

## Status

Accepted

## Context

We needed a debug panel that auto-generates sliders for all spacing tokens, driven by a single source of truth. The naive approach — parsing CSS custom properties from `document.styleSheets` at runtime — is fragile:

- Cross-origin stylesheets throw `SecurityError` when accessing `cssRules`
- Astro's CSS bundling can mangle `:root` selector text
- Inferring slider ranges and units from CSS value strings is unreliable

## Decision

Define spatial tokens (spacing, layout widths, radii) in `src/lib/tokens.ts` as typed objects with explicit value, unit, and slider constraints. Two consumers import this file:

1. `BaseLayout.astro` generates `:root { ... }` CSS custom properties at build time
2. `DebugPanel.svelte` renders sliders with correct ranges

Non-spatial tokens (colors, fonts, transitions) remain in `global.css` because they don't need slider adjustment and their value types (hex colors, font stacks, timing strings) don't map to simple numeric ranges.

## Consequences

- Adding a spatial token requires editing `tokens.ts`, not `global.css`
- The debug panel is always in sync with CSS by construction — no runtime discovery needed
- Token definitions are type-checked (`Token` interface) and self-documenting
- `global.css` becomes purely about styles (reset, prose, action class), not token definitions

## Alternatives considered

- **Runtime CSS parsing** (`document.styleSheets` iteration): Fragile, no type safety, requires string parsing for units and ranges
- **CSS + separate JSON manifest**: Two files to keep in sync, defeats single source of truth
- **All tokens in TS (including colors, fonts)**: Over-abstraction for non-numeric values that don't benefit from slider adjustment
