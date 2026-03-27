<script lang="ts">
	import type { MemoryEntry } from '$lib/types';
	import { summarize } from '$lib/summary';
	import { MAX_VALUE_LENGTH } from './constants';

	let {
		entry,
		onexpand,
	}: {
		entry: MemoryEntry;
		onexpand: (entry: MemoryEntry) => void;
	} = $props();

	const hasChildren = $derived(entry.children && entry.children.length > 0);
	const summaryValue = $derived(summarize(entry));
	const isLong = $derived(summaryValue.length > MAX_VALUE_LENGTH);

	let valueExpanded = $state(false);
</script>

<tr class="border-b border-zinc-800/50 transition-colors hover:bg-zinc-800/30">
	<td class="px-4 py-2.5 font-mono text-amber-400">
		{#if hasChildren}
			<button
				onclick={() => onexpand(entry)}
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
				onclick={() => onexpand(entry)}
				class="text-emerald-600 hover:text-emerald-400 transition-colors cursor-pointer"
			>
				{isLong ? summaryValue.slice(0, MAX_VALUE_LENGTH) + '...' : summaryValue}
			</button>
		{:else if isLong}
			<button
				onclick={() => (valueExpanded = !valueExpanded)}
				class="text-left cursor-pointer hover:text-emerald-300 transition-colors"
			>
				{valueExpanded ? summaryValue : summaryValue.slice(0, MAX_VALUE_LENGTH) + '...'}
				<span class="text-xs text-zinc-500 ml-1">{valueExpanded ? '(less)' : '(more)'}</span>
			</button>
		{:else}
			{summaryValue}
		{/if}
	</td>
	<td class="px-4 py-2.5 font-mono text-zinc-500">{entry.address}</td>
</tr>
