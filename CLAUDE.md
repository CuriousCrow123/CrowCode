# CrowCode

Visual essay template built with Astro 5 + Svelte 5. All source lives in `site/`.

## Architecture Rules

### Token system

- Spatial design tokens (spacing, layout widths, radii) are defined in `site/src/lib/tokens.ts` — this is the **single source of truth**
- `BaseLayout.astro` generates CSS custom properties from `tokens.ts` at build time
- `global.css` uses these tokens but does NOT define them — it only contains non-spatial tokens (colors, typography, transitions)
- The debug panel (`DebugPanel.svelte`) is auto-generated from the same `tokens.ts` — never add sliders manually

### Adding a new spatial token

1. Add it to the `tokens` array in `site/src/lib/tokens.ts`
2. It automatically appears as a CSS custom property and in the debug panel
3. Do NOT add `--space-*`, `--radius-*`, or layout width tokens to `global.css`

### Component patterns

- **Widgets** (`components/widgets/`) are self-contained, expose imperative APIs via `export function`
- **Sections** (`components/sections/`) compose widgets + prose, use `bind:this` for prose-widget interaction
- Prose text that triggers widget actions uses `<button class="action">` (styled in `global.css`)
- Every section's `<h2>` needs an `id` attribute for TOC auto-generation

### Dev tooling

- Debug panel is gated behind `import.meta.env.DEV` — never appears in production builds
- Toggle with the button in bottom-right corner or `Ctrl+.`
- Sandbox pages at `/sandbox/` for isolated widget development

## Commands

Run from `site/`:

- `npm run dev` — dev server
- `npm run build` — production build
- `npm run preview` — preview production build
