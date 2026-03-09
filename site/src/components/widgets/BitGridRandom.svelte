<script lang="ts">
  import type { Param } from '../../lib/params';
  import { loadParams } from '../../lib/params';
  import WidgetDebugPanel from '../debug/WidgetDebugPanel.svelte';
  import BitGridCore from './BitGridCore.svelte';

  const WIDGET_ID = 'bit-grid-random';

  const paramDefs: Param[] = [
    // Grid
    { name: 'cols',         value: 32,  unit: '',   category: 'grid',      min: 8,  max: 64,   step: 8,  description: 'Grid columns' },
    { name: 'rows',         value: 16,  unit: '',   category: 'grid',      min: 4,  max: 32,   step: 4,  description: 'Grid rows' },
    { name: 'cellSize',     value: 14,  unit: 'px', category: 'grid',      min: 8,  max: 24,   step: 1,  description: 'Cell width/height' },
    { name: 'cellGap',      value: 2,   unit: 'px', category: 'grid',      min: 0,  max: 6,    step: 1,  description: 'Gap between cells' },
    { name: 'fontSize',     value: 10,  unit: 'px', category: 'grid',      min: 0,  max: 16,   step: 1,  description: 'Digit size (0 = color only)' },
    // Animation
    { name: 'glowDuration', value: 300, unit: 'ms', category: 'animation', min: 50, max: 1000, step: 50, description: 'Glow-pulse animation duration' },
    // Behavior
    { name: 'flipInterval', value: 80,  unit: 'ms', category: 'behavior',  min: 16, max: 500,  step: 16, description: 'Time between flip batches' },
    { name: 'flipsPerTick', value: 3,   unit: '',   category: 'behavior',  min: 1,  max: 20,   step: 1,  description: 'Bits flipped per interval tick' },
  ];

  let params = $state(loadParams(WIDGET_ID, paramDefs));

  // State
  let bits: number[] = $state([]);
  let running = $state(true);
  let containerEl: HTMLDivElement = $state();
  let isVisible = $state(false);

  function randomBits(count: number): number[] {
    return Array.from({ length: count }, () => Math.round(Math.random()));
  }

  // Resize bits array when cols/rows change (also handles initial creation)
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

  // Visibility observer — pause when off-screen
  $effect(() => {
    if (!containerEl) return;
    const observer = new IntersectionObserver(
      ([entry]) => { isVisible = entry.isIntersecting; },
      { threshold: 0 }
    );
    observer.observe(containerEl);
    return () => observer.disconnect();
  });

  // Flip loop — only runs when visible and running
  $effect(() => {
    if (!isVisible || !running) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      const totalBits = bits.length;
      if (totalBits === 0) return;
      const flips = Math.min(params.flipsPerTick, totalBits);
      const newBits = [...bits];
      for (let f = 0; f < flips; f++) {
        const idx = Math.floor(Math.random() * totalBits);
        newBits[idx] = newBits[idx] === 0 ? 1 : 0;
      }
      bits = newBits;
    }, params.flipInterval);
    return () => clearInterval(id);
  });

  // Imperative API
  export function start() { running = true; }
  export function stop() { running = false; }
  export function reset() { bits = randomBits(params.cols * params.rows); }
</script>

<div class="bit-grid-random" bind:this={containerEl}>
  <BitGridCore
    {bits}
    cols={params.cols}
    cellSize={params.cellSize}
    cellGap={params.cellGap}
    fontSize={params.fontSize}
    glowDuration={params.glowDuration}
  />

  <WidgetDebugPanel defs={paramDefs} bind:values={params} widgetId={WIDGET_ID} />
</div>

<style>
  .bit-grid-random {
    position: relative;
    display: flex;
    justify-content: center;
    padding: 1rem;
  }
</style>
