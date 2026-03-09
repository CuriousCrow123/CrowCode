<script lang="ts">
  import type { Param } from '../../lib/params';
  import { loadParams } from '../../lib/params';
  import { readUint, writeUint } from '../../lib/binary';
  import { startRepeat } from '../../lib/repeat';
  import WidgetDebugPanel from '../debug/WidgetDebugPanel.svelte';
  import BitSequenceCore from './BitSequenceCore.svelte';

  const WIDGET_ID = 'bit-sequence-ascii';

  const paramDefs: Param[] = [
    { name: 'cellSize',      value: 48,  unit: 'px',  category: 'style',     min: 24, max: 72,   step: 4,    description: 'Bit cell width and height' },
    { name: 'cellGap',       value: 8,   unit: 'px',  category: 'style',     min: 2,  max: 16,   step: 2,    description: 'Gap between bit cells' },
    { name: 'fontSize',      value: 20,  unit: 'px',  category: 'style',     min: 10, max: 36,   step: 2,    description: 'Digit size in bit cells' },
    { name: 'perspective',   value: 400, unit: 'px',  category: 'style',     min: 100, max: 1000, step: 50,   description: '3D perspective depth' },
    { name: 'flipDuration',  value: 350, unit: 'ms',  category: 'animation', min: 100, max: 1000, step: 50,   description: '3D flip animation duration' },
    { name: 'valueFontSize', value: 1.5, unit: 'rem', category: 'style',     min: 1,  max: 4,    step: 0.25, description: 'Value display size' },
    { name: 'charFontSize',  value: 3,   unit: 'rem', category: 'style',     min: 1,  max: 6,    step: 0.25, description: 'Character display size' },
    { name: 'repeatDelay',   value: 400, unit: 'ms', category: 'behavior',  min: 100, max: 1000, step: 50,  description: 'Delay before auto-repeat starts' },
    { name: 'repeatInterval', value: 80, unit: 'ms', category: 'behavior',  min: 30,  max: 300,  step: 10,  description: 'Interval between repeats' },
    { name: 'repeatAccelMs', value: 800, unit: 'ms', category: 'behavior',  min: 200, max: 3000, step: 100, description: 'Time between delta doublings' },
  ];

  let params = $state(loadParams(WIDGET_ID, paramDefs));

  // State
  let bits: number[] = $state(Array(4).fill(0));
  let stage: 1 | 2 = $state(1);
  let showTable = $state(false);
  let isEditing = $state(false);
  let editValue = $state('');
  let isDragging = $state(false);
  let railEl: HTMLElement;
  let inputEl: HTMLInputElement;

  // Stage 1: arbitrary mapping (4 bits → 16 letters, NOT ASCII)
  const CUSTOM_MAP = 'ABCDEFGHIJKLMNOP';

  // ASCII control characters
  const CONTROL_CHARS: Record<number, string> = {
    0: 'NUL', 1: 'SOH', 2: 'STX', 3: 'ETX', 4: 'EOT', 5: 'ENQ',
    6: 'ACK', 7: 'BEL', 8: 'BS',  9: 'TAB', 10: 'LF', 11: 'VT',
    12: 'FF', 13: 'CR', 14: 'SO', 15: 'SI', 16: 'DLE', 17: 'DC1',
    18: 'DC2', 19: 'DC3', 20: 'DC4', 21: 'NAK', 22: 'SYN', 23: 'ETB',
    24: 'CAN', 25: 'EM', 26: 'SUB', 27: 'ESC', 28: 'FS', 29: 'GS',
    30: 'RS', 31: 'US', 127: 'DEL',
  };

  function asciiChar(code: number): string {
    if (code in CONTROL_CHARS) return CONTROL_CHARS[code];
    if (code >= 32 && code <= 126) return String.fromCharCode(code);
    return '?';
  }

  function isControl(code: number): boolean {
    return code < 32 || code === 127;
  }

  // Derived
  let bitCount = $derived(stage === 1 ? 4 : 7);
  let decimalValue = $derived(readUint(bits, 0, bits.length));
  let maxValue = $derived((1 << bits.length) - 1);
  let displayChar = $derived(
    stage === 1 ? (CUSTOM_MAP[decimalValue] ?? '?') : asciiChar(decimalValue)
  );
  let scrubPercent = $derived(maxValue > 0 ? (decimalValue / maxValue) * 100 : 0);
  let isPrintable = $derived(
    stage === 1 ? true : (decimalValue >= 32 && decimalValue <= 126)
  );

  // Sync bit count when stage changes
  $effect(() => {
    if (bits.length !== bitCount) {
      const currentValue = readUint(bits, 0, bits.length);
      const newMax = (1 << bitCount) - 1;
      const newBits = Array(bitCount).fill(0);
      writeUint(newBits, 0, Math.min(currentValue, newMax), bitCount);
      bits = newBits;
    }
  });

  // Bit change handler
  function handleBitChange(index: number, value: 0 | 1) {
    bits[index] = value;
    bits = bits;
  }

  export function setValue(code: number) {
    const clamped = Math.max(0, Math.min(maxValue, Math.round(code)));
    const newBits = Array(bits.length).fill(0);
    writeUint(newBits, 0, clamped, bits.length);
    bits = newBits;
  }

  export function setStage(s: 1 | 2) { stage = s; }
  export function showMappingTable() { showTable = true; }
  export function hideMappingTable() { showTable = false; }
  export function reset() { bits = Array(bits.length).fill(0); stage = 1; showTable = false; }

  // --- Edit mode ---
  function startEdit() {
    isEditing = true;
    if (stage === 1) {
      editValue = displayChar;
    } else {
      editValue = isPrintable ? displayChar : String(decimalValue);
    }
    requestAnimationFrame(() => {
      if (inputEl) {
        inputEl.focus();
        if (matchMedia('(pointer: fine)').matches) inputEl.select();
      }
    });
  }

  function commitEdit() {
    if (stage === 1) {
      const upper = editValue.toUpperCase();
      if (upper.length === 1) {
        const idx = CUSTOM_MAP.indexOf(upper);
        if (idx >= 0) { setValue(idx); isEditing = false; return; }
      }
    } else {
      if (editValue.length === 1 && editValue.charCodeAt(0) >= 32 && editValue.charCodeAt(0) <= 126) {
        setValue(editValue.charCodeAt(0));
        isEditing = false;
        return;
      }
    }
    const parsed = parseInt(editValue, 10);
    if (!isNaN(parsed)) setValue(parsed);
    isEditing = false;
  }

  function cancelEdit() { isEditing = false; }

  function handleEditKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') commitEdit();
    else if (e.key === 'Escape') cancelEdit();
  }

  // --- Scrub slider ---
  function updateScrubValue(e: PointerEvent) {
    if (!railEl) return;
    const rect = railEl.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setValue(Math.round(x * maxValue));
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

  function handleScrubUp() { isDragging = false; }

  // --- Press-and-hold +/- buttons ---
  let stopBtnRepeat: (() => void) | null = null;

  function handleBtnDown(dir: 1 | -1) {
    stopBtnRepeat?.();
    stopBtnRepeat = startRepeat((delta) => {
      setValue(decimalValue + dir * delta);
    }, params.repeatDelay, params.repeatInterval, params.repeatAccelMs);
  }

  function handleBtnUp() {
    stopBtnRepeat?.();
    stopBtnRepeat = null;
  }

  // --- Table click (event delegation) ---
  function handleTableClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const cell = target.closest('[data-code]') as HTMLElement | null;
    if (cell) {
      const code = parseInt(cell.dataset.code!, 10);
      if (!isNaN(code) && code <= maxValue) setValue(code);
    }
  }
</script>

<div
  class="bit-sequence-ascii"
  style="
    --bsa-value-font-size: {params.valueFontSize}rem;
    --bsa-char-font-size: {params.charFontSize}rem;
  "
>
  <BitSequenceCore
    {bits}
    cellSize={params.cellSize}
    cellGap={params.cellGap}
    fontSize={params.fontSize}
    mode="3d"
    perspective={params.perspective}
    flipDuration={params.flipDuration}
    onbitchange={handleBitChange}
  />

  <div class="mapping-display">
    {#if isEditing}
      <span class="decimal-value">
        <input
          bind:this={inputEl}
          bind:value={editValue}
          class="value-input"
          type="text"
          onblur={commitEdit}
          onkeydown={handleEditKeydown}
        />
      </span>
    {:else}
      <span class="decimal-value" onclick={startEdit}>= {decimalValue}</span>
    {/if}
    <span class="equals">=</span>
    <span class="char-display" class:control={!isPrintable}>
      '{displayChar}'
    </span>
    <button
      class="table-toggle"
      class:open={showTable}
      onclick={() => { showTable = !showTable; }}
      aria-expanded={showTable}
      aria-label={showTable ? 'Hide mapping table' : 'Show mapping table'}
    >
      {showTable ? 'Hide' : 'Show'} table
      <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">
        <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
  </div>

  <div class="scrub-row">
    <button class="scrub-btn" onpointerdown={(e) => { e.preventDefault(); handleBtnDown(-1); }} onpointerup={handleBtnUp} onpointerleave={handleBtnUp} aria-label="Decrement">&minus;</button>
    <div
      class="scrub-track"
      class:active={isDragging}
      role="slider"
      tabindex="0"
      aria-valuenow={decimalValue}
      aria-valuemin={0}
      aria-valuemax={maxValue}
      aria-label="Drag to scrub value"
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
      <span class="scrub-label">{maxValue}</span>
    </div>
    <button class="scrub-btn" onpointerdown={(e) => { e.preventDefault(); handleBtnDown(1); }} onpointerup={handleBtnUp} onpointerleave={handleBtnUp} aria-label="Increment">+</button>
  </div>

  {#if showTable}
  <div class="table-wrapper">
    {#if stage === 1}
      <!-- Stage 1: Custom 4×4 table (arbitrary mapping) -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="custom-table" onclick={handleTableClick}>
        {#each CUSTOM_MAP.split('') as ch, code}
          <div
            class="table-cell"
            class:active={code === decimalValue}
            data-code={code}
          >
            <span class="cell-code">{code}</span>
            <span class="cell-char">{ch}</span>
          </div>
        {/each}
      </div>
    {:else}
      <!-- Stage 2: Full ASCII table (standard mapping) -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="ascii-table" onclick={handleTableClick}>
        {#each Array(128) as _, code}
          {@const isActive = code === decimalValue}
          {@const ctrl = isControl(code)}
          <div
            class="table-cell"
            class:active={isActive}
            class:control={ctrl}
            data-code={code}
          >
            <span class="cell-code">{code}</span>
            <span class="cell-char">{asciiChar(code)}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
  {/if}

  <WidgetDebugPanel defs={paramDefs} bind:values={params} widgetId={WIDGET_ID} />
</div>

<style>
  .bit-sequence-ascii {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
  }

  .mapping-display {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    font-family: var(--font-mono);
  }

  .decimal-value {
    font-size: var(--bsa-value-font-size);
    font-weight: 600;
    color: var(--color-text);
    cursor: text;
    border-bottom: 2px dotted var(--color-text-muted);
    transition: border-color var(--transition-fast);
    padding: 0 0.125rem;
  }

  .decimal-value:hover {
    border-bottom-color: var(--color-accent);
    border-bottom-style: solid;
  }

  .value-input {
    font-family: var(--font-mono);
    font-size: var(--bsa-value-font-size);
    font-weight: 600;
    color: var(--color-text);
    background: transparent;
    border: none;
    border-bottom: 2px solid var(--color-accent);
    outline: none;
    text-align: center;
    width: 4ch;
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
    width: 120px;
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

  .table-toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--color-text-muted);
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    padding: 4px 8px;
    cursor: pointer;
    transition: color var(--transition-fast), border-color var(--transition-fast);
  }

  .table-toggle:hover {
    color: var(--color-accent);
    border-color: var(--color-accent);
  }

  .table-toggle svg {
    transition: transform var(--transition-fast);
  }

  .table-toggle.open svg {
    transform: rotate(180deg);
  }

  .equals {
    font-size: 1.25rem;
    color: var(--color-text-muted);
  }

  .char-display {
    font-size: var(--bsa-char-font-size);
    font-weight: 700;
    color: var(--color-accent);
  }

  .char-display.control {
    color: var(--color-text-muted);
    font-style: italic;
    font-size: calc(var(--bsa-char-font-size) * 0.6);
  }

  /* ── Tables ── */
  .table-wrapper {
    width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .custom-table {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
    max-width: 280px;
    margin: 0 auto;
  }

  .ascii-table {
    display: grid;
    grid-template-columns: repeat(16, minmax(36px, 1fr));
    gap: 2px;
    min-width: 600px;
  }

  .table-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 6px 2px;
    border-radius: 4px;
    cursor: pointer;
    background: var(--color-bg-surface);
    transition: background var(--transition-fast);
    gap: 2px;
  }

  .table-cell:hover {
    background: var(--color-bg-raised);
  }

  .table-cell.active {
    background: var(--color-accent);
  }

  .table-cell.active .cell-code,
  .table-cell.active .cell-char {
    color: var(--color-bg);
  }

  .table-cell.out-of-range {
    opacity: 0.25;
    cursor: default;
  }

  .cell-code {
    font-family: var(--font-mono);
    font-size: 0.5rem;
    color: var(--color-text-muted);
    line-height: 1;
  }

  .cell-char {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--color-text);
    line-height: 1;
  }

  .custom-table .cell-char {
    font-size: 1rem;
  }

  .table-cell.control .cell-char {
    color: var(--color-text-muted);
    font-style: italic;
    font-size: 0.55rem;
  }
</style>
