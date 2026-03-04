<script lang="ts">
  import type { Snippet } from 'svelte';

  let { caption, children }: { caption?: string; children: Snippet } = $props();
</script>

<figure class="figure">
  {@render children()}
  {#if caption}
    <figcaption class="figure-caption">{caption}</figcaption>
  {/if}
</figure>

<style>
  .figure {
    max-width: var(--figure-width);
    margin-inline: auto;
    margin-block: var(--space-2xl);
    padding: var(--space-lg);
  }

  .figure-caption {
    text-align: center;
    color: var(--color-text-muted);
    font-size: 0.875rem;
    margin-top: var(--space-sm);
  }
</style>
