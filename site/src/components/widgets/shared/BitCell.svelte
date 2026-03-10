<script lang="ts">
  /**
   * BitCell — Shared presentational component for a single bit cell.
   *
   * No WIDGET_ID, no paramDefs — receives all per-cell data via props.
   * Constant-per-grid values (cellSize, fontSize, glowDuration, glowColor)
   * are inherited via CSS custom properties on the parent container:
   *   --bit-cell-size, --bit-cell-font-size, --bit-cell-glow-duration, --bit-cell-glow-color
   */

  interface BitCellProps {
    bit: number;
    glowing?: boolean;
    highlightColor?: string;
    dimmed?: boolean;
    onglowend?: () => void;
  }

  let {
    bit,
    glowing = false,
    highlightColor,
    dimmed = false,
    onglowend,
  }: BitCellProps = $props();
</script>

<span
  class="bit-cell"
  class:glow={glowing}
  class:dimmed
  style={highlightColor ? `--bit-cell-highlight: ${highlightColor};` : ''}
  onanimationend={onglowend}
>
  {bit}
</span>

<style>
  .bit-cell {
    width: var(--bit-cell-size, 14px);
    height: var(--bit-cell-size, 14px);
    display: grid;
    place-items: center;
    font-family: var(--font-mono);
    font-size: var(--bit-cell-font-size, 10px);
    line-height: 1;
    color: var(--color-text-muted);
    background: var(--bit-cell-highlight, transparent);
    border-radius: 2px;
    transition: color var(--transition-fast);
    user-select: none;
  }

  .bit-cell.dimmed {
    opacity: 0.35;
  }

  @keyframes glow-pulse {
    0% {
      color: var(--bit-cell-glow-color, var(--color-accent));
      text-shadow: 0 0 6px var(--bit-cell-glow-color, var(--color-accent));
    }
    100% {
      color: var(--color-text-muted);
      text-shadow: none;
    }
  }

  .bit-cell.glow {
    animation: glow-pulse var(--bit-cell-glow-duration, 300ms) ease-out forwards;
  }
</style>
