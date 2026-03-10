<script lang="ts">
  import CMemoryView from '../widgets/CMemoryView.svelte';
  import CodePanel from '../widgets/shared/CodePanel.svelte';
  import type { SubHighlightSegment } from '../widgets/shared/CodePanel.svelte';
  import StdoutPanel from '../widgets/shared/StdoutPanel.svelte';
  import type { StdoutSegment } from '../widgets/shared/StdoutPanel.svelte';
  import {
    type CInstruction,
    type CSubStep,
    type CSubStepKind,
    type CVariable,
    countSubSteps,
    decomposeInstruction,
    parseFormatString,
  } from '../../lib/c-program';

  // --- Demo program ---

  const program: CInstruction[] = [
    { kind: 'declare-assign', code: 'int x = 42;', varName: 'x', type: 'int', value: 42 },
    { kind: 'declare-assign', code: "char c = 'A';", varName: 'c', type: 'char', value: 65 },
    { kind: 'declare-assign', code: 'float f = 3.14;', varName: 'f', type: 'float', value: 3.14 },
    { kind: 'printf', code: 'printf("x=%d, c=%c\\n", x, c);', format: 'x=%d, c=%c\\n', sources: ['x', 'c'] },
    { kind: 'printf', code: 'printf("f=%f\\n", f);', format: 'f=%f\\n', sources: ['f'] },
  ];

  /** Map sub-step kinds to highlight colors. */
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
  let pc = $state(-1);
  let isAnimating = $state(false);

  // Sub-step cache
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

  const totalSubSteps = program.reduce((sum, instr) => sum + countSubSteps(instr), 0);

  // --- Stdout state ---

  let stdoutSegments: StdoutSegment[] = $state([]);
  let activeSegmentIndex = $state(-1);

  // --- Derived display state ---

  let currentStep = $derived(pc >= 0 && pc < executed.length ? executed[pc] : null);
  let currentInstrIdx = $derived(currentStep?.instrIdx ?? -1);

  let subHighlights = $derived.by((): SubHighlightSegment[] | undefined => {
    if (!currentStep) return undefined;
    const code = program[currentStep.instrIdx].code;
    const start = currentStep.highlightOffset ?? code.indexOf(currentStep.highlight);
    if (start === -1) return undefined;

    const mainHighlight: SubHighlightSegment = {
      start,
      end: start + currentStep.highlight.length,
      color: SUB_STEP_COLORS[currentStep.kind],
    };

    // For printf-placeholder steps, also highlight the argument name in the arg list
    if (currentStep.kind === 'printf-placeholder' && currentStep.action?.kind === 'appendStdout') {
      const instr = program[currentStep.instrIdx];
      if (instr.kind === 'printf') {
        // Find which source this placeholder corresponds to
        const placeholderSteps = executed
          .filter((s) => s.instrIdx === currentStep!.instrIdx && s.kind === 'printf-placeholder');
        const placeholderIdx = placeholderSteps.indexOf(currentStep);
        const varName = instr.sources[placeholderIdx >= 0 ? placeholderIdx : 0];
        if (varName) {
          // Find the variable name after the closing quote in the args
          const closingQuote = code.indexOf('"', code.indexOf('"') + 1);
          const argsSection = code.slice(closingQuote + 1);
          const argStart = argsSection.indexOf(varName);
          if (argStart >= 0) {
            const varColor = memoryView?.getVariable(varName)?.color ?? SUB_STEP_COLORS['printf-placeholder'];
            return [
              { ...mainHighlight, color: varColor },
              {
                start: closingQuote + 1 + argStart,
                end: closingQuote + 1 + argStart + varName.length,
                color: varColor,
              },
            ];
          }
        }
      }
    }

    return [mainHighlight];
  });

  let statusLabel = $derived(currentStep?.label);

  // --- Orchestration ---

  async function executeNext() {
    const nextPc = pc + 1;
    if (isAnimating || nextPc >= totalSubSteps) return;

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
      case 'appendStdout': {
        // Build stdout segment
        let seg: StdoutSegment;
        if (step.kind === 'printf-placeholder') {
          // Find the variable associated with this placeholder
          const instr = program[step.instrIdx];
          if (instr.kind === 'printf') {
            const placeholderSteps = executed
              .filter((s) => s.instrIdx === step.instrIdx && s.kind === 'printf-placeholder');
            const placeholderIdx = placeholderSteps.indexOf(step);
            const varName = instr.sources[placeholderIdx >= 0 ? placeholderIdx : 0];
            const varColor = memoryView?.getVariable(varName)?.color ?? 'rgba(99, 102, 241, 0.35)';

            // Highlight the variable in memory
            memoryView.highlightVar(varName, varColor);

            seg = { kind: 'variable', text: step.action.text, color: varColor };
          } else {
            seg = { kind: 'literal', text: step.action.text };
          }
        } else if (step.action.raw) {
          seg = { kind: 'escape', rendered: step.action.text, raw: step.action.raw };
        } else {
          seg = { kind: 'literal', text: step.action.text };
        }

        stdoutSegments = [...stdoutSegments, seg];
        activeSegmentIndex = stdoutSegments.length - 1;
        break;
      }
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
      case 'appendStdout':
        // Stdout is rebuilt separately — no action needed here
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

    // Rebuild stdout from executed steps
    rebuildStdout();
  }

  function rebuildStdout() {
    const segs: StdoutSegment[] = [];
    for (const step of executed.slice(0, pc + 1)) {
      if (step.action?.kind !== 'appendStdout') continue;

      if (step.kind === 'printf-placeholder') {
        const instr = program[step.instrIdx];
        if (instr.kind === 'printf') {
          const placeholderSteps = executed
            .slice(0, pc + 1)
            .filter((s) => s.instrIdx === step.instrIdx && s.kind === 'printf-placeholder');
          const placeholderIdx = placeholderSteps.indexOf(step);
          const varName = instr.sources[placeholderIdx >= 0 ? placeholderIdx : 0];
          const varColor = memoryView?.getVariable(varName)?.color ?? 'rgba(99, 102, 241, 0.35)';
          segs.push({ kind: 'variable', text: step.action.text, color: varColor });
        } else {
          segs.push({ kind: 'literal', text: step.action.text });
        }
      } else if (step.action.raw) {
        segs.push({ kind: 'escape', rendered: step.action.text, raw: step.action.raw });
      } else {
        segs.push({ kind: 'literal', text: step.action.text });
      }
    }
    stdoutSegments = segs;
    activeSegmentIndex = -1;
  }

  function handleReset() {
    pc = -1;
    isAnimating = false;
    cachedSubSteps.clear();
    executed = [];
    stdoutSegments = [];
    activeSegmentIndex = -1;
    memoryView.reset();
    memoryView.setViewMode('bits');
  }
</script>

<div class="printf-layout">
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
  <StdoutPanel
    segments={stdoutSegments}
    {activeSegmentIndex}
    showCursor={stdoutSegments.length > 0}
  />
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
  .printf-layout {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto auto;
    gap: 1.5rem;
    align-items: start;
  }

  .printf-layout :global(.stdout-panel) {
    grid-column: 1 / -1;
  }

  @media (max-width: 768px) {
    .printf-layout {
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
