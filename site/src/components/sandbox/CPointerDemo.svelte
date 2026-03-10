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

  // --- Demo programs ---

  // Demo 1: Declaration + Assignment
  const demo1Program: CInstruction[] = [
    { kind: 'declare-assign', code: 'int x = 10;', varName: 'x', type: 'int', value: 10 },
    { kind: 'declare', code: 'int *p;', varName: 'p', type: 'pointer', targetType: 'int' },
    { kind: 'pointer-assign', code: 'p = &x;', ptrName: 'p', targetName: 'x' },
  ];

  // Demo 2: Size + Interpretation
  const demo2Program: CInstruction[] = [
    { kind: 'declare-assign', code: 'int x = 10;', varName: 'x', type: 'int', value: 10 },
    { kind: 'declare-assign', code: "char c = 'A';", varName: 'c', type: 'char', value: 65 },
    { kind: 'declare-pointer-assign', code: 'int *p = &x;', varName: 'p', targetType: 'int', targetName: 'x' },
    { kind: 'declare-pointer-assign', code: 'char *q = &c;', varName: 'q', targetType: 'char', targetName: 'c' },
    { kind: 'comment', code: '// pointer size ≠ data size', label: 'p is 4 bytes, q is 4 bytes — but int is 4 bytes and char is 1 byte' },
    { kind: 'deref-read-assign', code: 'int val = *p;', varName: 'val', type: 'int', ptrName: 'p', targetName: 'x' },
    { kind: 'deref-read-assign', code: 'char ch = *q;', varName: 'ch', type: 'char', ptrName: 'q', targetName: 'c' },
  ];

  // Demo 3: L-value vs R-value (Place vs Value)
  const demo3Program: CInstruction[] = [
    { kind: 'declare-assign', code: 'int x = 10;', varName: 'x', type: 'int', value: 10 },
    { kind: 'declare-pointer-assign', code: 'int *p = &x;', varName: 'p', targetType: 'int', targetName: 'x' },
    { kind: 'deref-write', code: '*p = 42;', ptrName: 'p', targetName: 'x', value: 42 },
    { kind: 'deref-read-assign', code: 'int y = *p;', varName: 'y', type: 'int', ptrName: 'p', targetName: 'x' },
  ];

  // --- Sub-step highlight colors ---

  const SUB_STEP_COLORS: Partial<Record<CSubStepKind, string>> = {
    declare:          'rgba(239, 68, 68, 0.15)',   // red
    read:             'rgba(99, 102, 241, 0.15)',   // indigo
    compute:          'rgba(234, 179, 8, 0.15)',    // yellow (pause)
    assign:           'rgba(34, 197, 94, 0.15)',    // green
    'deref-read':     'rgba(99, 102, 241, 0.15)',   // indigo (following pointer)
    'deref-write':    'rgba(34, 197, 94, 0.15)',    // green (writing through pointer)
    'pointer-assign': 'rgba(34, 197, 94, 0.15)',    // green (storing address)
  };

  // --- Tab state ---

  type DemoTab = 'declare-assign' | 'size-interpretation' | 'lvalue-rvalue';
  let activeTab = $state<DemoTab>('declare-assign');

  let program = $derived(
    activeTab === 'declare-assign' ? demo1Program
      : activeTab === 'size-interpretation' ? demo2Program
      : demo3Program
  );

  // --- Stepping state ---

  let memoryView: ReturnType<typeof CMemoryView>;
  let pc = $state(-1);
  let isAnimating = $state(false);
  let executed: (CSubStep & { instrIdx: number })[] = $state([]);
  let cachedSubSteps = new Map<number, (CSubStep & { instrIdx: number })[]>();
  let generation = 0;

  // --- Derived ---

  let totalSubSteps = $derived(program.reduce((sum, instr) => sum + countSubSteps(instr), 0));
  let currentStep = $derived(pc >= 0 && pc < executed.length ? executed[pc] : null);
  let currentInstrIdx = $derived(currentStep?.instrIdx ?? -1);

  let subHighlights = $derived.by((): SubHighlightSegment[] | undefined => {
    if (!currentStep) return undefined;
    const code = program[currentStep.instrIdx].code;
    const start = currentStep.highlightOffset ?? code.indexOf(currentStep.highlight);
    if (start === -1) return undefined;

    const segments: SubHighlightSegment[] = [{
      start,
      end: start + currentStep.highlight.length,
      color: SUB_STEP_COLORS[currentStep.kind] ?? 'rgba(99, 102, 241, 0.15)',
    }];

    // Add * character sub-highlight with distinct color
    if (currentStep.kind === 'declare' && code.includes('*')) {
      // Declaration * → red (type annotation)
      const starIdx = code.indexOf('*');
      segments.push({ start: starIdx, end: starIdx + 1, color: 'rgba(239, 68, 68, 0.25)' });
    } else if (currentStep.kind === 'deref-read' || currentStep.kind === 'deref-write') {
      // Dereference * → indigo (operator)
      const starIdx = code.indexOf('*');
      if (starIdx >= 0) {
        segments.push({ start: starIdx, end: starIdx + 1, color: 'rgba(99, 102, 241, 0.25)' });
      }
    }

    return segments;
  });

  let statusLabel = $derived(currentStep?.label);

  // --- Helpers ---

  function getSubSteps(instrIdx: number): (CSubStep & { instrIdx: number })[] {
    if (!cachedSubSteps.has(instrIdx)) {
      const steps = decomposeInstruction(
        program[instrIdx],
        {
          getVarValue: (name) => memoryView?.getVariable(name)?.value ?? null,
          getVarColor: (name) => memoryView?.getVariable(name)?.color ?? null,
          getVarAddress: (name) => memoryView?.getAddress(name) ?? null,
        },
      ).map((step) => ({ ...step, instrIdx }));
      cachedSubSteps.set(instrIdx, steps);
    }
    return cachedSubSteps.get(instrIdx)!;
  }

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

    try {
      await executeSubStep(step, gen);
    } finally {
      if (gen === generation) isAnimating = false;
    }
  }

  async function executeSubStep(step: CSubStep & { instrIdx: number }, gen: number) {
    memoryView.clearHighlights();

    if (!step.action) {
      // Pause step (comment instruction) — brief delay
      await new Promise((r) => setTimeout(r, 400));
      return;
    }

    switch (step.action.kind) {
      case 'declareVar':
        await memoryView.declareVar(step.action.typeName, step.action.varName, step.action.targetType);
        if (generation !== gen) return;
        break;
      case 'assignVar':
        await memoryView.assignVar(step.action.varName, step.action.value);
        if (generation !== gen) return;
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
        void memoryView.declareVar(step.action.typeName, step.action.varName, step.action.targetType);
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
    if (pc < 0 || isAnimating) return;
    pc--;

    // Clear cache entries beyond current position
    const currentIdx = pc >= 0 ? executed[pc].instrIdx : -1;
    for (const key of cachedSubSteps.keys()) {
      if (key > currentIdx) cachedSubSteps.delete(key);
    }
    executed = executed.slice(0, pc + 1);

    // Reset and replay
    generation++;
    memoryView.reset();
    for (let i = 0; i <= pc; i++) {
      replaySubStep(executed[i], i === pc);
    }
  }

  function resetDemo() {
    generation++;
    pc = -1;
    isAnimating = false;
    executed = [];
    cachedSubSteps = new Map();
    memoryView?.reset();
  }

  function switchTab(tab: DemoTab) {
    if (tab === activeTab || isAnimating) return;
    activeTab = tab;
    resetDemo();
  }

  // Keyboard navigation for tabs
  function handleTabKeydown(e: KeyboardEvent, current: DemoTab) {
    const tabs: DemoTab[] = ['declare-assign', 'size-interpretation', 'lvalue-rvalue'];
    const idx = tabs.indexOf(current);
    if (e.key === 'ArrowRight' && idx < tabs.length - 1) {
      switchTab(tabs[idx + 1]);
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      switchTab(tabs[idx - 1]);
    }
  }

  // Set bits view on mount
  $effect(() => {
    if (memoryView) {
      memoryView.setViewMode('bits');
    }
  });
</script>

<div class="tab-bar" role="tablist" aria-label="Pointer demo programs">
  <button
    role="tab"
    aria-selected={activeTab === 'declare-assign'}
    tabindex={activeTab === 'declare-assign' ? 0 : -1}
    class:active={activeTab === 'declare-assign'}
    onkeydown={(e) => handleTabKeydown(e, 'declare-assign')}
    onclick={() => switchTab('declare-assign')}
  >
    Declaration &amp; Assignment
  </button>
  <button
    role="tab"
    aria-selected={activeTab === 'size-interpretation'}
    tabindex={activeTab === 'size-interpretation' ? 0 : -1}
    class:active={activeTab === 'size-interpretation'}
    onkeydown={(e) => handleTabKeydown(e, 'size-interpretation')}
    onclick={() => switchTab('size-interpretation')}
  >
    Size &amp; Interpretation
  </button>
  <button
    role="tab"
    aria-selected={activeTab === 'lvalue-rvalue'}
    tabindex={activeTab === 'lvalue-rvalue' ? 0 : -1}
    class:active={activeTab === 'lvalue-rvalue'}
    onkeydown={(e) => handleTabKeydown(e, 'lvalue-rvalue')}
    onclick={() => switchTab('lvalue-rvalue')}
  >
    Place vs Value
  </button>
</div>

<div class="pointer-layout">
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
  .tab-bar {
    display: flex;
    gap: 0;
    margin-bottom: 1rem;
    border-bottom: 1px solid var(--color-border);
  }

  .tab-bar button {
    padding: 0.5rem 1rem;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--color-text-muted);
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    transition: color var(--transition-fast), border-color var(--transition-fast);
    white-space: nowrap;
  }

  .tab-bar button:hover {
    color: var(--color-text);
  }

  .tab-bar button.active {
    color: var(--color-text);
    border-bottom-color: var(--color-accent);
  }

  .tab-bar button:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }

  .pointer-layout {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
    align-items: start;
  }

  @media (max-width: 768px) {
    .pointer-layout {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 480px) {
    .tab-bar {
      overflow-x: auto;
    }

    .tab-bar button {
      font-size: 0.7rem;
      padding: 0.5rem 0.75rem;
    }
  }
</style>
