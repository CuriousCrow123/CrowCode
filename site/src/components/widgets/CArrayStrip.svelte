<script lang="ts">
  /**
   * CArrayStrip — Horizontal array visualization widget.
   *
   * Displays array elements as a row of cells with index labels,
   * pointer arrows below, and optional arithmetic/OOB displays.
   * Exposes an imperative API for orchestrator control.
   */

  // --- Props ---

  interface Props {
    arithmeticDisplay?: { base: string; offset: number; size: number; result: string } | null;
    oobIndex?: number | null;
  }

  let { arithmeticDisplay = null, oobIndex = null }: Props = $props();

  // --- Internal state ---

  let generation = $state(0);
  let arrayName = $state('');
  let elementType = $state('');
  let cellCount = $state(0);
  let values: (number | null)[] = $state([]);
  let highlightedIndex: number | null = $state(null);
  let highlightColor: string = $state('');
  let pointers: Map<string, number> = $state(new Map());

  // --- Reduced motion ---

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- Imperative API ---

  /** Declare the array (sets up cells with null values). */
  export function declareArray(name: string, elType: string, count: number): void {
    arrayName = name;
    elementType = elType;
    cellCount = count;
    values = new Array(count).fill(null);
  }

  /** Set a cell's value. */
  export function assignElementValue(index: number, value: number): void {
    values = values.map((v, i) => i === index ? value : v);
  }

  /** Highlight a cell with an optional color. */
  export function highlightElement(index: number, color?: string): void {
    highlightedIndex = index;
    highlightColor = color || '#4fc3f7';
  }

  /** Clear all highlights. */
  export function clearHighlights(): void {
    highlightedIndex = null;
    highlightColor = '';
  }

  /** Set pointer position instantly (used for replay). */
  export function setPointer(name: string, index: number): void {
    pointers = new Map([...pointers, [name, index]]);
  }

  /** Animate pointer movement (used during forward execution). */
  export async function movePointer(name: string, toIndex: number): Promise<void> {
    // Synchronous state update first (critical for replay)
    pointers = new Map([...pointers, [name, toIndex]]);
    // Then animate (cancellable by generation counter)
    const gen = generation;
    if (reducedMotion) return;
    // CSS transition handles the animation via transform
    await new Promise((r) => setTimeout(r, 300));
    if (gen !== generation) return;
  }

  /** Reset everything. Fully synchronous — no await, no tick(). */
  export function reset(): void {
    generation++;
    arrayName = '';
    elementType = '';
    cellCount = 0;
    values = [];
    highlightedIndex = null;
    highlightColor = '';
    pointers = new Map();
  }

  // Cleanup on destroy — invalidate all outstanding async chains
  $effect(() => {
    return () => {
      generation++;
    };
  });
</script>

<div class="array-strip" role="figure" aria-label="{arrayName} array visualization">
  {#if cellCount > 0}
    <!-- Index labels -->
    <div class="indices">
      {#each Array(cellCount) as _, i}
        <div class="index-label">[{i}]</div>
      {/each}
      {#if oobIndex != null}
        <div class="index-label oob-label">[{oobIndex}]</div>
      {/if}
    </div>

    <!-- Cell strip -->
    <div class="cells">
      {#each Array(cellCount) as _, i}
        <div
          class="cell"
          class:highlighted={highlightedIndex === i}
          style:background-color={highlightedIndex === i ? highlightColor : ''}
        >
          {values[i] != null ? values[i] : ''}
        </div>
      {/each}
      {#if oobIndex != null}
        <div class="cell oob-cell">?</div>
      {/if}
    </div>

    <!-- Pointer arrows -->
    {#if pointers.size > 0}
      <div class="pointer-row">
        {#each [...pointers] as [name, index]}
          <div
            class="pointer-arrow"
            style:transform="translateX(calc({index} * (var(--cell-width) + var(--cell-gap))))"
            aria-live="polite"
          >
            <span class="arrow">↑</span>
            <span class="pointer-name">{name}</span>
          </div>
        {/each}
      </div>
    {/if}

    <!-- Arithmetic display -->
    {#if arithmeticDisplay}
      <div class="arithmetic" aria-live="polite">
        {arithmeticDisplay.base} + {arithmeticDisplay.offset}×{arithmeticDisplay.size} = {arithmeticDisplay.result}
      </div>
    {/if}
  {/if}
</div>

<style>
  .array-strip {
    --cell-width: 72px;
    --cell-gap: 0px;

    display: flex;
    flex-direction: column;
    align-items: flex-start;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    padding: 12px 0;
  }

  .indices {
    display: flex;
    gap: var(--cell-gap);
  }

  .index-label {
    width: var(--cell-width);
    text-align: center;
    font-size: 0.75rem;
    color: var(--color-text-muted, #888);
  }

  .oob-label {
    color: #ef4444;
  }

  .cells {
    display: flex;
    gap: var(--cell-gap);
  }

  .cell {
    width: var(--cell-width);
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--color-border, #444);
    font-size: 0.875rem;
    transition: background-color 0.2s ease;
  }

  .cell:first-child {
    border-radius: 4px 0 0 4px;
  }

  .cell:last-child {
    border-radius: 0 4px 4px 0;
  }

  .cell.highlighted {
    font-weight: 600;
  }

  .oob-cell {
    border-color: #ef4444;
    color: #ef4444;
    background: repeating-linear-gradient(
      45deg,
      transparent,
      transparent 4px,
      rgba(239, 68, 68, 0.1) 4px,
      rgba(239, 68, 68, 0.1) 8px
    );
    animation: oob-appear 0.3s ease-out;
  }

  @keyframes oob-appear {
    from { transform: scaleX(0); opacity: 0; }
    to { transform: scaleX(1); opacity: 1; }
  }

  .pointer-row {
    position: relative;
    height: 32px;
    margin-top: 4px;
  }

  .pointer-arrow {
    position: absolute;
    left: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: var(--cell-width);
    transition: transform 0.3s ease;
    font-size: 0.875rem;
  }

  @media (prefers-reduced-motion: reduce) {
    .pointer-arrow {
      transition: none;
    }
    .oob-cell {
      animation: none;
    }
  }

  .arrow {
    font-size: 1rem;
    line-height: 1;
  }

  .pointer-name {
    font-size: 0.75rem;
    color: var(--color-text-muted, #888);
  }

  .arithmetic {
    margin-top: 8px;
    font-size: 0.75rem;
    color: var(--color-text-muted, #888);
    padding: 4px 8px;
    border-radius: 4px;
    background: var(--color-bg-subtle, rgba(255, 255, 255, 0.05));
  }
</style>
