<script lang="ts">
  import BitSequenceSigned from '../widgets/BitSequenceSigned.svelte';

  let widget: ReturnType<typeof BitSequenceSigned>;
  let currentStage: 1 | 2 | 3 = $state(1);

  function setStage(s: 1 | 2 | 3) {
    currentStage = s;
    widget?.setStage(s);
  }
</script>

<div class="sandbox-controls">
  <button class="stage-btn" class:active={currentStage === 1} onclick={() => setStage(1)}>
    Stage 1: Unsigned
  </button>
  <button class="stage-btn" class:active={currentStage === 2} onclick={() => setStage(2)}>
    Stage 2: Signed
  </button>
  <button class="stage-btn" class:active={currentStage === 3} onclick={() => setStage(3)}>
    Stage 3: Number Line
  </button>
</div>

<BitSequenceSigned bind:this={widget} />

<style>
  .sandbox-controls {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
    justify-content: center;
    flex-wrap: wrap;
  }

  .stage-btn {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    padding: 6px 12px;
    border-radius: 6px;
    border: 1.5px solid var(--color-border);
    background: var(--color-bg-surface);
    color: var(--color-text-muted);
    cursor: pointer;
    transition: color var(--transition-fast), border-color var(--transition-fast), background var(--transition-fast);
  }

  .stage-btn:hover {
    color: var(--color-accent);
    border-color: var(--color-accent);
  }

  .stage-btn.active {
    color: var(--color-bg);
    background: var(--color-accent);
    border-color: var(--color-accent);
  }
</style>
