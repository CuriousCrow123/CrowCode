---
title: "feat: Add Bit flip widget"
type: feat
status: completed
date: 2026-03-09
origin: docs/brainstorms/2026-03-09-bit-widget-brainstorm.md
---

# feat: Add Bit flip widget

A single square card representing a binary bit. Clicking it flips the card with a CSS 3D animation, toggling between 0 and 1. Replaces the existing example sections on the index page.

## Acceptance Criteria

- [x] Bit widget renders a square card showing "0" on the front face
- [x] Clicking the card triggers a 3D Y-axis rotation (180deg) revealing "1" on the back
- [x] Clicking again flips back to "0"
- [x] Clicks are blocked during animation (`pointer-events: none` while transitioning)
- [x] Card is a `<button>` element with `aria-pressed` and `aria-label` for accessibility
- [x] Keyboard: focusable via Tab, activatable via Enter/Space
- [x] `prefers-reduced-motion`: instant state swap, no animation (inherited from global rule)
- [x] Widget debug panel (gear icon) renders with tunable params
- [x] Widget does NOT reference global spatial tokens (`--space-*`, `--radius-*`)
- [x] Sandbox page at `/sandbox/bit` for isolated development
- [x] Index page shows BitIntro section instead of example sections
- [x] Section `<h2 id="the-bit">` present for TOC generation

## Implementation

### 1. `site/src/components/widgets/Bit.svelte` (new)

Widget following established Counter pattern (see brainstorm).

**paramDefs:**

| name | value | unit | category | min | max | step | description |
|------|-------|------|----------|-----|-----|------|-------------|
| cardSize | 8 | rem | style | 3 | 16 | 0.5 | Card width and height |
| fontSize | 3 | rem | style | 1 | 8 | 0.25 | Size of the 0/1 digit |
| flipDuration | 500 | ms | animation | 100 | 2000 | 50 | Flip animation duration |
| borderRadius | 12 | px | style | 0 | 32 | 1 | Card corner rounding |
| perspective | 600 | px | style | 200 | 2000 | 50 | 3D perspective depth |

**DOM structure:**

```html
<div class="bit" style="--bit-perspective: {params.perspective}px">
  <button
    class="card"
    onclick={flip}
    ontransitionend={handleTransitionEnd}
    aria-pressed={isFlipped}
    aria-label="Bit value: {isFlipped ? 1 : 0}"
    style="
      --bit-size: {params.cardSize}rem;
      --bit-font-size: {params.fontSize}rem;
      --bit-radius: {params.borderRadius}px;
      --bit-flip-duration: {params.flipDuration}ms;
      transform: rotateY({rotation}deg);
    "
  >
    <span class="face front">0</span>
    <span class="face back">1</span>
  </button>
  <WidgetDebugPanel ... />
</div>
```

**CSS approach:**
- `.bit` gets `perspective: var(--bit-perspective)` (parent container)
- `.card` gets `transform-style: preserve-3d`, `transition: transform var(--bit-flip-duration)`
- Rotation applied via inline `transform: rotateY({rotation}deg)` (cumulative, always forward)
- `.face` gets `backface-visibility: hidden`, `position: absolute`, `inset: 0`
- `.back` gets `transform: rotateY(180deg)` (pre-rotated)
- Block clicks during animation: `isAnimating` guard in JS, re-enabled on `transitionend`

**Face colors:** Both faces use identical colors (`--color-bg-raised` background, `--color-text` text, `--color-border` border). No color differentiation between 0 and 1.

**State:** Cumulative `rotation` counter incremented by 180 on each click. `isFlipped` derived from `rotation % 360 !== 0`. Always rotates in the same direction.

**Imperative API:**
- `export function toggle()` — flips the bit (always forward)
- `export function reset()` — flips back to 0 if currently 1

### 2. `site/src/components/sections/bits/BitIntro.svelte` (new)

Section following InteractiveDemo pattern.

```
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

### 3. `site/src/pages/sandbox/bit.astro` (new)

Follow existing `sandbox/counter.astro` pattern. Use `client:load`.

### 4. `site/src/pages/sandbox/index.astro` (modify)

Add `<li><a href="/sandbox/bit">Bit</a></li>` to the widget list.

### 5. `site/src/pages/index.astro` (modify)

Replace Introduction + InteractiveDemo imports with BitIntro. Use `client:visible`.

```astro
---
import EssayLayout from '../layouts/EssayLayout.astro';
import BitIntro from '../components/sections/bits/BitIntro.svelte';
---

<EssayLayout title="CrowCode">
  <BitIntro client:visible />
</EssayLayout>
```

## Sources

- **Origin brainstorm:** [docs/brainstorms/2026-03-09-bit-widget-brainstorm.md](docs/brainstorms/2026-03-09-bit-widget-brainstorm.md) — card faces (0/1), 3D CSS flip, replace example sections
- **Widget pattern reference:** [Counter.svelte](site/src/components/widgets/Counter.svelte) — paramDefs, loadParams, WidgetDebugPanel, imperative API
- **Section pattern reference:** [InteractiveDemo.svelte](site/src/components/sections/example/InteractiveDemo.svelte) — bind:this, Figure, action buttons, h2 id
- **Param interface:** [params.ts](site/src/lib/params.ts) — Param type, loadParams, saveParams
- **Architecture rules:** [CLAUDE.md](CLAUDE.md) — widget/global token separation, debug panel conventions
