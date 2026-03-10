<script lang="ts">
  import CMemoryView from '../widgets/CMemoryView.svelte';
  import CodePanel from '../widgets/shared/CodePanel.svelte';
  import {
    type CInstruction,
    type CSubStep,
    type CSubStepKind,
    countSubSteps,
    decomposeInstruction,
  } from '../../lib/c-program';

  /** Map sub-step kinds to highlight colors (replaces kind-based CSS classes). */
  const SUB_STEP_COLORS: Partial<Record<CSubStepKind, string>> = {
    declare:             'rgba(239, 68, 68, 0.15)',
    read:                'rgba(99, 102, 241, 0.15)',
    compute:             'rgba(234, 179, 8, 0.15)',
    assign:              'rgba(34, 197, 94, 0.15)',
    'printf-literal':    'rgba(195, 232, 141, 0.15)',
    'printf-placeholder':'rgba(130, 170, 255, 0.15)',
  };

  // --- Demo program ---

  const program: CInstruction[] = [
    { kind: 'declare', code: 'int x;', varName: 'x', type: 'int' },
    { kind: 'assign', code: 'x = 10;', varName: 'x', value: 10 },
    { kind: 'declare-assign', code: "char c = 'A';", varName: 'c', type: 'char', value: 65 },
    { kind: 'eval-assign', code: 'int y = x + 32;', target: { name: 'y', type: 'int' }, sources: ['x'], value: 42 },
  ];

  // --- State ---

  let memoryView: ReturnType<typeof CMemoryView>;
  let pc = $state(-1); // global sub-step index into allSubSteps
  let isAnimating = $state(false);

  // Sub-step cache: computed once per instruction when first reached, cleared on reset.
  // Imperative (not $state) to avoid reactive re-derivation.
  let cachedSubSteps = new Map<number, (CSubStep & { instrIdx: number })[]>();

  function getSubSteps(instrIdx: number): (CSubStep & { instrIdx: number })[] {
    if (!cachedSubSteps.has(instrIdx)) {
      const steps = decomposeInstruction(
        program[instrIdx],
        { getVarValue: (name) => memoryView?.getVariable(name)?.value ?? null },
      ).map((step) => ({ ...step, instrIdx }));
      cachedSubSteps.set(instrIdx, steps);
    }
    return cachedSubSteps.get(instrIdx)!;
  }

  // Flat array of all executed sub-steps (built incrementally as user steps forward)
  let executed: (CSubStep & { instrIdx: number })[] = $state([]);

  const totalSubSteps = program.reduce((sum, instr) => sum + countSubSteps(instr), 0);

  // --- Derived display state ---

  let currentStep = $derived(pc >= 0 && pc < executed.length ? executed[pc] : null);
  let currentInstrIdx = $derived(currentStep?.instrIdx ?? -1);

  let subHighlights = $derived.by(() => {
    if (!currentStep) return undefined;
    const code = program[currentStep.instrIdx].code;
    const start = currentStep.highlightOffset ?? code.indexOf(currentStep.highlight);
    if (start === -1) return undefined;
    return [{ start, end: start + currentStep.highlight.length, color: SUB_STEP_COLORS[currentStep.kind] }];
  });

  let statusLabel = $derived(currentStep?.label);

  // --- Orchestration ---

  async function executeNext() {
    const nextPc = pc + 1;
    if (isAnimating || nextPc >= totalSubSteps) return;

    // Expand sub-steps if needed
    if (nextPc >= executed.length) {
      // Find the next instruction to decompose
      const prevInstrIdx = executed.length > 0 ? executed[executed.length - 1].instrIdx : -1;
      const prevInstrSteps = prevInstrIdx >= 0 ? getSubSteps(prevInstrIdx) : [];
      const countForPrevInstr = executed.filter((s) => s.instrIdx === prevInstrIdx).length;

      if (prevInstrIdx >= 0 && countForPrevInstr < prevInstrSteps.length) {
        // More sub-steps in the current instruction
        executed = [...executed, prevInstrSteps[countForPrevInstr]];
      } else {
        // Move to next instruction
        const nextInstrIdx = prevInstrIdx + 1;
        const steps = getSubSteps(nextInstrIdx);
        executed = [...executed, steps[0]];
      }
    }

    pc = nextPc;
    const step = executed[pc];
    isAnimating = true;

    await executeSubStep(step);

    isAnimating = false;
  }

  async function executeSubStep(step: CSubStep & { instrIdx: number }) {
    // Clear any previous read highlights before executing the new step
    memoryView.clearHighlights();

    if (!step.action) {
      // Compute step — no memory change, brief pause for comprehension.
      await new Promise((r) => setTimeout(r, 400));
      return;
    }
    switch (step.action.kind) {
      case 'declareVar':
        await memoryView.declareVar(step.action.typeName, step.action.varName);
        break;
      case 'assignVar':
        await memoryView.assignVar(step.action.varName, step.action.value);
        break;
      case 'highlightVar':
        // Sustained highlight — stays on until next step clears it
        memoryView.highlightVar(step.action.varName);
        break;
    }
  }

  function replaySubStep(step: CSubStep & { instrIdx: number }, isLast: boolean) {
    // Fire-and-forget: synchronous state mutations run before first await.
    // Generation counter in CMemoryView ensures orphaned async continuations bail out.
    if (!step.action) return;
    switch (step.action.kind) {
      case 'declareVar':
        void memoryView.declareVar(step.action.typeName, step.action.varName);
        break;
      case 'assignVar':
        void memoryView.assignVar(step.action.varName, step.action.value);
        break;
      case 'highlightVar':
        // Only show read highlight if this is the final (current) step
        if (isLast) memoryView.highlightVar(step.action.varName);
        break;
    }
  }

  function executePrev() {
    if (isAnimating || pc < 0) return;
    pc--;

    // Clear cache entries for instructions beyond current position
    // to prevent stale labels on re-forward navigation
    const currentIdx = pc >= 0 ? executed[pc].instrIdx : -1;
    for (const key of cachedSubSteps.keys()) {
      if (key > currentIdx) cachedSubSteps.delete(key);
    }
    // Trim executed array to discard future sub-steps
    executed = executed.slice(0, pc + 1);

    memoryView.reset();
    for (let i = 0; i <= pc; i++) {
      replaySubStep(executed[i], i === pc);
    }
  }

  function handleReset() {
    pc = -1;
    isAnimating = false;
    cachedSubSteps.clear();
    executed = [];
    memoryView.reset();
    memoryView.setViewMode('bits'); // full reset returns to bits view
  }
</script>

<div class="demo-layout">
  <CodePanel
    instructions={program}
    currentLine={currentInstrIdx}
    showControls={true}
    canPrev={pc >= 0 && !isAnimating}
    canNext={pc < totalSubSteps - 1 && !isAnimating}
    onnext={executeNext}
    onprev={executePrev}
    {subHighlights}
    {statusLabel}
  />
  <CMemoryView bind:this={memoryView} />
</div>

<div class="demo-controls">
  <button onclick={executeNext} disabled={isAnimating || pc >= totalSubSteps - 1}>
    Step
  </button>
  <button onclick={executePrev} disabled={isAnimating || pc < 0}>
    Back
  </button>
  <button onclick={handleReset} disabled={isAnimating}>
    Reset
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
