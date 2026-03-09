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
    { name: 'timeScale',       value: 0.4, unit: 'x',  category: 'physics',   min: 0.1, max: 2,    step: 0.1, description: 'Simulation speed multiplier' },
    { name: 'gravity',         value: 500, unit: '',   category: 'physics',   min: 100, max: 2000, step: 100, description: 'Gravity strength' },
    { name: 'curveAmplitude',  value: 60,  unit: 'px', category: 'physics',   min: 20,  max: 120,  step: 10,  description: 'Sine wave amplitude' },
    { name: 'curveWavelength', value: 200, unit: 'px', category: 'physics',   min: 100, max: 400,  step: 20,  description: 'Sine wave wavelength' },
    // Style
    { name: 'ballSize',        value: 8,   unit: 'px', category: 'style',     min: 4,   max: 16,   step: 1,   description: 'Ball radius' },
    { name: 'canvasHeight',    value: 160, unit: 'px', category: 'style',     min: 80,  max: 300,  step: 10,  description: 'Animation canvas height' },
    { name: 'wireSpeed',       value: 400, unit: 'ms', category: 'animation', min: 100, max: 1000, step: 50,  description: 'Bus wire dot travel time' },
    { name: 'lerpSpeed',       value: 12,  unit: '',   category: 'animation', min: 2,   max: 30,   step: 1,   description: 'Ball smoothing speed (higher = snappier)' },
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

  // Multi-dot wire animation state (ticked inside physics loop, no separate rAF)
  interface WireDot { id: number; startTime: number; pendingX: number; pendingY: number; bitDepth: number; }
  let wireDots: WireDot[] = $state([]);
  let wireNow = $state(0);
  let dotIdCounter = 0;
  let lastDotSpawnTime = 0;
  let lastSentX = -1;
  let lastSentY = -1;

  // Smoothed display position (lerps toward decoded values)
  // Stored as normalized [0,1] to handle x-wrapping correctly
  let displayNormX = -1; // -1 = uninitialized, snap on first update
  let displayNormY = -1;

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

      const rawDt = Math.min((now - lastFrameTime) / 1000, 0.05);
      const dt = rawDt * params.timeScale;
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

      const canvasWidth = canvasEl.clientWidth;
      const canvasHeight = params.canvasHeight;
      const wl = params.curveWavelength;
      const A = params.curveAmplitude;
      const centerY = canvasHeight / 2;

      // CPU computes values from physics state
      const xNorm = ballX / wl;
      const canvasYPhysics = centerY - A * Math.sin((2 * Math.PI * ballX) / wl);
      const yNorm = canvasYPhysics / canvasHeight;
      const xInt = Math.round(xNorm * maxVal);
      const yInt = Math.round(yNorm * maxVal);

      if (cpuVisible) {
        // Defer bit writes — dots carry pending values, bits update on arrival
        if ((xInt !== lastSentX || yInt !== lastSentY) && now - lastDotSpawnTime >= 50) {
          lastDotSpawnTime = now;
          lastSentX = xInt;
          lastSentY = yInt;
          spawnDot(xInt, yInt, params.bitDepth);
        }

        // Tick wire dots: apply completed dot values to bits
        wireNow = now;
        let lastCompleted: WireDot | null = null;
        const active: WireDot[] = [];
        for (const d of wireDots) {
          if ((now - d.startTime) / params.wireSpeed >= 1) {
            lastCompleted = d;
          } else {
            active.push(d);
          }
        }
        if (lastCompleted) {
          const newBits = [...bits];
          writeUint(newBits, 0, lastCompleted.pendingX, lastCompleted.bitDepth);
          writeUint(newBits, lastCompleted.bitDepth, lastCompleted.pendingY, lastCompleted.bitDepth);
          bits = newBits;
          decodedX = lastCompleted.pendingX;
          decodedY = lastCompleted.pendingY;
        }
        wireDots = active;
      } else {
        // No CPU/wires — write bits immediately
        const newBits = [...bits];
        writeUint(newBits, 0, xInt, params.bitDepth);
        writeUint(newBits, params.bitDepth, yInt, params.bitDepth);
        bits = newBits;
        decodedX = xInt;
        decodedY = yInt;
      }

      // Smooth interpolation in normalized [0,1] space
      const targetNormX = decodedX / maxVal;
      const targetNormY = decodedY / maxVal;

      if (displayNormX < 0) {
        // First frame: snap to target (no lerp from origin)
        displayNormX = targetNormX;
        displayNormY = targetNormY;
      } else {
        const lerpFactor = 1 - Math.exp(-params.lerpSpeed * rawDt);

        // Wrap-aware lerp for X (circular — the ball wraps at edges)
        let dx = targetNormX - displayNormX;
        if (dx > 0.5) dx -= 1;
        if (dx < -0.5) dx += 1;
        displayNormX += dx * lerpFactor;
        displayNormX = ((displayNormX % 1) + 1) % 1;

        // Normal lerp for Y (no wrapping)
        displayNormY += (targetNormY - displayNormY) * lerpFactor;
      }

      renderCanvas(displayNormX * canvasWidth, displayNormY * canvasHeight);
      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  });

  function spawnDot(pendingX: number, pendingY: number, bitDepth: number) {
    if (wireDots.length >= 8) wireDots = wireDots.slice(1);
    wireDots = [...wireDots, { id: dotIdCounter++, startTime: performance.now(), pendingX, pendingY, bitDepth }];
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
    ballV = 20;
    bits = randomBits(params.cols * params.rows);
    ballInitialized = true;
    displayNormX = -1; // snap on next frame
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

  .play-pause-btn {
    position: absolute;
    top: 0.375rem;
    right: 0.375rem;
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .canvas-section:hover .play-pause-btn {
    opacity: 0.5;
  }

  .play-pause-btn:hover {
    opacity: 1;
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
