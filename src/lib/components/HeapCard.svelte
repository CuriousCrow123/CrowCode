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

	let collapsed = $state(false);

	// Track which blocks have their values expanded
	let expandedValues: Record<string, boolean> = $state({});

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
	<button
		onclick={() => (collapsed = !collapsed)}
		class="w-full flex items-center justify-between px-4 py-2.5 bg-zinc-900/80 border-b border-zinc-800 cursor-pointer hover:bg-zinc-800/80 transition-colors text-left"
	>
		<span class="font-mono font-semibold text-purple-400 flex items-center gap-2">
			<span class="text-zinc-600 text-xs">{collapsed ? '▶' : '▼'}</span>
			{entry.name || 'Heap'}
		</span>
	</button>

	{#if !collapsed && blocks.length > 0}
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
							{:else if isLong}
								<button
									onclick={() => (expandedValues[block.id] = !expandedValues[block.id])}
									class="text-left cursor-pointer hover:text-emerald-300 transition-colors"
								>
									{expandedValues[block.id] ? summary : summary.slice(0, MAX_VALUE_LENGTH) + '...'}
									<span class="text-xs text-zinc-500 ml-1">{expandedValues[block.id] ? '(less)' : '(more)'}</span>
								</button>
							{:else}
								{summary}
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
	{:else if !collapsed}
		<div class="px-4 py-3 text-zinc-500 text-sm">No heap allocations</div>
	{/if}
</div>
