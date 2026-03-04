<script lang="ts">
  import { tokens } from '../../lib/tokens';
  import { type Param, paramDefaults, saveParams } from '../../lib/params';

  let {
    widgetId,
    defs,
    values = $bindable(),
  }: {
    widgetId: string;
    defs: Param[];
    values: Record<string, number>;
  } = $props();

  let isOpen = $state(false);
  let copyFeedback = $state('');

  // Group defs by category, tracking current values
  type Entry = Param & { current: number };
  type Group = { category: string; entries: Entry[] };

  let groups: Group[] = $derived(
    Object.entries(
      Object.groupBy(defs, (d) => d.category),
    ).map(([category, items]) => ({
      category,
      entries: items!.map((d) => ({ ...d, current: values[d.name] ?? d.value })),
    })),
  );

  let allEntries = $derived(groups.flatMap((g) => g.entries));
  let defaults = paramDefaults(defs);
  let hasOverrides = $derived(allEntries.some((e) => e.current !== defaults[e.name]));

  function apply(entry: Entry) {
    values[entry.name] = entry.current;
    saveParams(widgetId, values, defs);
  }

  function resetEntry(entry: Entry) {
    entry.current = defaults[entry.name];
    values[entry.name] = defaults[entry.name];
    saveParams(widgetId, values, defs);
  }

  function resetAll() {
    for (const entry of allEntries) {
      entry.current = defaults[entry.name];
      values[entry.name] = defaults[entry.name];
    }
    localStorage.removeItem(`widget-params-${widgetId}`);
  }

  function copyParams() {
    const lines = allEntries.map((e) => {
      const v = values[e.name] ?? e.value;
      return `  { name: '${e.name}', value: ${v}, unit: '${e.unit}', category: '${e.category}', min: ${e.min}, max: ${e.max}, step: ${e.step}, description: '${e.description}' },`;
    });
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      copyFeedback = 'Copied!';
      setTimeout(() => (copyFeedback = ''), 1500);
    });
  }

  // Freeze global token defaults so global slider changes don't affect this panel
  function freezeTokens(node: HTMLElement) {
    for (const token of tokens) {
      node.style.setProperty(token.name, `${token.value}${token.unit}`);
    }
  }
</script>

{#if import.meta.env.DEV}
  <div class="widget-debug-root" use:freezeTokens>
    <button
      class="widget-debug-toggle"
      onclick={() => (isOpen = !isOpen)}
      aria-label={isOpen ? 'Close widget debug panel' : 'Open widget debug panel'}
      aria-expanded={isOpen}
      title="Widget params"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 1a1 1 0 0 1 1 1v.6a5.5 5.5 0 0 1 1.8.7l.4-.4a1 1 0 1 1 1.4 1.4l-.4.4a5.5 5.5 0 0 1 .7 1.8H13.5a1 1 0 1 1 0 2H12.9a5.5 5.5 0 0 1-.7 1.8l.4.4a1 1 0 1 1-1.4 1.4l-.4-.4a5.5 5.5 0 0 1-1.8.7V13.5a1 1 0 1 1-2 0V12.9a5.5 5.5 0 0 1-1.8-.7l-.4.4a1 1 0 0 1-1.4-1.4l.4-.4A5.5 5.5 0 0 1 3.1 9H2.5a1 1 0 0 1 0-2H3.1a5.5 5.5 0 0 1 .7-1.8l-.4-.4a1 1 0 0 1 1.4-1.4l.4.4A5.5 5.5 0 0 1 7 3.1V2.5A1 1 0 0 1 8 1Zm0 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" fill="currentColor" />
      </svg>
    </button>

    {#if isOpen}
      <div class="widget-debug-panel" role="dialog" aria-label="{widgetId} debug panel">
        <div class="debug-header">
          <span class="debug-title">{widgetId}</span>
          <div class="debug-actions">
            <button class="debug-btn" onclick={copyParams}>
              {copyFeedback || 'Copy'}
            </button>
            {#if hasOverrides}
              <button class="debug-btn" onclick={resetAll}>Reset all</button>
            {/if}
            <button class="debug-btn" onclick={() => (isOpen = false)} aria-label="Close">&times;</button>
          </div>
        </div>

        <div class="debug-body">
          {#each groups as group}
            <details open>
              <summary class="group-label">{group.category}</summary>
              <div class="group-entries">
                {#each group.entries as entry}
                  <div class="entry-row">
                    <div class="entry-label">
                      <label class="entry-name" for="{widgetId}-{entry.name}">{entry.name}</label>
                      <span class="entry-tooltip">{entry.description}</span>
                    </div>
                    <div class="entry-control">
                      <input
                        id="{widgetId}-{entry.name}"
                        type="range"
                        min={entry.min}
                        max={entry.max}
                        step={entry.step}
                        bind:value={entry.current}
                        oninput={() => apply(entry)}
                      />
                      <span class="entry-value" class:modified={entry.current !== defaults[entry.name]}>
                        {entry.current}{entry.unit}
                      </span>
                      {#if entry.current !== defaults[entry.name]}
                        <button class="entry-reset" onclick={() => resetEntry(entry)} title="Reset to default">
                          &circlearrowleft;
                        </button>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            </details>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .widget-debug-root {
    display: contents;
  }

  .widget-debug-toggle {
    position: absolute;
    top: var(--space-xs);
    right: var(--space-xs);
    z-index: 10;
    display: grid;
    place-items: center;
    width: 1.75rem;
    height: 1.75rem;
    background: var(--color-bg-raised);
    color: var(--color-text-muted);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    opacity: 0.5;
    transition:
      color var(--transition-fast),
      border-color var(--transition-fast),
      opacity var(--transition-fast);
  }

  .widget-debug-toggle:hover {
    color: var(--color-accent);
    border-color: var(--color-accent);
    opacity: 1;
  }

  .widget-debug-panel {
    position: absolute;
    top: var(--space-xs);
    right: calc(var(--space-xs) + 2.25rem);
    z-index: 10;
    width: 18rem;
    max-height: 20rem;
    display: flex;
    flex-direction: column;
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: 0.8125rem;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }

  .debug-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-xs) var(--space-sm);
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .debug-title {
    font-weight: 600;
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--color-text-muted);
  }

  .debug-actions {
    display: flex;
    gap: var(--space-xs);
  }

  .debug-btn {
    all: unset;
    padding: 0.125rem 0.375rem;
    font-size: 0.6875rem;
    color: var(--color-text-muted);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: color var(--transition-fast);
  }

  .debug-btn:hover {
    color: var(--color-text);
    border-color: var(--color-text-muted);
  }

  .debug-body {
    overflow-y: auto;
    padding: var(--space-xs);
    scrollbar-width: thin;
    scrollbar-color: var(--color-border) transparent;
  }

  .debug-body::-webkit-scrollbar {
    width: 6px;
  }

  .debug-body::-webkit-scrollbar-track {
    background: transparent;
  }

  .debug-body::-webkit-scrollbar-thumb {
    background: var(--color-border);
    border-radius: 3px;
  }

  .debug-body::-webkit-scrollbar-thumb:hover {
    background: var(--color-text-muted);
  }

  details {
    margin-bottom: var(--space-xs);
  }

  .group-label {
    font-weight: 600;
    font-size: 0.625rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
    cursor: pointer;
    padding: var(--space-xs) 0;
    user-select: none;
  }

  .group-entries {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    padding-top: var(--space-xs);
  }

  .entry-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .entry-label {
    position: relative;
  }

  .entry-name {
    font-family: var(--font-mono);
    font-size: 0.625rem;
    color: var(--color-text-muted);
    cursor: help;
  }

  .entry-tooltip {
    display: none;
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 10;
    padding: 0.25rem 0.5rem;
    font-size: 0.625rem;
    font-family: var(--font-body);
    color: var(--color-text);
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    white-space: normal;
    max-width: 16rem;
    pointer-events: none;
  }

  .entry-label:hover .entry-tooltip {
    display: block;
  }

  .entry-control {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
  }

  input[type='range'] {
    flex: 1;
    height: 4px;
    accent-color: var(--color-accent);
    cursor: pointer;
  }

  .entry-value {
    font-family: var(--font-mono);
    font-size: 0.625rem;
    min-width: 4rem;
    text-align: right;
    color: var(--color-text-muted);
  }

  .entry-value.modified {
    color: var(--color-accent);
  }

  .entry-reset {
    all: unset;
    font-size: 0.75rem;
    color: var(--color-text-muted);
    cursor: pointer;
    line-height: 1;
  }

  .entry-reset:hover {
    color: var(--color-text);
  }
</style>
