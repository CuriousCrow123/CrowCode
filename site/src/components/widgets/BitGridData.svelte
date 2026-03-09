<script lang="ts">
  import type { Param } from '../../lib/params';
  import { loadParams } from '../../lib/params';
  import WidgetDebugPanel from '../debug/WidgetDebugPanel.svelte';
  import BitGridCore from './BitGridCore.svelte';

  const WIDGET_ID = 'bit-grid-data';

  const paramDefs: Param[] = [
    // Grid
    { name: 'cols',            value: 16,  unit: '',   category: 'grid',      min: 8,   max: 32,   step: 8,   description: 'Grid columns' },
    { name: 'rows',            value: 4,   unit: '',   category: 'grid',      min: 2,   max: 8,    step: 2,   description: 'Grid rows' },
    { name: 'cellSize',        value: 14,  unit: 'px', category: 'grid',      min: 8,   max: 24,   step: 1,   description: 'Cell width/height' },
    { name: 'cellGap',         value: 2,   unit: 'px', category: 'grid',      min: 0,   max: 6,    step: 1,   description: 'Gap between cells' },
    { name: 'fontSize',        value: 10,  unit: 'px', category: 'grid',      min: 0,   max: 16,   step: 1,   description: 'Digit size' },
    // Animation
    { name: 'glowDuration',    value: 300, unit: 'ms', category: 'animation', min: 50,  max: 1000, step: 50,  description: 'Glow-pulse duration' },
    // Behavior
    { name: 'bitDepth',        value: 8,   unit: '',   category: 'behavior',  min: 8,   max: 16,   step: 8,   description: 'Bits per value (8 or 16)' },
    { name: 'ambientRate',     value: 200, unit: 'ms', category: 'behavior',  min: 50,  max: 1000, step: 50,  description: 'Ambient random flip interval' },
    // Physics
    { name: 'gravity',         value: 500, unit: '',   category: 'physics',   min: 100, max: 2000, step: 100, description: 'Gravity strength' },
    { name: 'curveAmplitude',  value: 60,  unit: 'px', category: 'physics',   min: 20,  max: 120,  step: 10,  description: 'Sine wave amplitude' },
    { name: 'curveWavelength', value: 200, unit: 'px', category: 'physics',   min: 100, max: 400,  step: 20,  description: 'Sine wave wavelength' },
    // Style
    { name: 'ballSize',        value: 8,   unit: 'px', category: 'style',     min: 4,   max: 16,   step: 1,   description: 'Ball radius' },
    { name: 'canvasHeight',    value: 160, unit: 'px', category: 'style',     min: 80,  max: 300,  step: 10,  description: 'Animation canvas height' },
    { name: 'wireSpeed',       value: 400, unit: 'ms', category: 'animation', min: 100, max: 1000, step: 50,  description: 'Bus wire dot travel time' },
    { name: 'cpuSize',         value: 80,  unit: 'px', category: 'style',     min: 40,  max: 120,  step: 10,  description: 'CPU block size' },
  ];

  let params = $state(loadParams(WIDGET_ID, paramDefs));

  // State
  let bits: number[] = $state(randomBits(params.cols * params.rows));
  let running = $state(true);
  let cpuVisible = $state(true);
  let containerEl: HTMLDivElement;
  let canvasEl: HTMLCanvasElement;
  let isVisible = $state(false);

  // Physics state
  let ballX = $state(0); // position along curve (in px units, wraps at wavelength)
  let ballV = $state(0); // velocity along curve tangent
  let lastFrameTime = $state(0);

  // Decoded values for display
  let decodedX = $state(0);
  let decodedY = $state(0);

  // Wire animation state
  let wireProgress = $state(-1);
  let wireAnimationId = $state(0);
  let lastWireTime = $state(0);

  const reducedMotion = typeof window !== 'undefined'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  function randomBits(count: number): number[] {
    return Array.from({ length: count }, () => Math.round(Math.random()));
  }

  // Number of bits used for x and y data
  let dataBits = $derived(params.bitDepth * 2);
  let maxVal = $derived((1 << params.bitDepth) - 1);

  // Highlight groups for x and y bytes
  let dataHighlights = $derived.by(() => {
    const bd = params.bitDepth;
    const xIndices: number[] = [];
    const yIndices: number[] = [];
    for (let i = 0; i < bd; i++) {
      xIndices.push(i);
      yIndices.push(bd + i);
    }
    return {
      x: { indices: xIndices, color: 'rgba(77, 159, 255, 0.15)' }, // cyan-ish
      y: { indices: yIndices, color: 'rgba(245, 166, 35, 0.15)' },  // orange-ish
    };
  });

  // Write an integer value to bits array at a given bit offset
  function writeValue(newBits: number[], offset: number, value: number, numBits: number) {
    const clamped = Math.max(0, Math.min((1 << numBits) - 1, Math.round(value)));
    for (let i = 0; i < numBits; i++) {
      newBits[offset + i] = (clamped >> (numBits - 1 - i)) & 1;
    }
  }

  // Read an integer value from bits array
  function readValue(bitsArr: number[], offset: number, numBits: number): number {
    let val = 0;
    for (let i = 0; i < numBits; i++) {
      val = (val << 1) | (bitsArr[offset + i] ?? 0);
    }
    return val;
  }

  // Format binary string
  function toBinary(value: number, numBits: number): string {
    return value.toString(2).padStart(numBits, '0');
  }

  // Resize bits array when params change
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

  // Ambient random flips on non-data bits
  $effect(() => {
    if (!isVisible || !running) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      const totalBits = bits.length;
      const dataEnd = dataBits;
      if (dataEnd >= totalBits) return;
      const idx = dataEnd + Math.floor(Math.random() * (totalBits - dataEnd));
      const newBits = [...bits];
      newBits[idx] = newBits[idx] === 0 ? 1 : 0;
      bits = newBits;
    }, params.ambientRate);
    return () => clearInterval(id);
  });

  // Physics simulation + canvas rendering (rAF loop)
  $effect(() => {
    if (!isVisible || !running || !canvasEl) return;

    // Initialize ball at a peak
    ballX = params.curveWavelength / 4; // start at first peak
    ballV = 0;
    lastFrameTime = performance.now();

    let rafId: number;

    function tick(now: number) {
      const dt = Math.min((now - lastFrameTime) / 1000, 0.05); // cap dt to avoid spiral
      lastFrameTime = now;

      if (!reducedMotion?.matches) {
        // Physics: ball constrained to sine track
        const A = params.curveAmplitude;
        const wl = params.curveWavelength;
        const g = params.gravity;
        const k = (2 * Math.PI) / wl;

        // Slope of sine curve at ballX
        const dydx = A * k * Math.cos(k * ballX);
        const theta = Math.atan(dydx);

        // Tangential acceleration from gravity
        // Negative because going "downhill" (positive slope going right means going up)
        const at = -g * Math.sin(theta);

        // Update velocity and position (semi-implicit Euler for better energy conservation)
        ballV += at * dt;
        ballX += ballV * Math.cos(theta) * dt;

        // Wrap periodically
        ballX = ((ballX % wl) + wl) % wl;
      }

      // Compute canvas ball position
      const canvasWidth = canvasEl.clientWidth;
      const canvasHeight = params.canvasHeight;
      const A = params.curveAmplitude;
      const wl = params.curveWavelength;

      // Map ballX to canvas coordinates (tile the sine wave across canvas width)
      const canvasX = (ballX / wl) * canvasWidth;
      const centerY = canvasHeight / 2;
      const canvasY = centerY - A * Math.sin((2 * Math.PI * ballX) / wl);

      // Map to integer values for bits
      const xNorm = ballX / wl; // 0..1
      const yNorm = (canvasY / canvasHeight); // 0..1
      const xInt = Math.round(xNorm * maxVal);
      const yInt = Math.round(yNorm * maxVal);

      decodedX = xInt;
      decodedY = yInt;

      // Write to bits array
      const newBits = [...bits];
      writeValue(newBits, 0, xInt, params.bitDepth);
      writeValue(newBits, params.bitDepth, yInt, params.bitDepth);
      bits = newBits;

      // Trigger wire animation at throttled rate (~10hz)
      if (cpuVisible && now - lastWireTime > 100) {
        lastWireTime = now;
        triggerWire();
      }

      // Render canvas
      renderCanvas(canvasX, canvasY);

      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  });

  function triggerWire() {
    if (wireProgress >= 0) return; // already animating
    wireProgress = 0;
    const startTime = performance.now();
    const duration = params.wireSpeed;

    function animate(now: number) {
      const elapsed = now - startTime;
      wireProgress = Math.min(elapsed / duration, 1);
      if (wireProgress < 1) {
        wireAnimationId = requestAnimationFrame(animate);
      } else {
        wireProgress = -1;
      }
    }
    wireAnimationId = requestAnimationFrame(animate);
  }

  function renderCanvas(ballCanvasX: number, ballCanvasY: number) {
    if (!canvasEl) return;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvasEl.clientWidth;
    const h = params.canvasHeight;

    // Set canvas resolution
    if (canvasEl.width !== w * dpr || canvasEl.height !== h * dpr) {
      canvasEl.width = w * dpr;
      canvasEl.height = h * dpr;
      ctx.scale(dpr, dpr);
    }

    ctx.clearRect(0, 0, w, h);

    // Draw sine curve
    const A = params.curveAmplitude;
    const wl = params.curveWavelength;
    const centerY = h / 2;

    ctx.beginPath();
    ctx.strokeStyle = getComputedStyle(canvasEl).getPropertyValue('--color-text-muted').trim() || '#8b90a0';
    ctx.lineWidth = 1.5;
    for (let px = 0; px <= w; px++) {
      const xOnCurve = (px / w) * wl;
      const y = centerY - A * Math.sin((2 * Math.PI * xOnCurve) / wl);
      if (px === 0) ctx.moveTo(px, y);
      else ctx.lineTo(px, y);
    }
    ctx.stroke();

    // Draw ball
    ctx.beginPath();
    ctx.fillStyle = getComputedStyle(canvasEl).getPropertyValue('--color-accent').trim() || '#4d9fff';
    ctx.arc(ballCanvasX, ballCanvasY, params.ballSize, 0, Math.PI * 2);
    ctx.fill();

    // Ball glow
    ctx.beginPath();
    ctx.fillStyle = (getComputedStyle(canvasEl).getPropertyValue('--color-accent').trim() || '#4d9fff') + '40';
    ctx.arc(ballCanvasX, ballCanvasY, params.ballSize * 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Imperative API
  export function start() { running = true; }
  export function stop() { running = false; }
  export function showCpu() { cpuVisible = true; }
  export function hideCpu() { cpuVisible = false; }
  export function setBitDepth(depth: 8 | 16) { params.bitDepth = depth; }
  export function reset() {
    ballX = params.curveWavelength / 4;
    ballV = 0;
    bits = randomBits(params.cols * params.rows);
  }
</script>

<div
  class="bit-grid-data"
  bind:this={containerEl}
  style="
    --bgd-cpu-size: {params.cpuSize}px;
    --bgd-canvas-height: {params.canvasHeight}px;
  "
>
  <div class="main-layout">
    {#if cpuVisible}
      <div class="cpu-section">
        <div class="cpu-chip">
          <span class="cpu-label">CPU</span>
        </div>

        <div class="wire-container">
          <svg class="wire-svg" viewBox="0 0 60 80" preserveAspectRatio="none">
            <line x1="0" y1="30" x2="60" y2="30"
              stroke="var(--color-text-muted)" stroke-width="2" opacity="0.4"
            />
            <line x1="0" y1="50" x2="60" y2="50"
              stroke="var(--color-text-muted)" stroke-width="2" opacity="0.4"
            />
            {#if wireProgress >= 0 && !reducedMotion?.matches}
              <circle cx={wireProgress * 60} cy="30" r="3" fill="var(--color-accent)" />
              <circle
                cx={Math.max(0, wireProgress - 0.15) / 0.85 * 60} cy="50" r="3"
                fill="var(--color-highlight)"
                opacity={wireProgress > 0.15 ? 1 : 0}
              />
            {/if}
          </svg>
        </div>
      </div>
    {/if}

    <div class="grid-and-decode">
      <div class="grid-section">
        <BitGridCore
          {bits}
          cols={params.cols}
          cellSize={params.cellSize}
          cellGap={params.cellGap}
          fontSize={params.fontSize}
          glowDuration={params.glowDuration}
          highlights={dataHighlights}
        />
      </div>

      <div class="decode-panel">
        <div class="decode-row x-row">
          <span class="decode-label">x</span>
          <span class="decode-binary">{toBinary(decodedX, params.bitDepth)}</span>
          <span class="decode-equals">=</span>
          <span class="decode-decimal">{decodedX}</span>
        </div>
        <div class="decode-row y-row">
          <span class="decode-label">y</span>
          <span class="decode-binary">{toBinary(decodedY, params.bitDepth)}</span>
          <span class="decode-equals">=</span>
          <span class="decode-decimal">{decodedY}</span>
        </div>
      </div>
    </div>
  </div>

  <div class="canvas-section">
    <canvas
      bind:this={canvasEl}
      class="sine-canvas"
      style="height: {params.canvasHeight}px;"
      aria-label="Ball rolling along a sine wave, position encoded as binary in the grid above"
    ></canvas>
    {#if reducedMotion?.matches}
      <p class="reduced-motion-note">(animation paused — reduced motion)</p>
    {/if}
  </div>

  <WidgetDebugPanel defs={paramDefs} bind:values={params} widgetId={WIDGET_ID} />
</div>

<style>
  .bit-grid-data {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
  }

  .main-layout {
    display: flex;
    align-items: center;
    gap: 0;
  }

  .cpu-section {
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }

  .cpu-chip {
    width: var(--bgd-cpu-size);
    height: var(--bgd-cpu-size);
    border: 2px solid var(--color-accent);
    border-radius: 6px;
    display: grid;
    place-items: center;
    background: var(--color-bg-surface);
    flex-shrink: 0;
  }

  .cpu-label {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--color-accent);
    letter-spacing: 0.1em;
  }

  .wire-container {
    width: 60px;
    height: 80px;
    flex-shrink: 0;
  }

  .wire-svg {
    width: 100%;
    height: 100%;
  }

  .grid-and-decode {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .grid-section {
    overflow-x: auto;
  }

  .decode-panel {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-family: var(--font-mono);
    font-size: 0.75rem;
  }

  .decode-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    background: var(--color-bg-surface);
  }

  .x-row { border-left: 3px solid rgba(77, 159, 255, 0.5); }
  .y-row { border-left: 3px solid rgba(245, 166, 35, 0.5); }

  .decode-label {
    font-weight: 700;
    min-width: 1ch;
  }

  .x-row .decode-label { color: var(--color-accent); }
  .y-row .decode-label { color: var(--color-highlight); }

  .decode-binary {
    color: var(--color-text-muted);
    letter-spacing: 0.05em;
  }

  .decode-equals {
    color: var(--color-text-muted);
    opacity: 0.5;
  }

  .decode-decimal {
    color: var(--color-text);
    font-weight: 600;
    min-width: 3ch;
    text-align: right;
  }

  .canvas-section {
    position: relative;
  }

  .sine-canvas {
    width: 100%;
    height: var(--bgd-canvas-height);
    border-radius: 4px;
    background: var(--color-bg-surface);
  }

  .reduced-motion-note {
    position: absolute;
    bottom: 0.5rem;
    right: 0.5rem;
    font-size: 0.625rem;
    color: var(--color-text-muted);
    opacity: 0.6;
    font-style: italic;
  }

  /* Mobile: stack everything vertically */
  @media (max-width: 600px) {
    .main-layout {
      flex-direction: column;
      gap: 1rem;
    }

    .cpu-section {
      flex-direction: column;
    }

    .wire-container {
      width: 80px;
      height: 40px;
      transform: rotate(90deg);
    }
  }
</style>
