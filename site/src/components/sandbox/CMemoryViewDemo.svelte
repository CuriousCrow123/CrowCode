<script lang="ts">
  import CMemoryView from '../widgets/CMemoryView.svelte';
  import CodePanel from '../widgets/shared/CodePanel.svelte';
  import type { CInstruction } from '../../lib/c-program';

  // --- Demo program ---

  const program: CInstruction[] = [
    { kind: 'declare', code: 'int x;', varName: 'x', type: 'int' },
    { kind: 'assign', code: 'x = 10;', varName: 'x', value: 10 },
    { kind: 'declare-assign', code: "char c = 'A';", varName: 'c', type: 'char', value: 65 },
    { kind: 'eval-assign', code: 'int y = x + 32;', target: { name: 'y', type: 'int' }, sources: ['x'], value: 42 },
  ];

  // --- State ---

  let memoryView: ReturnType<typeof CMemoryView>;
  let pc = $state(-1);
  let isAnimating = $state(false);

  // --- Orchestration ---

  async function executeNext() {
    if (isAnimating || pc >= program.length - 1) return;
    pc++;
    isAnimating = true;

    const instr = program[pc];
    switch (instr.kind) {
      case 'declare':
        await memoryView.declareVar(instr.type, instr.varName);
        break;
      case 'assign':
        await memoryView.assignVar(instr.varName, instr.value);
        break;
      case 'declare-assign':
        await memoryView.declareAssignVar(instr.type, instr.varName, instr.value);
        break;
      case 'eval-assign': {
        for (const src of instr.sources) {
          await memoryView.highlightVar(src);
        }
        if (instr.target.type) {
          await memoryView.declareAssignVar(instr.target.type, instr.target.name, instr.value);
        } else {
          await memoryView.assignVar(instr.target.name, instr.value);
        }
        break;
      }
    }

    isAnimating = false;
  }

  function replayInstruction(instr: CInstruction) {
    // Instant replay: call sync methods directly (no animation)
    switch (instr.kind) {
      case 'declare':
        memoryView.declareVar(instr.type, instr.varName);
        break;
      case 'assign':
        memoryView.assignVar(instr.varName, instr.value);
        break;
      case 'declare-assign':
        memoryView.declareAssignVar(instr.type, instr.varName, instr.value);
        break;
      case 'eval-assign':
        if (instr.target.type) {
          memoryView.declareAssignVar(instr.target.type, instr.target.name, instr.value);
        } else {
          memoryView.assignVar(instr.target.name, instr.value);
        }
        break;
    }
  }

  function executePrev() {
    if (isAnimating || pc < 0) return;
    pc--;
    memoryView.reset();
    // Replay instructions 0..pc instantly
    for (let i = 0; i <= pc; i++) {
      replayInstruction(program[i]);
    }
  }

  function handleReset() {
    pc = -1;
    isAnimating = false;
    memoryView.reset();
  }
</script>

<div class="demo-layout">
  <CodePanel
    instructions={program}
    currentLine={pc}
    showControls={true}
    canPrev={pc >= 0 && !isAnimating}
    canNext={pc < program.length - 1 && !isAnimating}
    onnext={executeNext}
    onprev={executePrev}
  />
  <CMemoryView bind:this={memoryView} />
</div>

<div class="demo-controls">
  <button onclick={executeNext} disabled={isAnimating || pc >= program.length - 1}>
    Step
  </button>
  <button onclick={executePrev} disabled={isAnimating || pc < 0}>
    Back
  </button>
  <button onclick={handleReset} disabled={isAnimating}>
    Reset
  </button>
  <button onclick={() => memoryView.setViewMode('table')} disabled={pc < 0}>
    Table view
  </button>
  <button onclick={() => memoryView.setViewMode('bits')}>
    Bits view
  </button>
</div>

<style>
  .demo-layout {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
    align-items: start;
  }

  @media (max-width: 768px) {
    .demo-layout {
      grid-template-columns: 1fr;
    }
  }

  .demo-controls {
    display: flex;
    gap: 0.5rem;
    margin-top: 1rem;
    flex-wrap: wrap;
  }

  .demo-controls button {
    padding: 0.3rem 0.75rem;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--color-text-muted);
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 4px;
    cursor: pointer;
    transition: color var(--transition-fast), border-color var(--transition-fast);
  }

  .demo-controls button:hover:not(:disabled) {
    color: var(--color-text);
    border-color: var(--color-text-muted);
  }

  .demo-controls button:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
</style>
