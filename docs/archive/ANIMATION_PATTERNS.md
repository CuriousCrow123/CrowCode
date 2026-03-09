# Animation Patterns Reference

Deep dive into animation approaches used in CrowCode, with code examples for each new widget type.

---

## 1. Interval-Based Grid Animation (BitMatrix Style)

**Best for**: RAM visualization, memory grid, any cell-based data structure

**Key traits**:
- Uint8Array for data
- Direct DOM element refs (array of HTMLElements)
- setInterval loop with visibility gate
- CSS animations triggered by class toggling
- Force reflow with `offsetWidth` to retrigger

**Example: Memory Viewer Widget**

```svelte
<script lang="ts">
  import type { Param } from '../../lib/params';
  import { loadParams } from '../../lib/params';
  import WidgetDebugPanel from '../debug/WidgetDebugPanel.svelte';

  const WIDGET_ID = 'memory-viewer';

  const paramDefs: Param[] = [
    { name: 'cellSize',        value: 1.5, unit: 'rem', category: 'style',    min: 0.75, max: 3,    step: 0.25, description: 'Memory cell size' },
    { name: 'addressSize',     value: 0.75, unit: 'rem', category: 'style',   min: 0.5,  max: 1.5,  step: 0.125, description: 'Address label size' },
    { name: 'updateInterval',  value: 150,  unit: 'ms',  category: 'behavior', min: 50,   max: 500,  step: 25, description: 'Cell update frequency' },
    { name: 'cellsPerUpdate',  value: 2,    unit: '',    category: 'behavior', min: 1,    max: 8,    step: 1, description: 'Cells written per update' },
  ];

  let params = $state(loadParams(WIDGET_ID, paramDefs));

  // Memory state: [address]: value
  let memory: Uint8Array = $state(new Uint8Array(256));
  let cellEls: HTMLSpanElement[] = [];
  let gridEl: HTMLDivElement;
  let containerWidth = $state(0);
  let isVisible = $state(true);

  // Calculate grid layout
  let cols = $derived(Math.max(1, Math.floor(containerWidth / (params.cellSize * 16))));
  let rows = $derived(Math.ceil(memory.length / cols));

  // Effect 1: Build/rebuild grid when dimensions change
  $effect(() => {
    if (!gridEl || containerWidth === 0) return;

    const newCols = Math.max(1, Math.floor(containerWidth / (params.cellSize * 16)));
    const newRows = Math.ceil(memory.length / newCols);

    // Only rebuild if layout changed
    if (cellEls.length !== memory.length) {
      gridEl.innerHTML = '';
      cellEls = [];

      for (let i = 0; i < memory.length; i++) {
        const span = document.createElement('span');
        span.className = 'cell';
        span.textContent = memory[i].toString(16).padStart(2, '0');
        span.setAttribute('data-address', String(i));
        span.addEventListener('animationend', () => span.classList.remove('written'));
        gridEl.appendChild(span);
        cellEls.push(span);
      }
    }

    return () => { if (gridEl) gridEl.innerHTML = ''; };
  });

  // Effect 2: Visibility observer
  $effect(() => {
    if (!gridEl) return;
    const observer = new IntersectionObserver(
      ([entry]) => { isVisible = entry.isIntersecting; },
      { threshold: 0, rootMargin: '100px 0px' }
    );
    observer.observe(gridEl);
    return () => observer.disconnect();
  });

  // Effect 3: Memory update loop
  $effect(() => {
    if (!isVisible || memory.length === 0) return;

    const cancel = { canceled: false };
    const id = setInterval(() => {
      if (cancel.canceled || document.hidden) return;

      // Update random cells
      for (let i = 0; i < params.cellsPerUpdate; i++) {
        const addr = Math.floor(Math.random() * memory.length);
        const oldValue = memory[addr];
        memory[addr] = (oldValue + 1) % 256;

        // Update DOM
        if (cellEls[addr]) {
          cellEls[addr].textContent = memory[addr].toString(16).padStart(2, '0');
          cellEls[addr].classList.remove('written');
          void cellEls[addr].offsetWidth;  // Force reflow
          cellEls[addr].classList.add('written');
        }
      }
    }, params.updateInterval);

    return () => { cancel.canceled = true; clearInterval(id); };
  });

  // Imperative API
  export function writeCell(address: number, value: number) {
    if (address >= 0 && address < memory.length) {
      memory[address] = value;
      if (cellEls[address]) {
        cellEls[address].textContent = value.toString(16).padStart(2, '0');
        cellEls[address].classList.remove('written');
        void cellEls[address].offsetWidth;
        cellEls[address].classList.add('written');
      }
    }
  }

  export function clear() {
    memory.fill(0);
    for (const el of cellEls) {
      el.textContent = '00';
      el.classList.remove('written');
    }
  }
</script>

<div
  class="memory-viewer"
  bind:clientWidth={containerWidth}
  style="
    --memory-cell-size: {params.cellSize}rem;
    --memory-address-size: {params.addressSize}rem;
  "
>
  <div class="grid" bind:this={gridEl} role="img" aria-label="Memory grid showing {rows}x{cols} cells"></div>

  <WidgetDebugPanel defs={paramDefs} bind:values={params} widgetId={WIDGET_ID} />
</div>

<style>
  .memory-viewer {
    position: relative;
    padding: 1rem;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--memory-cell-size), 1fr));
    gap: 4px;
    padding: 1rem;
    background: var(--color-bg-surface);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    content-visibility: auto;
  }

  /* Direct children created with createElement */
  :global(.grid .cell) {
    display: grid;
    place-items: center;
    width: var(--memory-cell-size);
    height: var(--memory-cell-size);
    font-family: var(--font-mono);
    font-size: calc(var(--memory-cell-size) * 0.4);
    font-weight: 700;
    color: var(--color-text-muted);
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: 3px;
    user-select: none;
  }

  :global(.grid .cell.written) {
    animation: cell-written 300ms ease-out forwards;
  }

  @keyframes cell-written {
    0% {
      color: var(--color-highlight);
      background: rgba(245, 166, 35, 0.1);
      border-color: var(--color-highlight);
      box-shadow: 0 0 8px rgba(245, 166, 35, 0.3);
    }
    100% {
      color: var(--color-text-muted);
      background: var(--color-bg-raised);
      border-color: var(--color-border);
      box-shadow: none;
    }
  }
</style>
```

---

## 2. SVG Signal Animation (BitRepresenter Style)

**Best for**: Signal propagation, wired connections, cascading updates

**Key traits**:
- SVG curves with Bezier paths
- `getTotalLength()` to measure paths
- `stroke-dasharray` + `stroke-dashoffset` for animation
- CSS transitions on dash offset
- Staggered timeouts for signal cascade

**Example: CPU Bus Widget**

```svelte
<script lang="ts">
  import type { Param } from '../../lib/params';
  import { loadParams } from '../../lib/params';
  import WidgetDebugPanel from '../debug/WidgetDebugPanel.svelte';

  const WIDGET_ID = 'cpu-bus';

  const paramDefs: Param[] = [
    { name: 'componentSize',  value: 3,   unit: 'rem', category: 'style',    min: 2,   max: 5,    step: 0.25, description: 'CPU/Memory component size' },
    { name: 'wireWidth',      value: 2,   unit: 'px',  category: 'style',    min: 1,   max: 4,    step: 1, description: 'Wire stroke width' },
    { name: 'signalSpeed',    value: 400, unit: 'ms',  category: 'behavior', min: 100, max: 1000, step: 50, description: 'Signal travel time' },
  ];

  let params = $state(loadParams(WIDGET_ID, paramDefs));

  let containerWidth = $state(0);
  let containerHeight = $state(0);
  let signalStates: Record<string, 0 | 1> = $state({ bus1: 0, bus2: 0, bus3: 0 });
  let pathEls: Record<string, SVGPathElement> = $state({});
  let pathLengths: Record<string, number> = $state({});
  let pendingTimeouts: ReturnType<typeof setTimeout>[] = [];

  // Compute layout
  let cpuX = $derived(50);
  let cpuY = $derived(containerHeight / 2);
  let memX = $derived(containerWidth - 100);
  let memY = $derived(containerHeight / 2);

  // Measure paths
  $effect(() => {
    for (const [key, el] of Object.entries(pathEls)) {
      if (el) pathLengths[key] = el.getTotalLength();
    }
  });

  // Cleanup timeouts on destroy
  $effect(() => {
    return () => {
      for (const id of pendingTimeouts) clearTimeout(id);
    };
  });

  function sendSignal(busName: string) {
    // Clear previous timeouts for this bus
    pendingTimeouts = pendingTimeouts.filter(id => {
      if (signalStates[busName] === 0) return true;
      return false;
    });

    signalStates[busName] = 1;

    const timeout = setTimeout(() => {
      signalStates[busName] = 0;
    }, params.signalSpeed);

    pendingTimeouts.push(timeout);
  }

  export function transferData() {
    sendSignal('bus1');
    setTimeout(() => sendSignal('bus2'), params.signalSpeed * 0.4);
    setTimeout(() => sendSignal('bus3'), params.signalSpeed * 0.8);
  }
</script>

<div
  class="cpu-bus"
  bind:clientWidth={containerWidth}
  bind:clientHeight={containerHeight}
  style="
    --cpu-bus-component-size: {params.componentSize}rem;
    --cpu-bus-wire-width: {params.wireWidth}px;
  "
>
  <!-- CPU component -->
  <div class="cpu" style="left: {cpuX}px; top: {cpuY}px;">
    <div class="label">CPU</div>
  </div>

  <!-- Memory component -->
  <div class="mem" style="right: {containerWidth - memX}px; top: {memY}px;">
    <div class="label">MEM</div>
  </div>

  <!-- SVG wires -->
  {#if containerWidth > 0 && containerHeight > 0}
    <svg class="wires" viewBox="0 0 {containerWidth} {containerHeight}">
      {#each ['bus1', 'bus2', 'bus3'] as busName, i}
        {@const startX = cpuX + params.componentSize * 8}
        {@const startY = cpuY + (i - 1) * 30}
        {@const endX = memX - params.componentSize * 8}
        {@const endY = startY}
        {@const cpOff = (endX - startX) * 0.3}
        {@const d = `M ${startX} ${startY} C ${startX + cpOff} ${startY}, ${endX - cpOff} ${endY}, ${endX} ${endY}`}

        <!-- Resting wire -->
        <path {d} stroke="var(--color-border)" stroke-width="var(--cpu-bus-wire-width)" stroke-linecap="round" fill="none" />

        <!-- Signal wire -->
        <path
          bind:this={pathEls[busName]}
          {d}
          stroke="var(--color-accent)"
          stroke-width="var(--cpu-bus-wire-width)"
          stroke-linecap="round"
          fill="none"
          stroke-dasharray={pathLengths[busName] || 0}
          stroke-dashoffset={signalStates[busName] === 1 ? 0 : pathLengths[busName]}
          style="transition: stroke-dashoffset {params.signalSpeed}ms ease;"
          opacity={signalStates[busName] === 1 ? 1 : 0}
        />
      {/each}
    </svg>
  {/if}

  <WidgetDebugPanel defs={paramDefs} bind:values={params} widgetId={WIDGET_ID} />
</div>

<style>
  .cpu-bus {
    position: relative;
    width: 100%;
    height: 250px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg-surface);
    padding: 1rem;
  }

  .wires {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .cpu, .mem {
    position: absolute;
    transform: translate(-50%, -50%);
    width: var(--cpu-bus-component-size);
    height: var(--cpu-bus-component-size);
    display: grid;
    place-items: center;
    border: 2px solid var(--color-accent);
    border-radius: var(--radius-md);
    background: var(--color-bg-raised);
    font-family: var(--font-mono);
    font-size: 0.75rem;
    font-weight: 700;
  }

  .label {
    color: var(--color-text);
  }
</style>
```

---

## 3. Continuous Sin Wave Animation

**Best for**: Mathematical visualizations, oscillators, continuous functions

**Key traits**:
- Canvas 2D context for smooth drawing
- Frame counter for time progression
- Params: frequency, amplitude, speed
- Visibility gate + document.hidden check
- requestAnimationFrame OR setInterval (setInterval simpler)

**Example: Sin Wave Visualizer**

```svelte
<script lang="ts">
  import type { Param } from '../../lib/params';
  import { loadParams } from '../../lib/params';
  import WidgetDebugPanel from '../debug/WidgetDebugPanel.svelte';

  const WIDGET_ID = 'sin-wave';

  const paramDefs: Param[] = [
    { name: 'frequency',     value: 0.05, unit: '',    category: 'behavior', min: 0.01, max: 0.2,  step: 0.01, description: 'Wave frequency (cycles per step)' },
    { name: 'amplitude',     value: 50,   unit: 'px',  category: 'behavior', min: 10,   max: 150,  step: 10, description: 'Wave height in pixels' },
    { name: 'speed',         value: 16,   unit: 'ms',  category: 'behavior', min: 1,    max: 50,   step: 1, description: 'Update interval' },
    { name: 'lineWidth',     value: 2,    unit: 'px',  category: 'style',    min: 1,    max: 8,    step: 1, description: 'Wave line thickness' },
    { name: 'trailLength',   value: 0.5,  unit: '',    category: 'behavior', min: 0.1,  max: 1,    step: 0.1, description: 'Fade trail (0=infinite, 1=current only)' },
  ];

  let params = $state(loadParams(WIDGET_ID, paramDefs));

  let canvas: HTMLCanvasElement;
  let isVisible = $state(true);
  let frame = 0;

  // Effect: Visibility observer
  $effect(() => {
    if (!canvas) return;
    const observer = new IntersectionObserver(
      ([entry]) => { isVisible = entry.isIntersecting; },
      { threshold: 0, rootMargin: '100px 0px' }
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  });

  // Effect: Animation loop
  $effect(() => {
    if (!isVisible || !canvas) return;

    const ctx = canvas.getContext('2d')!;
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;

    // Set canvas resolution to match display size
    canvas.width = w;
    canvas.height = h;

    const cancel = { canceled: false };
    frame = 0;

    const id = setInterval(() => {
      if (cancel.canceled || document.hidden) return;

      // Clear with fade trail
      ctx.fillStyle = `rgba(15, 17, 23, ${params.trailLength})`;
      ctx.fillRect(0, 0, w, h);

      // Draw wave
      ctx.strokeStyle = 'var(--color-accent)';
      ctx.lineWidth = params.lineWidth;
      ctx.lineCap = 'round';
      ctx.beginPath();

      for (let x = 0; x < w; x += 2) {
        const phase = (x / w) * Math.PI * 2;
        const y = h / 2 + Math.sin(frame * params.frequency + phase) * params.amplitude;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      ctx.stroke();

      frame += 1;
    }, params.speed);

    return () => { cancel.canceled = true; clearInterval(id); };
  });
</script>

<div class="sin-wave" style="--sin-wave-line-width: {params.lineWidth}px;">
  <canvas bind:this={canvas} width="800" height="200"></canvas>
  <WidgetDebugPanel defs={paramDefs} bind:values={params} widgetId={WIDGET_ID} />
</div>

<style>
  .sin-wave {
    position: relative;
    padding: 1rem;
  }

  canvas {
    width: 100%;
    max-width: var(--figure-width);
    height: auto;
    display: block;
    margin: 0 auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg-surface);
  }
</style>
```

---

## 4. Canvas-Based RGB Visualizer

**Best for**: Color channels, visual representations, multi-layer rendering

**Key traits**:
- Three separate canvases or layers
- Individual channel control
- Real-time color swatch preview
- Feedback visualization

**Example: RGB Viewer**

```svelte
<script lang="ts">
  import type { Param } from '../../lib/params';
  import { loadParams } from '../../lib/params';
  import WidgetDebugPanel from '../debug/WidgetDebugPanel.svelte';

  const WIDGET_ID = 'rgb-viewer';

  const paramDefs: Param[] = [
    { name: 'r',           value: 100, unit: '', category: 'behavior', min: 0, max: 255, step: 1, description: 'Red channel (0-255)' },
    { name: 'g',           value: 150, unit: '', category: 'behavior', min: 0, max: 255, step: 1, description: 'Green channel (0-255)' },
    { name: 'b',           value: 200, unit: '', category: 'behavior', min: 0, max: 255, step: 1, description: 'Blue channel (0-255)' },
    { name: 'swatchSize',  value: 6,   unit: 'rem', category: 'style', min: 2, max: 12, step: 0.5, description: 'Color preview size' },
  ];

  let params = $state(loadParams(WIDGET_ID, paramDefs));

  // Computed RGB
  let rgbString = $derived(`rgb(${params.r}, ${params.g}, ${params.b})`);
  let hexString = $derived(`#${params.r.toString(16).padStart(2, '0')}${params.g.toString(16).padStart(2, '0')}${params.b.toString(16).padStart(2, '0')}`.toUpperCase());

  let canvasR: HTMLCanvasElement;
  let canvasG: HTMLCanvasElement;
  let canvasB: HTMLCanvasElement;
  let isVisible = $state(true);
  let frameR = 0, frameG = 0, frameB = 0;

  // Effect: Visibility observer
  $effect(() => {
    if (!canvasR) return;
    const observer = new IntersectionObserver(
      ([entry]) => { isVisible = entry.isIntersecting; },
      { threshold: 0, rootMargin: '50px 0px' }
    );
    observer.observe(canvasR);
    return () => observer.disconnect();
  });

  // Effect: Animate channels
  $effect(() => {
    if (!isVisible || !canvasR || !canvasG || !canvasB) return;

    const cancel = { canceled: false };

    const draw = (canvas: HTMLCanvasElement, frame: number, channel: 'r' | 'g' | 'b') => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      const ctx = canvas.getContext('2d')!;
      const w = canvas.width;
      const h = canvas.height;
      const value = params[channel];

      // Fade background
      ctx.fillStyle = 'rgba(15, 17, 23, 0.5)';
      ctx.fillRect(0, 0, w, h);

      // Draw channel bar
      const barWidth = (value / 255) * w;
      ctx.fillStyle = channel === 'r' ? '#ff4444' : channel === 'g' ? '#44ff44' : '#4444ff';
      ctx.fillRect(0, 0, barWidth, h);

      // Draw wave overlay
      ctx.strokeStyle = channel === 'r' ? '#ff8888' : channel === 'g' ? '#88ff88' : '#8888ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x < w; x += 4) {
        const phase = (x / w) * Math.PI * 2;
        const y = h / 2 + Math.sin(frame * 0.05 + phase) * (value / 512) * h;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    const id = setInterval(() => {
      if (cancel.canceled || document.hidden) return;

      frameR += 1;
      frameG += 1;
      frameB += 1;

      draw(canvasR, frameR, 'r');
      draw(canvasG, frameG, 'g');
      draw(canvasB, frameB, 'b');
    }, 16);

    return () => { cancel.canceled = true; clearInterval(id); };
  });

  export function setColor(r: number, g: number, b: number) {
    params.r = Math.max(0, Math.min(255, r));
    params.g = Math.max(0, Math.min(255, g));
    params.b = Math.max(0, Math.min(255, b));
  }

  export function randomColor() {
    setColor(
      Math.floor(Math.random() * 256),
      Math.floor(Math.random() * 256),
      Math.floor(Math.random() * 256)
    );
  }
</script>

<div class="rgb-viewer" style="--rgb-swatch-size: {params.swatchSize}rem;">
  <div class="channels">
    <div class="channel">
      <label for="r">Red</label>
      <input type="range" id="r" min="0" max="255" bind:value={params.r} />
      <span class="value">{params.r}</span>
    </div>
    <div class="channel">
      <label for="g">Green</label>
      <input type="range" id="g" min="0" max="255" bind:value={params.g} />
      <span class="value">{params.g}</span>
    </div>
    <div class="channel">
      <label for="b">Blue</label>
      <input type="range" id="b" min="0" max="255" bind:value={params.b} />
      <span class="value">{params.b}</span>
    </div>
  </div>

  <div class="display">
    <div class="swatch" style="background: {rgbString};"></div>
    <div class="values">
      <div>{rgbString}</div>
      <div>{hexString}</div>
    </div>
  </div>

  <div class="canvases">
    <div class="canvas-row">
      <span>R</span>
      <canvas bind:this={canvasR} width="400" height="60"></canvas>
    </div>
    <div class="canvas-row">
      <span>G</span>
      <canvas bind:this={canvasG} width="400" height="60"></canvas>
    </div>
    <div class="canvas-row">
      <span>B</span>
      <canvas bind:this={canvasB} width="400" height="60"></canvas>
    </div>
  </div>

  <WidgetDebugPanel defs={paramDefs} bind:values={params} widgetId={WIDGET_ID} />
</div>

<style>
  .rgb-viewer {
    position: relative;
    padding: 1rem;
  }

  .channels {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .channel {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .channel label {
    min-width: 3rem;
    font-family: var(--font-mono);
    font-size: 0.875rem;
  }

  .channel input[type='range'] {
    flex: 1;
    height: 6px;
  }

  .channel .value {
    min-width: 3rem;
    text-align: right;
    font-family: var(--font-mono);
    color: var(--color-text-muted);
  }

  .display {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
    padding: 1rem;
    background: var(--color-bg-raised);
    border-radius: var(--radius-md);
  }

  .swatch {
    width: var(--rgb-swatch-size);
    height: var(--rgb-swatch-size);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .values {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-family: var(--font-mono);
    font-size: 0.875rem;
  }

  .canvases {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .canvas-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .canvas-row span {
    min-width: 1.5rem;
    font-family: var(--font-mono);
    font-weight: 700;
    color: var(--color-text-muted);
  }

  .canvas-row canvas {
    flex: 1;
    border: 1px solid var(--color-border);
    border-radius: 3px;
    background: var(--color-bg-surface);
  }
</style>
```

---

## Performance Checklist

For all animations:

- [ ] Visibility observer gates the animation loop
- [ ] `document.hidden` check prevents rendering when tab is inactive
- [ ] Intervals/RAF IDs cleared on effect cleanup
- [ ] Timeouts tracked and cleared on unmount
- [ ] Canvas DPI-aware (scale by `devicePixelRatio`)
- [ ] DOM elements cached in arrays (not queried repeatedly)
- [ ] Uint8Array used for bulk numeric data
- [ ] No `innerHTML` in animation loops
- [ ] Grid uses `content-visibility: auto` if large

---

## Common Canvas Patterns

### Get DPI-aware canvas
```svelte
<script lang="ts">
  let canvas: HTMLCanvasElement;

  $effect(() => {
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, rect.width, rect.height);
  });
</script>

<canvas bind:this={canvas}></canvas>
```

### Simple color helpers
```typescript
function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('').toUpperCase()}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? [
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16),
  ] : [0, 0, 0];
}
```

### Lerp (linear interpolation)
```typescript
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

// Use in animations:
const value = lerp(startValue, endValue, frame / totalFrames);
```

---

## Testing Patterns

### Test in sandbox first
Always create `src/pages/sandbox/widget-name.astro` before integrating into sections.

### Verify performance
- Open DevTools
- Throttle CPU (6x slowdown)
- Scroll widget in/out of view → animation should pause
- Switch tabs → animation should pause
- Check Memory tab for leaks after 10s of animation

### Accessibility
- Add `role="img"` + `aria-label` to custom canvas/SVG elements
- Include `aria-hidden="true"` on purely decorative DOM
- Support `prefers-reduced-motion: reduce`

---

## Gotchas

❌ **Canvas context is cleared on resize** — Re-measure and redraw every frame if canvas size can change

❌ **SVG path lengths are 0 before render** — Use `$effect()` to measure, not synchronous code

❌ **Timeouts/intervals keep running if not cleared** — Always return cleanup function from `$effect()`

❌ **Frame counter keeps incrementing during pause** — Reset frame counter when resuming if needed for smooth restart

❌ **CSS animations fire `animationend` even if display:none** — Use visibility observer, not just visibility:hidden

---

## Reference: Existing Animation Files

- **Interval grid pattern**: `/Users/alan/Desktop/CrowCode/site/src/components/widgets/BitMatrix.svelte`
- **SVG signal pattern**: `/Users/alan/Desktop/CrowCode/site/src/components/widgets/BitRepresenter.svelte`
- **Simple state pattern**: `/Users/alan/Desktop/CrowCode/site/src/components/widgets/SingleBit.svelte`

Copy, modify, iterate. All absolute paths.
