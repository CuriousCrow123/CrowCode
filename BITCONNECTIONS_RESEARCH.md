# BitConnections Widget — Repository Research Summary

## Overview
This document provides a systematic analysis of CrowCode's architecture, patterns, and conventions to inform the implementation of a BitConnections widget—a complex widget with drag-to-connect SVG bezier paths.

---

## 1. Architecture & Structure

### Repository Layout
```
site/
├── src/
│   ├── components/
│   │   ├── widgets/           # Self-contained interactive components
│   │   │   ├── Bit.svelte     # Existing bit widget (3D flip card)
│   │   │   └── Counter.svelte # Reference implementation with imperative API
│   │   ├── sections/          # Page sections composing widgets + prose
│   │   │   └── bits/
│   │   │       └── BitIntro.svelte
│   │   ├── essay/             # Layout & navigation helpers
│   │   │   ├── Figure.svelte  # Widget wrapper with captions
│   │   │   └── TableOfContents.svelte
│   │   └── debug/             # Debug panels (dev-only)
│   │       ├── DebugPanel.svelte      # Global token editor
│   │       └── WidgetDebugPanel.svelte # Per-widget param editor
│   ├── lib/
│   │   ├── tokens.ts          # **Single source of truth** for spatial design tokens
│   │   └── params.ts          # Widget parameter definitions & persistence
│   ├── layouts/
│   │   ├── BaseLayout.astro   # HTML root, token injection, global debug panel
│   │   └── EssayLayout.astro  # Essay page wrapper with TOC
│   ├── pages/
│   │   ├── index.astro        # Main page (BitIntro section)
│   │   └── sandbox/
│   │       ├── bit.astro      # Isolated Bit widget development
│   │       └── counter.astro  # Isolated Counter widget development
│   └── styles/
│       └── global.css         # Non-spatial tokens, prose, action buttons
```

### Technology Stack
- **Framework**: Astro 5 + Svelte 5 (runes-based reactivity)
- **CSS**: Scoped per-component + global tokens via CSS custom properties
- **State Management**: Svelte 5 runes (`$state`, `$derived`, `$effect`)
- **Persistence**: localStorage for both tokens and widget params
- **Dev Tools**: Built-in debug panels (token & widget debug UIs)

---

## 2. The Token System (Spatial Design Tokens)

### Core Philosophy
- **Single source of truth**: `site/src/lib/tokens.ts` defines all spatial tokens
- **Automatic propagation**: BaseLayout.astro generates CSS custom properties at build time
- **Debug-driven**: DebugPanel.svelte renders sliders for real-time adjustment

### Token Definition (tokens.ts, lines 31-50)
```typescript
export interface Token {
  name: string;          // e.g. '--space-lg'
  value: number;         // Default numeric value
  unit: string;          // 'rem', 'px', etc.
  category: string;      // 'spacing', 'layout', 'radii'
  min/max/step: number;  // Slider bounds
  description: string;   // Hover tooltip
}

export const tokens: Token[] = [
  // Spacing: --space-xs, --space-sm, --space-md, --space-lg, --space-xl, --space-2xl, --space-3xl
  // Layout: --prose-width, --figure-width, --sidebar-width
  // Radii: --radius-sm, --radius-md, --radius-lg
];
```

### Token Injection (BaseLayout.astro, line 28)
```html
<style set:html={`:root { ${tokensToCss(tokens)} }`}></style>
```
This generates CSS custom properties on the `:root` element before page load.

### Important Constraint: Widget Separation Rule
**Widgets MUST NOT reference global spatial tokens.** This isolation prevents widgets from being affected by the global debug panel's token adjustments.

```typescript
// DON'T DO THIS in a widget:
style="width: var(--space-lg);"  // ❌ Violates separation

// DO THIS instead:
// Define widget-specific params and use scoped CSS vars
style="width: var(--widget-size);"  // ✓ Correct
```

---

## 3. Widget System

### Widget Pattern Overview
Widgets are **self-contained, stateful Svelte components** with:
1. A `paramDefs` array defining tunable parameters
2. Reactive state management with Svelte runes
3. An exported imperative API (exported functions)
4. A `<WidgetDebugPanel>` for dev-time adjustments
5. Scoped CSS custom properties for style params

### Example: Bit Widget (Bit.svelte)

**File**: `/Users/alan/Desktop/CrowCode/site/src/components/widgets/Bit.svelte`

```typescript
const WIDGET_ID = 'bit';

const paramDefs: Param[] = [
  { name: 'cardSize',     value: 8,   unit: 'rem', category: 'style', ... },
  { name: 'fontSize',     value: 3,   unit: 'rem', category: 'style', ... },
  { name: 'borderRadius', value: 12,  unit: 'px',  category: 'style', ... },
  { name: 'perspective',  value: 600, unit: 'px',  category: 'style', ... },
  { name: 'flipDuration', value: 500, unit: 'ms',  category: 'animation', ... },
];

let params = $state(loadParams(WIDGET_ID, paramDefs));

let isFlipped = $state(false);
let isAnimating = $state(false);
let cardEl: HTMLButtonElement;

// Imperative API
export function toggle() { flip(); }
export function reset() { if (isFlipped) flip(); }

function flip() { /* animation logic */ }
```

**Style Integration**:
```html
<button
  style="
    --bit-size: {params.cardSize}rem;
    --bit-font-size: {params.fontSize}rem;
    --bit-radius: {params.borderRadius}px;
  "
>
  <!-- content -->
</button>

<WidgetDebugPanel defs={paramDefs} bind:values={params} widgetId={WIDGET_ID} />
```

### Example: Counter Widget (Counter.svelte)

**File**: `/Users/alan/Desktop/CrowCode/site/src/components/widgets/Counter.svelte`

Demonstrates:
- Mixed param types: `behavior` (stepSize) + `style` (gaps, sizing, typography)
- Derived values: `let doubled = $derived(count * 2);`
- Imperative API: `reset()`, `setCount(value)`
- Non-spatial global tokens are fine: `color: var(--color-accent);`

---

## 4. Widget Parameter System

### Param Interface (params.ts, lines 10-27)
```typescript
export interface Param {
  name: string;         // 'fontSize', 'stepSize', etc.
  value: number;        // Default
  unit: string;         // '', 'rem', 'px', 'ms'
  category: string;     // 'style', 'behavior', 'animation'
  min/max/step: number; // Slider bounds
  description: string;  // Tooltip text
}
```

### Lifecycle
1. **Definition**: Widget defines `paramDefs: Param[]`
2. **Loading**: `loadParams(widgetId, paramDefs)` restores saved overrides from localStorage
3. **Binding**: `bind:values={params}` in WidgetDebugPanel
4. **Persistence**: `saveParams()` called on slider change (WidgetDebugPanel, line 37)

### WidgetDebugPanel Behavior (WidgetDebugPanel.svelte)
- **Visibility**: Only renders in `import.meta.env.DEV` (line 73)
- **Location**: Gear icon in widget's top-right corner
- **UI**: Groups params by category (`style`, `behavior`, `animation`, etc.)
- **Features**:
  - Range sliders for each param
  - Hover tooltips showing descriptions
  - Reset buttons per param or reset-all
  - Copy button to clipboard (useful for snapshot testing)
  - Freezes global tokens so global slider changes don't affect the widget panel itself (line 66-70)

---

## 5. Section & Prose Pattern

### Section Components
Sections are **Svelte components** that:
- Compose widgets + prose
- Use `bind:this` to capture widget references
- Expose imperative APIs via exported functions (if needed)
- Include h2[id] for TOC auto-generation

### Example: BitIntro Section (BitIntro.svelte)

**File**: `/Users/alan/Desktop/CrowCode/site/src/components/sections/bits/BitIntro.svelte`

```svelte
<script lang="ts">
  import Figure from '../../essay/Figure.svelte';
  import Bit from '../../widgets/Bit.svelte';

  let bit: ReturnType<typeof Bit>;
</script>

<section>
  <div class="prose">
    <h2 id="the-bit">The Bit</h2>
    <p>This is a bit. Click it to flip it!</p>
  </div>

  <Figure caption="A single bit">
    <Bit bind:this={bit} />
  </Figure>
</section>
```

### Example: InteractiveDemo Section (with prose control)

**File**: `/Users/alan/Desktop/CrowCode/site/src/components/sections/example/InteractiveDemo.svelte`

Demonstrates prose-driven widget control:
```svelte
<p>
  Prose can interact with widgets. Try:
  <button class="action" onclick={() => counter.setCount(42)}>set to 42</button>
</p>

<Figure caption="A counter widget">
  <Counter bind:this={counter} />
</Figure>
```

The `bind:this={counter}` captures the widget instance, allowing prose buttons to call exported methods.

### Figure Component (Figure.svelte)

**File**: `/Users/alan/Desktop/CrowCode/site/src/components/essay/Figure.svelte`

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  let { caption, children }: { caption?: string; children: Snippet } = $props();
</script>

<figure class="figure">
  {@render children()}
  {#if caption}
    <figcaption class="figure-caption">{caption}</figcaption>
  {/if}
</figure>

<style>
  .figure {
    max-width: var(--figure-width);  /* Global token */
    margin-inline: auto;
    margin-block: var(--space-2xl);   /* Global token */
    padding: var(--space-lg);         /* Global token */
  }
</style>
```

**Key points**:
- Figure uses global tokens (it's not a widget)
- Wraps widgets with optional caption
- Centers content with `--figure-width` constraint

---

## 6. CSS Structure & Styling Patterns

### Global Tokens (global.css)

**File**: `/Users/alan/Desktop/CrowCode/site/src/styles/global.css`

Non-spatial tokens defined at `:root`:
```css
/* Colors */
--color-bg: #0f1117;
--color-bg-raised: #181b24;
--color-bg-surface: #1e2230;
--color-border: #2a2f3e;
--color-text: #e2e4e9;
--color-text-muted: #8b90a0;
--color-accent: #4d9fff;
--color-highlight: #f5a623;
--color-success: #34d399;
--color-error: #f87171;

/* Typography */
--font-body: 'Inter', system-ui, sans-serif;
--font-mono: 'JetBrains Mono', monospace;

/* Transitions */
--transition-fast: 150ms ease;
--transition-normal: 250ms ease;
```

### Prose Styling (global.css, lines 49-113)
```css
.prose {
  max-width: var(--prose-width);
  margin-inline: auto;
  padding-inline: var(--space-lg);
}

.prose h2 {
  font-size: 1.75rem;
  margin-top: var(--space-3xl);
  margin-bottom: var(--space-lg);
  scroll-margin-top: var(--space-xl);
}

/* Code snippets */
.prose code {
  font-family: var(--font-mono);
  background: var(--color-bg-raised);
  padding: 0.15em 0.35em;
  border-radius: var(--radius-sm);
}
```

### Action Buttons (global.css, lines 94-113)
Interactive text that triggers widget methods:
```css
button.action {
  all: unset;
  color: var(--color-accent);
  cursor: pointer;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 3px;
  transition: color var(--transition-fast);
}

button.action:hover {
  color: var(--color-highlight);
}
```

### Widget-Scoped Styles
Each widget uses scoped CSS custom properties:
```svelte
<style>
  .bit {
    perspective: var(--bit-perspective);
  }

  .card {
    width: var(--bit-size);
    height: var(--bit-size);
  }

  .face {
    border-radius: var(--bit-radius);
    font-size: var(--bit-font-size);
  }
</style>
```

---

## 7. Debug Panel System

### Global Debug Panel (DebugPanel.svelte)

**File**: `/Users/alan/Desktop/CrowCode/site/src/components/debug/DebugPanel.svelte`

- **Location**: Fixed bottom-right corner (lines 179-195)
- **Toggle**: `Ctrl+.` keyboard shortcut (line 95)
- **Content**: Sliders for all tokens from `tokens.ts`
- **Grouping**: By category (spacing, layout, radii)
- **Persistence**: localStorage with key `'debug-token-overrides'`
- **Freeze Mechanism**: `freezeTokens()` directive (lines 88-92) prevents cascading of changed tokens within the panel itself

### Widget Debug Panel (WidgetDebugPanel.svelte)

**File**: `/Users/alan/Desktop/CrowCode/site/src/components/debug/WidgetDebugPanel.svelte`

- **Location**: Top-right corner of each widget (gear icon)
- **Visibility**: Dev-only (`import.meta.env.DEV`)
- **Content**: Sliders for widget params from `paramDefs`
- **Grouping**: By category
- **Persistence**: localStorage with key `widget-params-{widgetId}`
- **Freeze Mechanism**: Same pattern as global panel (lines 66-70)
- **Features**: Copy button, reset buttons, hover tooltips

---

## 8. Existing SVG Usage

### TableOfContents Component

**File**: `/Users/alan/Desktop/CrowCode/site/src/components/essay/TableOfContents.svelte`

- Inline SVG icons (20x20)
- Conditional rendering based on state:
  ```svelte
  {#if isOpen}
    <path d="M6 6l8 8M14 6l-8 8" />
  {:else}
    <path d="M3 5h14M3 10h10M3 15h6" />
  {/if}
  ```
- Uses global color token: `stroke="currentColor"`

### WidgetDebugPanel Component

- Inline SVG gear icon (14x14)
- Uses `fill="currentColor"` for color theming
- Defined as embedded `<svg>` with `<path>`

### No Existing Canvas/Bezier Patterns
- No SVG bezier paths or complex SVG overlays found
- No drag/drop interaction patterns in the codebase

---

## 9. Interaction Patterns

### Bit Widget (imperative control)
```typescript
export function toggle() { flip(); }
export function reset() { if (!isFlipped) return; flip(); }
```

### Counter Widget (imperative control)
```typescript
export function reset() { count = 0; }
export function setCount(value: number) { count = value; }
```

### Prose Control Pattern
```html
<button class="action" onclick={() => counter.setCount(42)}>set to 42</button>
```

### Direct Interaction Pattern
Widgets are interactive by default:
- Bit: Click card to flip
- Counter: Click +/− buttons

---

## 10. Sandbox Pages

### Purpose
Isolated development and testing of widgets outside the essay context.

### Bit Sandbox (bit.astro)

**File**: `/Users/alan/Desktop/CrowCode/site/src/pages/sandbox/bit.astro`

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import Bit from '../../components/widgets/Bit.svelte';
---

<BaseLayout title="Sandbox: Bit">
  <main style="padding: var(--space-2xl); max-width: var(--figure-width); margin-inline: auto;">
    <a href="/sandbox">&larr; All widgets</a>
    <h1>Bit</h1>
    <p>A single binary bit...</p>
    <div style="background: var(--color-bg-raised); padding: var(--space-xl); border-radius: var(--radius-lg);">
      <Bit client:load />
    </div>
  </main>
</BaseLayout>
```

### Counter Sandbox (counter.astro)
Similar structure, demonstrates sandboxed widget development with:
- Direct widget instantiation
- Description text
- Visual framing (border, padding)

---

## 11. Page Structure

### Main Page (index.astro)

**File**: `/Users/alan/Desktop/CrowCode/site/src/pages/index.astro`

```astro
---
import EssayLayout from '../layouts/EssayLayout.astro';
import BitIntro from '../components/sections/bits/BitIntro.svelte';
---

<EssayLayout title="CrowCode">
  <BitIntro client:visible />
</EssayLayout>
```

**Breakdown**:
- Uses `EssayLayout` (adds TOC, essay styling)
- Imports section component (`BitIntro`)
- Uses `client:visible` hydration directive (loads JS when visible)

### Layout Hierarchy
```
BaseLayout.astro (root HTML, token injection, global debug panel)
  └─ EssayLayout.astro (essay structure, TOC)
      └─ Section components (e.g., BitIntro.svelte)
          └─ Figure.svelte (widget wrapper)
              └─ Widget (e.g., Bit.svelte)
```

---

## 12. Key Architectural Decisions

### 1. Token Separation
- Global tokens (colors, typography, transitions) in `global.css`
- Spatial tokens (spacing, layout, radii) in `tokens.ts` with auto-injection
- This enables the global debug panel to adjust page layout in real-time

### 2. Widget Param Isolation
- Widgets define their own params, not reliant on global tokens
- Prevents widget appearance from being affected by global slider changes
- Enables independent tuning of each widget

### 3. Imperative Widget API
- Widgets export functions for parent-controlled behavior
- Parents capture widgets via `bind:this`
- Prose can trigger widget methods via `onclick` handlers on action buttons

### 4. Debug Panel Freezing
- Both DebugPanel and WidgetDebugPanel freeze token defaults within their DOM
- Prevents cascading effects when sliders change
- Ensures stable panel UI even as page layout shifts

### 5. Svelte 5 Runes
- Uses modern `$state`, `$derived`, `$effect` for reactivity
- No `onMount`, `onDestroy`, or store subscriptions
- Clean, declarative state management

---

## 13. Recommended Patterns for BitConnections Widget

### 1. Define paramDefs
```typescript
const paramDefs: Param[] = [
  // Behavior
  { name: 'snapToGrid',    value: 1,    unit: 'px',  category: 'behavior', ... },
  { name: 'snapThreshold', value: 20,   unit: 'px',  category: 'behavior', ... },
  // Style
  { name: 'lineWidth',     value: 2,    unit: 'px',  category: 'style',    ... },
  { name: 'lineColor',     value: '#4d9fff', /* non-spatial, use global token */ },
  // Animation
  { name: 'transitionTime', value: 200,  unit: 'ms',  category: 'animation', ... },
];
```

### 2. Track Dragging State
```typescript
let isDragging = $state(false);
let dragStartPos = $state<{ x: number; y: number } | null>(null);
let currentConnections = $state<Connection[]>([]);

type Connection = {
  from: string;     // Source element ID
  to: string;       // Target element ID
  path: string;     // SVG path data (bezier)
};
```

### 3. Handle Pointer Events
- Use `pointerdown`, `pointermove`, `pointerup` for cross-platform compatibility
- Track positions in a `$effect` that updates SVG paths reactively

### 4. SVG Bezier Path Generation
```typescript
function generateBezierPath(
  x1: number, y1: number,
  x2: number, y2: number,
  curvature: number = 0.5
): string {
  const cp1x = x1 + (x2 - x1) * curvature;
  const cp1y = y1;
  const cp2x = x1 + (x2 - x1) * (1 - curvature);
  const cp2y = y2;
  return `M ${x1} ${y1} C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${x2} ${y2}`;
}
```

### 5. Bind to Bit Widget
```svelte
<script lang="ts">
  import Bit from './Bit.svelte';
  import BitConnections from './BitConnections.svelte';

  let bit: ReturnType<typeof Bit>;
</script>

<figure>
  <BitConnections bind:source={bit} />
</figure>
```

### 6. Imperative API
```typescript
export function addConnection(fromId: string, toId: string) {
  // Add to connections array
}

export function removeConnection(fromId: string, toId: string) {
  // Remove from connections array
}

export function clearConnections() {
  currentConnections = [];
}
```

---

## 14. File Paths Reference

### Core System Files
- **Token definitions**: `/Users/alan/Desktop/CrowCode/site/src/lib/tokens.ts`
- **Param system**: `/Users/alan/Desktop/CrowCode/site/src/lib/params.ts`
- **Global styles**: `/Users/alan/Desktop/CrowCode/site/src/styles/global.css`

### Debug Components
- **Global debug panel**: `/Users/alan/Desktop/CrowCode/site/src/components/debug/DebugPanel.svelte`
- **Widget debug panel**: `/Users/alan/Desktop/CrowCode/site/src/components/debug/WidgetDebugPanel.svelte`

### Existing Widgets
- **Bit widget**: `/Users/alan/Desktop/CrowCode/site/src/components/widgets/Bit.svelte`
- **Counter widget**: `/Users/alan/Desktop/CrowCode/site/src/components/widgets/Counter.svelte`

### Existing Sections
- **BitIntro section**: `/Users/alan/Desktop/CrowCode/site/src/components/sections/bits/BitIntro.svelte`
- **InteractiveDemo section**: `/Users/alan/Desktop/CrowCode/site/src/components/sections/example/InteractiveDemo.svelte`

### Layout Components
- **Figure wrapper**: `/Users/alan/Desktop/CrowCode/site/src/components/essay/Figure.svelte`
- **Table of Contents**: `/Users/alan/Desktop/CrowCode/site/src/components/essay/TableOfContents.svelte`
- **BaseLayout**: `/Users/alan/Desktop/CrowCode/site/src/layouts/BaseLayout.astro`
- **EssayLayout**: `/Users/alan/Desktop/CrowCode/site/src/layouts/EssayLayout.astro`

### Pages
- **Main page**: `/Users/alan/Desktop/CrowCode/site/src/pages/index.astro`
- **Bit sandbox**: `/Users/alan/Desktop/CrowCode/site/src/pages/sandbox/bit.astro`
- **Counter sandbox**: `/Users/alan/Desktop/CrowCode/site/src/pages/sandbox/counter.astro`

---

## 15. Implementation Checklist for BitConnections

- [ ] Create `/Users/alan/Desktop/CrowCode/site/src/components/widgets/BitConnections.svelte`
- [ ] Define `paramDefs` (behavior params for grid snap, style params for line appearance)
- [ ] Implement SVG overlay with dynamic bezier paths
- [ ] Add pointer event handlers for drag interaction
- [ ] Implement connection state management (add, remove, clear)
- [ ] Implement connection visualization (bezier curve rendering)
- [ ] Add exported imperative API methods
- [ ] Include `<WidgetDebugPanel>`
- [ ] Create `/Users/alan/Desktop/CrowCode/site/src/pages/sandbox/bitconnections.astro` for isolated testing
- [ ] Create section component at `/Users/alan/Desktop/CrowCode/site/src/components/sections/bits/BitConnections.svelte` (if integrating into main essay)
- [ ] Add SVG interactivity testing in debug panel
- [ ] Ensure widget params don't reference global spatial tokens
- [ ] Test with global debug panel open (ensure no coupling)

---

## Summary

The BitConnections widget should:
1. **Define its own params** via `paramDefs` (no global spatial tokens)
2. **Use SVG for bezier visualization** (inline `<svg>` with dynamic `<path>` elements)
3. **Implement drag handlers** via pointer events
4. **Expose imperative methods** for section-level control
5. **Include WidgetDebugPanel** for development
6. **Be wrapped in Figure** when used in prose
7. **Follow color/typography from globals** (non-spatial tokens are fine)
8. **Persist params** via the existing `loadParams`/`saveParams` system

All patterns are demonstrated in existing widgets (Bit, Counter) and sections (BitIntro, InteractiveDemo).
