<script lang="ts">
  /**
   * BitSequenceCore — Shared interactive bit-row renderer.
   *
   * Not a full widget (no WIDGET_ID, no paramDefs, no WidgetDebugPanel).
   * Prop-driven renderer: accepts bits from the variant, delegates
   * mutations upward via onbitchange callback.
   *
   * Supports two animation modes:
   *   - '3d': 3D card flip (for <=8 bits), matching Bit.svelte aesthetic
   *   - 'toggle': instant swap with glow-pulse (for >8 bits), matching BitGridCore
   */

  let {
    bits,
    cellSize,
    cellGap,
    fontSize,
    mode = '3d',
    perspective = 300,
    flipDuration = 350,
    glowDuration = 300,
    glowColor = 'var(--color-accent)',
    labels,
    sectionColors,
    sectionGaps,
    onbitchange,
  }: {
    bits: number[];
    cellSize: number;
    cellGap: number;
    fontSize: number;
    mode?: '3d' | 'toggle';
    perspective?: number;
    flipDuration?: number;
    glowDuration?: number;
    glowColor?: string;
    labels?: string[];
    sectionColors?: Record<string, { indices: number[]; color: string }>;
    sectionGaps?: number[];
    onbitchange?: (index: number, value: 0 | 1) => void;
  } = $props();

  const reducedMotion = typeof window !== 'undefined'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  // --- 3D mode state ---
  const animatingCells = new Set<number>();
  let cellEls: HTMLButtonElement[] = [];

  // --- Toggle mode state ---
  let prevBits = new Uint8Array(0);
  let glowingCells: Set<number> = $state(new Set());

  // Build section color lookup: index → color
  let sectionColorMap = $derived.by(() => {
    const map = new Map<number, string>();
    if (!sectionColors) return map;
    for (const group of Object.values(sectionColors)) {
      for (const idx of group.indices) {
        map.set(idx, group.color);
      }
    }
    return map;
  });

  // Build section gap lookup
  let gapSet = $derived(new Set(sectionGaps ?? []));

  function handleFlip(index: number) {
    if (mode === '3d' && animatingCells.has(index)) return;
    const newValue = (bits[index] === 0 ? 1 : 0) as 0 | 1;
    onbitchange?.(index, newValue);

    if (mode === '3d' && !reducedMotion?.matches) {
      animatingCells.add(index);
      const el = cellEls[index];
      if (el) {
        const from = newValue === 1 ? 0 : 180;
        const to = from + 180;
        el.animate(
          [{ transform: `rotateY(${from}deg)` }, { transform: `rotateY(${to}deg)` }],
          { duration: flipDuration, easing: 'ease' },
        ).onfinish = () => { animatingCells.delete(index); };
      }
    }
  }

  // Glow-pulse change detection for toggle mode
  $effect(() => {
    if (mode !== 'toggle') return;
    const currentBits = bits;
    if (prevBits.length !== currentBits.length) {
      prevBits = new Uint8Array(currentBits);
      return;
    }
    const changed: number[] = [];
    for (let i = 0; i < currentBits.length; i++) {
      if (currentBits[i] !== prevBits[i]) changed.push(i);
    }
    if (changed.length > 0) {
      for (const idx of changed) glowingCells.add(idx);
      glowingCells = new Set(glowingCells);
    }
    prevBits = new Uint8Array(currentBits);
  });

  function handleGlowEnd(index: number) {
    glowingCells.delete(index);
    glowingCells = new Set(glowingCells);
  }
</script>

{#if mode === '3d'}
  <div
    class="bit-sequence-core mode-3d"
    style="
      --bsc-cell-size: {cellSize}px;
      --bsc-gap: {cellGap}px;
      --bsc-font-size: {fontSize}px;
      --bsc-perspective: {perspective}px;
    "
  >
    {#each bits as bit, i}
      {@const sColor = sectionColorMap.get(i)}
      {@const hasGap = gapSet.has(i)}
      <div class="bit-cell" class:section-gap={hasGap}>
        <button
          bind:this={cellEls[i]}
          class="card"
          class:flipped={bit === 1}
          onclick={() => handleFlip(i)}
          aria-label="Bit {bits.length - 1 - i}: {bit}"
          style={sColor ? `--bsc-section-color: ${sColor};` : ''}
        >
          <span class="face front">0</span>
          <span class="face back">1</span>
        </button>
        {#if labels?.[i]}
          <span class="label">{labels[i]}</span>
        {/if}
      </div>
    {/each}
  </div>
{:else}
  <div
    class="bit-sequence-core mode-toggle"
    style="
      --bsc-cell-size: {cellSize}px;
      --bsc-gap: {cellGap}px;
      --bsc-font-size: {fontSize}px;
      --bsc-glow-duration: {glowDuration}ms;
      --bsc-glow-color: {glowColor};
    "
  >
    {#each bits as bit, i}
      {@const sColor = sectionColorMap.get(i)}
      {@const hasGap = gapSet.has(i)}
      <div class="bit-cell" class:section-gap={hasGap}>
        <button
          class="cell"
          class:active={bit === 1}
          class:glow={glowingCells.has(i)}
          onclick={() => handleFlip(i)}
          onanimationend={() => handleGlowEnd(i)}
          aria-label="Bit {bits.length - 1 - i}: {bit}"
          style={sColor ? `--bsc-section-color: ${sColor};` : ''}
        >
          {bit}
        </button>
        {#if labels?.[i]}
          <span class="label">{labels[i]}</span>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .bit-sequence-core {
    display: inline-flex;
    align-items: flex-start;
    gap: var(--bsc-gap);
    font-family: var(--font-mono);
    user-select: none;
  }

  .bit-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .bit-cell.section-gap {
    margin-right: calc(var(--bsc-gap) * 1.5);
  }

  .label {
    font-size: 0.625rem;
    color: var(--color-text-muted);
    line-height: 1;
  }

  /* ── 3D mode ── */
  .mode-3d {
    perspective: var(--bsc-perspective);
  }

  .mode-3d .card {
    all: unset;
    position: relative;
    width: var(--bsc-cell-size);
    height: var(--bsc-cell-size);
    cursor: pointer;
    transform-style: preserve-3d;
  }

  .mode-3d .card.flipped {
    transform: rotateY(180deg);
  }

  .face {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    backface-visibility: hidden;
    border-radius: 4px;
    font-size: var(--bsc-font-size);
    font-weight: 600;
  }

  .front {
    background: var(--bsc-section-color, var(--color-bg-raised));
    color: var(--color-text-muted);
    border: 1px solid var(--color-border);
  }

  .back {
    background: var(--bsc-section-color, var(--color-bg-raised));
    color: var(--color-accent);
    border: 1px solid var(--color-accent);
    transform: rotateY(180deg);
  }

  .mode-3d .card:focus-visible .face {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  /* ── Toggle mode ── */
  .cell {
    all: unset;
    width: var(--bsc-cell-size);
    height: var(--bsc-cell-size);
    display: grid;
    place-items: center;
    font-size: var(--bsc-font-size);
    font-weight: 600;
    color: var(--color-text-muted);
    background: var(--bsc-section-color, transparent);
    border-radius: 4px;
    cursor: pointer;
    transition: color var(--transition-fast);
  }

  .cell.active {
    color: var(--color-accent);
  }

  .cell:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  @keyframes glow-pulse {
    0% {
      color: var(--bsc-glow-color);
      text-shadow: 0 0 6px var(--bsc-glow-color);
    }
    100% {
      color: var(--color-text-muted);
      text-shadow: none;
    }
  }

  .cell.glow {
    animation: glow-pulse var(--bsc-glow-duration) ease-out forwards;
  }

  .cell.active.glow {
    animation: glow-pulse var(--bsc-glow-duration) ease-out forwards;
  }
</style>
