<script lang="ts">
  import { tick } from 'svelte';
  import CMemoryView from '../widgets/CMemoryView.svelte';
  import CodePanel from '../widgets/shared/CodePanel.svelte';
  import type { SubHighlightSegment } from '../widgets/shared/CodePanel.svelte';
  import {
    type CInstruction,
    type CSubStep,
    type CSubStepKind,
    C_TYPE_SIZES,
    countSubSteps,
    decomposeInstruction,
  } from '../../lib/c-program';

  // --- Types ---

  type FunctionInstruction = CInstruction & { sourceLine?: number };

  interface FunctionProgram {
    label: string;
    codeLines: string[];
    instructions: FunctionInstruction[];
    functionBoundaries: number[];
  }

  // --- Programs ---

  const programs: FunctionProgram[] = [
    // Tab 1 — Simple function call (twice)
    {
      label: 'Simple Call',
      codeLines: [
        'int twice(int x) {',
        '    int result = x * 2;',
        '    return result;',
        '}',
        '',
        'int main() {',
        '    int a = 5;',
        '    int b = twice(a);',
        '}',
      ],
      instructions: [
        { kind: 'declare-assign', code: 'int a = 5;', varName: 'a', type: 'int', value: 5, sourceLine: 6 },
        { kind: 'call', code: 'int b = twice(a);', functionName: 'twice',
          args: [{ paramName: 'x', paramType: 'int', argSource: 'a' }],
          returnTarget: { name: 'b', type: 'int' }, sourceLine: 7 },
        { kind: 'eval-assign', code: 'int result = x * 2;',
          target: { name: 'result', type: 'int' }, sources: ['x'], value: 10, sourceLine: 1 },
        { kind: 'return', code: 'return result;', valueSource: 'result',
          returnValue: 10, returnToVar: 'b', returnToType: 'int', returnSourceLine: 7, sourceLine: 2 },
      ],
      functionBoundaries: [3],
    },

    // Tab 2 — Scope isolation (setX)
    {
      label: 'Scope',
      codeLines: [
        'void setX(int x) {',
        '    x = 99;',
        '}',
        '',
        'int main() {',
        '    int x = 5;',
        '    setX(x);',
        '    // x is still 5!',
        '}',
      ],
      instructions: [
        { kind: 'declare-assign', code: 'int x = 5;', varName: 'x', type: 'int', value: 5, sourceLine: 5 },
        { kind: 'call', code: 'setX(x);', functionName: 'setX',
          args: [{ paramName: 'x', paramType: 'int', argSource: 'x' }], sourceLine: 6 },
        { kind: 'assign', code: 'x = 99;', varName: 'x', value: 99, sourceLine: 1 },
        { kind: 'return', code: '}', sourceLine: 2 },
        { kind: 'comment', code: '// x is still 5!', label: "main's x is unchanged: 5", sourceLine: 7 },
      ],
      functionBoundaries: [2],
    },

    // Tab 3 — Broken swap as function
    {
      label: 'Broken Swap',
      codeLines: [
        'void swap(int a, int b) {',
        '    int temp = a;',
        '    a = b;',
        '    b = temp;',
        '}',
        '',
        'int main() {',
        '    int a = 3;',
        '    int b = 7;',
        '    swap(a, b);',
        '    // a=3, b=7 unchanged!',
        '}',
      ],
      instructions: [
        { kind: 'declare-assign', code: 'int a = 3;', varName: 'a', type: 'int', value: 3, sourceLine: 7 },
        { kind: 'declare-assign', code: 'int b = 7;', varName: 'b', type: 'int', value: 7, sourceLine: 8 },
        { kind: 'call', code: 'swap(a, b);', functionName: 'swap',
          args: [
            { paramName: 'a', paramType: 'int', argSource: 'a' },
            { paramName: 'b', paramType: 'int', argSource: 'b' },
          ], sourceLine: 9 },
        { kind: 'declare-assign', code: 'int temp = a;', varName: 'temp', type: 'int', value: 3, sourceLine: 1 },
        { kind: 'assign', code: 'a = b;', varName: 'a', value: 7, sourceLine: 2 },
        { kind: 'assign', code: 'b = temp;', varName: 'b', value: 3, sourceLine: 3 },
        { kind: 'return', code: '}', sourceLine: 4 },
        { kind: 'comment', code: '// a=3, b=7 unchanged!', label: "main's a and b are unchanged", sourceLine: 10 },
      ],
      functionBoundaries: [4],
    },

    // Tab 4 — Recursion (factorial)
    {
      label: 'Recursion',
      codeLines: [
        'int factorial(int n) {',
        '    if (n <= 1) return n;',
        '    int sub = factorial(n - 1);',
        '    return n * sub;',
        '}',
        '',
        'int main() {',
        '    int result = factorial(3);',
        '}',
      ],
      instructions: [
        // main calls factorial(3)
        { kind: 'call', code: 'int result = factorial(3);', functionName: 'factorial',
          args: [{ paramName: 'n', paramType: 'int', argValue: 3 }],
          returnTarget: { name: 'result', type: 'int' }, sourceLine: 7 },
        // factorial(3): n=3, not base case
        { kind: 'comment', code: 'if (n <= 1) return n;', label: 'n = 3 > 1, recurse', sourceLine: 1 },
        { kind: 'call', code: 'int sub = factorial(n - 1);', functionName: 'factorial',
          args: [{ paramName: 'n', paramType: 'int', argValue: 2 }],
          returnTarget: { name: 'sub', type: 'int' }, sourceLine: 2 },
        // factorial(2): n=2, not base case
        { kind: 'comment', code: 'if (n <= 1) return n;', label: 'n = 2 > 1, recurse', sourceLine: 1 },
        { kind: 'call', code: 'int sub = factorial(n - 1);', functionName: 'factorial',
          args: [{ paramName: 'n', paramType: 'int', argValue: 1 }],
          returnTarget: { name: 'sub', type: 'int' }, sourceLine: 2 },
        // factorial(1): n=1, base case
        { kind: 'comment', code: 'if (n <= 1) return n;', label: 'n = 1 ≤ 1, base case!', sourceLine: 1 },
        { kind: 'return', code: 'return n;', valueSource: 'n',
          returnValue: 1, returnToVar: 'sub', returnToType: 'int', returnSourceLine: 2, sourceLine: 1 },
        // back in factorial(2): n*sub = 2*1 = 2
        { kind: 'comment', code: 'return n * sub;', label: 'n × sub = 2 × 1 = 2', sourceLine: 3 },
        { kind: 'return', code: 'return n * sub;',
          returnValue: 2, returnToVar: 'sub', returnToType: 'int', returnSourceLine: 2, sourceLine: 3 },
        // back in factorial(3): n*sub = 3*2 = 6
        { kind: 'comment', code: 'return n * sub;', label: 'n × sub = 3 × 2 = 6', sourceLine: 3 },
        { kind: 'return', code: 'return n * sub;',
          returnValue: 6, returnToVar: 'result', returnToType: 'int', returnSourceLine: 7, sourceLine: 3 },
      ],
      functionBoundaries: [4],
    },
  ];

  // --- Sub-step highlight colors ---

  const SUB_STEP_COLORS: Partial<Record<CSubStepKind, string>> = {
    'declare':        'rgba(239, 68, 68, 0.15)',
    'read':           'rgba(99, 102, 241, 0.15)',
    'compute':        'rgba(234, 179, 8, 0.15)',
    'assign':         'rgba(34, 197, 94, 0.15)',
    'push-frame':     'rgba(168, 85, 247, 0.15)',
    'copy-arg':       'rgba(34, 197, 94, 0.15)',
    'pop-frame':      'rgba(168, 85, 247, 0.15)',
    'assign-return':  'rgba(34, 197, 94, 0.15)',
  };

  // --- State ---

  let memoryView: ReturnType<typeof CMemoryView>;
  let activeTab = $state(0);
  let pc = $state(-1);
  let isAnimating = $state(false);
  let executed: (CSubStep & { instrIdx: number })[] = $state([]);
  let cachedSubSteps = new Map<number, (CSubStep & { instrIdx: number })[]>();
  let generation = 0;
  let callStack: string[] = $state(['main']);

  // --- Derived ---

  let program = $derived(programs[activeTab]);
  let totalSubSteps = $derived(
    program.instructions.reduce((sum, instr) => sum + countSubSteps(instr as CInstruction), 0)
  );

  let currentStep = $derived(pc >= 0 && pc < executed.length ? executed[pc] : null);

  let currentSourceLine = $derived.by(() => {
    if (!currentStep) return -1;
    // Sub-step sourceLine override (e.g., assign-return points to caller's line)
    if (currentStep.sourceLine != null) return currentStep.sourceLine;
    // Instruction's sourceLine
    const instr = program.instructions[currentStep.instrIdx] as FunctionInstruction;
    return instr.sourceLine ?? currentStep.instrIdx;
  });

  let subHighlights = $derived.by((): SubHighlightSegment[] | undefined => {
    if (!currentStep || currentSourceLine < 0) return undefined;

    const codeLine = program.codeLines[currentSourceLine];
    if (!codeLine) return undefined;

    const instr = program.instructions[currentStep.instrIdx];
    const instrCode = instr.code;

    // Find the instruction code's position within the codeLines entry
    const indentOffset = codeLine.indexOf(instrCode);

    let start: number;
    if (currentStep.highlightOffset != null && indentOffset >= 0) {
      // Pre-computed offset + indent adjustment
      start = currentStep.highlightOffset + indentOffset;
    } else {
      // Fallback: find highlight text directly in the code line
      start = codeLine.indexOf(currentStep.highlight);
    }

    if (start < 0) return undefined;

    return [{
      start,
      end: start + currentStep.highlight.length,
      color: SUB_STEP_COLORS[currentStep.kind] ?? 'rgba(99, 102, 241, 0.15)',
    }];
  });

  let statusLabel = $derived(currentStep?.label);

  // --- Helpers ---

  function getSubSteps(instrIdx: number): (CSubStep & { instrIdx: number })[] {
    if (!cachedSubSteps.has(instrIdx)) {
      const steps = decomposeInstruction(
        program.instructions[instrIdx] as CInstruction,
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

    // Expand sub-steps lazily
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
      case 'pushFrame':
        callStack = [...callStack, step.action.name];
        await memoryView.pushFrame(step.action.name);
        if (generation !== gen) return;
        break;
      case 'popFrame':
        callStack = callStack.slice(0, -1);
        await memoryView.popFrame();
        if (generation !== gen) return;
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
      case 'pushFrame':
        callStack = [...callStack, step.action.name];
        void memoryView.pushFrame(step.action.name);
        break;
      case 'popFrame':
        callStack = callStack.slice(0, -1);
        void memoryView.popFrame(true); // skip animation during replay
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
    callStack = ['main'];
    void memoryView.pushFrame('main');
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
    callStack = ['main'];
    memoryView?.reset();
    void memoryView?.pushFrame('main');
  }

  function switchTab(tab: number) {
    if (tab === activeTab || isAnimating) return;
    activeTab = tab;
    resetDemo();
  }

  // Keyboard navigation for tabs
  function handleTabKeydown(e: KeyboardEvent, idx: number) {
    if (e.key === 'ArrowRight' && idx < programs.length - 1) {
      switchTab(idx + 1);
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      switchTab(idx - 1);
    }
  }

  // Set bits view and push main frame on mount
  $effect(() => {
    if (memoryView) {
      memoryView.setViewMode('bits');
      // Defer pushFrame to avoid mutating reactive state during effect
      tick().then(() => memoryView.pushFrame('main'));
    }
  });
</script>

<div class="tab-bar" role="tablist" aria-label="Function demo programs">
  {#each programs as prog, idx (idx)}
    <button
      role="tab"
      aria-selected={activeTab === idx}
      tabindex={activeTab === idx ? 0 : -1}
      class:active={activeTab === idx}
      onkeydown={(e) => handleTabKeydown(e, idx)}
      onclick={() => switchTab(idx)}
    >
      {prog.label}
    </button>
  {/each}
</div>

<div class="function-layout">
  <CodePanel
    instructions={program.instructions as CInstruction[]}
    currentLine={currentSourceLine}
    showControls={true}
    canPrev={pc >= 0 && !isAnimating}
    canNext={pc < totalSubSteps - 1 && !isAnimating}
    onnext={executeNext}
    onprev={executePrev}
    {subHighlights}
    {statusLabel}
    codeLines={program.codeLines}
    {callStack}
    functionBoundaries={program.functionBoundaries}
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

  .function-layout {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
    align-items: start;
  }

  @media (max-width: 768px) {
    .function-layout {
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
