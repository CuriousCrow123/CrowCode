<script lang="ts">
  /**
   * StdoutPanel — Shared component displaying accumulated terminal output.
   *
   * No WIDGET_ID, no paramDefs — receives all data via props.
   * Follows the shared component pattern (like BitCell, CodePanel, ScrubSlider).
   *
   * SECURITY: All text is rendered via Svelte text interpolation, NEVER {@html}.
   */

  export type StdoutSegment =
    | { kind: 'literal'; text: string }
    | { kind: 'variable'; text: string; color: string }
    | { kind: 'escape'; rendered: string; raw: string };

  interface StdoutPanelProps {
    segments: StdoutSegment[];
    activeSegmentIndex: number; // -1 = no active segment
    showCursor?: boolean;
  }

  let {
    segments,
    activeSegmentIndex = -1,
    showCursor = true,
  }: StdoutPanelProps = $props();

  // Auto-scroll to bottom on new segments
  let codeEl: HTMLElement | undefined = $state(undefined);
  let userScrolled = false;

  function handleScroll(e: Event) {
    const el = e.target as HTMLElement;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
    userScrolled = !atBottom;
  }

  $effect(() => {
    // Re-run when segments change
    segments;
    if (codeEl && !userScrolled) {
      codeEl.scrollTop = codeEl.scrollHeight;
    }
  });

  function segmentText(seg: StdoutSegment): string {
    switch (seg.kind) {
      case 'literal': return seg.text;
      case 'variable': return seg.text;
      case 'escape': return seg.rendered === '\t' ? '    ' : seg.rendered;
    }
  }
</script>

<div class="stdout-panel">
  <div class="stdout-label">stdout</div>
  <pre class="stdout-pre"><code
      role="log"
      aria-live="polite"
      aria-label="Program output"
      bind:this={codeEl}
      onscroll={handleScroll}
    >{#each segments as seg, idx}{#if seg.kind === 'variable'}<span
          class="seg-variable"
          class:seg-active={idx === activeSegmentIndex}
          style="color: {seg.color.replace('0.35', '1')}"
        >{segmentText(seg)}</span>{:else}<span
          class="seg-text"
          class:seg-active={idx === activeSegmentIndex}
        >{segmentText(seg)}</span>{/if}{/each}{#if showCursor}<span
        class="stdout-cursor"
        class:writing={activeSegmentIndex >= 0}
        aria-hidden="true"
      ></span>{/if}</code></pre>
</div>

<style>
  .stdout-panel {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    line-height: 1.5;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 6px;
    color: var(--color-text);
  }

  .stdout-label {
    font-size: 0.55rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
    opacity: 0.5;
    padding: 0.5rem 0.75rem 0;
    user-select: none;
  }

  .stdout-pre {
    margin: 0;
    padding: 0.25rem 0.75rem 0.75rem;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .stdout-pre code {
    display: block;
    max-height: 8rem;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.12) transparent;
  }

  .seg-variable {
    font-weight: 500;
  }

  /* Flash on active segment */
  .seg-active {
    animation: seg-flash 400ms ease-out;
  }

  @keyframes seg-flash {
    0% { background: rgba(99, 102, 241, 0.25); }
    100% { background: transparent; }
  }

  /* Blinking cursor — step-end for real terminal feel */
  .stdout-cursor {
    display: inline-block;
    width: 0.55em;
    height: 1.1em;
    vertical-align: text-bottom;
    background: var(--color-text-muted);
    opacity: 0.6;
    animation: cursor-blink 1s step-end infinite;
  }

  .stdout-cursor.writing {
    animation: none;
    opacity: 0.8;
  }

  @keyframes cursor-blink {
    0%, 50% { opacity: 0.6; }
    50.01%, 100% { opacity: 0; }
  }
</style>
