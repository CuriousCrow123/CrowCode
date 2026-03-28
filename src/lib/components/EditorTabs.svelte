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

	let confirmIndex = $state<number | null>(null);

	function handleClose(index: number) {
		if (tabs.length <= 1) return;
		confirmIndex = index;
	}

	function confirmDelete() {
		if (confirmIndex !== null) {
			onclose(confirmIndex);
			confirmIndex = null;
		}
	}

	function cancelDelete() {
		confirmIndex = null;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowRight') {
			e.preventDefault();
			const next = (active + 1) % tabs.length;
			onselect(next);
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

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && confirmIndex !== null) cancelDelete(); }} />

<!-- svelte-ignore a11y_interactive_supports_focus -->
<div
	class="flex items-center gap-1 overflow-x-auto"
	role="tablist"
	aria-label="Editor tabs"
	onkeydown={handleKeydown}
>
	{#each tabs as tab, i}
		<div class="flex items-center">
			<button
				role="tab"
				aria-selected={active === i}
				tabindex={active === i ? 0 : -1}
				data-tab-index={i}
				onclick={() => onselect(i)}
				class="px-3 py-1.5 text-sm font-mono whitespace-nowrap transition-colors border {active === i
					? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
					: 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 border-transparent'} {tabs.length <= 1 ? 'rounded' : 'rounded-l border-r-0'}"
			>
				{tab.name}
			</button>
			{#if tabs.length > 1}
				<button
					tabindex={-1}
					aria-label="Close {tab.name}"
					onclick={() => handleClose(i)}
					class="px-1.5 py-1.5 rounded-r text-sm font-mono transition-colors border {active === i
						? 'bg-blue-500/20 text-zinc-500 hover:text-zinc-300 border-blue-500/30 border-l-0'
						: 'bg-zinc-800 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 border-transparent border-l-0'}"
				>
					&times;
				</button>
			{/if}
		</div>
	{/each}
	<button
		onclick={onadd}
		class="px-2.5 py-1.5 rounded text-sm font-mono bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300 transition-colors"
		aria-label="Add new tab"
	>
		+
	</button>
</div>

{#if confirmIndex !== null}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
		onclick={(e) => { if (e.target === e.currentTarget) cancelDelete(); }}
	>
		<div class="w-full max-w-sm mx-4 rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/60 overflow-hidden">
			<div class="px-5 pt-5 pb-4">
				<h3 class="text-sm font-mono text-zinc-200 mb-2">Delete tab</h3>
				<p class="text-sm font-mono text-zinc-400">
					Delete "<span class="text-zinc-200">{tabs[confirmIndex].name}</span>"? This cannot be undone.
				</p>
			</div>
			<div class="flex justify-end gap-2 px-5 py-3 border-t border-zinc-800">
				<button
					onclick={cancelDelete}
					class="px-3 py-1.5 rounded text-sm font-mono text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-600 transition-colors"
				>
					Cancel
				</button>
				<!-- svelte-ignore a11y_autofocus -->
				<button
					onclick={confirmDelete}
					autofocus
					class="px-3 py-1.5 rounded text-sm font-mono bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
				>
					Delete
				</button>
			</div>
		</div>
	</div>
{/if}
