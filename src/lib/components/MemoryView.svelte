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
</div>

{#if modalEntry}
	<DrilldownModal initial={modalEntry} onclose={closeModal} />
{/if}
