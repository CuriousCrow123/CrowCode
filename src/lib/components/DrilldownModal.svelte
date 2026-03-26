<script lang="ts">
	import type { MemoryEntry } from '$lib/types';
	import { summarize } from '$lib/summary';

	const MAX_VALUE_LENGTH = 40;

	let {
		initial,
		onclose,
	}: {
		initial: MemoryEntry;
		onclose: () => void;
	} = $props();

	let path: MemoryEntry[] = $state([initial]);

	const current = $derived(path[path.length - 1]);
	const children = $derived(current.children ?? []);

	function drilldown(entry: MemoryEntry) {
		path = [...path, entry];
	}

	function navigateTo(index: number) {
		path = path.slice(0, index + 1);
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) onclose();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Backdrop -->
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
	onclick={handleBackdropClick}
>
	<!-- Modal -->
	<div class="w-full max-w-2xl mx-4 rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/60 overflow-hidden">
		<!-- Header: breadcrumb + close -->
		<div class="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900/90">
			<div class="flex items-center gap-1 font-mono text-sm overflow-x-auto">
				{#each path as segment, i}
					{#if i > 0}
						<span class="text-zinc-600 shrink-0">&#8250;</span>
					{/if}
					{#if i === path.length - 1}
						<span class="shrink-0 text-zinc-200">{segment.name}</span>
					{:else}
						<button
							onclick={() => navigateTo(i)}
							class="shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
						>
							{segment.name}
						</button>
					{/if}
				{/each}
			</div>
			<button
				onclick={onclose}
				class="ml-4 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
			>
				<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M4 4 L12 12 M12 4 L4 12" />
				</svg>
			</button>
		</div>

		<!-- Info bar -->
		{#if current.type || current.address}
			<div class="flex items-center gap-4 px-4 py-2 border-b border-zinc-800/50 font-mono text-xs text-zinc-500">
				{#if current.type}
					<span class="text-zinc-400">{current.type}</span>
				{/if}
				{#if current.address}
					<span>{current.address}</span>
				{/if}
			</div>
		{/if}

		<!-- Table -->
		<div class="max-h-[60vh] overflow-y-auto">
			<table class="w-full text-sm table-fixed">
				<colgroup>
					<col class="w-[20%]" />
					<col class="w-[20%]" />
					<col class="w-[40%]" />
					<col class="w-[20%]" />
				</colgroup>
				<thead class="sticky top-0">
					<tr class="border-b border-zinc-800 bg-zinc-900 text-zinc-500 text-xs uppercase tracking-wider">
						<th class="px-4 py-2 text-left font-medium">Name</th>
						<th class="px-4 py-2 text-left font-medium">Type</th>
						<th class="px-4 py-2 text-left font-medium">Value</th>
						<th class="px-4 py-2 text-left font-medium">Address</th>
					</tr>
				</thead>
				<tbody>
					{#each children as entry (entry.id)}
						{@const hasChildren = entry.children && entry.children.length > 0}
						{@const summary = summarize(entry)}
						{@const isLong = summary.length > MAX_VALUE_LENGTH}
						<tr class="border-b border-zinc-800/50 transition-colors hover:bg-zinc-800/30">
							<td class="px-4 py-2.5 font-mono text-amber-400">
								{#if hasChildren}
									<button
										onclick={() => drilldown(entry)}
										class="hover:text-amber-300 transition-colors cursor-pointer"
									>
										{entry.name} <span class="text-zinc-600 text-xs">&#8250;</span>
									</button>
								{:else}
									{entry.name}
								{/if}
							</td>
							<td class="px-4 py-2.5 font-mono text-zinc-400">{entry.type}</td>
							<td class="px-4 py-2.5 font-mono text-emerald-400 overflow-hidden break-all">
								{#if hasChildren}
									<button
										onclick={() => drilldown(entry)}
										class="text-emerald-600 hover:text-emerald-400 transition-colors cursor-pointer"
									>
										{isLong ? summary.slice(0, MAX_VALUE_LENGTH) + '...' : summary}
									</button>
								{:else}
									{summary}
								{/if}
							</td>
							<td class="px-4 py-2.5 font-mono text-zinc-500">{entry.address}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
</div>
