<script lang="ts">
  import type { Param } from '../../lib/params';
  import { loadParams } from '../../lib/params';
  import WidgetDebugPanel from '../debug/WidgetDebugPanel.svelte';
  import BitGridCore from './BitGridCore.svelte';

  const WIDGET_ID = 'bit-grid-bytes';

  const paramDefs: Param[] = [
    // Grid
    { name: 'cols',         value: 32,  unit: '',   category: 'grid',      min: 8,   max: 64,   step: 8,   description: 'Grid columns (8-aligned)' },
    { name: 'rows',         value: 8,   unit: '',   category: 'grid',      min: 2,   max: 16,   step: 2,   description: 'Grid rows' },
    { name: 'cellSize',     value: 14,  unit: 'px', category: 'grid',      min: 8,   max: 24,   step: 1,   description: 'Cell width/height' },
    { name: 'cellGap',      value: 2,   unit: 'px', category: 'grid',      min: 0,   max: 6,    step: 1,   description: 'Gap between cells' },
    { name: 'fontSize',     value: 10,  unit: 'px', category: 'grid',      min: 0,   max: 16,   step: 1,   description: 'Digit size (0 = color only)' },
    // Animation
    { name: 'glowDuration', value: 300, unit: 'ms', category: 'animation', min: 50,  max: 1000, step: 50,  description: 'Glow-pulse animation duration' },
    { name: 'flipInterval', value: 500, unit: 'ms', category: 'behavior',  min: 100, max: 2000, step: 100, description: 'Time between byte flips' },
    { name: 'wireSpeed',    value: 400, unit: 'ms', category: 'animation', min: 100, max: 1000, step: 50,  description: 'Dot travel time along wire' },
    // Style
    { name: 'cpuSize',      value: 80,  unit: 'px', category: 'style',     min: 40,  max: 120,  step: 10,  description: 'CPU block width/height' },
    { name: 'wireWidth',    value: 2,   unit: 'px', category: 'style',     min: 1,   max: 4,    step: 0.5, description: 'Bus wire stroke width' },
    { name: 'dotSize',      value: 6,   unit: 'px', category: 'style',     min: 3,   max: 12,   step: 1,   description: 'Traveling dot radius' },
  ];

  let params = $state(loadParams(WIDGET_ID, paramDefs));

  // State
  let bits: number[] = $state([]);
  let running = $state(true);
  let cpuVisible = $state(true);
  let containerEl: HTMLDivElement = $state();
  let isVisible = $state(false);

  // Multi-dot wire animation state
  interface WireDot { id: number; startTime: number; }
  let wireDots: WireDot[] = $state([]);
  let wireNow = $state(0);
  let wireRafId = 0;
  let dotIdCounter = 0;

  // SVG layout refs
  let cpuEl: HTMLDivElement = $state();
  let gridWrapEl: HTMLDivElement = $state();

  function randomBits(count: number): number[] {
    return Array.from({ length: count }, () => Math.round(Math.random()));
  }

  // Byte highlights: alternating tint on even/odd byte groups
  let byteHighlights = $derived.by(() => {
    const totalBits = bits.length;
    const highlights: Record<string, { indices: number[]; color: string }> = {};
    const cols = params.cols;
    const bytesPerRow = Math.floor(cols / 8);

    for (let i = 0; i < totalBits; i++) {
      const col = i % cols;
      const byteInRow = Math.floor(col / 8);
      if (byteInRow % 2 === 1) {
        const key = 'odd-bytes';
        if (!highlights[key]) highlights[key] = { indices: [], color: 'rgba(255,255,255,0.03)' };
        highlights[key].indices.push(i);
      }
    }
    return highlights;
  });

  // Resize bits array when cols/rows change
  $effect(() => {
    const targetSize = params.cols * params.rows;
    if (bits.length !== targetSize) {
      if (targetSize > bits.length) {
        bits = [...bits, ...randomBits(targetSize - bits.length)];
      } else {
        bits = bits.slice(0, targetSize);
      }
    }
  });

  // Visibility observer
  $effect(() => {
    if (!containerEl) return;
    const observer = new IntersectionObserver(
      ([entry]) => { isVisible = entry.isIntersecting; },
      { threshold: 0 }
    );
    observer.observe(containerEl);
    return () => observer.disconnect();
  });

  // Byte flip loop — flip immediately, spawn wire dot as visual echo
  $effect(() => {
    if (!isVisible || !running) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      const totalBits = bits.length;
      if (totalBits < 8) return;
      const totalBytes = Math.floor(totalBits / 8);
      const byteIdx = Math.floor(Math.random() * totalBytes);
      const startBit = byteIdx * 8;
      flipByte(startBit);
      if (cpuVisible) spawnDot();
    }, params.flipInterval);
    return () => clearInterval(id);
  });

  // Cleanup wire rAF on unmount
  $effect(() => {
    return () => { if (wireRafId) cancelAnimationFrame(wireRafId); };
  });

  function flipByte(startBit: number) {
    const newBits = [...bits];
    for (let j = 0; j < 8; j++) {
      if (startBit + j < newBits.length) {
        newBits[startBit + j] = Math.round(Math.random());
      }
    }
    bits = newBits;
  }

  function spawnDot() {
    if (wireDots.length >= 8) wireDots = wireDots.slice(1);
    wireDots = [...wireDots, { id: dotIdCounter++, startTime: performance.now() }];
    if (!wireRafId) wireRafId = requestAnimationFrame(tickWireDots);
  }

  function tickWireDots(now: number) {
    wireNow = now;
    wireDots = wireDots.filter(d => (now - d.startTime) / params.wireSpeed < 1);
    if (wireDots.length > 0) {
      wireRafId = requestAnimationFrame(tickWireDots);
    } else {
      wireRafId = 0;
    }
  }

  // Reduced motion check for wire animation
  const reducedMotion = typeof window !== 'undefined'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  // Imperative API
  export function start() { running = true; }
  export function stop() { running = false; }
  export function showCpu() { cpuVisible = true; }
  export function hideCpu() { cpuVisible = false; }
  export function reset() { bits = randomBits(params.cols * params.rows); }
</script>

<div
  class="bit-grid-bytes"
  bind:this={containerEl}
  style="
    --bgb-cpu-size: {params.cpuSize}px;
    --bgb-wire-width: {params.wireWidth}px;
    --bgb-dot-size: {params.dotSize}px;
  "
>
  {#if cpuVisible}
    <div class="cpu-block" bind:this={cpuEl}>
      <div class="cpu-chip">
        <span class="cpu-label">CPU</span>
      </div>
    </div>

    <div class="wire-container">
      <svg class="wire-svg" viewBox="0 0 60 80" preserveAspectRatio="none">
        <!-- Address bus -->
        <line x1="0" y1="30" x2="60" y2="30"
          stroke="var(--color-text-muted)"
          stroke-width={params.wireWidth}
          opacity="0.4"
        />
        <!-- Data bus -->
        <line x1="0" y1="50" x2="60" y2="50"
          stroke="var(--color-text-muted)"
          stroke-width={params.wireWidth}
          opacity="0.4"
        />

        {#if !reducedMotion?.matches}
          {#each wireDots as dot (dot.id)}
            {@const progress = Math.min((wireNow - dot.startTime) / params.wireSpeed, 1)}
            <!-- Address bus dot -->
            <circle
              cx={progress * 60}
              cy="30"
              r={params.dotSize / 2}
              fill="var(--color-accent)"
            />
            <!-- Data bus dot (slightly delayed) -->
            <circle
              cx={Math.max(0, progress - 0.15) / 0.85 * 60}
              cy="50"
              r={params.dotSize / 2}
              fill="var(--color-highlight)"
              opacity={progress > 0.15 ? 1 : 0}
            />
          {/each}
        {/if}
      </svg>
      <div class="wire-labels">
        <span class="wire-label" style="top: 22px;">ADDR</span>
        <span class="wire-label" style="top: 42px;">DATA</span>
      </div>
    </div>
  {/if}

  <div class="grid-wrap" bind:this={gridWrapEl}>
    <BitGridCore
      {bits}
      cols={params.cols}
      cellSize={params.cellSize}
      cellGap={params.cellGap}
      fontSize={params.fontSize}
      glowDuration={params.glowDuration}
      highlights={byteHighlights}
    />
    {#if cpuVisible}
      <span class="ram-label">RAM</span>
    {/if}
  </div>

  <WidgetDebugPanel defs={paramDefs} bind:values={params} widgetId={WIDGET_ID} />
</div>

<style>
  .bit-grid-bytes {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0;
    padding: 1rem;
  }

  .cpu-block {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .cpu-chip {
    width: var(--bgb-cpu-size);
    height: var(--bgb-cpu-size);
    border: 2px solid var(--color-accent);
    border-radius: 6px;
    display: grid;
    place-items: center;
    background: var(--color-bg-surface);
    position: relative;
  }

  .cpu-chip::before,
  .cpu-chip::after {
    content: '';
    position: absolute;
    background: var(--color-accent);
    opacity: 0.5;
  }

  /* CPU pins - top/bottom */
  .cpu-chip::before {
    width: 60%;
    height: 3px;
    top: -3px;
    left: 20%;
  }
  .cpu-chip::after {
    width: 60%;
    height: 3px;
    bottom: -3px;
    left: 20%;
  }

  .cpu-label {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--color-accent);
    letter-spacing: 0.1em;
  }

  .wire-container {
    flex-shrink: 0;
    width: 60px;
    height: 80px;
    position: relative;
  }

  .wire-svg {
    width: 100%;
    height: 100%;
  }

  .wire-labels {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .wire-label {
    position: absolute;
    left: 50%;
    transform: translateX(-50%) translateY(-100%);
    font-family: var(--font-mono);
    font-size: 0.5rem;
    color: var(--color-text-muted);
    opacity: 0.6;
    white-space: nowrap;
  }

  .grid-wrap {
    position: relative;
    overflow-x: auto;
  }

  .ram-label {
    position: absolute;
    top: -1.25rem;
    left: 0;
    font-family: var(--font-mono);
    font-size: 0.625rem;
    font-weight: 700;
    color: var(--color-text-muted);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  /* Mobile: stack vertically */
  @media (max-width: 600px) {
    .bit-grid-bytes {
      flex-direction: column;
      gap: 1rem;
    }

    .wire-container {
      width: 80px;
      height: 40px;
      transform: rotate(90deg);
    }
  }
</style>
