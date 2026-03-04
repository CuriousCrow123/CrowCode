<script lang="ts">
  import type { Param } from '../../lib/params';
  import { loadParams, saveParams } from '../../lib/params';
  import WidgetDebugPanel from '../debug/WidgetDebugPanel.svelte';

  const WIDGET_ID = 'counter';

  const paramDefs: Param[] = [
    // Behavior
    { name: 'stepSize',       value: 1,    unit: '',    category: 'behavior', min: 1,    max: 10,  step: 1,     description: 'Increment/decrement amount per click' },
    // Style — layout
    { name: 'gap',            value: 1.5,  unit: 'rem', category: 'style',    min: 0,    max: 4,   step: 0.125, description: 'Spacing between counter elements' },
    { name: 'padding',        value: 2,    unit: 'rem', category: 'style',    min: 0,    max: 4,   step: 0.25,  description: 'Widget internal padding' },
    { name: 'displayGap',     value: 0.25, unit: 'rem', category: 'style',    min: 0,    max: 2,   step: 0.125, description: 'Gap between value and its label' },
    { name: 'controlsGap',    value: 0.5,  unit: 'rem', category: 'style',    min: 0,    max: 2,   step: 0.125, description: 'Gap between +/− buttons' },
    // Style — typography
    { name: 'fontSize',       value: 2.5,  unit: 'rem', category: 'style',    min: 1,    max: 8,   step: 0.25,  description: 'Count display font size' },
    { name: 'labelSize',      value: 0.75, unit: 'rem', category: 'style',    min: 0.5,  max: 2,   step: 0.125, description: 'Label text font size' },
    { name: 'letterSpacing',  value: 0.1,  unit: 'em',  category: 'style',    min: 0,    max: 0.3, step: 0.01,  description: 'Label uppercase letter spacing' },
    // Style — buttons
    { name: 'buttonSize',     value: 3,    unit: 'rem', category: 'style',    min: 1.5,  max: 6,   step: 0.25,  description: 'Width and height of +/− buttons' },
    { name: 'buttonFontSize', value: 1.25, unit: 'rem', category: 'style',    min: 0.75, max: 3,   step: 0.25,  description: 'Font size of +/− button symbols' },
    { name: 'borderRadius',   value: 8,    unit: 'px',  category: 'style',    min: 0,    max: 32,  step: 1,     description: 'Button corner radius' },
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
    --counter-gap: {params.gap}rem;
    --counter-padding: {params.padding}rem;
    --counter-display-gap: {params.displayGap}rem;
    --counter-controls-gap: {params.controlsGap}rem;
    --counter-font-size: {params.fontSize}rem;
    --counter-label-size: {params.labelSize}rem;
    --counter-letter-spacing: {params.letterSpacing}em;
    --counter-button-size: {params.buttonSize}rem;
    --counter-button-font-size: {params.buttonFontSize}rem;
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
    gap: var(--counter-display-gap);
  }

  .value {
    font-family: var(--font-mono);
    font-size: var(--counter-font-size);
    font-weight: 500;
    color: var(--color-accent);
    transition: color var(--transition-fast);
  }

  .label {
    font-size: var(--counter-label-size);
    text-transform: uppercase;
    letter-spacing: var(--counter-letter-spacing);
    color: var(--color-text-muted);
  }

  .controls {
    display: flex;
    gap: var(--counter-controls-gap);
  }

  button {
    font-family: var(--font-mono);
    font-size: var(--counter-button-font-size);
    width: var(--counter-button-size);
    height: var(--counter-button-size);
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
