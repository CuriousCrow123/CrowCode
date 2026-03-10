<script lang="ts">
  import CMemoryView from '../widgets/CMemoryView.svelte';
  import CArrayStrip from '../widgets/CArrayStrip.svelte';
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
  import { toHex } from '../../lib/binary';

  // --- Program (static, fixed array size 4) ---

  const program: CInstruction[] = [
    // Act 1: Declaration and memory layout
    { kind: 'declare-array', code: 'int arr[4] = {10, 20, 30, 40};',
      varName: 'arr', elementType: 'int', values: [10, 20, 30, 40] },

    // Act 2: Array indexing
    { kind: 'array-index-read', code: 'int x = arr[1];',
      varName: 'x', type: 'int', arrayName: 'arr', index: 1 },
    { kind: 'array-index-read', code: 'int y = arr[3];',
      varName: 'y', type: 'int', arrayName: 'arr', index: 3 },

    // Act 3: Pointer arithmetic equivalence
    { kind: 'declare-pointer-assign', code: 'int *p = arr;',
      varName: 'p', targetType: 'int', targetName: 'arr' },
    { kind: 'pointer-arith-deref', code: 'int a = *(p + 1);',
      varName: 'a', type: 'int', ptrName: 'p', offset: 1,
      arrayName: 'arr', elementType: 'int' },
    { kind: 'pointer-arith-deref', code: 'int b = *(p + 2);',
      varName: 'b', type: 'int', ptrName: 'p', offset: 2,
      arrayName: 'arr', elementType: 'int' },
    { kind: 'assign', code: 'p++;',
      varName: 'p', value: 0 },  // placeholder — resolved at execute time
    { kind: 'pointer-arith-deref', code: 'int c = *p;',
      varName: 'c', type: 'int', ptrName: 'p', offset: 0,
      arrayName: 'arr', elementType: 'int' },

    // Act 4: Out-of-bounds (danger zone)
    { kind: 'array-index-read', code: 'int bad = arr[4];',
      varName: 'bad', type: 'int', arrayName: 'arr', index: 4 },
  ];

  // --- Sub-step highlight colors ---

  const SUB_STEP_COLORS: Partial<Record<CSubStepKind, string>> = {
    declare:          'rgba(239, 68, 68, 0.15)',   // red
    read:             'rgba(99, 102, 241, 0.15)',   // indigo
    compute:          'rgba(234, 179, 8, 0.15)',    // yellow
    assign:           'rgba(34, 197, 94, 0.15)',    // green
    'deref-read':     'rgba(99, 102, 241, 0.15)',   // indigo
    'pointer-assign': 'rgba(34, 197, 94, 0.15)',    // green
  };

  // --- Pointer → array mapping (precomputed from program) ---

  const ptrToArray = new Map<string, string>();
  {
    const arrayNames = new Set<string>();
    for (const instr of program) {
      if (instr.kind === 'declare-array') arrayNames.add(instr.varName);
      if (instr.kind === 'declare-pointer-assign' && arrayNames.has(instr.targetName)) {
        ptrToArray.set(instr.varName, instr.targetName);
      }
    }
  }

  // --- State ---

  let memoryView: ReturnType<typeof CMemoryView>;
  let strip: ReturnType<typeof CArrayStrip>;
  let pc = $state(-1);
  let isAnimating = $state(false);
  let executed: (CSubStep & { instrIdx: number })[] = $state([]);
  let cachedSubSteps = new Map<number, (CSubStep & { instrIdx: number })[]>();
  let generation = 0;

  // Show math toggle
  let showMath = $state(false);
  // Reactive props for CArrayStrip
  let arithmeticDisplay = $state<{ base: string; offset: number; size: number; result: string } | null>(null);
  let oobIndex = $state<number | null>(null);

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

    // Highlight * character distinctly for pointer operations
    if (currentStep.kind === 'declare' && code.includes('*')) {
      const starIdx = code.indexOf('*');
      segments.push({ start: starIdx, end: starIdx + 1, color: 'rgba(239, 68, 68, 0.25)' });
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

  /** Resolve the target array index from pointer arithmetic at runtime. */
  function resolvePointerArithIndex(instr: CInstruction & { kind: 'pointer-arith-deref' }): number {
    const ptrVal = memoryView?.getVariable(instr.ptrName)?.value ?? 0;
    const arrBaseAddr = memoryView?.getAddressRaw(instr.arrayName);
    if (arrBaseAddr == null) return instr.offset;
    const elemSize = C_TYPE_SIZES[instr.elementType];
    return Math.floor((ptrVal - arrBaseAddr) / elemSize) + instr.offset;
  }

  /** Compute the array index a pointer value points to. */
  function computeArrayIndex(ptrValue: number, arrayName: string): number {
    const arrBaseAddr = memoryView?.getAddressRaw(arrayName);
    if (arrBaseAddr == null) return 0;
    const arrVar = memoryView?.getVariable(arrayName);
    if (!arrVar?.arrayElements) return 0;
    const elemSize = arrVar.size / arrVar.arrayElements;
    return Math.floor((ptrValue - arrBaseAddr) / elemSize);
  }

  /** Read an array element's value from CMemoryView state. */
  function getElementValue(arrayName: string, index: number): number {
    const arrVar = memoryView?.getVariable(arrayName);
    if (arrVar?.elementValues && index >= 0 && index < (arrVar.arrayElements ?? 0)) {
      return arrVar.elementValues[index] ?? 0;
    }
    return 0; // OOB or uninitialized
  }

  // --- Orchestration ---

  async function executeNext() {
    const nextPc = pc + 1;
    if (isAnimating || nextPc >= totalSubSteps) return;
    isAnimating = true; // lock FIRST to prevent keyboard repeat

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

    try {
      await executeSubStep(step, gen);
    } finally {
      if (gen === generation) isAnimating = false;
    }
  }

  async function executeSubStep(step: CSubStep & { instrIdx: number }, gen: number) {
    memoryView.clearHighlights();
    strip.clearHighlights();
    arithmeticDisplay = null;
    oobIndex = null;

    const instr = program[step.instrIdx];

    if (!step.action) {
      // Compute step — handle pointer arithmetic arrow slide + math
      if (instr.kind === 'pointer-arith-deref' && instr.offset > 0) {
        const resolvedIndex = resolvePointerArithIndex(instr);
        await strip.movePointer(instr.ptrName, resolvedIndex);
        if (gen !== generation) return;

        if (showMath) {
          const ptrVal = memoryView.getVariable(instr.ptrName)?.value ?? 0;
          const elemSize = C_TYPE_SIZES[instr.elementType];
          arithmeticDisplay = {
            base: toHex(ptrVal, 4),
            offset: instr.offset,
            size: elemSize,
            result: toHex(ptrVal + instr.offset * elemSize, 4),
          };
        }
      } else {
        // Brief pause for compute steps with no visual action
        await new Promise((r) => setTimeout(r, 400));
        if (gen !== generation) return;
      }
      return;
    }

    switch (step.action.kind) {
      case 'declareVar':
        await memoryView.declareVar(step.action.typeName, step.action.varName, step.action.targetType);
        if (gen !== generation) return;
        break;

      case 'declareArray':
        await memoryView.declareArray(step.action.elementType, step.action.varName, step.action.count);
        if (gen !== generation) return;
        strip.declareArray(step.action.varName, step.action.elementType, step.action.count);
        break;

      case 'assignArrayElement':
        await memoryView.assignArrayElement(step.action.arrayName, step.action.index, step.action.value);
        if (gen !== generation) return;
        strip.assignElementValue(step.action.index, step.action.value);
        break;

      case 'highlightArrayElement': {
        let index = step.action.index;

        // Resolve index at execute time for pointer-arith-deref
        if (instr.kind === 'pointer-arith-deref') {
          index = resolvePointerArithIndex(instr);
        }

        const arrVar = memoryView.getVariable(step.action.arrayName);
        const isOob = arrVar?.arrayElements != null && index >= arrVar.arrayElements;

        if (isOob) {
          oobIndex = index;
          memoryView.highlightOob(step.action.arrayName, index);
        } else {
          memoryView.highlightArrayElement(step.action.arrayName, index);
          strip.highlightElement(index, arrVar?.color);
        }
        break;
      }

      case 'assignVar': {
        let value = step.action.value;

        // Resolve placeholder values at execute time
        if (instr.kind === 'array-index-read') {
          value = getElementValue(instr.arrayName, instr.index);
        } else if (instr.kind === 'pointer-arith-deref') {
          const resolvedIndex = resolvePointerArithIndex(instr);
          value = getElementValue(instr.arrayName, resolvedIndex);
        } else if (instr.kind === 'assign' && ptrToArray.has(instr.varName)) {
          // p++ — pointer increment by sizeof(elementType)
          const currentAddr = memoryView.getVariable(instr.varName)?.value ?? 0;
          const arrName = ptrToArray.get(instr.varName)!;
          const arrVar = memoryView.getVariable(arrName);
          if (arrVar?.arrayElements) {
            const elemSize = arrVar.size / arrVar.arrayElements;
            value = currentAddr + elemSize;
          }
        }

        await memoryView.assignVar(step.action.varName, value);
        if (gen !== generation) return;

        // Update strip pointer if this assigns to a pointer targeting an array
        if (ptrToArray.has(step.action.varName)) {
          const arrName = ptrToArray.get(step.action.varName)!;
          const targetIndex = computeArrayIndex(value, arrName);

          if (instr.kind === 'declare-pointer-assign') {
            // Initial pointer set — instant, no animation
            strip.setPointer(step.action.varName, targetIndex);
          } else {
            // p++ — animate the arrow slide
            await strip.movePointer(step.action.varName, targetIndex);
            if (gen !== generation) return;

            if (showMath) {
              const elemSize = C_TYPE_SIZES['int'];
              const prevAddr = value - elemSize;
              arithmeticDisplay = {
                base: toHex(prevAddr, 4),
                offset: 1,
                size: elemSize,
                result: toHex(value, 4),
              };
            }
          }
        }
        break;
      }

      case 'highlightVar':
        memoryView.highlightVar(step.action.varName);
        break;
    }
  }

  function replaySubStep(step: CSubStep & { instrIdx: number }, isLast: boolean) {
    const instr = program[step.instrIdx];

    if (!step.action) {
      // For pointer-arith-deref compute step, set pointer position instantly
      if (instr.kind === 'pointer-arith-deref' && instr.offset > 0) {
        const resolvedIndex = resolvePointerArithIndex(instr);
        strip.setPointer(instr.ptrName, resolvedIndex);
      }
      return;
    }

    switch (step.action.kind) {
      case 'declareVar':
        void memoryView.declareVar(step.action.typeName, step.action.varName, step.action.targetType);
        break;

      case 'declareArray':
        void memoryView.declareArray(step.action.elementType, step.action.varName, step.action.count);
        strip.declareArray(step.action.varName, step.action.elementType, step.action.count);
        break;

      case 'assignArrayElement':
        void memoryView.assignArrayElement(step.action.arrayName, step.action.index, step.action.value);
        strip.assignElementValue(step.action.index, step.action.value);
        break;

      case 'highlightArrayElement': {
        if (isLast) {
          let index = step.action.index;
          if (instr.kind === 'pointer-arith-deref') {
            index = resolvePointerArithIndex(instr);
          }
          const arrVar = memoryView.getVariable(step.action.arrayName);
          const isOob = arrVar?.arrayElements != null && index >= arrVar.arrayElements;
          if (isOob) {
            oobIndex = index;
            memoryView.highlightOob(step.action.arrayName, index);
          } else {
            memoryView.highlightArrayElement(step.action.arrayName, index);
            strip.highlightElement(index, arrVar?.color);
          }
        }
        break;
      }

      case 'assignVar': {
        let value = step.action.value;

        // Same runtime resolution as executeSubStep
        if (instr.kind === 'array-index-read') {
          value = getElementValue(instr.arrayName, instr.index);
        } else if (instr.kind === 'pointer-arith-deref') {
          const resolvedIndex = resolvePointerArithIndex(instr);
          value = getElementValue(instr.arrayName, resolvedIndex);
        } else if (instr.kind === 'assign' && ptrToArray.has(instr.varName)) {
          const currentAddr = memoryView.getVariable(instr.varName)?.value ?? 0;
          const arrName = ptrToArray.get(instr.varName)!;
          const arrVar = memoryView.getVariable(arrName);
          if (arrVar?.arrayElements) {
            const elemSize = arrVar.size / arrVar.arrayElements;
            value = currentAddr + elemSize;
          }
        }

        void memoryView.assignVar(step.action.varName, value);

        // Instant pointer position update during replay
        if (ptrToArray.has(step.action.varName)) {
          const arrName = ptrToArray.get(step.action.varName)!;
          const targetIndex = computeArrayIndex(value, arrName);
          strip.setPointer(step.action.varName, targetIndex);
        }
        break;
      }

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
    strip.reset();
    arithmeticDisplay = null;
    oobIndex = null;
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
    arithmeticDisplay = null;
    oobIndex = null;
    memoryView?.reset();
    strip?.reset();
  }

  // Set bits view on mount
  $effect(() => {
    if (memoryView) {
      memoryView.setViewMode('bits');
    }
  });
</script>

<div class="array-layout">
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
  <div class="right-column">
    <div class="strip-controls">
      <button
        class="math-toggle"
        class:active={showMath}
        onclick={() => showMath = !showMath}
      >
        {showMath ? 'Hide math' : 'Show math'}
      </button>
    </div>
    <CArrayStrip bind:this={strip} {arithmeticDisplay} {oobIndex} />
    <CMemoryView bind:this={memoryView} />
  </div>
</div>

<style>
  .array-layout {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
    align-items: start;
  }

  .right-column {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .strip-controls {
    display: flex;
    justify-content: flex-end;
  }

  .math-toggle {
    padding: 0.25rem 0.75rem;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--color-text-muted);
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    cursor: pointer;
    transition: color var(--transition-fast), border-color var(--transition-fast);
  }

  .math-toggle:hover {
    color: var(--color-text);
    border-color: var(--color-text-muted);
  }

  .math-toggle.active {
    color: var(--color-accent);
    border-color: var(--color-accent);
  }

  @media (max-width: 768px) {
    .array-layout {
      grid-template-columns: 1fr;
    }
  }
</style>
