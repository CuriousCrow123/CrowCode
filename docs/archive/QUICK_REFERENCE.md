# CrowCode Quick Reference Card

**Bookmark this.** All answers are here or in the source files.

---

## Creating a Widget in 90 Seconds

```bash
# 1. Copy template → /site/src/components/widgets/MyWidget.svelte
# 2. Update WIDGET_ID, paramDefs, and component name
# 3. Add sandbox at /site/src/pages/sandbox/my-widget.astro
# 4. Visit http://localhost:4321/sandbox/my-widget
# 5. Develop with debug panel (gear icon, top-right)
```

**Widget Template** (minimal):
```svelte
<script lang="ts">
  import type { Param } from '../../lib/params';
  import { loadParams } from '../../lib/params';
  import WidgetDebugPanel from '../debug/WidgetDebugPanel.svelte';

  const WIDGET_ID = 'my-widget';
  const paramDefs: Param[] = [
    { name: 'fontSize', value: 1.5, unit: 'rem', category: 'style', min: 0.75, max: 3, step: 0.25, description: 'Text size' },
  ];

  let params = $state(loadParams(WIDGET_ID, paramDefs));
  let data = $state(0);

  export function reset() { data = 0; }
</script>

<div style="--my-widget-font-size: {params.fontSize}rem;">
  <p style="font-size: var(--my-widget-font-size);">{data}</p>
  <WidgetDebugPanel defs={paramDefs} bind:values={params} widgetId={WIDGET_ID} />
</div>

<style>
  div {
    position: relative;
    padding: 1rem;
  }
</style>
```

---

## Animation Quick Pick

| Scenario | Pattern | Example |
|----------|---------|---------|
| **Cells/Grid flipping** | Interval + DOM refs + class toggle | BitMatrix |
| **SVG wires lighting up** | SVG getTotalLength() + stroke-dashoffset | BitRepresenter |
| **Continuous sin wave** | Canvas + setInterval() + frame counter | Your Sin Wave |
| **RGB/HSL controls** | Canvas + sliders + real-time redraw | RGB Viewer |

All have visibility observers + `document.hidden` checks.

---

## Param Categories

```typescript
// Style params (via CSS custom properties)
{ name: 'fontSize', ..., category: 'style', unit: 'rem' }

// Behavior params (use directly in JS)
{ name: 'updateSpeed', ..., category: 'behavior', unit: 'ms' }

// Animation params (timing-related)
{ name: 'duration', ..., category: 'animation', unit: 'ms' }

// Interaction params (user input)
{ name: 'sensitivity', ..., category: 'interaction', unit: '' }
```

Units: `''` (unitless), `'rem'`, `'px'`, `'ms'`, `'%'`, `'em'`

---

## Widget Anatomy

```
┌─ Widget File (widget/MyWidget.svelte)
│  ├─ WIDGET_ID = 'my-widget'
│  ├─ paramDefs[] with tunable params
│  ├─ params = $state(loadParams(...))
│  ├─ data = $state(...)
│  ├─ export function reset() { ... }
│  ├─ $effect() for side effects + cleanup
│  ├─ <WidgetDebugPanel> (always included)
│  └─ Styles (use --my-widget-* custom properties)
│
├─ Sandbox (pages/sandbox/my-widget.astro)
│  ├─ Minimal layout
│  ├─ Widget with client:load
│  └─ Link back to /sandbox
│
└─ Section (sections/topic/MySection.svelte)
   ├─ <h2 id="..."> for TOC
   ├─ <div class="prose"> for text
   ├─ <Figure> containers
   ├─ bind:this={widget} on widget components
   └─ <button class="action"> for interactive text
```

---

## Essential Patterns

### Visibility Gate (pause offscreen)
```svelte
let isVisible = $state(true);

$effect(() => {
  const observer = new IntersectionObserver(
    ([entry]) => { isVisible = entry.isIntersecting; },
    { threshold: 0, rootMargin: '100px 0px' }
  );
  observer.observe(element);
  return () => observer.disconnect();
});

// Use isVisible in animation loop
if (!isVisible || document.hidden) return;
```

### Class Toggle Animation
```svelte
element.classList.remove('active');
void element.offsetWidth;  // Force reflow
element.classList.add('active');
```

### Cleanup Pattern
```svelte
$effect(() => {
  const id = setInterval(() => { /* ... */ }, ms);
  return () => clearInterval(id);
});
```

### SVG Measurement
```svelte
let pathEl: SVGPathElement;
let pathLength: number;

$effect(() => {
  if (pathEl) pathLength = pathEl.getTotalLength();
});
```

---

## Never Do This

❌ Reference global tokens in widgets:
```svelte
<style>
  .widget { padding: var(--space-lg); }  // WRONG
</style>
```

✓ Use widget params instead:
```svelte
const paramDefs = [
  { name: 'padding', value: 1, unit: 'rem', ... }
];
<style>
  .widget { padding: var(--my-widget-padding); }  // RIGHT
</style>
```

---

❌ Forget cleanup:
```svelte
$effect(() => {
  setInterval(() => { /* ... */ }, 100);  // LEAK
});
```

✓ Return cleanup function:
```svelte
$effect(() => {
  const id = setInterval(() => { /* ... */ }, 100);
  return () => clearInterval(id);
});
```

---

❌ Query DOM repeatedly:
```svelte
for (let i = 0; i < 100; i++) {
  document.querySelector(`.cell-${i}`).textContent = data[i];  // SLOW
}
```

✓ Cache element refs:
```svelte
let cellEls: HTMLSpanElement[] = [];
for (let i = 0; i < 100; i++) {
  cellEls[i].textContent = data[i];  // FAST
}
```

---

## Section Template

```svelte
<script lang="ts">
  import Figure from '../../essay/Figure.svelte';
  import MyWidget from '../../widgets/MyWidget.svelte';

  let myWidget: ReturnType<typeof MyWidget>;
</script>

<section>
  <div class="prose">
    <h2 id="my-section">Section Title</h2>
    <p>Prose text with <button class="action" onclick={() => myWidget.reset()}>action</button>.</p>
  </div>

  <Figure caption="Figure caption">
    <MyWidget bind:this={myWidget} />
  </Figure>

  <div class="prose">
    <p>More prose after the figure.</p>
  </div>
</section>
```

---

## File Structure

```
site/src/
├── lib/
│   ├── tokens.ts          ← Design tokens (spatial)
│   └── params.ts          ← Widget param interface
├── styles/
│   └── global.css         ← Non-spatial tokens, prose, reset
├── layouts/
│   ├── BaseLayout.astro   ← HTML shell + token injection
│   └── EssayLayout.astro  ← TOC + essay container
├── components/
│   ├── debug/
│   │   ├── DebugPanel.svelte         ← Global tokens (bottom-right)
│   │   └── WidgetDebugPanel.svelte   ← Per-widget params (gear icon)
│   ├── widgets/
│   │   ├── Counter.svelte            ← Copy this
│   │   ├── BitMatrix.svelte          ← Reference for grid animation
│   │   └── BitRepresenter.svelte     ← Reference for SVG animation
│   ├── sections/
│   │   └── bits/WhatIsABit.svelte    ← Copy this
│   └── essay/
│       ├── Figure.svelte             ← Use this (don't modify)
│       └── TableOfContents.svelte    ← Use this (don't modify)
└── pages/
    ├── index.astro                   ← Main essay page
    └── sandbox/
        ├── index.astro               ← Widget catalog
        ├── counter.astro             ← Copy this pattern
        └── bit-matrix.astro          ← Copy this pattern
```

All absolute paths in `/Users/alan/Desktop/CrowCode/site/src/`

---

## Dev Commands

```bash
cd /Users/alan/Desktop/CrowCode/site

npm run dev      # Dev server, HMR, debug panels enabled
npm run build    # Production build (debug code removed)
npm run preview  # Preview production build locally
```

Visit `http://localhost:4321/sandbox/` to see all widgets.

---

## Keyboard Shortcuts

- **`Ctrl+.`** — Toggle global token debug panel
- **Gear icon** (top-right of widget) — Toggle widget debug panel (dev only)

---

## Token Units

| Unit | Use | Example |
|------|-----|---------|
| `''` | Unitless (counts, steps) | `{ name: 'count', unit: '', value: 5 }` |
| `'rem'` | Font-relative (responsive) | `{ name: 'fontSize', unit: 'rem', value: 1.5 }` |
| `'px'` | Absolute pixels | `{ name: 'borderRadius', unit: 'px', value: 8 }` |
| `'ms'` | Milliseconds (timing) | `{ name: 'duration', unit: 'ms', value: 300 }` |
| `'%'` | Percentages | `{ name: 'opacity', unit: '%', value: 80 }` |
| `'em'` | Font-relative (relative) | `{ name: 'letterSpacing', unit: 'em', value: 0.1 }` |

---

## Color Tokens

```css
--color-bg          #0f1117    (page background)
--color-bg-raised   #181b24    (cards, raised)
--color-bg-surface  #1e2230    (interactive surfaces)
--color-border      #2a2f3e    (borders, dividers)
--color-text        #e2e4e9    (primary text)
--color-text-muted  #8b90a0    (secondary text)
--color-accent      #4d9fff    (links, focus, active)
--color-highlight   #f5a623    (hover, emphasis)
--color-success     #34d399    (success states)
--color-error       #f87171    (error states)
```

Use these freely in widgets (they're not controlled by global debug panel).

---

## Typography Tokens

```css
--font-body  'Inter', system-ui, sans-serif        (prose, UI)
--font-mono  'JetBrains Mono', monospace           (code, data)
```

---

## Timing Tokens

```css
--transition-fast    150ms ease    (hover, focus)
--transition-normal  250ms ease    (panels, reveals)
```

---

## Spacing Scale (use in global layouts, NOT in widgets)

```
--space-xs    0.25rem    (tight gaps, inline spacing)
--space-sm    0.5rem     (small padding)
--space-md    1rem       (medium padding)
--space-lg    1.5rem     (large spacing, section gaps)
--space-xl    2rem       (extra-large)
--space-2xl   3rem       (double-large)
--space-3xl   4rem       (triple-large, hero gaps)
```

Widgets NEVER use these. Define your own params instead.

---

## Layout Widths (use in global layouts, NOT in widgets)

```
--prose-width   42rem    (text column max-width)
--figure-width  64rem    (interactive figure max-width)
--sidebar-width 16rem    (TOC sidebar width)
```

Widgets NEVER use these either.

---

## Radii (use in global layouts, NOT in widgets)

```
--radius-sm   4px     (buttons, badges)
--radius-md   8px     (cards, inputs)
--radius-lg   12px    (panels, modals)
```

Widgets NEVER use these. Define your own params if needed.

---

## Test Checklist

- [ ] Widget renders in sandbox
- [ ] Debug panel shows all params
- [ ] Can adjust with sliders
- [ ] Params persist after reload
- [ ] Animation pauses when scrolled out of view
- [ ] Animation pauses when browser tab is hidden
- [ ] No console errors
- [ ] No memory leaks (10s test)
- [ ] Mobile responsive
- [ ] Keyboard navigation works

---

## Common Code Snippets

### Get device pixel ratio for canvas
```typescript
const dpr = window.devicePixelRatio || 1;
canvas.width = canvas.offsetWidth * dpr;
canvas.height = canvas.offsetHeight * dpr;
ctx.scale(dpr, dpr);
```

### Linear interpolation
```typescript
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}
```

### RGB to hex
```typescript
function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}
```

### Clamp value
```typescript
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
```

---

## Files You'll Edit Most

1. `/Users/alan/Desktop/CrowCode/site/src/components/widgets/YourWidget.svelte` ← Your new widgets
2. `/Users/alan/Desktop/CrowCode/site/src/components/sections/topic/YourSection.svelte` ← Prose + composition
3. `/Users/alan/Desktop/CrowCode/site/src/pages/sandbox/your-widget.astro` ← Isolated development
4. `/Users/alan/Desktop/CrowCode/site/src/pages/index.astro` ← Add sections here

Never edit:
- `lib/tokens.ts` (unless adding new global tokens)
- `lib/params.ts` (interface is stable)
- `styles/global.css` (unless adding new colors/fonts)
- Debug components (they're generic)

---

## Reference Examples

Copy and modify these:

- **Simple widget**: `/Users/alan/Desktop/CrowCode/site/src/components/widgets/Counter.svelte`
- **Grid animation**: `/Users/alan/Desktop/CrowCode/site/src/components/widgets/BitMatrix.svelte`
- **SVG animation**: `/Users/alan/Desktop/CrowCode/site/src/components/widgets/BitRepresenter.svelte`
- **Section**: `/Users/alan/Desktop/CrowCode/site/src/components/sections/bits/WhatIsABit.svelte`
- **Sandbox**: `/Users/alan/Desktop/CrowCode/site/src/pages/sandbox/bit-representer.astro`

All absolute paths. Don't reinvent, iterate.

---

## Performance Tips

1. **Use Uint8Array** for bulk numeric data
2. **Cache DOM refs** in arrays (not querySelectors)
3. **Visibility observer** gates animations
4. **Check document.hidden** in loops
5. **Cleanup timeouts/intervals** in $effect returns
6. **Use content-visibility: auto** on large grids
7. **Force reflow sparingly** (offsetWidth)
8. **Batch DOM updates** within single effect

---

## Production

```bash
npm run build
# Outputs to site/dist/

# Everything with import.meta.env.DEV is removed
# Debug panels: GONE
# localStorage params: GONE
# Visibility observers: Still there (good)

npm run preview
# Test production build locally
```

Final size should be tiny (3 deps, no bundles, pure Svelte).

---

## Getting Help

**Architecture questions**: See `/Users/alan/Desktop/CrowCode/CLAUDE.md`
**Full analysis**: See `/Users/alan/Desktop/CrowCode/RESEARCH_PATTERNS.md`
**Widget guide**: See `/Users/alan/Desktop/CrowCode/WIDGET_IMPLEMENTATION_GUIDE.md`
**Animation examples**: See `/Users/alan/Desktop/CrowCode/ANIMATION_PATTERNS.md`
**Source examples**: Copy from widgets directory

---

## One More Thing

The most important rule (from CLAUDE.md):

> **Widgets must NOT reference global spatial tokens (`--space-*`, `--radius-*`, layout widths). All numeric styling comes from the widget's own `paramDefs`.**

This keeps the two debug layers independent. Global panel controls page layout. Widget panels control widget styling. Never mix.

---

Good luck! 🚀
