<script lang="ts">
  import { startRepeat } from '../../../lib/repeat';
  import { onDestroy } from 'svelte';

  interface ScrubSliderProps {
    value: number;
    max: number;
    onvaluechange: (v: number) => void;
    ondelta: (delta: number, direction: 1 | -1) => void;
    repeatDelay?: number;
    repeatInterval?: number;
    repeatAccelMs?: number;
    ariaLabel?: string;
    railWidth?: number;
  }

  let {
    value,
    max,
    onvaluechange,
    ondelta,
    repeatDelay = 400,
    repeatInterval = 80,
    repeatAccelMs = 800,
    ariaLabel = 'Drag to scrub value',
    railWidth = 120,
  }: ScrubSliderProps = $props();

  let maxLabel = $derived(String(max));
  let percent = $derived(max > 0 ? (value / max) * 100 : 0);

  // --- Scrub slider drag ---
  let isDragging = $state(false);
  let railEl: HTMLElement;

  function updateFromPointer(e: PointerEvent) {
    if (!railEl) return;
    const rect = railEl.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onvaluechange(Math.round(x * max));
  }

  function handleScrubDown(e: PointerEvent) {
    e.preventDefault();
    isDragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    updateFromPointer(e);
  }

  function handleScrubMove(e: PointerEvent) {
    if (!isDragging) return;
    updateFromPointer(e);
  }

  function handleScrubUp() {
    isDragging = false;
  }

  // --- Keyboard accessibility ---
  function handleKeydown(e: KeyboardEvent) {
    const step = e.shiftKey ? Math.ceil(max / 10) : 1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onvaluechange(Math.min(max, value + step));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onvaluechange(Math.max(0, value - step));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onvaluechange(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      onvaluechange(max);
    }
  }

  // --- Press-and-hold +/- buttons ---
  let stopBtnRepeat: (() => void) | null = null;

  function handleBtnDown(dir: 1 | -1) {
    stopBtnRepeat?.();
    stopBtnRepeat = startRepeat((delta) => {
      ondelta(delta, dir);
    }, repeatDelay, repeatInterval, repeatAccelMs);

    // Safety: stop on any pointer-up anywhere (catches touch leave)
    document.addEventListener('pointerup', handleBtnUp, { once: true });
  }

  function handleBtnUp() {
    stopBtnRepeat?.();
    stopBtnRepeat = null;
  }

  onDestroy(() => {
    stopBtnRepeat?.();
    stopBtnRepeat = null;
  });
</script>

<div class="scrub-row">
  <button
    class="scrub-btn"
    onpointerdown={(e) => { e.preventDefault(); handleBtnDown(-1); }}
    onpointerup={handleBtnUp}
    onpointerleave={handleBtnUp}
    aria-label="Decrement"
  >&minus;</button>
  <div
    class="scrub-track"
    class:active={isDragging}
    role="slider"
    tabindex="0"
    aria-valuenow={value}
    aria-valuemin={0}
    aria-valuemax={max}
    aria-label={ariaLabel}
    onpointerdown={handleScrubDown}
    onpointermove={handleScrubMove}
    onpointerup={handleScrubUp}
    onpointercancel={() => { isDragging = false; }}
    onkeydown={handleKeydown}
  >
    <span class="scrub-label">0</span>
    <div class="scrub-rail" style="width: {railWidth}px;" bind:this={railEl}>
      <div class="scrub-fill" style="width: {percent}%"></div>
      <div class="scrub-knob" style="left: {percent}%"></div>
    </div>
    <span class="scrub-label">{maxLabel}</span>
  </div>
  <button
    class="scrub-btn"
    onpointerdown={(e) => { e.preventDefault(); handleBtnDown(1); }}
    onpointerup={handleBtnUp}
    onpointerleave={handleBtnUp}
    aria-label="Increment"
  >+</button>
</div>

<style>
  .scrub-row {
    display: flex;
    align-items: center;
    gap: 6px;
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
</style>
