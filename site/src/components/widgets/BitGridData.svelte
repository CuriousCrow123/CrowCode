<script lang="ts">
  import type { Param } from '../../lib/params';
  import { loadParams } from '../../lib/params';
  import { writeUint, readUint, toBinary } from '../../lib/binary';
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
    { name: 'timeScale',       value: 0.1, unit: 'x',  category: 'physics',   min: 0.1, max: 2,    step: 0.1, description: 'Simulation speed multiplier' },
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
  let bits: number[] = $state([]);
  let running = $state(true);
  let cpuVisible = $state(true);
  let containerEl: HTMLDivElement = $state();
  let canvasEl: HTMLCanvasElement = $state();
  let isVisible = $state(false);

  // Physics state
  let ballX = $state(0); // position along curve (in px units, wraps at wavelength)
  let ballV = $state(0); // velocity along curve tangent
  let lastFrameTime = $state(0);

  // Decoded values for display
  let decodedX = $state(0);
  let decodedY = $state(0);

  // Direction arrows: 1 = increasing, -1 = decreasing, 0 = no change yet
  let xDir = $state(0);
  let yDir = $state(0);

  // Multi-dot wire animation state (ticked inside physics loop)
  interface WireDot { id: number; startTime: number; }
  let wireDots: WireDot[] = $state([]);
  let wireNow = $state(0);
  let dotIdCounter = 0;
  let lastDotSpawnTime = 0;
  let lastSentX = -1;
  let lastSentY = -1;

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

  // Initialize ball once on mount
  let ballInitialized = false;
  $effect(() => {
    if (!canvasEl || ballInitialized) return;
    ballX = params.curveWavelength / 4;
    ballV = 20;
    ballInitialized = true;
  });

  // Physics simulation + canvas rendering (rAF loop)
  $effect(() => {
    if (!isVisible || !running || !canvasEl) return;

    lastFrameTime = performance.now();

    let rafId: number;

    function tick(now: number) {
      if (document.hidden) {
        lastFrameTime = now;
        rafId = requestAnimationFrame(tick);
        return;
      }

      const dt = Math.min((now - lastFrameTime) / 1000, 0.05) * params.timeScale;
      lastFrameTime = now;

      if (!reducedMotion?.matches) {
        const A = params.curveAmplitude;
        const wl = params.curveWavelength;
        const g = params.gravity;
        const k = (2 * Math.PI) / wl;
        const dydx = A * k * Math.cos(k * ballX);
        const theta = Math.atan(dydx);
        const at = -g * Math.sin(theta);
        ballV += at * dt;
        ballX += ballV * Math.cos(theta) * dt;
        ballX = ((ballX % wl) + wl) % wl;
      }

      const canvasHeight = params.canvasHeight;
      const wl = params.curveWavelength;
      const A = params.curveAmplitude;
      const centerY = canvasHeight / 2;

      // Derive integer values from physics
      const normY = centerY - A * Math.sin((2 * Math.PI * ballX) / wl);
      const xInt = Math.round((ballX / wl) * maxVal);
      const yInt = Math.round((1 - normY / canvasHeight) * maxVal);

      // Track value direction before updating
      if (xInt !== decodedX) xDir = xInt > decodedX ? 1 : -1;
      if (yInt !== decodedY) yDir = yInt > decodedY ? 1 : -1;

      // Write bits immediately
      const newBits = [...bits];
      writeUint(newBits, 0, xInt, params.bitDepth);
      writeUint(newBits, params.bitDepth, yInt, params.bitDepth);
      bits = newBits;
      decodedX = xInt;
      decodedY = yInt;

      // Spawn wire dot as visual echo when values change (with 50ms throttle)
      if (cpuVisible) {
        // Tick existing dots
        wireNow = now;
        wireDots = wireDots.filter(d => (now - d.startTime) / params.wireSpeed < 1);

        if ((xInt !== lastSentX || yInt !== lastSentY) && now - lastDotSpawnTime >= 50) {
          lastDotSpawnTime = now;
          lastSentX = xInt;
          lastSentY = yInt;
          spawnDot();
        }
      }

      renderCanvas(ballX);
      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  });

  function spawnDot() {
    if (wireDots.length >= 8) wireDots = wireDots.slice(1);
    wireDots = [...wireDots, { id: dotIdCounter++, startTime: performance.now() }];
  }

  function renderCanvas(physBallX: number) {
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

    const mutedColor = getComputedStyle(canvasEl).getPropertyValue('--color-text-muted').trim() || '#8b90a0';
    const accentColor = getComputedStyle(canvasEl).getPropertyValue('--color-accent').trim() || '#4d9fff';

    // Axis insets
    const axisLeft = 20;
    const axisBottom = 16;
    const plotW = w - axisLeft;
    const plotH = h - axisBottom;

    // Square grid lines
    const gridSpacing = 20;
    ctx.strokeStyle = mutedColor;
    ctx.lineWidth = 0.5;
    ctx.globalAlpha = 0.12;
    for (let gy = gridSpacing; gy < plotH; gy += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(axisLeft, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();
    }
    for (let gx = axisLeft + gridSpacing; gx < w; gx += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, plotH);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Axes
    ctx.strokeStyle = mutedColor;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.moveTo(axisLeft, 0);
    ctx.lineTo(axisLeft, plotH);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(axisLeft, plotH);
    ctx.lineTo(w, plotH);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Axis labels (no rotation)
    ctx.font = '9px sans-serif';
    ctx.fillStyle = mutedColor;
    ctx.globalAlpha = 0.5;
    ctx.textAlign = 'center';
    ctx.fillText('x', axisLeft + plotW / 2, h - 2);
    ctx.textBaseline = 'middle';
    ctx.fillText('y', 8, plotH / 2);
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = 1;

    // Draw sine curve (within plot area)
    const A = params.curveAmplitude;
    const wl = params.curveWavelength;
    const centerY = plotH / 2;

    ctx.beginPath();
    ctx.strokeStyle = mutedColor;
    ctx.lineWidth = 1.5;
    for (let px = 0; px <= plotW; px++) {
      const xOnCurve = (px / plotW) * wl;
      const y = centerY - A * Math.sin((2 * Math.PI * xOnCurve) / wl);
      if (px === 0) ctx.moveTo(axisLeft + px, y);
      else ctx.lineTo(axisLeft + px, y);
    }
    ctx.stroke();

    // Compute ball position in same coordinate system as curve
    const plotBallX = axisLeft + (physBallX / wl) * plotW;
    const plotBallY = centerY - A * Math.sin((2 * Math.PI * physBallX) / wl);

    // Draw ball
    ctx.beginPath();
    ctx.fillStyle = accentColor;
    ctx.arc(plotBallX, plotBallY, params.ballSize, 0, Math.PI * 2);
    ctx.fill();

    // Ball glow
    ctx.beginPath();
    ctx.fillStyle = accentColor + '40';
    ctx.arc(plotBallX, plotBallY, params.ballSize * 2, 0, Math.PI * 2);
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
    ballV = 20;
    bits = randomBits(params.cols * params.rows);
    ballInitialized = true;
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
            {#if !reducedMotion?.matches}
              {#each wireDots as dot (dot.id)}
                {@const progress = Math.min((wireNow - dot.startTime) / params.wireSpeed, 1)}
                <circle cx={progress * 60} cy="30" r="3" fill="var(--color-accent)" />
                <circle
                  cx={Math.max(0, progress - 0.15) / 0.85 * 60} cy="50" r="3"
                  fill="var(--color-highlight)"
                  opacity={progress > 0.15 ? 1 : 0}
                />
              {/each}
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
          <span class="decode-arrow x-arrow">{xDir > 0 ? '\u2191' : ''}</span>
        </div>
        <div class="decode-row y-row">
          <span class="decode-label">y</span>
          <span class="decode-binary">{toBinary(decodedY, params.bitDepth)}</span>
          <span class="decode-equals">=</span>
          <span class="decode-decimal">{decodedY}</span>
          <span class="decode-arrow y-arrow">{yDir > 0 ? '\u2191' : yDir < 0 ? '\u2193' : ''}</span>
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
    <div class="canvas-controls">
      <div class="scrubber">
        <span class="scrubber-label">{params.timeScale.toFixed(1)}x</span>
        <input
          type="range"
          min="0.1"
          max="2"
          step="0.1"
          bind:value={params.timeScale}
          aria-label="Simulation speed"
        />
      </div>
      <button
        class="play-pause-btn"
        onclick={() => { running = !running; }}
        aria-label={running ? 'Pause animation' : 'Play animation'}
      >
        {#if running}
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <polygon points="6,4 20,12 6,20" />
          </svg>
        {/if}
      </button>
    </div>
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

  .decode-arrow {
    font-weight: 700;
    min-width: 1.5ch;
    text-align: center;
  }

  .x-arrow { color: var(--color-accent); }
  .y-arrow { color: var(--color-highlight); }

  .canvas-section {
    position: relative;
  }

  .sine-canvas {
    width: 100%;
    height: var(--bgd-canvas-height);
    border-radius: 4px;
    background: var(--color-bg-surface);
  }

  .canvas-controls {
    position: absolute;
    top: 0.375rem;
    right: 0.375rem;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .canvas-section:hover .canvas-controls {
    opacity: 0.6;
  }

  .canvas-controls:hover {
    opacity: 1 !important;
  }

  .play-pause-btn {
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    flex-shrink: 0;
  }

  .play-pause-btn:hover {
    color: var(--color-text);
  }

  .scrubber {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .scrubber input[type="range"] {
    width: 60px;
    height: 2px;
    appearance: none;
    background: var(--color-text-muted);
    border-radius: 1px;
    cursor: pointer;
    opacity: 0.5;
  }

  .scrubber input[type="range"]::-webkit-slider-thumb {
    appearance: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--color-accent);
    cursor: pointer;
  }

  .scrubber input[type="range"]::-moz-range-thumb {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--color-accent);
    border: none;
    cursor: pointer;
  }

  .scrubber-label {
    font-family: var(--font-mono);
    font-size: 0.625rem;
    color: var(--color-text-muted);
    min-width: 3ch;
    text-align: right;
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
