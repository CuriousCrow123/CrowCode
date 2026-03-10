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

### Widget parameters

- Each widget defines its own tunable params via a `paramDefs` array using the `Param` interface from `site/src/lib/params.ts`
- `WidgetDebugPanel.svelte` renders sliders for any widget's params — never build custom debug UI per widget
- Style params flow via scoped CSS custom properties (e.g. `--counter-font-size`), behavioral params are used directly in JS
- Widget debug panels are gated behind `import.meta.env.DEV` internally — widgets include `<WidgetDebugPanel>` unconditionally
- **Separation rule**: Widgets must NOT reference global spatial tokens (`--space-*`, `--radius-*`, layout widths) — all numeric styling comes from the widget's own `paramDefs` via scoped CSS custom properties. Non-spatial globals (`--color-*`, `--font-*`, `--transition-*`) are fine — they aren't controlled by the global debug panel

### Adding a new widget

1. Create `site/src/components/widgets/MyWidget.svelte`
2. Define a `paramDefs` array with tunable parameters using the `Param` interface
3. Initialize reactive params with `loadParams()` from `params.ts`
4. Use scoped CSS custom properties for style params, direct JS for behavioral params
5. Include `<WidgetDebugPanel>` with `bind:values` for the debug panel
6. Export methods via `export function` for prose control
7. Create `site/src/pages/sandbox/my-widget.astro` using `SandboxLayout` for isolated development

### Widget visual feedback patterns

- **Sustained highlight** (read steps): `highlightVar(name)` adds to a reactive Set; `clearHighlights()` clears it. The highlight persists until the orchestrator explicitly clears it (typically at the start of the next step). No timers — the user controls pacing.
- **Glow animation** (assign steps): CSS `@keyframes` with `onanimationend` callback to clean up state (e.g., remove from `glowingVarNames` Set after animation completes).
- **Svelte 5 Set reactivity**: Always reassign the full Set (`highlightedVars = new Set([...highlightedVars, name])`) — never use `.add()`/`.delete()` mutations, which don't trigger Svelte 5 reactivity.
- **Generation counter for async cancellation**: `reset()` increments a monotonic counter; async methods capture it before each `await` and bail if it changed. Replaces error-prone `cancelled` boolean pattern.

### Component patterns

- **Widgets** (`components/widgets/`) are self-contained, expose imperative APIs via `export function`
- **Shared widget components** (`components/widgets/shared/`) are stateless/presentational Svelte components used by multiple widgets (e.g. `ScrubSlider`). They have no `WIDGET_ID` or `paramDefs` — they receive all data via props and communicate changes via callbacks
- **Sections** (`components/sections/`) compose widgets + prose, use `bind:this` for prose-widget interaction
- Prose text that triggers widget actions uses `<button class="action">` (styled in `global.css`)
- Every section's `<h2>` needs an `id` attribute for TOC auto-generation

### Dev tooling

- **Global debug panel**: gated behind `import.meta.env.DEV` — toggle with bottom-right button or `Ctrl+.`
- **Widget debug panels**: gear icon in each widget's top-right corner (dev only)
- Sandbox pages at `/sandbox/` for isolated widget development — use `SandboxLayout.astro` for consistent page structure

## Commands

Run from `site/`:

- `npm run dev` — dev server
- `npm run build` — production build
- `npm run preview` — preview production build
