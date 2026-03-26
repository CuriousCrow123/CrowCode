<script lang="ts">
	import ProgramStepper from '$lib/components/ProgramStepper.svelte';
	import { basics, loops } from '$lib/programs';
	import type { Program } from '$lib/types';

	const programs: Program[] = [basics, loops];
	let selected = $state(0);
</script>

<div class="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center p-8">
	<h1 class="text-3xl font-bold mb-2">CrowTools</h1>
	<p class="text-zinc-500 mb-4">Memory Visualizer</p>

	<div class="flex gap-2 mb-6">
		{#each programs as prog, i}
			<button
				onclick={() => (selected = i)}
				class="px-4 py-1.5 rounded text-sm font-mono transition-colors {selected === i ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}"
			>
				{prog.name}
			</button>
		{/each}
	</div>

	{#key selected}
		<ProgramStepper program={programs[selected]} />
	{/key}
</div>
