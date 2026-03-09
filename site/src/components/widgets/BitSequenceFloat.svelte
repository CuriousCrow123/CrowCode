<script lang="ts">
  import type { Param } from '../../lib/params';
  import { loadParams } from '../../lib/params';
  import { readUint, writeUint, float16Decode, float16Encode, float16Classify } from '../../lib/binary';
  import WidgetDebugPanel from '../debug/WidgetDebugPanel.svelte';
  import BitSequenceCore from './BitSequenceCore.svelte';
  import ScrubSlider from './shared/ScrubSlider.svelte';

  const WIDGET_ID = 'bit-sequence-float';

  const paramDefs: Param[] = [
    { name: 'cellSize',        value: 28,  unit: 'px',  category: 'style',     min: 20,  max: 48,   step: 2,    description: 'Bit cell width and height' },
    { name: 'cellGap',         value: 4,   unit: 'px',  category: 'style',     min: 1,   max: 8,    step: 1,    description: 'Gap between bit cells' },
    { name: 'fontSize',        value: 12,  unit: 'px',  category: 'style',     min: 8,   max: 24,   step: 1,    description: 'Digit size in bit cells' },
    { name: 'glowDuration',    value: 300, unit: 'ms',  category: 'animation', min: 50,  max: 1000, step: 50,   description: 'Glow-pulse duration' },
    { name: 'valueFontSize',   value: 2,   unit: 'rem', category: 'style',     min: 1,   max: 4,    step: 0.25, description: 'Decoded value display size' },
    { name: 'formulaFontSize', value: 1.1, unit: 'rem', category: 'style',     min: 0.7, max: 2,    step: 0.1,  description: 'Formula display size' },
    { name: 'repeatDelay',    value: 400, unit: 'ms',  category: 'behavior',  min: 100, max: 1000, step: 50,   description: 'Delay before auto-repeat starts' },
    { name: 'repeatInterval', value: 80,  unit: 'ms',  category: 'behavior',  min: 30,  max: 300,  step: 10,   description: 'Interval between repeats' },
    { name: 'repeatAccelMs',  value: 800, unit: 'ms',  category: 'behavior',  min: 200, max: 3000, step: 100,  description: 'Time between delta doublings' },
  ];

  let params = $state(loadParams(WIDGET_ID, paramDefs));

  // State — always 16 bits
  let bits: number[] = $state(Array(16).fill(0));
  let isEditing = $state(false);
  let editValue = $state('');
  let inputEl: HTMLInputElement;

  // Derived
  let bits16 = $derived(readUint(bits, 0, 16));
  let decodedValue = $derived(float16Decode(bits16));
  let classification = $derived(float16Classify(bits16));

  let sign = $derived(bits[0]);
  let exponent = $derived(readUint(bits, 1, 5));
  let mantissa = $derived(readUint(bits, 6, 10));

  // Section colors for bit row
  let sectionColors = $derived({
    sign:     { indices: [0],                        color: 'rgba(239, 68, 68, 0.15)' },
    exponent: { indices: [1, 2, 3, 4, 5],            color: 'rgba(59, 130, 246, 0.15)' },
    mantissa: { indices: [6,7,8,9,10,11,12,13,14,15], color: 'rgba(34, 197, 94, 0.15)' },
  });

  let sectionGaps = [0, 5]; // gap after sign, gap after exponent

  let labels = [
    'S',
    'E','E','E','E','E',
    'M','M','M','M','M','M','M','M','M','M',
  ];

  // Display value
  let displayValue = $derived.by(() => {
    switch (classification) {
      case 'infinity': return sign ? '-Infinity' : '+Infinity';
      case 'nan': return 'NaN';
      case 'zero': return sign ? '-0' : '0';
      default: {
        return String(decodedValue);
      }
    }
  });

  // Bit change handler
  function handleBitChange(index: number, value: 0 | 1) {
    bits[index] = value;
    bits = bits;
  }

  export function setValue(f: number) {
    const pattern = float16Encode(f);
    const newBits = Array(16).fill(0);
    writeUint(newBits, 0, pattern, 16);
    bits = newBits;
  }

  export function reset() {
    bits = Array(16).fill(0);
  }

  export function setSpecial(kind: 'zero' | 'negzero' | 'inf' | 'neginf' | 'nan') {
    const patterns: Record<string, number> = {
      zero: 0, negzero: 0x8000, inf: 0x7c00, neginf: 0xfc00, nan: 0x7e00,
    };
    const newBits = Array(16).fill(0);
    writeUint(newBits, 0, patterns[kind], 16);
    bits = newBits;
  }

  // --- Edit mode ---
  function startEdit() {
    isEditing = true;
    editValue = classification === 'zero' || classification === 'normal' || classification === 'subnormal'
      ? String(decodedValue)
      : displayValue;
    requestAnimationFrame(() => {
      if (inputEl) {
        inputEl.focus();
        if (matchMedia('(pointer: fine)').matches) inputEl.select();
      }
    });
  }

  function commitEdit() {
    const parsed = parseFloat(editValue);
    if (!isNaN(parsed) || editValue.toLowerCase() === 'infinity' || editValue.toLowerCase() === '-infinity') {
      if (editValue.toLowerCase() === 'nan') {
        setSpecial('nan');
      } else if (editValue.toLowerCase() === 'infinity' || editValue.toLowerCase() === '+infinity') {
        setSpecial('inf');
      } else if (editValue.toLowerCase() === '-infinity') {
        setSpecial('neginf');
      } else if (!isNaN(parsed)) {
        setValue(parsed);
      }
    }
    isEditing = false;
  }

  function cancelEdit() { isEditing = false; }

  function handleEditKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') commitEdit();
    else if (e.key === 'Escape') cancelEdit();
  }

</script>

<div
  class="bit-sequence-float"
  style="
    --bsf-value-font-size: {params.valueFontSize}rem;
    --bsf-formula-font-size: {params.formulaFontSize}rem;
  "
>
  <BitSequenceCore
    {bits}
    cellSize={params.cellSize}
    cellGap={params.cellGap}
    fontSize={params.fontSize}
    mode="toggle"
    glowDuration={params.glowDuration}
    {labels}
    {sectionColors}
    {sectionGaps}
    onbitchange={handleBitChange}
  />

  <div class="value-row">
    <span class="equals">=</span>
    {#if isEditing}
      <input
        bind:this={inputEl}
        bind:value={editValue}
        class="value-input"
        type="text"
        onblur={commitEdit}
        onkeydown={handleEditKeydown}
      />
    {:else}
      <span
        class="value"
        class:special={classification === 'infinity' || classification === 'nan'}
        onclick={startEdit}
      >
        {displayValue}
      </span>
    {/if}
    <span class="badge">{classification}</span>
  </div>

  <ScrubSlider
    value={bits16}
    max={65535}
    onvaluechange={(v) => {
      const newBits = Array(16).fill(0);
      writeUint(newBits, 0, v, 16);
      bits = newBits;
    }}
    ondelta={(delta, dir) => {
      const newVal = Math.max(0, Math.min(65535, bits16 + dir * delta));
      const newBits = Array(16).fill(0);
      writeUint(newBits, 0, newVal, 16);
      bits = newBits;
    }}
    repeatDelay={params.repeatDelay}
    repeatInterval={params.repeatInterval}
    repeatAccelMs={params.repeatAccelMs}
    ariaLabel="Drag to scrub bit pattern"
    railWidth={140}
  />

  <!-- Formula breakdown -->
  <div class="formula">
    {#if classification === 'infinity'}
      <span class="formula-special">{sign ? '-' : '+'}Infinity</span>
      <span class="formula-note">(exponent=31, mantissa=0)</span>
    {:else if classification === 'nan'}
      <span class="formula-special">NaN</span>
      <span class="formula-note">(exponent=31, mantissa={mantissa})</span>
    {:else if classification === 'zero'}
      <span class="formula-special">{sign ? '-0' : '+0'}</span>
      <span class="formula-note">(exponent=0, mantissa=0)</span>
    {:else if classification === 'subnormal'}
      <div class="formula-blocks">
        <div class="formula-block sign-block">
          <span class="block-value">(-1)<sup>{sign}</sup></span>
          <span class="block-label">sign</span>
        </div>
        <span class="formula-op">&times;</span>
        <div class="formula-block exponent-block">
          <span class="block-value">2<sup>-14</sup></span>
          <span class="block-label">fixed</span>
        </div>
        <span class="formula-op">&times;</span>
        <div class="formula-block mantissa-block">
          <span class="block-value">{mantissa}/1024</span>
          <span class="block-label">mantissa</span>
        </div>
        <span class="formula-op">=</span>
        <span class="formula-result">{displayValue}</span>
      </div>
    {:else}
      <div class="formula-blocks">
        <div class="formula-block sign-block">
          <span class="block-value">(-1)<sup>{sign}</sup></span>
          <span class="block-label">sign</span>
        </div>
        <span class="formula-op">&times;</span>
        <div class="formula-block exponent-block">
          <span class="block-value">2<sup>{exponent}-15</sup></span>
          <span class="block-label">exponent</span>
        </div>
        <span class="formula-op">&times;</span>
        <div class="formula-block mantissa-block">
          <span class="block-value">1+{mantissa}/1024</span>
          <span class="block-label">mantissa</span>
        </div>
        <span class="formula-op">=</span>
        <span class="formula-result">{displayValue}</span>
      </div>
    {/if}
  </div>

  <WidgetDebugPanel defs={paramDefs} bind:values={params} widgetId={WIDGET_ID} />
</div>

<style>
  .bit-sequence-float {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
  }

  .value-row {
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
    font-size: var(--bsf-value-font-size);
    font-weight: 700;
    color: var(--color-text);
    cursor: text;
    border-bottom: 2px dotted var(--color-text-muted);
    transition: border-color var(--transition-fast);
    padding: 0 0.125rem;
    min-width: 3ch;
    text-align: center;
  }

  .value:hover {
    border-bottom-color: var(--color-accent);
    border-bottom-style: solid;
  }

  .value.special {
    color: var(--color-text-muted);
    font-style: italic;
  }

  .value-input {
    font-family: var(--font-mono);
    font-size: var(--bsf-value-font-size);
    font-weight: 700;
    color: var(--color-text);
    background: transparent;
    border: none;
    border-bottom: 2px solid var(--color-accent);
    outline: none;
    text-align: center;
    width: 8ch;
  }

  .badge {
    font-size: 0.625rem;
    font-family: var(--font-mono);
    color: var(--color-text-muted);
    background: var(--color-bg-surface);
    padding: 0.125rem 0.375rem;
    border-radius: 9999px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* ── Formula ── */
  .formula {
    font-family: var(--font-mono);
    font-size: var(--bsf-formula-font-size);
    color: var(--color-text);
    text-align: center;
  }

  .formula-special {
    font-weight: 700;
    font-size: calc(var(--bsf-formula-font-size) * 1.2);
  }

  .formula-note {
    color: var(--color-text-muted);
    font-size: calc(var(--bsf-formula-font-size) * 0.8);
    margin-left: 0.5rem;
  }

  .formula-blocks {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    flex-wrap: wrap;
    justify-content: center;
  }

  .formula-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.25rem 0.5rem;
    border-radius: 6px;
    gap: 2px;
  }

  .sign-block {
    background: rgba(239, 68, 68, 0.1);
  }

  .exponent-block {
    background: rgba(59, 130, 246, 0.1);
  }

  .mantissa-block {
    background: rgba(34, 197, 94, 0.1);
  }

  .block-value {
    font-weight: 600;
    font-size: calc(var(--bsf-formula-font-size) * 0.95);
  }

  .block-label {
    font-size: 0.5rem;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .formula-op {
    color: var(--color-text-muted);
    font-size: calc(var(--bsf-formula-font-size) * 0.9);
  }

  .formula-result {
    font-weight: 700;
    color: var(--color-accent);
    font-size: calc(var(--bsf-formula-font-size) * 1.1);
  }
</style>
