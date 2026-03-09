<script lang="ts">
  import type { Param } from '../../lib/params';
  import { loadParams } from '../../lib/params';
  import { readUint, writeUint } from '../../lib/binary';
  import WidgetDebugPanel from '../debug/WidgetDebugPanel.svelte';
  import BitSequenceCore from './BitSequenceCore.svelte';
  import ScrubSlider from './shared/ScrubSlider.svelte';

  const WIDGET_ID = 'bit-sequence-uint';

  const paramDefs: Param[] = [
    { name: 'cellSize',      value: 48,  unit: 'px', category: 'style',     min: 24, max: 72,   step: 4,   description: 'Bit cell width and height' },
    { name: 'cellGap',       value: 8,   unit: 'px', category: 'style',     min: 2,  max: 16,   step: 2,   description: 'Gap between bit cells' },
    { name: 'fontSize',      value: 20,  unit: 'px', category: 'style',     min: 10, max: 36,   step: 2,   description: 'Digit size in bit cells' },
    { name: 'perspective',   value: 400, unit: 'px', category: 'style',     min: 100, max: 1000, step: 50,  description: '3D perspective depth' },
    { name: 'flipDuration',  value: 350, unit: 'ms', category: 'animation', min: 100, max: 1000, step: 50,  description: '3D flip animation duration' },
    { name: 'valueFontSize', value: 2,   unit: 'rem', category: 'style',    min: 1,  max: 4,    step: 0.25, description: 'Decimal value display size' },
    { name: 'bitCount',      value: 4,   unit: '',   category: 'behavior',  min: 2,  max: 8,    step: 1,   description: 'Number of bits' },
    { name: 'repeatDelay',   value: 400, unit: 'ms', category: 'behavior',  min: 100, max: 1000, step: 50,  description: 'Delay before auto-repeat starts' },
    { name: 'repeatInterval', value: 80, unit: 'ms', category: 'behavior',  min: 30,  max: 300,  step: 10,  description: 'Interval between repeats' },
    { name: 'repeatAccelMs', value: 800, unit: 'ms', category: 'behavior',  min: 200, max: 3000, step: 100, description: 'Time between delta doublings' },
  ];

  let params = $state(loadParams(WIDGET_ID, paramDefs));

  // State
  let bits: number[] = $state(Array(4).fill(0));
  let isEditing = $state(false);
  let editValue = $state('');
  let inputEl: HTMLInputElement;

  // Sync bit count when param changes
  $effect(() => {
    const target = params.bitCount;
    if (bits.length !== target) {
      setBitCount(target);
    }
  });

  // Derived
  let decimalValue = $derived(readUint(bits, 0, bits.length));
  let maxValue = $derived((1 << bits.length) - 1);
  let labels = $derived(
    Array.from({ length: bits.length }, (_, i) =>
      String(1 << (bits.length - 1 - i))
    )
  );

  // Bit change handler (mutate-then-reassign for perf)
  function handleBitChange(index: number, value: 0 | 1) {
    bits[index] = value;
    bits = bits;
  }

  // Bidirectional: set decimal value → update bits
  export function setValue(n: number) {
    const clamped = Math.max(0, Math.min(maxValue, Math.round(n)));
    const newBits = Array(bits.length).fill(0);
    writeUint(newBits, 0, clamped, bits.length);
    bits = newBits;
  }

  export function setBitCount(n: number) {
    const currentValue = readUint(bits, 0, bits.length);
    const newMax = (1 << n) - 1;
    const newBits = Array(n).fill(0);
    writeUint(newBits, 0, Math.min(currentValue, newMax), n);
    bits = newBits;
  }

  export function reset() {
    bits = Array(bits.length).fill(0);
  }

  // --- Edit mode ---
  function startEdit() {
    isEditing = true;
    editValue = String(decimalValue);
    // Focus input on next tick
    requestAnimationFrame(() => {
      if (inputEl) {
        inputEl.focus();
        if (matchMedia('(pointer: fine)').matches) {
          inputEl.select();
        }
      }
    });
  }

  function commitEdit() {
    const parsed = parseInt(editValue, 10);
    if (!isNaN(parsed)) {
      setValue(parsed);
    }
    isEditing = false;
  }

  function cancelEdit() {
    isEditing = false;
  }

  function handleEditKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { commitEdit(); }
    else if (e.key === 'Escape') { cancelEdit(); }
  }

</script>

<div
  class="bit-sequence-uint"
  style="--bsu-value-font-size: {params.valueFontSize}rem;"
>
  <BitSequenceCore
    {bits}
    cellSize={params.cellSize}
    cellGap={params.cellGap}
    fontSize={params.fontSize}
    mode="3d"
    perspective={params.perspective}
    flipDuration={params.flipDuration}
    {labels}
    onbitchange={handleBitChange}
  />

  <div class="value-display">
    <span class="equals">=</span>
    {#if isEditing}
      <input
        bind:this={inputEl}
        bind:value={editValue}
        class="value-input"
        type="text"
        inputmode="numeric"
        onblur={commitEdit}
        onkeydown={handleEditKeydown}
      />
    {:else}
      <span class="value" onclick={startEdit}>{decimalValue}</span>
    {/if}
  </div>

  <ScrubSlider
    value={decimalValue}
    max={maxValue}
    onvaluechange={(v) => setValue(v)}
    ondelta={(delta, dir) => setValue(decimalValue + dir * delta)}
    repeatDelay={params.repeatDelay}
    repeatInterval={params.repeatInterval}
    repeatAccelMs={params.repeatAccelMs}
  />

  <WidgetDebugPanel defs={paramDefs} bind:values={params} widgetId={WIDGET_ID} />
</div>

<style>
  .bit-sequence-uint {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
  }

  .value-display {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    font-family: var(--font-mono);
  }

  .equals {
    font-size: 1.25rem;
    color: var(--color-text-muted);
  }

  .value {
    font-size: var(--bsu-value-font-size);
    font-weight: 700;
    color: var(--color-text);
    cursor: text;
    border-bottom: 2px dotted var(--color-text-muted);
    transition: border-color var(--transition-fast);
    padding: 0 0.125rem;
    min-width: 2ch;
    text-align: center;
  }

  .value:hover {
    border-bottom-color: var(--color-accent);
    border-bottom-style: solid;
  }

  .value-input {
    font-family: var(--font-mono);
    font-size: var(--bsu-value-font-size);
    font-weight: 700;
    color: var(--color-text);
    background: transparent;
    border: none;
    border-bottom: 2px solid var(--color-accent);
    outline: none;
    text-align: center;
    width: 4ch;
    padding: 0 0.125rem;
  }

</style>
