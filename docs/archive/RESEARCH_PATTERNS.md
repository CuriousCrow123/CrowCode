# CrowCode Repository Pattern Research

**Research Date**: March 4, 2026
**Analyzed**: Widget architecture, animation patterns, DOM manipulation, state management, debug system, section composition

---

## Repository Research Summary

### Architecture & Structure

**Tech Stack**
- **Generator**: Astro 5 with islands architecture
- **Interactive Components**: Svelte 5 with `$state`/`$derived` runes
- **Styling**: CSS custom properties (spatial tokens in TS, non-spatial in CSS)
- **Dependencies**: Only 3 (`astro`, `@astrojs/svelte`, `svelte`)

**Key Files**
- `/Users/alan/Desktop/CrowCode/site/src/lib/tokens.ts` — Single source of truth for spatial design tokens
- `/Users/alan/Desktop/CrowCode/site/src/lib/params.ts` — Param interface + localStorage helpers for widget parameters
- `/Users/alan/Desktop/CrowCode/site/src/layouts/BaseLayout.astro` — Injects token CSS at build time
- `/Users/alan/Desktop/CrowCode/site/src/layouts/EssayLayout.astro` — TOC + scrollable essay container
- `/Users/alan/Desktop/CrowCode/site/src/styles/global.css` — Non-spatial tokens, reset, prose, action class
- `/Users/alan/Desktop/CrowCode/CLAUDE.md` — Project-specific architecture rules (must follow these)

**Component Hierarchy**
```
tokens.ts + global.css (design foundation)
  ↓
widgets/ (self-contained, sandbox-testable)
  ↓
sections/ (compose widgets + prose)
  ↓
pages/ (assemble sections into essays)
```

No upward dependencies. Widgets never import sections. Sections never import pages.

---

## Widget Pattern Analysis

### 1. Widget Param System

**Location**: `/Users/alan/Desktop/CrowCode/site/src/lib/params.ts`

**Interface** (`Param`):
```typescript
interface Param {
  name: string;              // e.g., 'fontSize'
  value: number;             // Default value
  unit: string;              // 'rem', 'px', 'ms', ''
  category: string;          // 'style', 'behavior' for UI grouping
  min: number;               // Slider min
  max: number;               // Slider max
  step: number;              // Increment
  description: string;       // Tooltip text
}
```

**Key Helpers**:
- `paramDefaults(defs)` — Build defaults map
- `loadParams(widgetId, defs)` — Restore from localStorage or return defaults
- `saveParams(widgetId, values, defs)` — Persist only overridden values

**Pattern**: Each widget defines its own `paramDefs` array. Parameters are:
1. **Style params**: Flow via scoped CSS custom properties (e.g., `--counter-font-size`)
2. **Behavioral params**: Used directly in JS logic (e.g., `stepSize`)

Both are reactive `$state` that the debug panel mutates via `bind:values`.

---

### 2. Animation Patterns (Critical for your new widgets)

**BitMatrix Animation** (`/Users/alan/Desktop/CrowCode/site/src/components/widgets/BitMatrix.svelte`)

Pattern: **Interval-based DOM mutation with CSS animation triggers**

```svelte
<script lang="ts">
  let cells: Uint8Array;              // Direct data store
  let cellEls: HTMLSpanElement[] = [];  // Direct DOM refs
  let isVisible = $state(true);

  // Effect 1: Build grid
  $effect(() => {
    if (!gridEl || containerWidth === 0) return;

    cells = new Uint8Array(total);    // Initialize data
    gridEl.innerHTML = '';             // Clear

    // Create DOM elements directly
    for (let i = 0; i < total; i++) {
      const span = document.createElement('span');
      span.className = cells[i] ? 'cell on' : 'cell';
      span.textContent = String(cells[i]);
      span.setAttribute('aria-hidden', 'true');
      span.addEventListener('animationend', () => span.classList.remove('glowing'));
      gridEl.appendChild(span);
      cellEls.push(span);
    }
    return () => { if (gridEl) gridEl.innerHTML = ''; };
  });

  // Effect 2: Visibility observer for performance
  $effect(() => {
    if (!gridEl) return;
    const observer = new IntersectionObserver(
      ([entry]) => { isVisible = entry.isIntersecting; },
      { threshold: 0, rootMargin: '100px 0px' }
    );
    observer.observe(gridEl);
    return () => observer.disconnect();
  });

  // Effect 3: Animation loop (only when visible)
  $effect(() => {
    if (!isVisible || !cells || cells.length === 0) return;

    const cancel = { canceled: false };
    const id = setInterval(() => {
      if (cancel.canceled || document.hidden) return;  // Pause if tab hidden

      for (let f = 0; f < flips; f++) {
        const idx = Math.floor(Math.random() * cells.length);
        if (!cellEls[idx]) continue;

        // Mutate data
        cells[idx] ^= 1;
        cellEls[idx].textContent = String(cells[idx]);
        cellEls[idx].className = cells[idx] ? 'cell on' : 'cell';

        // Trigger CSS animation by removing and re-adding class
        cellEls[idx].classList.remove('glowing');
        void cellEls[idx].offsetWidth;  // Force reflow
        cellEls[idx].classList.add('glowing');
      }
    }, ms);

    return () => { cancel.canceled = true; clearInterval(id); };
  });
</script>

<style>
  :global(.grid .cell.glowing) {
    animation: bit-glow 300ms ease-out forwards;
  }

  @keyframes bit-glow {
    0% {
      text-shadow: 0 0 6px rgba(77, 159, 255, 0.6);
      color: #fff;
      background-color: rgba(77, 159, 255, 0.12);
    }
    100% {
      text-shadow: none;
      color: inherit;
      background-color: inherit;
    }
  }
</style>
```

**Key Principles**:
- Direct DOM element array (`cellEls`) for fast mutation
- Typed data store (`Uint8Array`) separate from DOM
- Visibility observer to pause animations when offscreen (performance)
- `setInterval()` for batch updates, not `requestAnimationFrame()`
- Force reflow with `offsetWidth` to retrigger CSS animations
- Cleanup via return function from `$effect()`
- Gating animations behind `if (document.hidden)` to respect browser tab focus

---

**BitRepresenter SVG Animation** (`/Users/alan/Desktop/CrowCode/site/src/components/widgets/BitRepresenter.svelte`)

Pattern: **SVG stroke-dash animation with staggered signals**

```svelte
<script lang="ts">
  let value: 0 | 1 = $state(0);
  let repValues: (0 | 1)[] = $state([0, 0, 0, 0]);
  let pendingTimeouts: ReturnType<typeof setTimeout>[] = [];

  function triggerSignal() {
    for (const id of pendingTimeouts) clearTimeout(id);
    pendingTimeouts = [];

    representations.forEach((_, i) => {
      const id = setTimeout(() => {
        repValues[i] = value;  // Update representation value
      }, params.signalSpeed * (i + 1) / representations.length);
      pendingTimeouts.push(id);
    });
  }

  export function flip() {
    value = value === 0 ? 1 : 0;
    triggerSignal();
  }

  // Cleanup on destroy
  $effect(() => {
    return () => {
      for (const id of pendingTimeouts) clearTimeout(id);
    };
  });

  // Measure SVG path lengths for stroke animation
  let pathEls: SVGPathElement[] = $state([]);
  let pathLengths: number[] = $state([0, 0, 0, 0]);

  $effect(() => {
    if (pathEls.length > 0) {
      pathLengths = pathEls.map(p => p ? p.getTotalLength() : 0);
    }
  });
</script>

{#if containerWidth > 0}
  <svg class="wires" viewBox="0 0 {containerWidth} {containerHeight}">
    {#each representations as _, i}
      <!-- Signal wire animates stroke-dashoffset -->
      <path
        bind:this={pathEls[i]}
        d={d}
        stroke="var(--color-accent)"
        stroke-dasharray={pathLengths[i]}
        stroke-dashoffset={repValues[i] === value ? 0 : pathLengths[i]}
        style="transition: stroke-dashoffset {params.signalSpeed}ms ease;"
        opacity={repValues[i] === value ? 0.8 : 0}
      />
    {/each}
  </svg>
{/if}
```

**Key Principles**:
- SVG curves render via `{#each}` with computed Bezier paths
- `getTotalLength()` on SVG paths for stroke-dash sizing
- Bind path elements to measure them: `bind:this={pathEls[i]}`
- `stroke-dasharray` and `stroke-dashoffset` for animation (pure CSS, no JS animation)
- `setTimeout()` for staggered signal cascades
- Cleanup timeouts in `$effect()` return function

---

### 3. Widget Structure Template

**Example: Counter** (`/Users/alan/Desktop/CrowCode/site/src/components/widgets/Counter.svelte`)

```svelte
<script lang="ts">
  import type { Param } from '../../lib/params';
  import { loadParams, saveParams } from '../../lib/params';
  import WidgetDebugPanel from '../debug/WidgetDebugPanel.svelte';

  const WIDGET_ID = 'counter';  // Unique ID for localStorage

  const paramDefs: Param[] = [
    { name: 'stepSize', value: 1, unit: '', category: 'behavior', min: 1, max: 10, step: 1, description: 'Increment per click' },
    { name: 'fontSize', value: 2.5, unit: 'rem', category: 'style', min: 1, max: 8, step: 0.25, description: 'Count display size' },
    // ... more params
  ];

  let params = $state(loadParams(WIDGET_ID, paramDefs));
  let count = $state(0);
  let doubled = $derived(count * 2);

  // Imperative API
  export function reset() { count = 0; }
  export function setCount(value: number) { count = value; }
</script>

<div
  class="counter"
  style="
    --counter-font-size: {params.fontSize}rem;
    --counter-padding: {params.padding}rem;
    ... other params
  "
>
  <!-- Widget content -->
  <WidgetDebugPanel defs={paramDefs} bind:values={params} widgetId={WIDGET_ID} />
</div>

<style>
  .counter {
    /* Use scoped custom properties, never reference global --space-* or layout tokens */
    padding: var(--counter-padding);
    font-size: var(--counter-font-size);
  }
</style>
```

**Checklist**:
- ✓ Unique `WIDGET_ID` for localStorage
- ✓ `paramDefs` array with all tunable params
- ✓ `loadParams(WIDGET_ID, paramDefs)` on init
- ✓ All style params → scoped CSS custom properties (e.g., `--widget-name-param`)
- ✓ Behavioral params → used directly in JS
- ✓ `export function` for imperative API
- ✓ `<WidgetDebugPanel>` included unconditionally (gated in component)
- ✓ Widget styles never reference global `--space-*`, `--radius-*`, or layout width tokens
- ✓ Can use non-spatial globals: `--color-*`, `--font-*`, `--transition-*`

---

### 4. Debug Panel System

**WidgetDebugPanel** (`/Users/alan/Desktop/CrowCode/site/src/components/debug/WidgetDebugPanel.svelte`)

- Reusable component, takes `defs`, `values`, `widgetId`
- Groups params by category
- Range sliders with real-time sync via `bind:values`
- Copy button generates param definition code
- Reset per-param or all at once
- Gated behind `import.meta.env.DEV` — removed from production
- Freezes its own token defaults so global slider changes don't affect it

**GlobalDebugPanel** (`/Users/alan/Desktop/CrowCode/site/src/components/debug/DebugPanel.svelte`)

- Fixed position (bottom-right corner)
- Toggle with `Ctrl+.` or button
- Sliders for all spatial tokens from `tokens.ts`
- Persists overrides to localStorage
- Also has copy/reset functionality

**Key**: The two panels are independent. Global panel controls page-level layout. Widget panels control individual widget styling.

---

## Section Composition Pattern

**Location**: `/Users/alan/Desktop/CrowCode/site/src/components/sections/`

**Structure**:

```svelte
<script lang="ts">
  import Figure from '../../essay/Figure.svelte';
  import SingleBit from '../../widgets/SingleBit.svelte';
  import BitRepresenter from '../../widgets/BitRepresenter.svelte';

  let singleBit: ReturnType<typeof SingleBit>;
  let bitRepresenter: ReturnType<typeof BitRepresenter>;
</script>

<section>
  <div class="prose">
    <h2 id="what-is-a-bit">What Is a Bit?</h2>
    <p>
      This is a bit.
      <button class="action" onclick={() => singleBit.flip()}>Click it to flip it!</button>
    </p>
  </div>

  <Figure caption="A single bit — click to flip">
    <SingleBit bind:this={singleBit} />
  </Figure>

  <div class="prose">
    <p>Pretty simple right?</p>
  </div>

  <Figure caption="One bit, many meanings">
    <BitRepresenter bind:this={bitRepresenter} />
  </Figure>
</section>
```

**Key Pattern**:
- Prose lives in `<div class="prose">` (constrained to `--prose-width`: 42rem)
- Widgets live in `<Figure>` components (expand to `--figure-width`: 64rem)
- `bind:this={widget}` captures widget instance
- `<button class="action">` inline text calls `widget.method()`
- Every section's `<h2>` needs `id` attribute for TOC auto-generation
- Sections are Svelte components, not Markdown — prose and widget refs share scope

**Figure Component** (`/Users/alan/Desktop/CrowCode/site/src/components/essay/Figure.svelte`):
```svelte
<figure class="figure">
  {@render children()}
  {#if caption}
    <figcaption class="figure-caption">{caption}</figcaption>
  {/if}
</figure>

<style>
  .figure {
    max-width: var(--figure-width);  // Layout token
    margin-block: var(--space-2xl);  // Spacing token
    padding: var(--space-lg);        // Spacing token
  }
</style>
```

---

## Design Token System

**Spatial Tokens** (`/Users/alan/Desktop/CrowCode/site/src/lib/tokens.ts`)

Defined as typed objects with value, unit, category, slider constraints:

```typescript
export interface Token {
  name: string;     // CSS custom property name
  value: number;    // Default numeric value
  unit: string;     // 'rem', 'px'
  category: string; // 'spacing', 'layout', 'radii'
  min: number;      // Slider min
  max: number;      // Slider max
  step: number;     // Increment
  description: string; // Tooltip
}
```

**Spacing Scale** (8-step):
- `--space-xs`: 0.25rem
- `--space-sm`: 0.5rem
- `--space-md`: 1rem
- `--space-lg`: 1.5rem
- `--space-xl`: 2rem
- `--space-2xl`: 3rem
- `--space-3xl`: 4rem

**Layout Widths**:
- `--prose-width`: 42rem (text columns)
- `--figure-width`: 64rem (interactive figures)
- `--sidebar-width`: 16rem (TOC)

**Radii**:
- `--radius-sm`: 4px
- `--radius-md`: 8px
- `--radius-lg`: 12px

**Non-Spatial Tokens** (`/Users/alan/Desktop/CrowCode/site/src/styles/global.css`):

Colors, typography, transitions (do NOT use numeric sliders):
```css
--color-bg: #0f1117;
--color-bg-raised: #181b24;
--color-border: #2a2f3e;
--color-text: #e2e4e9;
--color-text-muted: #8b90a0;
--color-accent: #4d9fff;
--color-highlight: #f5a623;

--font-body: 'Inter', system-ui, sans-serif;
--font-mono: 'JetBrains Mono', monospace;

--transition-fast: 150ms ease;
--transition-normal: 250ms ease;
```

**Critical Rule** (from CLAUDE.md):
> Widgets must NOT reference global spatial tokens (`--space-*`, `--radius-*`, layout widths). All numeric styling comes from the widget's own `paramDefs`. Non-spatial globals (`--color-*`, `--font-*`, `--transition-*`) are fine.

This separation ensures:
- Global debug panel controls only page layout
- Widget debug panels control only widget styling
- Zero leakage between layers

---

## Hydration & Performance

**Astro Client Directives**:
- `client:visible` — JS loads when scrolled into viewport (most sections)
- `client:load` — JS loads at page init (above-the-fold)
- `client:idle` — JS loads when browser idle (TOC, non-critical)
- (none) — Static-only, no JS

**Optimization Patterns**:
1. Visibility observers to pause animations offscreen (BitMatrix)
2. `document.hidden` check in animation loops
3. `content-visibility: auto` on grid containers
4. `IntersectionObserver` with generous rootMargin for early detection
5. Cancel objects to abort timeouts/intervals on cleanup

---

## Architecture Decision Records (ADRs)

**ADR 001: Spatial tokens in TypeScript** (`/Users/alan/Desktop/CrowCode/docs/decisions/001-tokens-in-typescript.md`)

*Why not parse CSS at runtime?*
- Cross-origin stylesheets throw `SecurityError`
- Astro's CSS bundling can mangle selectors
- No reliable way to infer slider ranges from CSS values

*Decision*: Spatial tokens defined in `tokens.ts` with explicit shape. `BaseLayout.astro` generates CSS at build time. `DebugPanel.svelte` reads the same array. Single source of truth, type-safe, debug panel always in sync.

**ADR 002: Per-widget tunable parameters** (`/Users/alan/Desktop/CrowCode/docs/decisions/002-per-widget-params.md`)

*Why not a central registry?*
- Couples widgets, defeats independence
- Requires editing shared file for each param

*Decision*: Each widget defines `paramDefs` inline. Reusable `WidgetDebugPanel` renders sliders. Style params flow via scoped CSS custom properties. Behavioral params used directly in JS. localStorage per widget.

---

## No Canvas/WebGL Usage

**Current Animation Approaches**:
1. **CSS animations** triggered by class toggles (BitMatrix glow)
2. **CSS transitions** on SVG stroke properties (BitRepresenter signal wires)
3. **setInterval** for batch DOM updates (BitMatrix cell flips)
4. **SVG `getTotalLength()`** for stroke-dash sizing

No Canvas or WebGL is currently used. All animations are DOM + CSS driven, which keeps the codebase simple and the bundle tiny.

---

## For Your New Chapter

### Anticipated Widgets

**Sin Wave Animation (bits → numbers)**
- Likely needs continuous animation (use `requestAnimationFrame` OR `setInterval` with visible gate)
- Multiple animated sine curves (DOM or SVG)
- Real-time param adjustment (wave amplitude, frequency, phase)
- Params: waveHeight, frequency, animationSpeed, ...

**Number-to-Representation Mappings (RGB, characters, audio)**
- RGB widget: three sliders → color swatch + hex value
- Character widget: number input → ASCII character + visual representation
- Audio widget: sine wave oscillator (Web Audio API?) or visualizer
- Params: fontSize, colorSize, ...

**RAM Visualization (byte grid + CPU wires)**
- Similar grid structure to BitMatrix but with addresses/values
- CPU wires (like BitRepresenter) connecting addresses
- Transformations between views (linear → 2D grid)
- Params: cellSize, wireSpeed, gridLayout, ...

**Variable/Memory Viewer (code + dual memory views)**
- Code panel (left) + memory views (right)
- Inline execution stepping
- Highlight corresponding memory cells
- Params: fontSize, cellSize, highlightDuration, ...

### Recommended Patterns for These Widgets

1. **Use the BitMatrix pattern** for grid-based rendering (RAM, memory viewer)
   - Direct DOM element arrays for fast mutation
   - Typed data stores (Uint8Array or custom structs)
   - Visibility observers to pause offscreen

2. **Use the BitRepresenter pattern** for wired connections
   - SVG curves with computed paths
   - `getTotalLength()` for animations
   - `stroke-dashoffset` transitions for signal flow

3. **For continuous animation** (sin wave, oscillators)
   - Use `requestAnimationFrame()` if sub-16ms precision needed
   - Or `setInterval()` with visibility gate (simpler)
   - Canvas only if rendering thousands of primitives (unlikely here)

4. **Param system**
   - Every tunable value → `paramDefs` entry
   - Categories: 'style', 'behavior', 'animation'
   - Include descriptions for helpful tooltips

5. **Sections**
   - Prose interspersed with figures
   - Use `bind:this` for widget control from text
   - Every `<h2>` needs unique `id` for TOC

---

## File Paths (All Absolute)

**Source Files**:
- `/Users/alan/Desktop/CrowCode/site/src/lib/params.ts` — Param interface
- `/Users/alan/Desktop/CrowCode/site/src/lib/tokens.ts` — Token definitions + CSS generation
- `/Users/alan/Desktop/CrowCode/site/src/components/debug/WidgetDebugPanel.svelte` — Reusable widget param sliders
- `/Users/alan/Desktop/CrowCode/site/src/components/debug/DebugPanel.svelte` — Global token sliders
- `/Users/alan/Desktop/CrowCode/site/src/components/widgets/BitMatrix.svelte` — DOM mutation + interval animation example
- `/Users/alan/Desktop/CrowCode/site/src/components/widgets/BitRepresenter.svelte` — SVG + stroke animation example
- `/Users/alan/Desktop/CrowCode/site/src/components/widgets/Counter.svelte` — Basic widget template
- `/Users/alan/Desktop/CrowCode/site/src/components/essay/Figure.svelte` — Figure container
- `/Users/alan/Desktop/CrowCode/site/src/styles/global.css` — Non-spatial tokens, prose, reset
- `/Users/alan/Desktop/CrowCode/site/src/layouts/BaseLayout.astro` — HTML shell + token injection
- `/Users/alan/Desktop/CrowCode/site/src/layouts/EssayLayout.astro` — TOC + essay container
- `/Users/alan/Desktop/CrowCode/CLAUDE.md` — Architecture rules (follow these exactly)

**Decision Records**:
- `/Users/alan/Desktop/CrowCode/docs/decisions/001-tokens-in-typescript.md`
- `/Users/alan/Desktop/CrowCode/docs/decisions/002-per-widget-params.md`

---

## Key Takeaways

1. **Widgets are self-contained**: No global state, export imperative methods, define own params
2. **Separation of concerns**: Widgets never reference global spatial tokens; global panel controls page layout only
3. **Param system drives debug UI**: Define `paramDefs` array → `WidgetDebugPanel` auto-renders sliders
4. **Sections compose prose + widgets**: Use `bind:this` + `<button class="action">` for interactivity
5. **Performance first**: Visibility observers, `document.hidden` checks, interval gates
6. **Animations are DOM + CSS**: No Canvas/WebGL. CSS animations + SVG curves + interval-driven DOM updates
7. **Single source of truth**: `tokens.ts` for spatial design, `paramDefs` in widgets for params, `CLAUDE.md` for rules
8. **Type safety**: All tokens and params use typed interfaces, no stringly-typed values
9. **Development experience**: Two debug panels (global + per-widget) with real-time adjustment + localStorage persistence
10. **Follow CLAUDE.md strictly**: It overrides all other patterns; read it before making design decisions

---

## Testing Strategy

- **Sandbox pages** at `/sandbox/` for isolated widget development
- Each widget gets a dedicated sandbox: `/Users/alan/Desktop/CrowCode/site/src/pages/sandbox/widget-name.astro`
- Sandbox pattern: Minimal page with widget + debug panel, no prose
- Develop in sandbox, integrate into essay via sections

---

## Deployment & Build

- `npm run dev` — Dev server with debug panels + HMR
- `npm run build` — Production build (removes all `import.meta.env.DEV` code)
- `npm run preview` — Local preview of production build
- All debug panels + localStorage params are tree-shaken from production

No external dependencies beyond Astro, Svelte, and `@astrojs/svelte`. Pure web standards (SVG, CSS animations, DOM APIs).
