<script lang="ts">
  import type { Param } from '../../lib/params';
  import { loadParams } from '../../lib/params';
  import WidgetDebugPanel from '../debug/WidgetDebugPanel.svelte';
  import { programs } from '../../lib/programs';
  import type { Program, ProgramStep } from '../../lib/programs';

  const WIDGET_ID = 'memory-tracer';

  const paramDefs: Param[] = [
    { name: 'codeFontSize',  value: 0.82, unit: 'rem', category: 'style', min: 0.65, max: 1.2, step: 0.05, description: 'Code font size' },
    { name: 'tableFontSize', value: 0.75, unit: 'rem', category: 'style', min: 0.6,  max: 1.0, step: 0.05, description: 'Memory table font size' },
    { name: 'outputFontSize', value: 0.72, unit: 'rem', category: 'style', min: 0.55, max: 1.0, step: 0.05, description: 'Output panel font size' },
    { name: 'glowDuration',  value: 400,  unit: 'ms',  category: 'behavior', min: 100, max: 800, step: 50, description: 'Row highlight duration' },
  ];

  let params = $state(loadParams(WIDGET_ID, paramDefs));

  let activeProgram = $state(0);
  let currentStep = $state(0);
  let glowTimerId: ReturnType<typeof setTimeout> | undefined;

  const program = $derived(programs[activeProgram]);
  const totalSteps = $derived(program.steps.length - 1);
  const snapshot = $derived(program.steps[currentStep]);

  export function step() {
    if (currentStep >= totalSteps) return;
    currentStep++;
    scheduleGlow();
  }

  export function stepBack() {
    if (currentStep <= 0) return;
    currentStep--;
    clearGlow();
  }

  export function reset() {
    currentStep = 0;
    clearGlow();
  }

  export function selectProgram(index: number) {
    if (index === activeProgram) return;
    activeProgram = index;
    currentStep = 0;
    clearGlow();
  }

  function scheduleGlow() {
    clearTimeout(glowTimerId);
    glowTimerId = setTimeout(() => { glowTimerId = undefined; }, params.glowDuration);
  }

  function clearGlow() {
    clearTimeout(glowTimerId);
    glowTimerId = undefined;
  }

  const isGlowing = $derived(glowTimerId !== undefined);

  function isPointerType(type: string): boolean {
    return type.includes('*');
  }
</script>

<div class="memory-tracer" style="
  --mt-code-size: {params.codeFontSize}rem;
  --mt-table-size: {params.tableFontSize}rem;
  --mt-output-size: {params.outputFontSize}rem;
">
  <!-- Program selector -->
  <div class="program-tabs" role="tablist">
    {#each programs as prog, i}
      <button
        class="program-tab"
        class:active={i === activeProgram}
        role="tab"
        aria-selected={i === activeProgram}
        onclick={() => selectProgram(i)}
      >
        {prog.shortTitle}
      </button>
    {/each}
  </div>

  <div class="program-desc">{program.description}</div>

  <!-- Main content area -->
  <div class="content-split">
    <!-- Left: Code panel -->
    <div class="code-panel">
      <div class="code-header">
        <span class="code-title">Code</span>
        <div class="step-controls">
          <button class="step-btn" onclick={() => stepBack()} disabled={currentStep === 0} aria-label="Previous step">&larr;</button>
          <span class="step-label">Step {currentStep}/{totalSteps}</span>
          <button class="step-btn" onclick={() => step()} disabled={currentStep === totalSteps} aria-label="Next step">&rarr;</button>
        </div>
      </div>
      <div class="code-lines">
        {#each program.code as line, i}
          {@const lineNum = i + 1}
          {@const isBlank = line.trim() === ''}
          {@const isCurrent = snapshot.lineNumber === lineNum}
          {@const isExecuted = lineNum < snapshot.lineNumber}
          {#if !isBlank}
            <div class="code-line" class:executed={isExecuted} class:current={isCurrent}>
              <span class="line-number">{lineNum}</span>
              <code>{line}</code>
            </div>
          {:else}
            <div class="code-line blank"></div>
          {/if}
        {/each}
      </div>
      {#if currentStep > 0}
        <div class="step-description">{snapshot.description}</div>
      {/if}
    </div>

    <!-- Right: Memory + Output -->
    <div class="data-panel">
      <!-- Memory table -->
      <div class="memory-section">
        <div class="section-label">Memory</div>
        {#if snapshot.memory.length === 0}
          <div class="empty-state">No variables yet</div>
        {:else}
          <div class="memory-table-wrap">
            <table class="memory-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Name</th>
                  <th>Value</th>
                  <th>Address</th>
                  {#if snapshot.memory.some(e => e.scope)}
                    <th>Scope</th>
                  {/if}
                  {#if snapshot.memory.some(e => e.region)}
                    <th>Region</th>
                  {/if}
                </tr>
              </thead>
              <tbody>
                {#each snapshot.memory as entry}
                  <tr
                    class:new-row={entry.isNew && isGlowing}
                    class:changed-row={entry.isChanged && isGlowing}
                    class:pointer-type={isPointerType(entry.type)}
                    class:heap-entry={entry.region === 'heap'}
                  >
                    <td class="cell-type">{entry.type}</td>
                    <td class="cell-name">{entry.name}</td>
                    <td class="cell-value" class:pointer-value={isPointerType(entry.type)}>{entry.value}</td>
                    <td class="cell-addr">{entry.address}</td>
                    {#if snapshot.memory.some(e => e.scope)}
                      <td class="cell-scope">{entry.scope || 'main'}</td>
                    {/if}
                    {#if snapshot.memory.some(e => e.region)}
                      <td class="cell-region">
                        {#if entry.region}
                          <span class="region-badge" class:stack={entry.region === 'stack'} class:heap={entry.region === 'heap'}>
                            {entry.region}
                          </span>
                        {/if}
                      </td>
                    {/if}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>

      <!-- Output panel -->
      {#if snapshot.output.length > 0}
        <div class="output-section">
          <div class="section-label">Output</div>
          <div class="output-lines">
            {#each snapshot.output as line}
              <div class="output-line" class:new-output={line.isNew && isGlowing}>
                <span class="prompt">&gt;</span> {line.text}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </div>

  <WidgetDebugPanel defs={paramDefs} bind:values={params} widgetId={WIDGET_ID} />
</div>

<style>
  .memory-tracer {
    position: relative;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  /* Program selector tabs */
  .program-tabs {
    display: flex;
    gap: 2px;
    background: var(--color-bg-surface);
    border-radius: 6px;
    padding: 2px;
  }

  .program-tab {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--color-text-muted);
    background: transparent;
    border: none;
    border-radius: 4px;
    padding: 0.4rem 0.5rem;
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
    white-space: nowrap;
  }

  .program-tab.active {
    background: var(--color-bg-raised);
    color: var(--color-text);
  }

  .program-tab:hover:not(.active) {
    color: var(--color-text);
  }

  .program-tab:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }

  .program-desc {
    font-size: 0.72rem;
    color: var(--color-text-muted);
    font-style: italic;
  }

  /* Content split layout */
  .content-split {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    align-items: start;
  }

  /* Code panel */
  .code-panel {
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 0.75rem;
  }

  .code-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .code-title {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-muted);
  }

  .step-controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .step-btn {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--color-text);
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 0.2rem 0.5rem;
    cursor: pointer;
    transition: border-color var(--transition-fast);
  }

  .step-btn:hover:not(:disabled) { border-color: var(--color-accent); }
  .step-btn:disabled { opacity: 0.3; cursor: default; }
  .step-btn:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }

  .step-label {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--color-text-muted);
    min-width: 5rem;
    text-align: center;
  }

  .code-lines {
    display: flex;
    flex-direction: column;
    gap: 1px;
    max-height: 20rem;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--color-border) transparent;
  }

  .code-line {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    transition: background 200ms ease;
    flex-shrink: 0;
  }

  .code-line.blank {
    height: 0.5rem;
  }

  .code-line.executed { opacity: 0.4; }
  .code-line.current { background: rgba(77, 159, 255, 0.1); border-left: 2px solid var(--color-accent); }

  .line-number {
    font-family: var(--font-mono);
    font-size: calc(var(--mt-code-size) * 0.8);
    color: var(--color-text-muted);
    min-width: 1.5rem;
    text-align: right;
  }

  .code-line code {
    font-family: var(--font-mono);
    font-size: var(--mt-code-size);
    color: var(--color-text);
    white-space: nowrap;
  }

  .step-description {
    font-size: 0.75rem;
    color: var(--color-text-muted);
    margin-top: 0.5rem;
    padding: 0.4rem 0.5rem;
    background: var(--color-bg-surface);
    border-radius: 4px;
  }

  /* Data panel (memory + output) */
  .data-panel {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .section-label {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-muted);
    margin-bottom: 0.35rem;
  }

  /* Memory table */
  .memory-section {
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 0.75rem;
  }

  .empty-state {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--color-text-muted);
    text-align: center;
    padding: 2rem;
  }

  .memory-table-wrap {
    overflow-x: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--color-border) transparent;
  }

  .memory-table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-mono);
    font-size: var(--mt-table-size);
  }

  .memory-table th {
    text-align: left;
    padding: 0.3rem 0.4rem;
    font-size: calc(var(--mt-table-size) * 0.85);
    font-weight: 700;
    color: var(--color-text-muted);
    border-bottom: 1px solid var(--color-border);
    white-space: nowrap;
  }

  .memory-table td {
    padding: 0.3rem 0.4rem;
    border-bottom: 1px solid rgba(42, 47, 62, 0.5);
    white-space: nowrap;
    transition: background 300ms ease;
  }

  .memory-table tr.new-row td {
    background: rgba(77, 159, 255, 0.12);
  }

  .memory-table tr.changed-row td {
    background: rgba(245, 166, 35, 0.12);
  }

  .cell-type {
    color: var(--color-text-muted);
    font-size: calc(var(--mt-table-size) * 0.9);
  }

  .cell-name {
    font-weight: 700;
    color: var(--color-text);
  }

  .cell-value {
    color: var(--color-text);
  }

  .cell-value.pointer-value {
    color: var(--color-accent);
    font-size: calc(var(--mt-table-size) * 0.9);
  }

  .cell-addr {
    color: var(--color-text-muted);
    font-size: calc(var(--mt-table-size) * 0.9);
  }

  .cell-scope {
    font-size: calc(var(--mt-table-size) * 0.85);
    color: var(--color-text-muted);
  }

  .cell-region {
    text-align: center;
  }

  .region-badge {
    display: inline-block;
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    font-size: calc(var(--mt-table-size) * 0.8);
    font-weight: 600;
  }

  .region-badge.stack {
    background: rgba(77, 159, 255, 0.1);
    color: rgba(77, 159, 255, 0.8);
  }

  .region-badge.heap {
    background: rgba(245, 166, 35, 0.1);
    color: rgba(245, 166, 35, 0.8);
  }

  .heap-entry .cell-name {
    color: rgba(245, 166, 35, 0.9);
  }

  /* Output panel */
  .output-section {
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 0.75rem;
    animation: fade-up 300ms ease;
  }

  .output-lines {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .output-line {
    font-family: var(--font-mono);
    font-size: var(--mt-output-size);
    color: var(--color-text);
    padding: 0.2rem 0.3rem;
    border-radius: 3px;
    transition: background 300ms ease;
  }

  .output-line.new-output {
    background: rgba(52, 211, 153, 0.1);
  }

  .prompt {
    color: var(--color-success);
    font-weight: 700;
  }

  @keyframes fade-up {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* Responsive: stack on mobile */
  @media (max-width: 768px) {
    .content-split {
      grid-template-columns: 1fr;
    }

    .code-lines {
      max-height: 14rem;
    }

    .program-tab {
      font-size: 0.62rem;
      padding: 0.35rem 0.3rem;
    }
  }
</style>
