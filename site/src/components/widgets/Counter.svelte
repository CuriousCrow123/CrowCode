<script lang="ts">
  import type { Param } from '../../lib/params';
  import { loadParams, saveParams } from '../../lib/params';
  import WidgetDebugPanel from '../debug/WidgetDebugPanel.svelte';

  const WIDGET_ID = 'counter';

  const paramDefs: Param[] = [
    { name: 'stepSize',     value: 1,    unit: '',    category: 'behavior', min: 1,   max: 10,  step: 1,     description: 'Increment/decrement amount per click' },
    { name: 'fontSize',     value: 2.5,  unit: 'rem', category: 'style',    min: 1,   max: 8,   step: 0.25,  description: 'Count display font size' },
    { name: 'gap',          value: 1.5,  unit: 'rem', category: 'style',    min: 0,   max: 4,   step: 0.125, description: 'Spacing between counter elements' },
    { name: 'padding',      value: 2,    unit: 'rem', category: 'style',    min: 0,   max: 4,   step: 0.25,  description: 'Widget internal padding' },
    { name: 'borderRadius', value: 8,    unit: 'px',  category: 'style',    min: 0,   max: 32,  step: 1,     description: 'Button corner radius' },
  ];

  let params = $state(loadParams(WIDGET_ID, paramDefs));

  let count = $state(0);
  let doubled = $derived(count * 2);

  // Imperative API — accessible via bind:this from parent
  export function reset() {
    count = 0;
  }

  export function setCount(value: number) {
    count = value;
  }
</script>

<div
  class="counter"
  style="
    --counter-font-size: {params.fontSize}rem;
    --counter-gap: {params.gap}rem;
    --counter-padding: {params.padding}rem;
    --counter-radius: {params.borderRadius}px;
  "
>
  <div class="display">
    <span class="value">{count}</span>
    <span class="label">count</span>
  </div>
  <div class="display">
    <span class="value">{doubled}</span>
    <span class="label">doubled</span>
  </div>
  <div class="controls">
    <button onclick={() => (count -= params.stepSize)}>−</button>
    <button onclick={() => (count += params.stepSize)}>+</button>
  </div>

  <WidgetDebugPanel defs={paramDefs} bind:values={params} widgetId={WIDGET_ID} />
</div>

<style>
  .counter {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--counter-gap);
    padding: var(--counter-padding);
  }

  .display {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-xs);
  }

  .value {
    font-family: var(--font-mono);
    font-size: var(--counter-font-size);
    font-weight: 500;
    color: var(--color-accent);
    transition: color var(--transition-fast);
  }

  .label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--color-text-muted);
  }

  .controls {
    display: flex;
    gap: var(--space-sm);
  }

  button {
    font-family: var(--font-mono);
    font-size: 1.25rem;
    width: 3rem;
    height: 3rem;
    display: grid;
    place-items: center;
    background: var(--color-bg-surface);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    border-radius: var(--counter-radius);
    cursor: pointer;
    transition: border-color var(--transition-fast);
  }

  button:hover {
    border-color: var(--color-accent);
  }

  button:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
</style>
