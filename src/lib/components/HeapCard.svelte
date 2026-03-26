<script lang="ts">
	import type { MemoryEntry } from '$lib/types';
	import { summarize } from '$lib/summary';

	const MAX_VALUE_LENGTH = 40;

	let {
		entry,
		onexpand,
	}: {
		entry: MemoryEntry;
		onexpand: (entry: MemoryEntry) => void;
	} = $props();

	const blocks = $derived(entry.children ?? []);

	function statusColor(status: string): string {
		switch (status) {
			case 'allocated': return 'text-emerald-400';
			case 'freed': return 'text-orange-400';
			case 'leaked': return 'text-red-400';
			default: return 'text-zinc-400';
		}
	}

	function statusBg(status: string): string {
		switch (status) {
			case 'freed': return 'bg-orange-400/10';
			case 'leaked': return 'bg-red-400/10';
			default: return '';
		}
	}
</script>

<div class="rounded-lg border border-zinc-800 overflow-hidden">
	<div class="flex items-center justify-between px-4 py-2.5 bg-zinc-900/80 border-b border-zinc-800">
		<span class="font-mono font-semibold text-purple-400">{entry.name || 'Heap'}</span>
	</div>

	{#if blocks.length > 0}
		<table class="w-full text-sm table-fixed">
			<colgroup>
				<col class="w-[18%]" />
				<col class="w-[16%]" />
				<col class="w-[10%]" />
				<col class="w-[12%]" />
				<col class="w-[26%]" />
				<col class="w-[18%]" />
			</colgroup>
			<thead>
				<tr class="border-b border-zinc-800/50 bg-zinc-900/30 text-zinc-500 text-xs uppercase tracking-wider">
					<th class="px-4 py-2 text-left font-medium">Address</th>
					<th class="px-4 py-2 text-left font-medium">Type</th>
					<th class="px-4 py-2 text-left font-medium">Size</th>
					<th class="px-4 py-2 text-left font-medium">Status</th>
					<th class="px-4 py-2 text-left font-medium">Value</th>
					<th class="px-4 py-2 text-left font-medium">Alloc Site</th>
				</tr>
			</thead>
			<tbody>
				{#each blocks as block (block.id)}
					{@const hasChildren = block.children && block.children.length > 0}
					{@const summary = summarize(block)}
					{@const isLong = summary.length > MAX_VALUE_LENGTH}
					{@const status = block.heap?.status ?? 'allocated'}
					<tr class="border-b border-zinc-800/50 transition-colors hover:bg-zinc-800/30 {statusBg(status)}">
						<td class="px-4 py-2.5 font-mono text-zinc-300">
							{#if hasChildren}
								<button
									onclick={() => onexpand(block)}
									class="hover:text-white transition-colors cursor-pointer"
								>
									{block.address} <span class="text-zinc-600 text-xs">&#8250;</span>
								</button>
							{:else}
								{block.address}
							{/if}
						</td>
						<td class="px-4 py-2.5 font-mono text-zinc-400">{block.type}</td>
						<td class="px-4 py-2.5 font-mono text-zinc-500">
							{#if block.heap?.size}
								{block.heap.size}B
							{/if}
						</td>
						<td class="px-4 py-2.5 font-mono text-xs {statusColor(status)}">{status}</td>
						<td class="px-4 py-2.5 font-mono text-emerald-400 overflow-hidden break-all">
							{#if hasChildren}
								<button
									onclick={() => onexpand(block)}
									class="text-emerald-600 hover:text-emerald-400 transition-colors cursor-pointer"
								>
									{isLong ? summary.slice(0, MAX_VALUE_LENGTH) + '...' : summary}
								</button>
							{:else}
								{isLong ? summary.slice(0, MAX_VALUE_LENGTH) + '...' : summary}
							{/if}
						</td>
						<td class="px-4 py-2.5 font-mono text-zinc-600 text-xs">
							{#if block.heap?.allocSite}
								{block.heap.allocSite.file}:{block.heap.allocSite.line}
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{:else}
		<div class="px-4 py-3 text-zinc-500 text-sm">No heap allocations</div>
	{/if}
</div>
