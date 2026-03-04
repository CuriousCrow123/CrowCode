<script lang="ts">
  type TocEntry = { id: string; text: string };

  let entries: TocEntry[] = $state([]);
  let activeId = $state('');
  let isOpen = $state(false);

  $effect(() => {
    // Scan the DOM for h2[id] elements to build TOC
    const headings = document.querySelectorAll('h2[id]');
    entries = Array.from(headings).map((h) => ({
      id: h.id,
      text: h.textContent?.trim() ?? '',
    }));

    // Track which section is currently visible
    const observer = new IntersectionObserver(
      (observed) => {
        for (const entry of observed) {
          if (entry.isIntersecting) {
            activeId = entry.target.id;
          }
        }
      },
      { rootMargin: '-10% 0px -80% 0px' },
    );

    for (const heading of headings) {
      observer.observe(heading);
    }

    return () => observer.disconnect();
  });

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    // Close on mobile after clicking
    if (window.innerWidth < 768) {
      isOpen = false;
    }
  }
</script>

<button
  class="toc-toggle"
  onclick={() => (isOpen = !isOpen)}
  aria-label={isOpen ? 'Close table of contents' : 'Open table of contents'}
  aria-expanded={isOpen}
>
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    {#if isOpen}
      <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    {:else}
      <path d="M3 5h14M3 10h10M3 15h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    {/if}
  </svg>
</button>

{#if entries.length > 0}
  <nav class="toc" class:open={isOpen} aria-label="Table of contents">
    <div class="toc-header">
      <span class="toc-title">Contents</span>
    </div>
    <ol class="toc-list">
      {#each entries as entry}
        <li>
          <button
            class="toc-link"
            class:active={activeId === entry.id}
            onclick={() => scrollTo(entry.id)}
          >
            {entry.text}
          </button>
        </li>
      {/each}
    </ol>
  </nav>
{/if}

<style>
  .toc-toggle {
    position: fixed;
    top: var(--space-lg);
    left: var(--space-lg);
    z-index: 100;
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

  .toc-toggle:hover {
    color: var(--color-text);
    border-color: var(--color-text-muted);
  }

  .toc-toggle:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  .toc {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 99;
    width: var(--sidebar-width);
    height: 100vh;
    padding: var(--space-3xl) var(--space-lg) var(--space-lg);
    background: var(--color-bg-raised);
    border-right: 1px solid var(--color-border);
    overflow-y: auto;
    transform: translateX(-100%);
    transition: transform var(--transition-normal);
  }

  .toc.open {
    transform: translateX(0);
  }

  .toc-header {
    margin-bottom: var(--space-lg);
  }

  .toc-title {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--color-text-muted);
  }

  .toc-list {
    list-style: none;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .toc-link {
    all: unset;
    display: block;
    width: 100%;
    padding: var(--space-xs) var(--space-sm);
    font-size: 0.875rem;
    color: var(--color-text-muted);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition:
      color var(--transition-fast),
      background var(--transition-fast);
  }

  .toc-link:hover {
    color: var(--color-text);
    background: var(--color-bg-surface);
  }

  .toc-link.active {
    color: var(--color-accent);
    background: var(--color-bg-surface);
  }

  .toc-link:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: -2px;
  }
</style>
