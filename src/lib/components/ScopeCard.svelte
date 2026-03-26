<script lang="ts">
	import type { MemoryEntry } from '$lib/types';
	import MemoryRow from './MemoryRow.svelte';

	let {
		entry,
		onexpand,
	}: {
		entry: MemoryEntry;
		onexpand: (entry: MemoryEntry) => void;
	} = $props();

	const variables = $derived(
		entry.children?.filter((c) => c.kind !== 'scope') ?? []
	);
</script>

<div class="rounded-lg border border-zinc-800 overflow-hidden">
	<div class="flex items-center justify-between px-4 py-2.5 bg-zinc-900/80 border-b border-zinc-800">
		<span class="font-mono font-semibold text-blue-400">{entry.name}</span>
		<div class="flex gap-4 text-xs text-zinc-500 font-mono">
			{#if entry.scope?.caller}
				<span>called by <span class="text-zinc-400">{entry.scope.caller}</span></span>
			{/if}
			{#if entry.scope?.returnAddr}
				<span>returns to <span class="text-zinc-400">{entry.scope.returnAddr}</span></span>
			{/if}
			{#if entry.scope?.file}
				<span class="text-zinc-600">{entry.scope.file}{entry.scope.line ? `:${entry.scope.line}` : ''}</span>
			{/if}
			{#if entry.address}
				<span class="text-zinc-600">{entry.address}</span>
			{/if}
		</div>
	</div>

	{#if variables.length > 0}
		<table class="w-full text-sm table-fixed">
			<colgroup>
				<col class="w-[20%]" />
				<col class="w-[20%]" />
				<col class="w-[40%]" />
				<col class="w-[20%]" />
			</colgroup>
			<thead>
				<tr class="border-b border-zinc-800/50 bg-zinc-900/30 text-zinc-500 text-xs uppercase tracking-wider">
					<th class="px-4 py-2 text-left font-medium">Name</th>
					<th class="px-4 py-2 text-left font-medium">Type</th>
					<th class="px-4 py-2 text-left font-medium">Value</th>
					<th class="px-4 py-2 text-left font-medium">Address</th>
				</tr>
			</thead>
			<tbody>
				{#each variables as variable (variable.id)}
					<MemoryRow entry={variable} {onexpand} />
				{/each}
			</tbody>
		</table>
	{/if}
</div>
