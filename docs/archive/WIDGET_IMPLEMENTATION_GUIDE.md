# Widget Implementation Guide for New Chapter

**For**: Bits to Numbers, Representation Mapping, RAM Visualization, Memory Viewer

This is a distilled checklist based on existing patterns in the codebase.

---

## Quick Start: Creating a New Widget

### Step 1: Create the widget file
```bash
# Create at: /Users/alan/Desktop/CrowCode/site/src/components/widgets/YourWidget.svelte
```

### Step 2: Copy this template
```svelte
<script lang="ts">
  import type { Param } from '../../lib/params';
  import { loadParams } from '../../lib/params';
  import WidgetDebugPanel from '../debug/WidgetDebugPanel.svelte';

  const WIDGET_ID = 'your-widget';  // e.g., 'sin-wave', 'memory-viewer'

  const paramDefs: Param[] = [
    // Style params (will flow via CSS custom properties)
    { name: 'fontSize',     value: 1.5, unit: 'rem', category: 'style', min: 0.75, max: 3,   step: 0.25, description: 'Label text size' },
    { name: 'cellSize',     value: 2,   unit: 'rem', category: 'style', min: 0.75, max: 4,   step: 0.25, description: 'Grid cell size' },

    // Behavior params (used directly in JS)
    { name: 'updateSpeed',  value: 100, unit: 'ms',  category: 'behavior', min: 16, max: 500, step: 16, description: 'Animation frame interval' },
    { name: 'amplitude',    value: 1,   unit: '',    category: 'behavior', min: 0.1, max: 3,  step: 0.1, description: 'Wave height' },
  ];

  let params = $state(loadParams(WIDGET_ID, paramDefs));

  // Your widget state
  let data = $state(...);

  // Reactive derived values if needed
  let computed = $derived(...);

  // Imperative API for prose-widget interaction
  export function reset() { ... }
  export function doSomething() { ... }
</script>

<div
  class="your-widget"
  style="
    --your-widget-font-size: {params.fontSize}rem;
    --your-widget-cell-size: {params.cellSize}rem;
  "
>
  <!-- Your widget markup -->

  <!-- Always include this, even in DEV only (it gates itself) -->
  <WidgetDebugPanel defs={paramDefs} bind:values={params} widgetId={WIDGET_ID} />
</div>

<style>
  .your-widget {
    position: relative;
    padding: 1rem;
  }

  /* Use scoped custom properties, never --space-* or layout tokens */
  .your-widget {
    font-size: var(--your-widget-font-size);
  }
</style>
```

---

## Animation Patterns

### For Continuous Animation (Sin Waves, Oscillators)

**Option A: `setInterval()` with visibility gate** (recommended, simpler)

```svelte
<script lang="ts">
  let isVisible = $state(true);
  let canvas: HTMLCanvasElement;

  // Effect: Visibility observer
  $effect(() => {
    if (!canvas) return;
    const observer = new IntersectionObserver(
      ([entry]) => { isVisible = entry.isIntersecting; },
      { threshold: 0, rootMargin: '100px 0px' }
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  });

  // Effect: Animation loop
  $effect(() => {
    if (!isVisible || !canvas) return;

    const ctx = canvas.getContext('2d')!;
    let frame = 0;
    const cancel = { canceled: false };

    const id = setInterval(() => {
      if (cancel.canceled || document.hidden) return;

      frame += 1;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw frame based on frame counter
      const x = Math.sin(frame * params.frequency) * params.amplitude;
      // ... draw your content

      frame++;
    }, params.updateSpeed);

    return () => { cancel.canceled = true; clearInterval(id); };
  });
</script>

<canvas bind:this={canvas} width={800} height={400}></canvas>
```

**Option B: `requestAnimationFrame()`** (if sub-16ms precision needed)

```svelte
<script lang="ts">
  let isVisible = $state(true);
  let canvas: HTMLCanvasElement;

  $effect(() => {
    if (!isVisible || !canvas) return;

    const ctx = canvas.getContext('2d')!;
    let frame = 0;
    let rafId: number;
    const cancel = { canceled: false };

    const loop = () => {
      if (cancel.canceled || document.hidden) return;

      frame += 1;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Draw your content

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);

    return () => { cancel.canceled = true; cancelAnimationFrame(rafId); };
  });
</script>
```

### For Grid-Based Animations (RAM, Memory Viewer)

**Follow BitMatrix pattern** — see `/Users/alan/Desktop/CrowCode/site/src/components/widgets/BitMatrix.svelte`

```svelte
<script lang="ts">
  let cells: Uint8Array;
  let cellEls: HTMLSpanElement[] = [];
  let gridEl: HTMLDivElement;
  let isVisible = $state(true);

  // Effect 1: Build grid DOM
  $effect(() => {
    if (!gridEl || containerWidth === 0) return;

    cells = new Uint8Array(rows * cols);
    gridEl.innerHTML = '';
    cellEls = [];

    for (let i = 0; i < cells.length; i++) {
      const span = document.createElement('span');
      span.className = 'cell';
      span.textContent = String(cells[i]);
      span.addEventListener('animationend', () => span.classList.remove('active'));
      gridEl.appendChild(span);
      cellEls.push(span);
    }

    return () => { if (gridEl) gridEl.innerHTML = ''; };
  });

  // Effect 2: Visibility observer
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
    if (!isVisible || !cells) return;

    const cancel = { canceled: false };
    const id = setInterval(() => {
      if (cancel.canceled || document.hidden) return;

      // Update cell data
      const idx = Math.floor(Math.random() * cells.length);
      cells[idx] = (cells[idx] + 1) % 2;
      cellEls[idx].textContent = String(cells[idx]);

      // Trigger CSS animation
      cellEls[idx].classList.remove('active');
      void cellEls[idx].offsetWidth;  // Force reflow to retrigger
      cellEls[idx].classList.add('active');
    }, params.updateSpeed);

    return () => { cancel.canceled = true; clearInterval(id); };
  });
</script>

<div class="grid" bind:this={gridEl}></div>

<style>
  :global(.grid .cell.active) {
    animation: cell-flash 300ms ease-out forwards;
  }

  @keyframes cell-flash {
    0% { background: var(--color-accent); }
    100% { background: transparent; }
  }
</style>
```

---

## SVG Wiring Pattern (for RAM/CPU wires)

**Follow BitRepresenter pattern** — see `/Users/alan/Desktop/CrowCode/site/src/components/widgets/BitRepresenter.svelte`

```svelte
<script lang="ts">
  let containerWidth = $state(0);
  let containerHeight = $state(0);
  let signalValues: number[] = $state([0, 0, 0]);
  let pathEls: SVGPathElement[] = $state([]);
  let pathLengths: number[] = $state([0, 0, 0]);

  // Measure paths
  $effect(() => {
    if (pathEls.length > 0) {
      pathLengths = pathEls.map(p => p ? p.getTotalLength() : 0);
    }
  });

  function sendSignal(targetIndex: number) {
    const delay = params.signalSpeed / signalValues.length;
    signalValues[targetIndex] = 1;
    setTimeout(() => { signalValues[targetIndex] = 0; }, delay);
  }

  export function trigger() { sendSignal(0); }
</script>

<div class="representer" bind:clientWidth={containerWidth} bind:clientHeight={containerHeight}>
  {#if containerWidth > 0}
    <svg class="wires" viewBox="0 0 {containerWidth} {containerHeight}">
      {#each [0, 1, 2] as i}
        {@const startX = 50}
        {@const startY = 50 + i * 100}
        {@const endX = containerWidth - 50}
        {@const endY = startY}
        {@const d = `M ${startX} ${startY} L ${endX} ${endY}`}

        <!-- Resting wire -->
        <path {d} stroke="var(--color-border)" stroke-width="2" />

        <!-- Signal wire -->
        <path
          bind:this={pathEls[i]}
          {d}
          stroke="var(--color-accent)"
          stroke-width="2"
          stroke-dasharray={pathLengths[i]}
          stroke-dashoffset={signalValues[i] ? 0 : pathLengths[i]}
          style="transition: stroke-dashoffset {params.signalSpeed}ms ease;"
          opacity={signalValues[i] ? 0.8 : 0}
        />
      {/each}
    </svg>
  {/if}
</div>

<style>
  .wires {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
</style>
```

---

## Parameter Categories Reference

Use these categories in `paramDefs`:

| Category | Examples | Notes |
|----------|----------|-------|
| `'style'` | fontSize, padding, cellSize, borderRadius | Flows via CSS custom properties |
| `'behavior'` | updateSpeed, amplitude, frequency, batchSize | Used directly in JS logic |
| `'animation'` | duration, delay, easing | Timing-related |
| `'interaction'` | clickThreshold, dragSensitivity | User input |

---

## Param Units Reference

| Unit | Use |
|------|-----|
| `''` (empty) | Unitless (steps, counts, frequencies) |
| `'rem'` | Font-relative sizes (prefer for responsive) |
| `'px'` | Absolute pixel sizes (borders, shadows) |
| `'ms'` | Milliseconds (animation timings) |
| `'%'` | Percentages |
| `'em'` | Font-relative (letter-spacing, etc.) |

---

## State Management Pattern

```svelte
<script lang="ts">
  // Params (from debug panel)
  let params = $state(loadParams(WIDGET_ID, paramDefs));

  // Widget data
  let data = $state([...]);

  // Derived values (recalculated when dependencies change)
  let computed = $derived(data.map(x => x * 2));

  // Complex derived with custom logic
  let result = $derived.by(() => {
    let sum = 0;
    for (const item of data) sum += item;
    return sum / data.length;
  });

  // Imperative updates (only use for events, not rendering)
  export function update(newValue) {
    data = newValue;
  }

  // Reactive effects (cleanup via return)
  $effect(() => {
    if (!data) return;

    const observer = new IntersectionObserver(([entry]) => {
      // Handle intersection
    });
    observer.observe(element);

    return () => observer.disconnect();  // Cleanup
  });
</script>
```

---

## Common Mistakes to Avoid

❌ **Don't** reference global spatial tokens in widgets:
```svelte
<style>
  .widget {
    padding: var(--space-lg);  /* WRONG! */
  }
</style>
```

✓ **Do** define params and use scoped custom properties:
```svelte
const paramDefs: Param[] = [
  { name: 'padding', value: 1.5, unit: 'rem', ... }
];

<style>
  .widget {
    padding: var(--your-widget-padding);  /* RIGHT */
  }
</style>
```

---

❌ **Don't** forget to cleanup effects:
```svelte
$effect(() => {
  const id = setInterval(...);
  // WRONG! No cleanup
});
```

✓ **Do** return cleanup functions:
```svelte
$effect(() => {
  const id = setInterval(...);
  return () => clearInterval(id);
});
```

---

❌ **Don't** poll visibility with setInterval:
```svelte
let isVisible = $state(true);
setInterval(() => {
  isVisible = document.visibilityState === 'visible';
}, 100);
```

✓ **Do** use IntersectionObserver:
```svelte
$effect(() => {
  const observer = new IntersectionObserver(([entry]) => {
    isVisible = entry.isIntersecting;
  });
  observer.observe(element);
  return () => observer.disconnect();
});
```

---

## Section Integration Pattern

### Create a new section file
```bash
# At: /Users/alan/Desktop/CrowCode/site/src/components/sections/numbers/SinWave.svelte
```

### Template
```svelte
<script lang="ts">
  import Figure from '../../essay/Figure.svelte';
  import SinWaveWidget from '../../widgets/SinWave.svelte';

  let sinWave: ReturnType<typeof SinWaveWidget>;
</script>

<section>
  <div class="prose">
    <h2 id="sin-wave">Sine Waves</h2>
    <p>
      A sine wave shows how numbers can vary smoothly over time.
      <button class="action" onclick={() => sinWave.reset()}>Reset the wave</button>.
    </p>
  </div>

  <Figure caption="A sine wave — numbers visualized">
    <SinWaveWidget bind:this={sinWave} />
  </Figure>

  <div class="prose">
    <p>The wave repeats forever, representing continuous change.</p>
  </div>
</section>
```

---

## Sandbox Page Pattern

### Create a sandbox file
```bash
# At: /Users/alan/Desktop/CrowCode/site/src/pages/sandbox/sin-wave.astro
```

### Template
```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import SinWave from '../../components/widgets/SinWave.svelte';
---

<BaseLayout title="Sandbox: Sin Wave">
  <main style="padding: var(--space-2xl); max-width: var(--figure-width); margin-inline: auto;">
    <a href="/sandbox" style="color: var(--color-accent);">&larr; All widgets</a>
    <h1 style="margin-block: var(--space-lg); font-size: 1.75rem;">Sin Wave</h1>
    <p style="color: var(--color-text-muted); margin-bottom: var(--space-xl);">
      A continuous sine wave animation with tunable frequency and amplitude.
    </p>
    <div style="background: var(--color-bg-raised); padding: var(--space-xl); border-radius: var(--radius-lg); border: 1px solid var(--color-border);">
      <SinWave client:load />
    </div>
  </main>
</BaseLayout>
```

### Update sandbox index
Add to `/Users/alan/Desktop/CrowCode/site/src/pages/sandbox/index.astro`:
```astro
<li><a href="/sandbox/sin-wave">Sin Wave</a></li>
```

---

## Testing Checklist

- [ ] Widget renders without errors
- [ ] Debug panel appears in dev mode (bottom-right gear icon)
- [ ] Can adjust all params via sliders
- [ ] Params persist across page reloads
- [ ] Can reset individual params or all at once
- [ ] Can copy params to clipboard
- [ ] Animation plays when visible, pauses when scrolled out of view
- [ ] Animation pauses when browser tab is hidden
- [ ] No memory leaks (intervals/timeouts cleared on unmount)
- [ ] Responsive on mobile (adjust for narrow viewports)
- [ ] Keyboard accessible (focus rings on interactive elements)
- [ ] Respects `prefers-reduced-motion`

---

## Useful Code Snippets

### Force CSS animation retrigger
```svelte
// Remove animation class
element.classList.remove('animating');

// Force reflow
void element.offsetWidth;

// Re-add animation class
element.classList.add('animating');
```

### Get canvas DPI-aware dimensions
```svelte
let canvas: HTMLCanvasElement;

$effect(() => {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.offsetWidth * dpr;
  canvas.height = canvas.offsetHeight * dpr;
  ctx.scale(dpr, dpr);
});
```

### Measure SVG path for stroke animation
```svelte
let pathEl: SVGPathElement;
let pathLength: number;

$effect(() => {
  if (pathEl) pathLength = pathEl.getTotalLength();
});
```

### Simple easing functions (no library needed)
```typescript
// Linear
const linear = (t: number) => t;

// Ease in/out quad
const easeInOutQuad = (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

// Ease out cubic
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
```

### Cleanup pattern for multiple effects
```svelte
<script lang="ts">
  let cleanupFns: (() => void)[] = [];

  function addCleanup(fn: () => void) {
    cleanupFns.push(fn);
  }

  $effect(() => {
    return () => {
      for (const fn of cleanupFns) fn();
      cleanupFns = [];
    };
  });

  // Later:
  addCleanup(() => clearInterval(myInterval));
  addCleanup(() => observer.disconnect());
</script>
```

---

## Performance Tips

1. **Use `Uint8Array` for bulk data** (not arrays of objects)
2. **Batch DOM updates** within a single effect
3. **Use visibility observers** to pause animations offscreen
4. **Cache element refs** in arrays (like `cellEls`)
5. **Avoid frequent `innerHTML`** — use `appendChild` or templating
6. **Use `content-visibility: auto`** on large grids
7. **Check `document.hidden`** before rendering frames
8. **Use `position: absolute`** for overlaid debug panels
9. **Minimize style recalculations** — batch CSS changes

---

## File Checklist

When adding a new widget:

- [ ] Widget file created at `/Users/alan/Desktop/CrowCode/site/src/components/widgets/YourWidget.svelte`
- [ ] Sandbox file created at `/Users/alan/Desktop/CrowCode/site/src/pages/sandbox/your-widget.astro`
- [ ] Sandbox indexed in `/Users/alan/Desktop/CrowCode/site/src/pages/sandbox/index.astro`
- [ ] Section file created at `/Users/alan/Desktop/CrowCode/site/src/components/sections/topic/YourSection.svelte`
- [ ] All params have descriptions and reasonable min/max values
- [ ] All style params use scoped CSS custom properties
- [ ] All behavioral params used directly in JS
- [ ] Effects have cleanup functions
- [ ] No global token references in widget styles
- [ ] Section has `<h2 id="...">` for TOC registration
- [ ] Section uses `bind:this` for widget refs
- [ ] Section uses `<button class="action">` for interactive text
- [ ] All interactive elements have accessible labels/roles

---

## Need Help?

Reference these example files:

- **Simple widget**: `/Users/alan/Desktop/CrowCode/site/src/components/widgets/Counter.svelte`
- **Animation + DOM**: `/Users/alan/Desktop/CrowCode/site/src/components/widgets/BitMatrix.svelte`
- **SVG + signals**: `/Users/alan/Desktop/CrowCode/site/src/components/widgets/BitRepresenter.svelte`
- **Section pattern**: `/Users/alan/Desktop/CrowCode/site/src/components/sections/bits/WhatIsABit.svelte`
- **Sandbox pattern**: `/Users/alan/Desktop/CrowCode/site/src/pages/sandbox/bit-representer.astro`

All absolute paths. Copy, modify, iterate.
