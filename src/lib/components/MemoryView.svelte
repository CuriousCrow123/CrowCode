<script lang="ts">
	import type { MemoryEntry } from '$lib/types';
	import ScopeCard from './ScopeCard.svelte';
	import HeapCard from './HeapCard.svelte';
	import DrilldownModal from './DrilldownModal.svelte';

	let { data }: { data: MemoryEntry[] } = $props();

	let modalEntry: MemoryEntry | null = $state(null);

	// Close modal when data changes (e.g. stepping)
	$effect(() => {
		// Touch data to track it
		data;
		modalEntry = null;
	});

	// Flatten nested scopes into a linear stack
	function flattenScopes(entries: MemoryEntry[]): MemoryEntry[] {
		const result: MemoryEntry[] = [];
		for (const entry of entries) {
			if (entry.kind === 'scope') {
				result.push(entry);
				const childScopes = entry.children?.filter((c) => c.kind === 'scope') ?? [];
				result.push(...flattenScopes(childScopes));
			}
		}
		return result;
	}

	const allScopes = $derived(flattenScopes(data));
	const heapEntries = $derived(data.filter((e) => e.kind === 'heap'));
	const ioEntries = $derived(data.filter((e) => e.kind === 'io'));

	function openModal(entry: MemoryEntry) {
		modalEntry = entry;
	}

	function closeModal() {
		modalEntry = null;
	}
</script>

<div class="w-full max-w-3xl space-y-3">
	{#each allScopes as scope (scope.id)}
		<ScopeCard entry={scope} onexpand={openModal} />
	{/each}

	{#each heapEntries as heap (heap.id)}
		<HeapCard entry={heap} onexpand={openModal} />
	{/each}

	{#each ioEntries as io (io.id)}
		<div class="rounded-lg border border-cyan-800/40 bg-zinc-900/80 overflow-hidden">
			<div class="px-3 py-1.5 bg-cyan-900/20 border-b border-cyan-800/30 flex items-center gap-2">
				<span class="text-xs font-mono text-cyan-500 uppercase tracking-wider">{io.name}</span>
				<span class="text-xs text-zinc-500">{io.type}</span>
			</div>
			<div class="px-3 py-2 font-mono text-sm">
				{#if io.value.includes('|')}
					{@const parts = io.value.split('|')}
					<span class="text-zinc-600">{parts[0]}</span><span class="text-cyan-400 animate-pulse">|</span><span class="text-zinc-300">{parts[1]}</span>
				{:else if io.value.includes('(exhausted)')}
					<span class="text-zinc-600">{io.value}</span>
				{:else}
					<span class="text-zinc-300">{io.value}</span>
				{/if}
			</div>
		</div>
	{/each}
</div>

{#if modalEntry}
	<DrilldownModal initial={modalEntry} onclose={closeModal} />
{/if}
