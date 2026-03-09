<script lang="ts">
  /**
   * BitGridCore — Shared bit-grid renderer.
   *
   * Not a full widget (no WIDGET_ID, no WidgetDebugPanel).
   * Prop-driven pure renderer: accepts a reactive bits array from the
   * variant and detects changes to trigger glow-pulse animations.
   */

  let {
    bits,
    cols,
    cellSize,
    cellGap,
    fontSize,
    glowDuration,
    glowColor = 'var(--color-accent)',
    highlights = {},
  }: {
    bits: number[];
    cols: number;
    cellSize: number;
    cellGap: number;
    fontSize: number;
    glowDuration: number;
    glowColor?: string;
    highlights?: Record<string, { indices: number[]; color: string }>;
  } = $props();

  // Internal previous-bits snapshot for change detection
  let prevBits: Uint8Array = $state(new Uint8Array(0));
  let glowingCells: Set<number> = $state(new Set());

  // Build a highlight lookup: index → color
  let highlightMap = $derived.by(() => {
    const map = new Map<number, string>();
    for (const group of Object.values(highlights)) {
      for (const idx of group.indices) {
        map.set(idx, group.color);
      }
    }
    return map;
  });

  // Detect changes and trigger glow
  $effect(() => {
    const currentBits = bits;
    if (prevBits.length !== currentBits.length) {
      // Array resized — update snapshot, no glow
      prevBits = new Uint8Array(currentBits);
      return;
    }

    const changed: number[] = [];
    for (let i = 0; i < currentBits.length; i++) {
      if (currentBits[i] !== prevBits[i]) {
        changed.push(i);
      }
    }

    if (changed.length > 0) {
      // Trigger glow on changed cells
      glowingCells = new Set([...glowingCells, ...changed]);
    }

    prevBits = new Uint8Array(currentBits);
  });

  function handleAnimationEnd(index: number) {
    glowingCells.delete(index);
    glowingCells = new Set(glowingCells); // trigger reactivity
  }
</script>

<div
  class="bit-grid-core"
  role="img"
  aria-label="Grid of binary bits"
  style="
    --bg-cell-size: {cellSize}px;
    --bg-cell-gap: {cellGap}px;
    --bg-font-size: {fontSize}px;
    --bg-glow-duration: {glowDuration}ms;
    --bg-glow-color: {glowColor};
    --bg-cols: {cols};
  "
>
  {#each bits as bit, i}
    {@const isGlowing = glowingCells.has(i)}
    {@const highlightColor = highlightMap.get(i)}
    <span
      class="cell"
      class:glow={isGlowing}
      class:color-only={fontSize === 0}
      style={highlightColor ? `--bg-highlight: ${highlightColor};` : ''}
      onanimationend={() => handleAnimationEnd(i)}
    >
      {#if fontSize > 0}
        {bit}
      {/if}
    </span>
  {/each}
</div>

<style>
  .bit-grid-core {
    display: grid;
    grid-template-columns: repeat(var(--bg-cols), var(--bg-cell-size));
    gap: var(--bg-cell-gap);
    font-family: var(--font-mono);
    font-size: var(--bg-font-size);
    line-height: 1;
    user-select: none;
  }

  .cell {
    width: var(--bg-cell-size);
    height: var(--bg-cell-size);
    display: grid;
    place-items: center;
    color: var(--color-text-muted);
    background: var(--bg-highlight, transparent);
    border-radius: 2px;
    transition: color var(--transition-fast);
  }

  .cell.color-only {
    background: var(--bg-highlight, var(--color-bg-surface));
  }

  /* Color-only mode: use brightness to show 0 vs 1 */
  .cell.color-only {
    opacity: 0.3;
  }

  @keyframes glow-pulse {
    0% {
      color: var(--bg-glow-color);
      text-shadow: 0 0 6px var(--bg-glow-color);
    }
    100% {
      color: var(--color-text-muted);
      text-shadow: none;
    }
  }

  @keyframes glow-pulse-color-only {
    0% {
      background-color: var(--bg-glow-color);
      box-shadow: 0 0 6px var(--bg-glow-color);
    }
    100% {
      background-color: var(--bg-highlight, var(--color-bg-surface));
      box-shadow: none;
    }
  }

  .cell.glow {
    animation: glow-pulse var(--bg-glow-duration) ease-out forwards;
  }

  .cell.glow.color-only {
    animation: glow-pulse-color-only var(--bg-glow-duration) ease-out forwards;
  }
</style>
