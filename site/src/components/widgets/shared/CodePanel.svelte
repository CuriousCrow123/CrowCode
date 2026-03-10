<script lang="ts">
  /**
   * CodePanel — Shared component for displaying C code with syntax highlighting.
   *
   * No WIDGET_ID, no paramDefs — receives all data via props.
   * Follows the shared component pattern (like BitCell, ScrubSlider).
   */
  import type { CInstruction, CSubStepKind } from '../../../lib/c-program';

  interface CodePanelProps {
    instructions: CInstruction[];
    currentLine: number; // -1 = none highlighted
    showControls?: boolean;
    canPrev?: boolean;
    canNext?: boolean;
    onnext?: () => void;
    onprev?: () => void;
    /** Character range within active line to highlight */
    subHighlight?: { start: number; end: number; kind: CSubStepKind };
    /** Status label below step controls */
    statusLabel?: string;
  }

  let {
    instructions,
    currentLine = -1,
    showControls = false,
    canPrev = false,
    canNext = false,
    onnext,
    onprev,
    subHighlight,
    statusLabel,
  }: CodePanelProps = $props();

  // --- Syntax highlighting ---

  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Single-pass tokenizer for the C subset used in teaching examples.
   * Tokenizes first, then builds HTML — avoids regex clobbering across passes.
   *
   * NOTE: Code strings are hardcoded by the essay author, not user input.
   * escapeHtml is defense-in-depth for future-proofing.
   */
  function highlightSyntax(code: string): string {
    const TOKEN_RE =
      /\b(int|char|float|double)\b|'.'|\b\d+(?:\.\d+)?\b|[+\-*/=;]/g;

    let result = '';
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = TOKEN_RE.exec(code)) !== null) {
      // Append any unmatched text before this token
      if (match.index > lastIndex) {
        result += escapeHtml(code.slice(lastIndex, match.index));
      }

      const token = match[0];
      const escaped = escapeHtml(token);

      if (match[1]) {
        // Type keyword (captured group 1)
        result += `<span class="hl-type">${escaped}</span>`;
      } else if (token.startsWith("'")) {
        // Char literal
        result += `<span class="hl-literal">${escaped}</span>`;
      } else if (/^\d/.test(token)) {
        // Numeric literal
        result += `<span class="hl-literal">${escaped}</span>`;
      } else if ('+-*/='.includes(token)) {
        // Operator
        result += `<span class="hl-op">${escaped}</span>`;
      } else {
        // Punctuation (;) — no special styling
        result += escaped;
      }

      lastIndex = match.index + token.length;
    }

    // Append remaining text
    if (lastIndex < code.length) {
      result += escapeHtml(code.slice(lastIndex));
    }

    return result;
  }
</script>

<div class="code-panel">
  <div class="code-lines">
    {#each instructions as instr, idx (idx)}
      <div class="code-line" class:active={idx === currentLine}>
        <span class="line-number">{idx + 1}</span>
        <code>
          {@html highlightSyntax(instr.code)}
          {#if idx === currentLine && subHighlight}
            <span
              class="sub-highlight sub-highlight--{subHighlight.kind}"
              style="left: {subHighlight.start}ch; width: {subHighlight.end - subHighlight.start}ch"
            ></span>
          {/if}
        </code>
      </div>
    {/each}
  </div>

  {#if showControls}
    <div class="step-controls">
      <button onclick={onprev} disabled={!canPrev} aria-label="Previous step">
        Prev
      </button>
      <button onclick={onnext} disabled={!canNext} aria-label="Next step">
        Next
      </button>
    </div>
  {/if}

  {#if statusLabel}
    <div class="status-label">
      <span class="status-arrow">▸</span> {statusLabel}
    </div>
  {/if}
</div>

<style>
  .code-panel {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    line-height: 1.6;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 6px;
    padding: 0.75rem 0;
    overflow-x: auto;
  }

  .code-lines {
    display: flex;
    flex-direction: column;
  }

  .code-line {
    display: flex;
    align-items: center;
    padding: 0.15rem 0.75rem;
    border-left: 2px solid transparent;
    transition: background var(--transition-fast);
  }

  .code-line.active {
    background: rgba(99, 102, 241, 0.08);
    border-left-color: var(--color-accent, #6366f1);
  }

  .line-number {
    color: var(--color-text-muted);
    opacity: 0.4;
    width: 1.5em;
    text-align: right;
    margin-right: 1em;
    font-size: 0.7rem;
    user-select: none;
    flex-shrink: 0;
  }

  code {
    white-space: pre;
    position: relative;
  }

  /* Defensive: prevent syntax-highlighted spans from drifting ch-unit overlay */
  code :global(span) {
    letter-spacing: normal;
    padding: 0;
  }

  /* Sub-expression highlight overlay (ch-unit positioned within <code>) */
  .sub-highlight {
    position: absolute;
    top: -2px;
    bottom: -2px;
    border-radius: 2px;
    pointer-events: none;
    transition: left 0.15s ease, width 0.15s ease, background 0.15s ease;
  }

  .sub-highlight--declare { background: rgba(239, 68, 68, 0.15); }
  .sub-highlight--read    { background: rgba(99, 102, 241, 0.15); }
  .sub-highlight--compute { background: rgba(234, 179, 8, 0.15); }
  .sub-highlight--assign  { background: rgba(34, 197, 94, 0.15); }

  /* Syntax highlighting classes */
  code :global(.hl-type) {
    color: #c792ea;
  }

  code :global(.hl-literal) {
    color: #f78c6c;
  }

  code :global(.hl-op) {
    color: #89ddff;
  }

  /* Step controls */
  .step-controls {
    display: flex;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem 0;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    margin-top: 0.5rem;
  }

  .step-controls button {
    padding: 0.25rem 0.75rem;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--color-text-muted);
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 4px;
    cursor: pointer;
    transition: color var(--transition-fast), border-color var(--transition-fast);
  }

  .step-controls button:hover:not(:disabled) {
    color: var(--color-text);
    border-color: var(--color-text-muted);
  }

  .step-controls button:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  /* Status label */
  .status-label {
    font-size: 0.7rem;
    color: var(--color-text-muted);
    padding: 0.4rem 0.75rem;
    font-style: italic;
  }

  .status-arrow {
    opacity: 0.5;
  }
</style>
