<script lang="ts">
  import type { Param } from '../../lib/params';
  import { loadParams } from '../../lib/params';
  import { readUint, writeUint, toSigned, fromSigned } from '../../lib/binary';
  import WidgetDebugPanel from '../debug/WidgetDebugPanel.svelte';
  import BitSequenceCore from './BitSequenceCore.svelte';

  const WIDGET_ID = 'bit-sequence-signed';

  const paramDefs: Param[] = [
    { name: 'cellSize',        value: 48,  unit: 'px',  category: 'style',     min: 24,  max: 72,   step: 4,    description: 'Bit cell width and height' },
    { name: 'cellGap',         value: 8,   unit: 'px',  category: 'style',     min: 2,   max: 16,   step: 2,    description: 'Gap between bit cells' },
    { name: 'fontSize',        value: 20,  unit: 'px',  category: 'style',     min: 10,  max: 36,   step: 2,    description: 'Digit size in bit cells' },
    { name: 'perspective',     value: 400, unit: 'px',  category: 'style',     min: 100, max: 1000, step: 50,   description: '3D perspective depth' },
    { name: 'flipDuration',    value: 350, unit: 'ms',  category: 'animation', min: 100, max: 1000, step: 50,   description: '3D flip animation duration' },
    { name: 'valueFontSize',   value: 2,   unit: 'rem', category: 'style',     min: 1,   max: 4,    step: 0.25, description: 'Value display size' },
    { name: 'numberLineSize',  value: 240, unit: 'px',  category: 'style',     min: 160, max: 360,  step: 20,   description: 'Circular number line diameter' },
    { name: 'bitCount',        value: 4,   unit: '',    category: 'behavior',  min: 3,   max: 8,    step: 1,    description: 'Number of bits' },
  ];

  let params = $state(loadParams(WIDGET_ID, paramDefs));

  // State
  let bits: number[] = $state(Array(4).fill(0));
  let stage: 1 | 2 | 3 = $state(1);
  let isEditingUnsigned = $state(false);
  let isEditingSigned = $state(false);
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

  // Derived
  let unsignedValue = $derived(readUint(bits, 0, bits.length));
  let signedValue = $derived(toSigned(unsignedValue, bits.length));
  let maxUnsigned = $derived((1 << bits.length) - 1);
  let maxSigned = $derived((1 << (bits.length - 1)) - 1);
  let minSigned = $derived(-(1 << (bits.length - 1)));
  let totalValues = $derived(1 << bits.length);

  // Sign bit highlight
  let sectionColors = $derived({
    sign: { indices: [0], color: 'rgba(239, 68, 68, 0.15)' },
  });

  let labels = $derived(
    Array.from({ length: bits.length }, (_, i) =>
      i === 0 ? 'sign' : String(bits.length - 1 - i)
    )
  );

  // Number line geometry
  let numberLinePoints = $derived.by(() => {
    const n = totalValues;
    const r = (params.numberLineSize / 2) - 30; // radius with margin for labels
    const cx = params.numberLineSize / 2;
    const cy = params.numberLineSize / 2;
    const points: { x: number; y: number; unsigned: number; signed: number; angle: number }[] = [];

    for (let u = 0; u < n; u++) {
      // 0 at top, clockwise
      const angle = (u / n) * Math.PI * 2 - Math.PI / 2;
      points.push({
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
        unsigned: u,
        signed: toSigned(u, bits.length),
        angle,
      });
    }
    return points;
  });

  // Label interval for readability
  let labelInterval = $derived.by(() => {
    const n = totalValues;
    if (n <= 16) return 1;
    if (n <= 32) return 4;
    if (n <= 64) return 8;
    return 16;
  });

  // Current indicator position
  let indicatorPoint = $derived(numberLinePoints[unsignedValue]);

  // Number line geometry (derived for template use)
  let nlCx = $derived(params.numberLineSize / 2);
  let nlCy = $derived(params.numberLineSize / 2);
  let nlR = $derived((params.numberLineSize / 2) - 30);
  let nlLabelR = $derived(nlR + 16);
  let nlInnerLabelR = $derived(nlR - 16);
  let nlPosEndAngle = $derived((maxSigned / totalValues) * Math.PI * 2 - Math.PI / 2);
  let nlNegStartAngle = $derived(((maxSigned + 1) / totalValues) * Math.PI * 2 - Math.PI / 2);

  // Bit change handler
  function handleBitChange(index: number, value: 0 | 1) {
    bits[index] = value;
    bits = bits;
  }

  export function setValue(n: number) {
    const clamped = Math.max(0, Math.min(maxUnsigned, Math.round(n)));
    const newBits = Array(bits.length).fill(0);
    writeUint(newBits, 0, clamped, bits.length);
    bits = newBits;
  }

  export function setSignedValue(n: number) {
    const clamped = Math.max(minSigned, Math.min(maxSigned, Math.round(n)));
    setValue(fromSigned(clamped, bits.length));
  }

  export function setBitCount(n: number) {
    const currentSigned = signedValue;
    const newMax = (1 << (n - 1)) - 1;
    const newMin = -(1 << (n - 1));
    const clampedSigned = Math.max(newMin, Math.min(newMax, currentSigned));
    const newUnsigned = fromSigned(clampedSigned, n);
    const newBits = Array(n).fill(0);
    writeUint(newBits, 0, newUnsigned, n);
    bits = newBits;
  }

  export function setStage(s: 1 | 2 | 3) { stage = s; }
  export function reset() {
    bits = Array(bits.length).fill(0);
    stage = 1;
  }

  // --- Edit mode (unsigned) ---
  function startEditUnsigned() {
    isEditingUnsigned = true;
    editValue = String(unsignedValue);
    requestAnimationFrame(() => {
      if (inputEl) {
        inputEl.focus();
        if (matchMedia('(pointer: fine)').matches) inputEl.select();
      }
    });
  }

  function startEditSigned() {
    isEditingSigned = true;
    editValue = String(signedValue);
    requestAnimationFrame(() => {
      if (inputEl) {
        inputEl.focus();
        if (matchMedia('(pointer: fine)').matches) inputEl.select();
      }
    });
  }

  function commitEdit() {
    const parsed = parseInt(editValue, 10);
    if (!isNaN(parsed)) {
      if (isEditingUnsigned) {
        setValue(parsed);
      } else if (isEditingSigned) {
        setSignedValue(parsed);
      }
    }
    isEditingUnsigned = false;
    isEditingSigned = false;
  }

  function cancelEdit() {
    isEditingUnsigned = false;
    isEditingSigned = false;
  }

  function handleEditKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') commitEdit();
    else if (e.key === 'Escape') cancelEdit();
  }

  // --- Drag-scrub ---
  function handlePointerDown(e: PointerEvent) {
    dragStartX = e.clientX;
    dragStartValue = unsignedValue;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent) {
    const dx = e.clientX - dragStartX;
    if (!isDragging && Math.abs(dx) > 5) isDragging = true;
    if (isDragging) {
      const sensitivity = Math.max(1, Math.floor(totalValues / 256));
      const delta = Math.floor(dx / 4) * sensitivity;
      let newValue = dragStartValue + delta;
      newValue = ((newValue % totalValues) + totalValues) % totalValues;
      setValue(newValue);
    }
  }

  function handlePointerUp() {
    if (!isDragging) startEditUnsigned();
    isDragging = false;
  }

  // --- Number line click ---
  function handleNumberLineClick(e: MouseEvent) {
    const svg = (e.currentTarget as SVGElement);
    const rect = svg.getBoundingClientRect();
    const cx = params.numberLineSize / 2;
    const cy = params.numberLineSize / 2;
    const mouseX = (e.clientX - rect.left) * (params.numberLineSize / rect.width);
    const mouseY = (e.clientY - rect.top) * (params.numberLineSize / rect.height);
    const angle = Math.atan2(mouseY - cy, mouseX - cx);
    // Convert angle to unsigned value (0 at top = -PI/2)
    let norm = (angle + Math.PI / 2) / (Math.PI * 2);
    if (norm < 0) norm += 1;
    // Snap to nearest labeled value for large counts
    let rawIndex = Math.round(norm * totalValues) % totalValues;
    if (totalValues > 16) {
      rawIndex = Math.round(rawIndex / labelInterval) * labelInterval;
      if (rawIndex >= totalValues) rawIndex = 0;
    }
    setValue(rawIndex);
  }
</script>

<div
  class="bit-sequence-signed"
  style="--bss-value-font-size: {params.valueFontSize}rem;"
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
    {sectionColors}
    onbitchange={handleBitChange}
  />

  <div class="readouts">
    <!-- Unsigned readout (always visible) -->
    <div class="readout unsigned">
      <span class="readout-label">unsigned:</span>
      {#if isEditingUnsigned}
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
        <span
          class="readout-value"
          class:dragging={isDragging}
          role="spinbutton"
          tabindex="0"
          aria-valuenow={unsignedValue}
          onpointerdown={handlePointerDown}
          onpointermove={handlePointerMove}
          onpointerup={handlePointerUp}
          onpointercancel={() => { isDragging = false; }}
        >
          {unsignedValue}
        </span>
      {/if}
    </div>

    <!-- Signed readout (Stage 2+) -->
    {#if stage >= 2}
      <div class="readout-divider">|</div>
      <div class="readout signed">
        <span class="readout-label">signed:</span>
        {#if isEditingSigned}
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
          <span
            class="readout-value signed-value"
            onclick={startEditSigned}
          >
            {signedValue}
          </span>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Stage 3: Circular number line -->
  {#if stage >= 3}
    <svg
      class="number-line"
      viewBox="0 0 {params.numberLineSize} {params.numberLineSize}"
      width={params.numberLineSize}
      height={params.numberLineSize}
      onclick={handleNumberLineClick}
      role="img"
      aria-label="Circular number line showing unsigned and signed values"
    >
      <!-- Background circle -->
      <circle cx={nlCx} cy={nlCy} r={nlR} fill="none" stroke="var(--color-border)" stroke-width="2" />

      <!-- Positive arc (0 to maxSigned) — blue -->
      <path
        d="M {nlCx} {nlCy - nlR} A {nlR} {nlR} 0 0 1 {nlCx + nlR * Math.cos(nlPosEndAngle)} {nlCy + nlR * Math.sin(nlPosEndAngle)}"
        fill="none"
        stroke="var(--color-accent)"
        stroke-width="4"
        opacity="0.4"
      />

      <!-- Negative arc (minSigned to -1) — red -->
      <path
        d="M {nlCx + nlR * Math.cos(nlNegStartAngle)} {nlCy + nlR * Math.sin(nlNegStartAngle)} A {nlR} {nlR} 0 0 1 {nlCx + nlR * Math.cos(-Math.PI / 2 - 0.001)} {nlCy + nlR * Math.sin(-Math.PI / 2 - 0.001)}"
        fill="none"
        stroke="rgba(239, 68, 68, 0.6)"
        stroke-width="4"
        opacity="0.4"
      />

      <!-- Tick marks and labels -->
      {#each numberLinePoints as pt, i}
        {@const showLabel = i % labelInterval === 0}
        {@const tickLen = showLabel ? 6 : 3}
        {@const dx = Math.cos(pt.angle)}
        {@const dy = Math.sin(pt.angle)}

        <line
          x1={nlCx + (nlR - tickLen) * dx}
          y1={nlCy + (nlR - tickLen) * dy}
          x2={nlCx + nlR * dx}
          y2={nlCy + nlR * dy}
          stroke="var(--color-text-muted)"
          stroke-width={showLabel ? 1.5 : 0.5}
          opacity={showLabel ? 0.8 : 0.3}
        />

        {#if showLabel}
          <!-- Outer label: unsigned -->
          <text
            x={nlCx + nlLabelR * dx}
            y={nlCy + nlLabelR * dy}
            text-anchor="middle"
            dominant-baseline="central"
            font-family="var(--font-mono)"
            font-size="9"
            fill="var(--color-text-muted)"
          >
            {pt.unsigned}
          </text>

          <!-- Inner label: signed -->
          <text
            x={nlCx + nlInnerLabelR * dx}
            y={nlCy + nlInnerLabelR * dy}
            text-anchor="middle"
            dominant-baseline="central"
            font-family="var(--font-mono)"
            font-size="9"
            fill={pt.signed < 0 ? 'rgba(239, 68, 68, 0.8)' : 'var(--color-accent)'}
          >
            {pt.signed}
          </text>
        {/if}
      {/each}

      <!-- Current value indicator -->
      {#if indicatorPoint}
        <!-- Radial line from center -->
        <line
          x1={nlCx}
          y1={nlCy}
          x2={indicatorPoint.x}
          y2={indicatorPoint.y}
          stroke="var(--color-accent)"
          stroke-width="2"
          opacity="0.5"
        />
        <!-- Dot -->
        <circle
          cx={indicatorPoint.x}
          cy={indicatorPoint.y}
          r="6"
          fill="var(--color-accent)"
        />
      {/if}
    </svg>
  {/if}

  <WidgetDebugPanel defs={paramDefs} bind:values={params} widgetId={WIDGET_ID} />
</div>

<style>
  .bit-sequence-signed {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
  }

  .readouts {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    font-family: var(--font-mono);
  }

  .readout {
    display: flex;
    align-items: baseline;
    gap: 0.375rem;
  }

  .readout-label {
    font-size: 0.875rem;
    color: var(--color-text-muted);
  }

  .readout-divider {
    color: var(--color-text-muted);
    opacity: 0.4;
    font-size: 1.25rem;
  }

  .readout-value {
    font-size: var(--bss-value-font-size);
    font-weight: 700;
    color: var(--color-text);
    cursor: ew-resize;
    border-bottom: 2px dotted var(--color-text-muted);
    transition: border-color var(--transition-fast);
    padding: 0 0.125rem;
    min-width: 2ch;
    text-align: center;
  }

  .readout-value:hover {
    border-bottom-color: var(--color-accent);
    border-bottom-style: solid;
  }

  .readout-value.dragging {
    user-select: none;
    border-bottom-color: var(--color-accent);
    border-bottom-style: solid;
  }

  .signed-value {
    cursor: text;
    color: var(--color-text);
  }

  .value-input {
    font-family: var(--font-mono);
    font-size: var(--bss-value-font-size);
    font-weight: 700;
    color: var(--color-text);
    background: transparent;
    border: none;
    border-bottom: 2px solid var(--color-accent);
    outline: none;
    text-align: center;
    width: 5ch;
  }

  .number-line {
    cursor: pointer;
    max-width: 100%;
    height: auto;
  }
</style>
