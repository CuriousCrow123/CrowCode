<script lang="ts">
  let count = $state(0);
  let doubled = $derived(count * 2);

  // Imperative API — accessible via bind:this from parent
  export function reset() {
    count = 0;
  }

  export function setCount(value: number) {
    count = value;
  }
</script>

<div class="counter">
  <div class="display">
    <span class="value">{count}</span>
    <span class="label">count</span>
  </div>
  <div class="display">
    <span class="value">{doubled}</span>
    <span class="label">doubled</span>
  </div>
  <div class="controls">
    <button onclick={() => count--}>−</button>
    <button onclick={() => count++}>+</button>
  </div>
</div>

<style>
  .counter {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-lg);
    padding: var(--space-xl);
  }

  .display {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-xs);
  }

  .value {
    font-family: var(--font-mono);
    font-size: 2.5rem;
    font-weight: 500;
    color: var(--color-accent);
    transition: color var(--transition-fast);
  }

  .label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--color-text-muted);
  }

  .controls {
    display: flex;
    gap: var(--space-sm);
  }

  button {
    font-family: var(--font-mono);
    font-size: 1.25rem;
    width: 3rem;
    height: 3rem;
    display: grid;
    place-items: center;
    background: var(--color-bg-surface);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: border-color var(--transition-fast);
  }

  button:hover {
    border-color: var(--color-accent);
  }

  button:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
</style>
