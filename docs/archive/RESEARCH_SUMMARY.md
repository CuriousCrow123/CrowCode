# CrowCode Repository Research — Executive Summary

**Date**: March 4, 2026
**Project**: Astro 5 + Svelte 5 Visual Essay Template
**Scope**: Widget architecture, animation patterns, state management, debug system

---

## Overview

CrowCode is a minimal visual essay platform (3 dependencies: Astro, Svelte, @astrojs/svelte) designed for building interactive, prose-interleaved pages. The architecture is exceptionally clean: a tight separation of concerns between design tokens, widgets, sections, and pages.

For your new chapter (bits → numbers, RAM visualization, memory viewer), this means:
1. Build widgets in isolation with their own parameters
2. Compose them into sections with prose
3. Use the debug system to tune in real-time
4. No global state pollution, no coupling

---

## The Three Pillars

### 1. Design Tokens (Single Source of Truth)

**File**: `/Users/alan/Desktop/CrowCode/site/src/lib/tokens.ts`

Spatial tokens (spacing, layout widths, radii) are TypeScript objects, not CSS:

```typescript
{ name: '--space-lg', value: 1.5, unit: 'rem', category: 'spacing', min: 0, max: 4, step: 0.125, description: '...' }
```

Why TS, not CSS?
- Build-time injection into `BaseLayout.astro` → CSS custom properties
- Debug panel reads the same array → always in sync
- Type-safe, self-documenting, zero runtime discovery needed

Non-spatial tokens (colors, fonts, transitions) stay in `global.css` because they don't benefit from slider adjustment.

**Critical Rule**: Widgets NEVER reference global spatial tokens. All numeric styling comes from widget-owned params.

---

### 2. Widget Parameters (Per-Widget Tuning)

**File**: `/Users/alan/Desktop/CrowCode/site/src/lib/params.ts`

Each widget defines a `paramDefs` array:

```typescript
const paramDefs: Param[] = [
  { name: 'fontSize', value: 2.5, unit: 'rem', category: 'style', min: 1, max: 8, step: 0.25, description: '...' }
];

let params = $state(loadParams('my-widget', paramDefs));
```

Style params → scoped CSS custom properties:
```svelte
<div style="--my-widget-font-size: {params.fontSize}rem">
  <span style="font-size: var(--my-widget-font-size)">Text</span>
</div>
```

Behavioral params → used directly in JS:
```svelte
setInterval(() => { /* use params.updateSpeed */ }, params.updateSpeed);
```

The `WidgetDebugPanel` auto-generates sliders from these definitions. Zero manual debug UI coding.

---

### 3. Section Composition (Prose + Widgets)

**Pattern**: Svelte components, not Markdown

```svelte
<script>
  import Figure from '...';
  import MyWidget from '...';

  let myWidget: ReturnType<typeof MyWidget>;
</script>

<section>
  <div class="prose">
    <h2 id="section-id">Title</h2>
    <p>
      Prose text with
      <button class="action" onclick={() => myWidget.reset()}>action link</button>
    </p>
  </div>

  <Figure caption="Widget caption">
    <MyWidget bind:this={myWidget} />
  </Figure>
</section>
```

Key points:
- Prose in `<div class="prose">` (constrained to 42rem)
- Figures in `<Figure>` (expand to 64rem)
- `bind:this` captures widget instance
- `<button class="action">` = inline text triggering widget methods
- Every `<h2>` needs `id` for TOC auto-generation
- Sections are compiled Svelte, not Markdown — prose and code share scope

---

## Animation Patterns

### Interval-Based Grid (BitMatrix style)

Best for: RAM visualization, memory grids, cell-based data

```svelte
let cells: Uint8Array;
let cellEls: HTMLSpanElement[] = [];
let isVisible = $state(true);

// Visibility observer → pause when offscreen
$effect(() => {
  const observer = new IntersectionObserver(
    ([entry]) => { isVisible = entry.isIntersecting; },
    { threshold: 0, rootMargin: '100px 0px' }
  );
  observer.observe(gridEl);
  return () => observer.disconnect();
});

// Animation loop → only runs when visible + tab is active
$effect(() => {
  if (!isVisible || document.hidden) return;

  const id = setInterval(() => {
    // Update data
    cells[idx] ^= 1;
    cellEls[idx].textContent = String(cells[idx]);

    // Trigger CSS animation by toggling class
    cellEls[idx].classList.remove('animating');
    void cellEls[idx].offsetWidth;  // Force reflow
    cellEls[idx].classList.add('animating');
  }, params.updateSpeed);

  return () => clearInterval(id);
});
```

Key points:
- Direct DOM element array for mutation speed
- Typed data store (Uint8Array) separate from DOM
- Visibility observer prevents offscreen rendering
- `document.hidden` check respects browser focus
- Class toggle + reflow forces animation retrigger
- Cleanup via return from `$effect()`

---

### SVG Signal Animation (BitRepresenter style)

Best for: Wired connections, signal propagation, cascading updates

```svelte
let pathEls: SVGPathElement[] = $state([]);
let pathLengths: number[] = $state([0, 0, 0]);
let signalValues: (0 | 1)[] = $state([0, 0, 0]);

// Measure paths
$effect(() => {
  pathLengths = pathEls.map(p => p ? p.getTotalLength() : 0);
});

// Trigger signal cascade
function sendSignal() {
  signalValues[0] = 1;
  setTimeout(() => { signalValues[0] = 0; }, duration);
  setTimeout(() => { signalValues[1] = 1; }, duration * 0.5);
  // ...
}

// Cleanup timeouts on unmount
$effect(() => {
  return () => {
    for (const id of pendingTimeouts) clearTimeout(id);
  };
});
```

SVG markup:
```svelte
<svg>
  {#each paths as _, i}
    <path
      bind:this={pathEls[i]}
      d={pathData}
      stroke-dasharray={pathLengths[i]}
      stroke-dashoffset={signalValues[i] ? 0 : pathLengths[i]}
      style="transition: stroke-dashoffset {duration}ms ease;"
    />
  {/each}
</svg>
```

Key points:
- `getTotalLength()` to measure SVG paths
- `bind:this` elements to capture refs
- `stroke-dashoffset` for animation (pure CSS)
- Timeouts for staggered signal cascade
- Cleanup timeouts in effect return

---

### Continuous Canvas Animation (Sin Wave style)

Best for: Mathematical graphs, oscillators, smooth curves

```svelte
let canvas: HTMLCanvasElement;
let isVisible = $state(true);
let frame = 0;

$effect(() => {
  if (!isVisible || !canvas) return;

  const ctx = canvas.getContext('2d')!;
  const cancel = { canceled: false };

  const id = setInterval(() => {
    if (cancel.canceled || document.hidden) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw frame based on frame counter
    for (let x = 0; x < canvas.width; x += 2) {
      const y = canvas.height / 2 + Math.sin(frame * freq + x) * amp;
      // Draw point...
    }

    frame += 1;
  }, params.speed);

  return () => { cancel.canceled = true; clearInterval(id); };
});
```

Key points:
- Frame counter for time progression
- `document.hidden` check prevents rendering when inactive
- Visibility observer gates the loop
- Cleanup via return function
- Canvas width/height match display (DPI-aware)

---

## Widget Structure Checklist

Every widget needs:

1. **WIDGET_ID** (unique string for localStorage)
2. **paramDefs** (array of tunable params)
3. **loadParams()** on init (restore from localStorage)
4. **$state** for reactive data
5. **$derived** for computed values
6. **export function** for imperative API (prose control)
7. **<WidgetDebugPanel>** included unconditionally (gates itself)
8. **Scoped CSS custom properties** for style params
9. **No global token references** in styles
10. **Cleanup functions** in $effect() returns

---

## Debug System

### Global Debug Panel (`DebugPanel.svelte`)
- Toggle: bottom-right corner or `Ctrl+.`
- Sliders for all spatial tokens from `tokens.ts`
- Persists to localStorage
- Freezes its own token defaults (doesn't affect itself)

### Per-Widget Debug Panel (`WidgetDebugPanel.svelte`)
- Gear icon in each widget's top-right corner
- Renders sliders for `paramDefs`
- Copy button generates param definitions
- Reset per-param or all
- Gated behind `import.meta.env.DEV` (removed in production)

Both are fully independent. No leakage between layers.

---

## Key Files (All Absolute Paths)

**Core Systems**:
- `/Users/alan/Desktop/CrowCode/site/src/lib/tokens.ts` — Spatial token definitions
- `/Users/alan/Desktop/CrowCode/site/src/lib/params.ts` — Widget param interface + helpers
- `/Users/alan/Desktop/CrowCode/site/src/styles/global.css` — Non-spatial tokens, reset, prose
- `/Users/alan/Desktop/CrowCode/site/src/layouts/BaseLayout.astro` — HTML shell + token injection
- `/Users/alan/Desktop/CrowCode/site/src/layouts/EssayLayout.astro` — TOC + essay container

**Debug Components**:
- `/Users/alan/Desktop/CrowCode/site/src/components/debug/DebugPanel.svelte` — Global tokens
- `/Users/alan/Desktop/CrowCode/site/src/components/debug/WidgetDebugPanel.svelte` — Per-widget params

**Example Widgets**:
- `/Users/alan/Desktop/CrowCode/site/src/components/widgets/Counter.svelte` — Simple interactive
- `/Users/alan/Desktop/CrowCode/site/src/components/widgets/BitMatrix.svelte` — DOM grid animation
- `/Users/alan/Desktop/CrowCode/site/src/components/widgets/BitRepresenter.svelte` — SVG wiring

**Example Sections**:
- `/Users/alan/Desktop/CrowCode/site/src/components/sections/bits/WhatIsABit.svelte` — Prose + widgets
- `/Users/alan/Desktop/CrowCode/site/src/components/sections/example/InteractiveDemo.svelte` — Template

**Project Rules**:
- `/Users/alan/Desktop/CrowCode/CLAUDE.md` — **READ THIS FIRST** — Architecture rules

**Decisions**:
- `/Users/alan/Desktop/CrowCode/docs/decisions/001-tokens-in-typescript.md` — Why TS tokens
- `/Users/alan/Desktop/CrowCode/docs/decisions/002-per-widget-params.md` — Why per-widget params

---

## For Your New Chapter

### Anticipated Widgets

1. **Sin Wave** (bits → continuous animation)
   - Canvas-based continuous animation
   - Params: frequency, amplitude, speed
   - Use `setInterval()` with visibility gate

2. **RGB Viewer** (representation mapping → colors)
   - Three sliders → color swatch
   - Canvas per channel for visualization
   - Params: r, g, b (behavior), swatchSize (style)

3. **Character Encoder** (representation → ASCII)
   - Number input → character display + visual representation
   - Simple state, no animation
   - Params: fontSize, cellSize

4. **RAM Grid** (memory visualization)
   - 16x16 grid of bytes
   - Similar to BitMatrix but with addresses
   - Params: cellSize, updateInterval
   - Use interval-based grid pattern

5. **CPU Wires** (connections)
   - SVG lines from CPU to Memory
   - Signal propagation animation
   - Use SVG signal pattern from BitRepresenter

6. **Memory Viewer** (code + dual views)
   - Left: code editor simulation
   - Right: memory grid (stack + heap)
   - Highlights as execution steps
   - Composite widget using above patterns

### Development Workflow

1. Create widget file: `/site/src/components/widgets/YourWidget.svelte`
2. Create sandbox: `/site/src/pages/sandbox/your-widget.astro`
3. Develop in sandbox with debug panel
4. Create section: `/site/src/components/sections/topic/YourSection.svelte`
5. Integrate into essay page
6. Test accessibility, performance, responsiveness

---

## Documentation Generated

| Document | Purpose |
|----------|---------|
| `RESEARCH_PATTERNS.md` | Deep analysis of all patterns, architecture, conventions |
| `WIDGET_IMPLEMENTATION_GUIDE.md` | Distilled checklist + templates for new widgets |
| `ANIMATION_PATTERNS.md` | Detailed code examples for each animation style |
| `RESEARCH_SUMMARY.md` | This document — executive summary |

---

## Critical Constraints (From CLAUDE.md)

These override all other patterns:

1. **Widgets never reference global spatial tokens** (`--space-*`, `--radius-*`, layout widths)
2. **All widget numeric styling comes from widget's own paramDefs**
3. **Non-spatial globals are fine** (`--color-*`, `--font-*`, `--transition-*`)
4. **Widgets include `<WidgetDebugPanel>` unconditionally** (it gates itself)
5. **Style params flow via scoped CSS custom properties** (e.g., `--widget-name-param`)
6. **Behavioral params used directly in JS**
7. **Sections are Svelte components, not Markdown** (prose and code share scope)
8. **Every section's `<h2>` needs `id` for TOC** auto-generation
9. **No Canvas or WebGL currently used** — DOM + CSS + SVG animations
10. **Three dependencies only** — keep it minimal

---

## Quick Reference: Creating a New Widget

```bash
# 1. Create widget
# File: /Users/alan/Desktop/CrowCode/site/src/components/widgets/SinWave.svelte
# Template at: WIDGET_IMPLEMENTATION_GUIDE.md

# 2. Create sandbox
# File: /Users/alan/Desktop/CrowCode/site/src/pages/sandbox/sin-wave.astro
# Template at: WIDGET_IMPLEMENTATION_GUIDE.md

# 3. Create section
# File: /Users/alan/Desktop/CrowCode/site/src/components/sections/numbers/SinWave.svelte
# Template at: WIDGET_IMPLEMENTATION_GUIDE.md

# 4. Develop
npm run dev
# Visit http://localhost:4321/sandbox/sin-wave

# 5. Integrate
# Import section into essay page
# Add sandbox link to /sandbox/index.astro
```

---

## Performance Highlights

- **Visibility observers** pause animations offscreen
- **`document.hidden` checks** respect browser tab focus
- **Uint8Array** for bulk numeric data
- **Direct DOM refs** (cached arrays) vs DOM queries
- **`content-visibility: auto`** on large grids
- **Cleanup functions** prevent memory leaks
- **localStorage persistence** of params (keyed per widget)
- **`import.meta.env.DEV` gating** removes all debug code from production

No memory leaks, no unnecessary renders, no polling.

---

## Testing Checklist

- [ ] Widget renders without errors in sandbox
- [ ] Debug panel appears and adjusts params
- [ ] Params persist across page reload
- [ ] Animation pauses when scrolled out of view
- [ ] Animation pauses when browser tab is hidden
- [ ] No console errors or memory leaks (10s of animation)
- [ ] Responsive on mobile
- [ ] Keyboard navigation works (focus rings)
- [ ] Production build removes debug code

---

## No Canvas/WebGL

Current animations use:
1. **CSS animations** (triggered by class toggles)
2. **CSS transitions** (on SVG stroke properties)
3. **setInterval** (for batch DOM updates)
4. **SVG getTotalLength()** (for stroke-dash sizing)

This keeps the codebase simple and the bundle tiny. Add Canvas/WebGL only if you need to render thousands of primitives per frame.

---

## What's NOT in This Repo

- No dependencies beyond Astro + Svelte
- No animation libraries (Framer Motion, GSAP, etc.)
- No state management (Redux, Zustand, etc.)
- No component libraries
- No Canvas/WebGL (yet)
- No server-side rendering

Everything is vanilla web APIs + CSS + Svelte reactivity.

---

## Recommended Reading Order

1. **CLAUDE.md** (project rules)
2. **RESEARCH_PATTERNS.md** (full architecture)
3. **WIDGET_IMPLEMENTATION_GUIDE.md** (practical checklist)
4. **ANIMATION_PATTERNS.md** (code examples)
5. Source files (copy, modify, iterate)

All paths are absolute and file-safe.

---

## Contact Points

Need clarification on:

- **Token system**: See `/Users/alan/Desktop/CrowCode/site/src/lib/tokens.ts` + `RESEARCH_PATTERNS.md#design-token-system`
- **Widget params**: See `/Users/alan/Desktop/CrowCode/site/src/lib/params.ts` + `WIDGET_IMPLEMENTATION_GUIDE.md`
- **Animation patterns**: See `ANIMATION_PATTERNS.md` + example widgets
- **Section composition**: See `/Users/alan/Desktop/CrowCode/site/src/components/sections/bits/WhatIsABit.svelte`
- **Debug system**: See `DebugPanel.svelte` + `WidgetDebugPanel.svelte`
- **Architecture rules**: See `CLAUDE.md`

---

## Summary

CrowCode is a **opinionated, minimal visual essay platform** designed for rapid interactive development. Its strength is in its clarity: tight separation between design tokens, widgets, sections, and pages. For your new chapter, this means building small, focused widgets and composing them into prose-interleaved sections. The debug system lets you tune everything in real-time.

Key word: **simplicity**. No runtime magic, no invisible dependencies, no configuration files beyond what's shown. Just Svelte components, CSS custom properties, and clean patterns.

Good luck building! 🚀
