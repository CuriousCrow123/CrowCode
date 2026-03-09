<script lang="ts">
  import type { Param } from '../../lib/params';
  import { loadParams } from '../../lib/params';
  import { readUint, writeUint } from '../../lib/binary';
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
    { name: 'bitCount',      value: 4,   unit: '',    category: 'behavior',  min: 4,  max: 7,    step: 1,    description: 'Number of bits (4 or 7)' },
  ];

  let params = $state(loadParams(WIDGET_ID, paramDefs));

  // State
  let bits: number[] = $state(Array(4).fill(0));
  let showTable = $state(false);
  let isEditing = $state(false);
  let editValue = $state('');
  let isDragging = $state(false);
  let dragStartX = 0;
  let dragStartValue = 0;
  let inputEl: HTMLInputElement;

  // Sync bit count
  $effect(() => {
    const target = params.bitCount;
    if (bits.length !== target) {
      setBitCount(target);
    }
  });

  // Control characters
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
  let decimalValue = $derived(readUint(bits, 0, bits.length));
  let maxValue = $derived((1 << bits.length) - 1);
  let char = $derived(asciiChar(decimalValue));
  let isPrintable = $derived(decimalValue >= 32 && decimalValue <= 126);

  // Bit change handler
  function handleBitChange(index: number, value: 0 | 1) {
    bits[index] = value;
    bits = bits;
  }

  // Bidirectional
  export function setValue(code: number) {
    const clamped = Math.max(0, Math.min(maxValue, Math.round(code)));
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

  export function showAsciiTable() { showTable = true; }
  export function hideAsciiTable() { showTable = false; }
  export function reset() { bits = Array(bits.length).fill(0); }

  // --- Edit mode ---
  function startEdit() {
    isEditing = true;
    editValue = isPrintable ? char : String(decimalValue);
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
    if (editValue.length === 1 && editValue.charCodeAt(0) >= 32 && editValue.charCodeAt(0) <= 126) {
      setValue(editValue.charCodeAt(0));
    } else {
      const parsed = parseInt(editValue, 10);
      if (!isNaN(parsed)) {
        setValue(parsed);
      }
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

  // --- Drag-scrub ---
  function handlePointerDown(e: PointerEvent) {
    dragStartX = e.clientX;
    dragStartValue = decimalValue;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent) {
    const dx = e.clientX - dragStartX;
    if (!isDragging && Math.abs(dx) > 5) {
      isDragging = true;
    }
    if (isDragging) {
      const sensitivity = Math.max(1, Math.floor((maxValue + 1) / 256));
      const delta = Math.floor(dx / 4) * sensitivity;
      let newValue = dragStartValue + delta;
      const range = maxValue + 1;
      newValue = ((newValue % range) + range) % range;
      setValue(newValue);
    }
  }

  function handlePointerUp() {
    if (!isDragging) {
      startEdit();
    }
    isDragging = false;
  }

  // --- ASCII table click (event delegation) ---
  function handleTableClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const cell = target.closest('[data-code]') as HTMLElement | null;
    if (cell) {
      const code = parseInt(cell.dataset.code!, 10);
      if (!isNaN(code) && code <= maxValue) {
        setValue(code);
      }
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
    <span class="decimal-value"
      class:dragging={isDragging}
      role="spinbutton"
      tabindex="0"
      aria-valuenow={decimalValue}
      aria-valuemin={0}
      aria-valuemax={maxValue}
      onpointerdown={handlePointerDown}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerUp}
      onpointercancel={() => { isDragging = false; }}
    >
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
        = {decimalValue}
      {/if}
    </span>
    <span class="equals">=</span>
    <span class="char-display" class:control={!isPrintable}>
      '{char}'
    </span>
  </div>

  {#if showTable}
    <div class="ascii-table-wrapper">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="ascii-table" onclick={handleTableClick}>
        {#each Array(128) as _, code}
          {@const inRange = code <= maxValue}
          {@const isActive = code === decimalValue}
          {@const ctrl = isControl(code)}
          <div
            class="ascii-cell"
            class:active={isActive}
            class:control={ctrl}
            class:out-of-range={!inRange}
            data-code={code}
          >
            <span class="cell-code">{code}</span>
            <span class="cell-char">{asciiChar(code)}</span>
          </div>
        {/each}
      </div>
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
    cursor: ew-resize;
    border-bottom: 2px dotted var(--color-text-muted);
    transition: border-color var(--transition-fast);
    padding: 0 0.125rem;
  }

  .decimal-value:hover {
    border-bottom-color: var(--color-accent);
    border-bottom-style: solid;
  }

  .decimal-value.dragging {
    user-select: none;
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

  /* ── ASCII Table ── */
  .ascii-table-wrapper {
    width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .ascii-table {
    display: grid;
    grid-template-columns: repeat(16, minmax(36px, 1fr));
    gap: 2px;
    min-width: 600px;
  }

  .ascii-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 4px 2px;
    border-radius: 3px;
    cursor: pointer;
    background: var(--color-bg-surface);
    transition: background var(--transition-fast);
    gap: 1px;
  }

  .ascii-cell:hover:not(.out-of-range) {
    background: var(--color-bg-raised);
  }

  .ascii-cell.active {
    background: var(--color-accent);
    color: var(--color-bg);
  }

  .ascii-cell.active .cell-code,
  .ascii-cell.active .cell-char {
    color: var(--color-bg);
  }

  .ascii-cell.out-of-range {
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

  .ascii-cell.control .cell-char {
    color: var(--color-text-muted);
    font-style: italic;
    font-size: 0.55rem;
  }
</style>
