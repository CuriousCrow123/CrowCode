<script lang="ts">
  import CMemoryView from '../widgets/CMemoryView.svelte';
  import CodePanel from '../widgets/shared/CodePanel.svelte';
  import type { SubHighlightSegment } from '../widgets/shared/CodePanel.svelte';
  import {
    type CInstruction,
    type CSubStep,
    type CSubStepKind,
    countSubSteps,
    decomposeInstruction,
  } from '../../lib/c-program';

  // --- Programs ---

  const naiveProgram: CInstruction[] = [
    { kind: 'declare-assign', code: "char a = 'A';", varName: 'a', type: 'char', value: 65 },
    { kind: 'declare-assign', code: "char b = 'Z';", varName: 'b', type: 'char', value: 90 },
    { kind: 'eval-assign', code: 'a = b;', target: { name: 'a' }, sources: ['b'], value: 90 },
    { kind: 'eval-assign', code: 'b = a;', target: { name: 'b' }, sources: ['a'], value: 90 },
  ];

  const correctProgram: CInstruction[] = [
    { kind: 'declare-assign', code: "char a = 'A';", varName: 'a', type: 'char', value: 65 },
    { kind: 'declare-assign', code: "char b = 'Z';", varName: 'b', type: 'char', value: 90 },
    { kind: 'eval-assign', code: 'char temp = a;', target: { name: 'temp', type: 'char' }, sources: ['a'], value: 65 },
    { kind: 'eval-assign', code: 'a = b;', target: { name: 'a' }, sources: ['b'], value: 90 },
    { kind: 'eval-assign', code: 'b = temp;', target: { name: 'b' }, sources: ['temp'], value: 65 },
  ];

  const SUB_STEP_COLORS: Record<CSubStepKind, string> = {
    declare:              'rgba(239, 68, 68, 0.15)',
    read:                 'rgba(99, 102, 241, 0.15)',
    compute:              'rgba(234, 179, 8, 0.15)',
    assign:               'rgba(34, 197, 94, 0.15)',
    'printf-literal':     'rgba(195, 232, 141, 0.15)',
    'printf-placeholder': 'rgba(130, 170, 255, 0.15)',
  };

  // --- State ---

  let memoryView: ReturnType<typeof CMemoryView>;
  let activeTab: 'naive' | 'correct' = $state('naive');
  let pc = $state(-1);
  let isAnimating = $state(false);
  let generation = 0; // orchestrator-level cancellation counter

  let program = $derived(activeTab === 'naive' ? naiveProgram : correctProgram);
  let totalSubSteps = $derived(program.reduce((sum, instr) => sum + countSubSteps(instr), 0));

  // Sub-step cache (not reactive — imperative map)
  let cachedSubSteps = new Map<number, (CSubStep & { instrIdx: number })[]>();

  function getSubSteps(instrIdx: number): (CSubStep & { instrIdx: number })[] {
    if (!cachedSubSteps.has(instrIdx)) {
      const steps = decomposeInstruction(
        program[instrIdx],
        (name) => memoryView?.getVariable(name)?.value ?? null,
        (name) => memoryView?.getVariable(name)?.color ?? null,
      ).map((step) => ({ ...step, instrIdx }));
      cachedSubSteps.set(instrIdx, steps);
    }
    return cachedSubSteps.get(instrIdx)!;
  }

  // Flat array of all executed sub-steps
  let executed: (CSubStep & { instrIdx: number })[] = $state([]);

  // --- Derived display state ---

  let currentStep = $derived(pc >= 0 && pc < executed.length ? executed[pc] : null);
  let currentInstrIdx = $derived(currentStep?.instrIdx ?? -1);

  let subHighlights = $derived.by((): SubHighlightSegment[] | undefined => {
    if (!currentStep) return undefined;
    const code = program[currentStep.instrIdx].code;
    const start = currentStep.highlightOffset ?? code.indexOf(currentStep.highlight);
    if (start === -1) return undefined;

    return [{
      start,
      end: start + currentStep.highlight.length,
      color: SUB_STEP_COLORS[currentStep.kind],
    }];
  });

  let statusLabel = $derived(currentStep?.label);

  // --- Orchestration ---

  async function executeNext() {
    const nextPc = pc + 1;
    if (isAnimating || nextPc >= totalSubSteps) return;

    const gen = generation;

    // Expand sub-steps if needed
    if (nextPc >= executed.length) {
      const prevInstrIdx = executed.length > 0 ? executed[executed.length - 1].instrIdx : -1;
      const prevInstrSteps = prevInstrIdx >= 0 ? getSubSteps(prevInstrIdx) : [];
      const countForPrevInstr = executed.filter((s) => s.instrIdx === prevInstrIdx).length;

      if (prevInstrIdx >= 0 && countForPrevInstr < prevInstrSteps.length) {
        executed = [...executed, prevInstrSteps[countForPrevInstr]];
      } else {
        const nextInstrIdx = prevInstrIdx + 1;
        const steps = getSubSteps(nextInstrIdx);
        executed = [...executed, steps[0]];
      }
    }

    pc = nextPc;
    const step = executed[pc];
    isAnimating = true;

    await executeSubStep(step);

    // Bail if a tab switch or reset happened during the await
    if (gen !== generation) return;

    isAnimating = false;
  }

  async function executeSubStep(step: CSubStep & { instrIdx: number }) {
    memoryView.clearHighlights();

    if (!step.action) {
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
        memoryView.highlightVar(step.action.varName);
        break;
    }
  }

  function replaySubStep(step: CSubStep & { instrIdx: number }, isLast: boolean) {
    if (!step.action) return;
    switch (step.action.kind) {
      case 'declareVar':
        void memoryView.declareVar(step.action.typeName, step.action.varName);
        break;
      case 'assignVar':
        void memoryView.assignVar(step.action.varName, step.action.value);
        break;
      case 'highlightVar':
        if (isLast) memoryView.highlightVar(step.action.varName);
        break;
    }
  }

  function executePrev() {
    if (isAnimating || pc < 0) return;
    pc--;

    // Clear cache entries for instructions beyond current position
    const currentIdx = pc >= 0 ? executed[pc].instrIdx : -1;
    for (const key of cachedSubSteps.keys()) {
      if (key > currentIdx) cachedSubSteps.delete(key);
    }
    executed = executed.slice(0, pc + 1);

    // Reset memory and replay
    memoryView.reset();
    for (let i = 0; i <= pc; i++) {
      replaySubStep(executed[i], i === pc);
    }
  }

  function handleReset() {
    generation++;
    pc = -1;
    isAnimating = false;
    cachedSubSteps.clear();
    executed = [];
    memoryView.reset();
  }

  function switchTab(tab: 'naive' | 'correct') {
    if (tab === activeTab) return;
    activeTab = tab;
    handleReset();
  }

  // Set table view on mount
  $effect(() => {
    if (memoryView) {
      memoryView.setViewMode('table');
    }
  });
</script>

<div class="swap-tabs" role="tablist" aria-label="Swap algorithm variants">
  <button
    role="tab"
    aria-selected={activeTab === 'naive'}
    aria-controls="swap-tabpanel"
    onclick={() => switchTab('naive')}
  >
    Naive
  </button>
  <button
    role="tab"
    aria-selected={activeTab === 'correct'}
    aria-controls="swap-tabpanel"
    onclick={() => switchTab('correct')}
  >
    Correct
  </button>
</div>

<div id="swap-tabpanel" role="tabpanel" class="swap-layout">
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

<style>
  .swap-tabs {
    display: flex;
    gap: 0;
    margin-bottom: 1rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .swap-tabs button {
    padding: 0.5rem 1.25rem;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--color-text-muted);
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    transition: color var(--transition-fast), border-color var(--transition-fast);
  }

  .swap-tabs button:hover {
    color: var(--color-text);
  }

  .swap-tabs button[aria-selected='true'] {
    color: var(--color-text);
    border-bottom-color: var(--color-accent);
  }

  .swap-layout {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
    align-items: start;
  }

  @media (max-width: 768px) {
    .swap-layout {
      grid-template-columns: 1fr;
    }
  }
</style>
