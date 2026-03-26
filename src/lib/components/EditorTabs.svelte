<script lang="ts">
	import type { EditorTab } from '$lib/stores/editor-tabs.svelte';

	let {
		tabs,
		active,
		onselect,
		onadd,
		onclose,
	}: {
		tabs: EditorTab[];
		active: number;
		onselect: (index: number) => void;
		onadd: () => void;
		onclose: (index: number) => void;
	} = $props();

	function handleClose(e: MouseEvent, index: number) {
		e.stopPropagation();
		if (tabs.length <= 1) return;
		if (!confirm(`Delete "${tabs[index].name}"? This cannot be undone.`)) return;
		onclose(index);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowRight') {
			e.preventDefault();
			const next = (active + 1) % tabs.length;
			onselect(next);
			// Focus the next tab button
			const btn = (e.currentTarget as HTMLElement).querySelector(`[data-tab-index="${next}"]`) as HTMLElement;
			btn?.focus();
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			const prev = (active - 1 + tabs.length) % tabs.length;
			onselect(prev);
			const btn = (e.currentTarget as HTMLElement).querySelector(`[data-tab-index="${prev}"]`) as HTMLElement;
			btn?.focus();
		}
	}
</script>

<!-- svelte-ignore a11y_interactive_supports_focus -->
<div
	class="flex items-center gap-1 overflow-x-auto"
	role="tablist"
	aria-label="Editor tabs"
	onkeydown={handleKeydown}
>
	{#each tabs as tab, i}
		<button
			role="tab"
			aria-selected={active === i}
			tabindex={active === i ? 0 : -1}
			data-tab-index={i}
			onclick={() => onselect(i)}
			class="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-mono whitespace-nowrap transition-colors {active === i
				? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
				: 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}"
		>
			{tab.name}
			{#if tabs.length > 1}
				<button
					tabindex={-1}
					aria-label="Close {tab.name}"
					onclick={(e: MouseEvent) => handleClose(e, i)}
					class="ml-1 text-zinc-500 hover:text-zinc-300 text-xs leading-none"
				>
					&times;
				</button>
			{/if}
		</button>
	{/each}
	<button
		onclick={onadd}
		class="px-2.5 py-1.5 rounded text-sm font-mono bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300 transition-colors"
		aria-label="Add new tab"
	>
		+
	</button>
</div>
