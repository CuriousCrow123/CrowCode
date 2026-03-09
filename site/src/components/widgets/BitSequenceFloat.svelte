<script lang="ts">
  import type { Param } from '../../lib/params';
  import { loadParams } from '../../lib/params';
  import { readUint, writeUint, float16Decode, float16Encode, float16Classify } from '../../lib/binary';
  import { startRepeat } from '../../lib/repeat';
  import WidgetDebugPanel from '../debug/WidgetDebugPanel.svelte';
  import BitSequenceCore from './BitSequenceCore.svelte';

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
  let isDragging = $state(false);
  let railEl: HTMLElement;
  let inputEl: HTMLInputElement;

  // Derived
  let bits16 = $derived(readUint(bits, 0, 16));
  let decodedValue = $derived(float16Decode(bits16));
  let classification = $derived(float16Classify(bits16));

  let sign = $derived(bits[0]);
  let exponent = $derived(readUint(bits, 1, 5));
  let mantissa = $derived(readUint(bits, 6, 10));
  let scrubPercent = $derived((bits16 / 65535) * 100);

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
        const v = decodedValue;
        if (Math.abs(v) < 0.001 || Math.abs(v) > 99999) {
          return v.toExponential(4);
        }
        return v.toPrecision(5);
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

  // --- Scrub slider (maps position to raw 16-bit pattern) ---
  function updateScrubValue(e: PointerEvent) {
    if (!railEl) return;
    const rect = railEl.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const pattern = Math.round(x * 65535);
    const newBits = Array(16).fill(0);
    writeUint(newBits, 0, pattern, 16);
    bits = newBits;
  }

  function handleScrubDown(e: PointerEvent) {
    e.preventDefault();
    isDragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    updateScrubValue(e);
  }

  function handleScrubMove(e: PointerEvent) {
    if (!isDragging) return;
    updateScrubValue(e);
  }

  function handleScrubUp() {
    isDragging = false;
  }

  // --- Press-and-hold +/- buttons ---
  let stopBtnRepeat: (() => void) | null = null;

  function handleBtnDown(dir: 1 | -1) {
    stopBtnRepeat?.();
    stopBtnRepeat = startRepeat((delta) => {
      const newVal = Math.max(0, Math.min(65535, bits16 + dir * delta));
      const newBits = Array(16).fill(0);
      writeUint(newBits, 0, newVal, 16);
      bits = newBits;
    }, params.repeatDelay, params.repeatInterval, params.repeatAccelMs);
  }

  function handleBtnUp() {
    stopBtnRepeat?.();
    stopBtnRepeat = null;
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

  <div class="scrub-row">
    <button class="scrub-btn" onpointerdown={(e) => { e.preventDefault(); handleBtnDown(-1); }} onpointerup={handleBtnUp} onpointerleave={handleBtnUp} aria-label="Decrement">&minus;</button>
    <div
      class="scrub-track"
      class:active={isDragging}
      role="slider"
      tabindex="0"
      aria-valuenow={bits16}
      aria-valuemin={0}
      aria-valuemax={65535}
      aria-label="Drag to scrub bit pattern"
      onpointerdown={handleScrubDown}
      onpointermove={handleScrubMove}
      onpointerup={handleScrubUp}
      onpointercancel={() => { isDragging = false; }}
    >
      <span class="scrub-label">0</span>
      <div class="scrub-rail" bind:this={railEl}>
        <div class="scrub-fill" style="width: {scrubPercent}%"></div>
        <div class="scrub-knob" style="left: {scrubPercent}%"></div>
      </div>
      <span class="scrub-label">65535</span>
    </div>
    <button class="scrub-btn" onpointerdown={(e) => { e.preventDefault(); handleBtnDown(1); }} onpointerup={handleBtnUp} onpointerleave={handleBtnUp} aria-label="Increment">+</button>
  </div>

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

  .scrub-track {
    display: flex;
    align-items: center;
    gap: 8px;
    touch-action: none;
    user-select: none;
    cursor: pointer;
  }

  .scrub-label {
    font-family: var(--font-mono);
    font-size: 0.625rem;
    color: var(--color-text-muted);
    flex-shrink: 0;
    min-width: 2ch;
    text-align: center;
  }

  .scrub-rail {
    position: relative;
    width: 140px;
    height: 20px;
    display: flex;
    align-items: center;
  }

  .scrub-rail::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 3px;
    background: var(--color-border);
    border-radius: 1.5px;
  }

  .scrub-fill {
    position: absolute;
    left: 0;
    height: 3px;
    background: var(--color-accent);
    border-radius: 1.5px;
    pointer-events: none;
  }

  .scrub-knob {
    position: absolute;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--color-accent);
    border: 2px solid var(--color-bg);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
    transform: translateX(-50%);
    pointer-events: none;
    transition: box-shadow var(--transition-fast);
  }

  .scrub-track:hover .scrub-knob {
    box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.15);
  }

  .scrub-track.active .scrub-knob {
    box-shadow: 0 0 0 6px rgba(99, 102, 241, 0.2);
  }

  .scrub-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .scrub-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 1.5px solid var(--color-border);
    background: var(--color-bg-surface);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    font-size: 0.875rem;
    font-weight: 600;
    line-height: 1;
    cursor: pointer;
    transition: color var(--transition-fast), border-color var(--transition-fast), background var(--transition-fast);
    flex-shrink: 0;
    padding: 0;
  }

  .scrub-btn:hover {
    color: var(--color-accent);
    border-color: var(--color-accent);
    background: rgba(99, 102, 241, 0.08);
  }

  .scrub-btn:active {
    background: rgba(99, 102, 241, 0.15);
    transform: scale(0.92);
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
