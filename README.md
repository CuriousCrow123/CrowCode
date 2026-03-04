# Visual Essay Template

A minimal template for building [ciechanow.ski](https://ciechanow.ski/)-style visual essays: single scrollable pages with prose interleaved with interactive figures, where text can drive widget state.

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Site generator | Astro 5 | Islands architecture — static HTML by default, Svelte components hydrate independently |
| Interactive components | Svelte 5 | Tiny runtime, `$state`/`$derived` runes, `export function` for imperative APIs |
| Styling | CSS custom properties | One token file controls the entire visual system |
| Hosting | GitHub Pages | Static output via `astro build` |

**3 dependencies total**: `astro`, `@astrojs/svelte`, `svelte`.

## Directory Structure

```
site/
├── src/
│   ├── components/
│   │   ├── debug/
│   │   │   ├── DebugPanel.svelte       # Dev-only global spatial token sliders
│   │   │   └── WidgetDebugPanel.svelte # Reusable per-widget param sliders
│   │   ├── essay/                      # Template primitives
│   │   │   ├── Figure.svelte           # Wide container for interactive figures
│   │   │   └── TableOfContents.svelte  # Collapsible sidebar TOC
│   │   ├── widgets/                    # Reusable interactive components
│   │   │   └── Counter.svelte          # Example: imperative API via export function
│   │   └── sections/                   # Self-contained essay sections
│   │       └── example/
│   │           ├── Introduction.svelte
│   │           └── InteractiveDemo.svelte
│   ├── lib/
│   │   ├── tokens.ts                   # Single source of truth for spatial tokens
│   │   └── params.ts                   # Param interface + helpers for widget parameters
│   ├── layouts/
│   │   ├── BaseLayout.astro            # HTML shell, fonts, CSS, token injection
│   │   └── EssayLayout.astro           # TOC sidebar + scrollable content area
│   ├── pages/
│   │   ├── index.astro                 # Assembled essay page
│   │   └── sandbox/
│   │       ├── index.astro             # Widget catalog
│   │       └── counter.astro           # Isolated widget sandbox
│   └── styles/
│       └── global.css                  # Non-spatial tokens, reset, prose, .action class
├── public/
│   └── favicon.svg
├── package.json
├── astro.config.mjs
├── svelte.config.js
└── tsconfig.json
```

## Core Concepts

### The three component types

**Widgets** are reusable interactive building blocks. They know nothing about the essay — they just render, react, and expose an imperative API via `export function`. Developed and tested in the sandbox.

```svelte
<!-- widgets/Counter.svelte -->
<script lang="ts">
  let count = $state(0);
  let doubled = $derived(count * 2);

  export function reset() { count = 0; }
  export function setCount(value: number) { count = value; }
</script>
```

**Sections** are self-contained essay modules. Each section contains its own prose and widgets. Prose can interact with widgets through `bind:this` and `<button class="action">` inline elements.

```svelte
<!-- sections/example/InteractiveDemo.svelte -->
<script lang="ts">
  import Figure from '../../essay/Figure.svelte';
  import Counter from '../../widgets/Counter.svelte';

  let counter: ReturnType<typeof Counter>;
</script>

<section>
  <div class="prose">
    <h2 id="interactive-demo">Interactive Demo</h2>
    <p>
      Click <button class="action" onclick={() => counter.setCount(42)}>set to 42</button>
      to see the widget update.
    </p>
  </div>

  <Figure caption="A counter widget">
    <Counter bind:this={counter} />
  </Figure>
</section>
```

**Essay primitives** are the layout building blocks provided by the template:

- `Figure.svelte` — Wide container for interactive figures. Prose is constrained to `--prose-width` (42rem), figures expand to `--figure-width` (64rem). This creates the narrow-prose / wide-figure rhythm.
- `TableOfContents.svelte` — Collapsible sidebar. Scans the DOM for `h2[id]` elements on mount, uses `IntersectionObserver` to highlight the active section. Toggle button in the top-left corner.

### Prose-widget interaction

The key architectural decision: sections are Svelte components (not Markdown), so prose and widget refs share the same scope. This enables inline text that triggers widget state changes, like ciechanow.ski.

The pattern:
1. Widget exports methods via `export function`
2. Section binds the widget instance via `bind:this`
3. Inline `<button class="action">` elements in prose call those methods

The `.action` class (defined in `global.css`) styles buttons as inline text links — dotted underline, accent color, focus ring.

### Page assembly

An Astro page imports sections and renders them in order inside `EssayLayout`:

```astro
---
import EssayLayout from '../layouts/EssayLayout.astro';
import Introduction from '../components/sections/example/Introduction.svelte';
import InteractiveDemo from '../components/sections/example/InteractiveDemo.svelte';
---

<EssayLayout title="Example Visual Essay">
  <Introduction client:visible />
  <InteractiveDemo client:visible />
</EssayLayout>
```

Each section hydrates independently via `client:visible` (loads JS when scrolled into viewport).

### Table of contents

The TOC auto-generates from the DOM — no prop passing or duplication needed. Every section's `<h2 id="...">` is discovered at runtime via `document.querySelectorAll('h2[id]')` and tracked with `IntersectionObserver`. The sidebar is collapsible via a toggle button, slides in from the left.

## Design System

Design tokens are split across two files:
- **`src/lib/tokens.ts`** — spatial tokens (spacing, layout widths, radii). This is the single source of truth. `BaseLayout.astro` generates CSS custom properties from it, and the debug panel reads from it.
- **`src/styles/global.css`** — non-spatial tokens (colors, typography, transitions) plus all styles (reset, prose, action class).

See [ADR 001](docs/decisions/001-tokens-in-typescript.md) for why spatial tokens live in TypeScript.

### Colors

| Token | Value | Use |
|-------|-------|-----|
| `--color-bg` | `#0f1117` | Page background |
| `--color-bg-raised` | `#181b24` | Cards, raised surfaces |
| `--color-bg-surface` | `#1e2230` | Interactive surfaces |
| `--color-border` | `#2a2f3e` | Borders, dividers |
| `--color-text` | `#e2e4e9` | Primary text |
| `--color-text-muted` | `#8b90a0` | Secondary text, labels |
| `--color-accent` | `#4d9fff` | Active states, links, focus rings, action links |
| `--color-highlight` | `#f5a623` | Hover state for action links |
| `--color-success` | `#34d399` | Success states |
| `--color-error` | `#f87171` | Error states |

### Typography

| Token | Value | Use |
|-------|-------|-----|
| `--font-body` | Inter | Prose, UI text |
| `--font-mono` | JetBrains Mono | Code, data values |

Both loaded as variable fonts from Google Fonts.

### Spacing & Layout

8-step spacing scale: `--space-xs` (0.25rem) through `--space-3xl` (4rem).

| Token | Value | Use |
|-------|-------|-----|
| `--prose-width` | `42rem` | Max width for text columns |
| `--figure-width` | `64rem` | Max width for interactive figures |
| `--sidebar-width` | `16rem` | TOC sidebar width |

Three border radii: `--radius-sm` (4px), `--radius-md` (8px), `--radius-lg` (12px).

### Transitions

| Token | Value | Use |
|-------|-------|-----|
| `--transition-fast` | `150ms ease` | Hover, focus feedback |
| `--transition-normal` | `250ms ease` | Panel open/close, reveals |

### Accessibility

- `prefers-reduced-motion: reduce` disables all animations and transitions
- `button.action` has `:focus-visible` rings for keyboard navigation
- TOC toggle uses `aria-label` and `aria-expanded`
- TOC nav uses `aria-label="Table of contents"`

## How To

### Add a new widget

1. Create `src/components/widgets/MyWidget.svelte`
2. Define a `paramDefs` array with tunable parameters using the `Param` interface from `params.ts`
3. Initialize reactive params with `loadParams()` from `params.ts`
4. Use scoped CSS custom properties for style params (e.g. `--mywidget-font-size`), direct JS for behavioral params
5. Include `<WidgetDebugPanel>` with `bind:values` for the per-widget debug panel
6. Use `$state` / `$derived` for widget-internal reactivity
7. Export methods via `export function` for prose control
8. Create `src/pages/sandbox/my-widget.astro` for isolated development
9. Add it to the sandbox index at `src/pages/sandbox/index.astro`

### Add a new section

1. Create `src/components/sections/{topic}/MySection.svelte`
2. Add a `<h2 id="my-section">` for TOC registration
3. Wrap prose in `<div class="prose">`
4. Import widgets with `bind:this` for prose-widget interaction
5. Wrap interactive figures in `<Figure>`
6. Use `<button class="action">` for inline text that triggers widget methods

### Add a new essay page

1. Create `src/pages/my-essay.astro`
2. Import `EssayLayout` and your section components
3. Render sections in order with `client:visible`

### Add a new spatial token

1. Add it to the `tokens` array in `src/lib/tokens.ts` with name, value, unit, category, and slider constraints
2. It automatically appears as a CSS custom property and in the debug panel
3. Do NOT add spatial tokens (`--space-*`, `--radius-*`, layout widths) to `global.css`

### Hydration directives

| Directive | When JS loads | Use for |
|-----------|--------------|---------|
| `client:visible` | Scrolled into viewport | Most sections (lazy default) |
| `client:load` | Page load | Above-the-fold interactions |
| `client:idle` | Browser idle | TOC, non-critical components |
| (none) | Never | Static-only content |

## Debug Panels

### Global tokens panel

In development (`npm run dev`), a global debug panel is available in the bottom-right corner. Toggle it with the button or `Ctrl+.`. It renders sliders for all spatial tokens defined in `tokens.ts`, grouped by category (spacing, layout, radii). Drag a slider to adjust values in real time. Reset individual tokens or all at once. The panel freezes its own token values so slider changes don't affect the panel itself.

### Per-widget panels

Each widget includes its own debug panel (gear icon in top-right corner) for adjusting widget-specific parameters like font size, spacing, and behavior settings. These are defined via `paramDefs` arrays inside each widget using the `Param` interface from `params.ts`. Widget params persist to localStorage independently per widget (`widget-params-{widgetId}`).

Style params flow via scoped CSS custom properties (e.g. `--counter-font-size`). Behavioral params (e.g. `stepSize`) are used directly in JS logic. See [ADR 002](docs/decisions/002-per-widget-params.md) for rationale.

Both panel types are gated behind `import.meta.env.DEV` and completely removed from production builds.

## Commands

Run from `site/`:

| Command | Action |
|---------|--------|
| `npm install` | Install dependencies |
| `npm run dev` | Dev server at `localhost:4321` |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview production build locally |

## Dependency Rule

```
tokens.ts + global.css (design foundation)
  → widgets (self-contained, sandbox-testable)
    → sections (compose widgets + prose)
      → pages (assemble sections into essays)
```

Nothing points down. A widget never imports a section. A section never imports a page. Each layer is independently workable.
