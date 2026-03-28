<script lang="ts">
	import fuzzysort from 'fuzzysort';
	import { features, type Feature } from '$lib/data/features';

	let { onclose }: { onclose: () => void } = $props();

	let query = $state('');
	let hoveredIndex = $state<number | null>(null);
	let tooltipAbove = $state(false);

	// Prepare fuzzysort targets once
	const prepared = features.map((f) => ({
		feature: f,
		preparedName: fuzzysort.prepare(f.name),
		preparedCategory: fuzzysort.prepare(f.category),
	}));

	const filtered = $derived.by((): Feature[] => {
		if (!query.trim()) return features;
		const results = fuzzysort.go(query, prepared, {
			keys: ['preparedName', 'preparedCategory'],
			threshold: -1000,
		});
		return results.map((r) => r.obj.feature);
	});

	const statusOrder: Record<string, number> = { 'implemented': 0, 'partial': 1, 'not-implemented': 2 };

	const grouped = $derived.by(() => {
		const groups: { label: string; status: string; items: Feature[] }[] = [
			{ label: 'Implemented', status: 'implemented', items: [] },
			{ label: 'Partial', status: 'partial', items: [] },
			{ label: 'Not Implemented', status: 'not-implemented', items: [] },
		];
		for (const f of filtered) {
			groups[statusOrder[f.status]].items.push(f);
		}
		return groups.filter((g) => g.items.length > 0);
	});

	const totalFiltered = $derived(filtered.length);

	function statusColor(status: string): string {
		switch (status) {
			case 'implemented': return 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30';
			case 'partial': return 'text-amber-400 bg-amber-500/15 border-amber-500/30';
			case 'not-implemented': return 'text-red-400 bg-red-500/15 border-red-500/30';
			default: return 'text-zinc-400';
		}
	}

	function statusLabel(status: string): string {
		switch (status) {
			case 'implemented': return 'Yes';
			case 'partial': return 'Partial';
			case 'not-implemented': return 'No';
			default: return status;
		}
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) onclose();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}

	function handleItemHover(index: number, event: MouseEvent) {
		hoveredIndex = index;
		// Check if tooltip should render above (item near bottom of viewport)
		const target = event.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		tooltipAbove = rect.bottom + 120 > window.innerHeight;
	}

	function handleItemLeave() {
		hoveredIndex = null;
	}

	// Build a map from feature name+category to flat index for tooltip tracking
	const featureIndex = $derived.by(() => {
		const map = new Map<string, number>();
		let idx = 0;
		for (const group of grouped) {
			for (const f of group.items) {
				map.set(`${f.name}::${f.category}`, idx++);
			}
		}
		return map;
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
	onclick={handleBackdropClick}
>
	<div class="w-full max-w-lg mx-4 rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/60 overflow-hidden">
		<!-- Header -->
		<div class="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900/90">
			<span class="text-sm font-mono text-zinc-200">Feature Support</span>
			<div class="flex items-center gap-3">
				<span class="text-xs font-mono text-zinc-500">{totalFiltered} features</span>
				<button
					onclick={onclose}
					aria-label="Close feature search"
					class="text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
				>
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M4 4 L12 12 M12 4 L4 12" />
					</svg>
				</button>
			</div>
		</div>

		<!-- Search input -->
		<div class="px-4 py-3 border-b border-zinc-800">
			<!-- svelte-ignore a11y_autofocus -->
			<input
				type="text"
				bind:value={query}
				placeholder="Search features... (e.g. malloc, enum, scanf)"
				autofocus
				class="w-full bg-zinc-800 text-zinc-200 text-sm font-mono px-3 py-2 rounded border border-zinc-700 focus:border-blue-500/50 focus:outline-none placeholder:text-zinc-600"
			/>
		</div>

		<!-- Results -->
		<div class="max-h-[60vh] overflow-y-auto">
			{#if grouped.length === 0}
				<div class="px-4 py-8 text-center text-zinc-500 text-sm font-mono">
					No features match "{query}"
				</div>
			{:else}
				{#each grouped as group}
					<div class="px-4 pt-3 pb-1">
						<span class="text-xs font-mono text-zinc-500 uppercase tracking-wider">{group.label}</span>
					</div>
					{#each group.items as feature}
						{@const idx = featureIndex.get(`${feature.name}::${feature.category}`) ?? -1}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="relative px-4 py-2 flex items-center gap-3 hover:bg-zinc-800/50 transition-colors cursor-default"
							onmouseenter={(e) => handleItemHover(idx, e)}
							onmouseleave={handleItemLeave}
							onfocus={() => {}}
						>
							<span class="text-sm font-mono text-zinc-200 flex-1 truncate">{feature.name}</span>
							<span class="text-xs font-mono text-zinc-600 shrink-0">{feature.category}</span>
							<span class="text-xs font-mono px-1.5 py-0.5 rounded border shrink-0 {statusColor(feature.status)}">
								{statusLabel(feature.status)}
							</span>

							<!-- Tooltip -->
							{#if hoveredIndex === idx}
								<div
									class="absolute left-4 right-4 z-10 px-3 py-2 rounded border border-zinc-700 bg-zinc-800 shadow-lg shadow-black/40 {tooltipAbove ? 'bottom-full mb-1' : 'top-full mt-1'}"
								>
									<p class="text-xs font-mono text-zinc-300 leading-relaxed">{feature.description}</p>
								</div>
							{/if}
						</div>
					{/each}
				{/each}
			{/if}
		</div>

		<!-- Footer hint -->
		<div class="px-4 py-2 border-t border-zinc-800 text-xs font-mono text-zinc-600 text-center">
			Press <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-400">?</kbd> or <kbd class="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-400">Esc</kbd> to close
		</div>
	</div>
</div>
