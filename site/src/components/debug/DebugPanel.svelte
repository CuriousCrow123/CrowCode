<script lang="ts">
  import { tokens, type Token } from '../../lib/tokens';

  const STORAGE_KEY = 'debug-token-overrides';

  let isOpen = $state(false);
  let copyFeedback = $state('');

  // Group tokens by category
  type Group = { category: string; tokens: (Token & { current: number })[] };

  // Restore saved overrides from localStorage
  function loadSaved(): Record<string, number> {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    } catch {
      return {};
    }
  }

  const saved = loadSaved();

  let groups: Group[] = $state(
    Object.entries(
      Object.groupBy(tokens, (t) => t.category),
    ).map(([category, items]) => ({
      category,
      tokens: items!.map((t) => ({ ...t, current: saved[t.name] ?? t.value })),
    })),
  );

  // Apply any restored overrides to the DOM on mount
  $effect(() => {
    for (const token of allTokens) {
      if (token.current !== token.value) {
        document.documentElement.style.setProperty(token.name, `${token.current}${token.unit}`);
      }
    }
  });

  let allTokens = $derived(groups.flatMap((g) => g.tokens));
  let hasOverrides = $derived(allTokens.some((t) => t.current !== t.value));

  function persist() {
    const overrides: Record<string, number> = {};
    for (const t of allTokens) {
      if (t.current !== t.value) overrides[t.name] = t.current;
    }
    if (Object.keys(overrides).length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  function apply(token: Token & { current: number }) {
    document.documentElement.style.setProperty(token.name, `${token.current}${token.unit}`);
    persist();
  }

  function resetToken(token: Token & { current: number }) {
    token.current = token.value;
    document.documentElement.style.removeProperty(token.name);
    persist();
  }

  function resetAll() {
    for (const token of allTokens) {
      token.current = token.value;
      document.documentElement.style.removeProperty(token.name);
    }
    localStorage.removeItem(STORAGE_KEY);
  }

  function copyTokens() {
    const lines = allTokens.map((t) => {
      const changed = t.current !== t.value;
      const v = changed ? t.current : t.value;
      return `  { name: '${t.name}', value: ${v}, unit: '${t.unit}', category: '${t.category}', min: ${t.min}, max: ${t.max}, step: ${t.step} },`;
    });
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      copyFeedback = 'Copied!';
      setTimeout(() => (copyFeedback = ''), 1500);
    });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.ctrlKey && e.key === '.') {
      e.preventDefault();
      isOpen = !isOpen;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<button
  class="debug-toggle"
  onclick={() => (isOpen = !isOpen)}
  aria-label={isOpen ? 'Close debug panel' : 'Open debug panel'}
  aria-expanded={isOpen}
  title="Debug tokens (Ctrl+.)"
>
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    <circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.5" />
  </svg>
</button>

{#if isOpen}
  <aside class="debug-panel" role="dialog" aria-label="Design token debug panel">
    <div class="debug-header">
      <span class="debug-title">Tokens</span>
      <div class="debug-actions">
        <button class="debug-btn" onclick={copyTokens}>
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
          <div class="group-tokens">
            {#each group.tokens as token}
              <div class="token-row">
                <label class="token-name" for={token.name}>{token.name}</label>
                <div class="token-control">
                  <input
                    id={token.name}
                    type="range"
                    min={token.min}
                    max={token.max}
                    step={token.step}
                    bind:value={token.current}
                    oninput={() => apply(token)}
                  />
                  <span class="token-value" class:modified={token.current !== token.value}>
                    {token.current}{token.unit}
                  </span>
                  {#if token.current !== token.value}
                    <button class="token-reset" onclick={() => resetToken(token)} title="Reset to default">
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
  </aside>
{/if}

<style>
  .debug-toggle {
    position: fixed;
    bottom: var(--space-lg);
    right: var(--space-lg);
    z-index: 200;
    display: grid;
    place-items: center;
    width: 2.5rem;
    height: 2.5rem;
    background: var(--color-bg-raised);
    color: var(--color-text-muted);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition:
      color var(--transition-fast),
      border-color var(--transition-fast);
  }

  .debug-toggle:hover {
    color: var(--color-accent);
    border-color: var(--color-accent);
  }

  .debug-panel {
    position: fixed;
    bottom: calc(var(--space-lg) + 3rem);
    right: var(--space-lg);
    z-index: 199;
    width: 20rem;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    font-size: 0.8125rem;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }

  .debug-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .debug-title {
    font-weight: 600;
    font-size: 0.75rem;
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
    padding: 0.125rem 0.5rem;
    font-size: 0.75rem;
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
    padding: var(--space-sm);
  }

  details {
    margin-bottom: var(--space-xs);
  }

  .group-label {
    font-weight: 600;
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
    cursor: pointer;
    padding: var(--space-xs) 0;
    user-select: none;
  }

  .group-tokens {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    padding-top: var(--space-xs);
  }

  .token-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .token-name {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    color: var(--color-text-muted);
  }

  .token-control {
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

  .token-value {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    min-width: 4.5rem;
    text-align: right;
    color: var(--color-text-muted);
  }

  .token-value.modified {
    color: var(--color-accent);
  }

  .token-reset {
    all: unset;
    font-size: 0.875rem;
    color: var(--color-text-muted);
    cursor: pointer;
    line-height: 1;
  }

  .token-reset:hover {
    color: var(--color-text);
  }
</style>
