<script lang="ts">
  import type { Param } from '../../lib/params';
  import { loadParams, saveParams } from '../../lib/params';
  import WidgetDebugPanel from '../debug/WidgetDebugPanel.svelte';

  const WIDGET_ID = 'bit';

  const paramDefs: Param[] = [
    // Style
    { name: 'cardSize',     value: 8,   unit: 'rem', category: 'style',     min: 3,   max: 16,   step: 0.5,  description: 'Card width and height' },
    { name: 'fontSize',     value: 3,   unit: 'rem', category: 'style',     min: 1,   max: 8,    step: 0.25, description: 'Size of the 0/1 digit' },
    { name: 'borderRadius', value: 12,  unit: 'px',  category: 'style',     min: 0,   max: 32,   step: 1,    description: 'Card corner rounding' },
    { name: 'perspective',  value: 600, unit: 'px',  category: 'style',     min: 200, max: 2000, step: 50,   description: '3D perspective depth' },
    // Animation
    { name: 'flipDuration', value: 500, unit: 'ms',  category: 'animation', min: 100, max: 2000, step: 50,   description: 'Flip animation duration' },
  ];

  let { onflip }: { onflip?: (value: 0 | 1) => void } = $props();

  let params = $state(loadParams(WIDGET_ID, paramDefs));

  const reducedMotion = typeof window !== 'undefined'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  let isFlipped = $state(false);
  let isAnimating = $state(false);
  let cardEl: HTMLButtonElement;

  function flip() {
    if (isAnimating) return;

    const from = isFlipped ? 180 : 0;
    const to = from + 180;

    isFlipped = !isFlipped;
    onflip?.(isFlipped ? 1 : 0);

    if (reducedMotion?.matches) return;

    isAnimating = true;
    cardEl.animate(
      [
        { transform: `rotateY(${from}deg)` },
        { transform: `rotateY(${to}deg)` },
      ],
      { duration: params.flipDuration, easing: 'ease' },
    ).onfinish = () => {
      isAnimating = false;
    };
  }

  // Imperative API
  export function toggle() {
    flip();
  }

  export function reset() {
    if (!isFlipped) return;
    flip();
  }
</script>

<div
  class="bit"
  style="--bit-perspective: {params.perspective}px;"
>
  <button
    bind:this={cardEl}
    class="card"
    class:flipped={isFlipped}
    onclick={flip}
    aria-pressed={isFlipped}
    aria-label="Bit value: {isFlipped ? 1 : 0}"
    style="
      --bit-size: {params.cardSize}rem;
      --bit-font-size: {params.fontSize}rem;
      --bit-radius: {params.borderRadius}px;
    "
  >
    <span class="face front">0</span>
    <span class="face back">1</span>
  </button>

  <WidgetDebugPanel defs={paramDefs} bind:values={params} widgetId={WIDGET_ID} />
</div>

<style>
  .bit {
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    perspective: var(--bit-perspective);
  }

  .card {
    all: unset;
    position: relative;
    width: var(--bit-size);
    height: var(--bit-size);
    cursor: pointer;
    transform-style: preserve-3d;
  }

  .card.flipped {
    transform: rotateY(180deg);
  }

  .face {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    backface-visibility: hidden;
    border-radius: var(--bit-radius);
    font-family: var(--font-mono);
    font-size: var(--bit-font-size);
    font-weight: 600;
    user-select: none;
  }

  .front {
    background: var(--color-bg-raised);
    color: var(--color-text);
    border: 1px solid var(--color-border);
  }

  .back {
    background: var(--color-bg-raised);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    transform: rotateY(180deg);
  }

  .card:focus-visible .face {
    outline: 2px solid var(--color-accent);
    outline-offset: 4px;
  }
</style>
