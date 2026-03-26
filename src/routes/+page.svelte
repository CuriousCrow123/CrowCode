<script lang="ts">
	import ProgramStepper from '$lib/components/ProgramStepper.svelte';
	import CustomEditor from '$lib/components/CustomEditor.svelte';
	import { basics, loops } from '$lib/programs';
	import type { Program } from '$lib/types';

	const programs: Program[] = [basics, loops];
	let selected = $state(0);
	let customMode = $state(false);
	let customProgram = $state<Program | null>(null);

	function selectProgram(index: number) {
		selected = index;
		customMode = false;
		customProgram = null;
	}

	function selectCustom() {
		customMode = true;
	}

	function handleCustomProgram(program: Program) {
		customProgram = program;
	}
</script>

<div class="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center p-8">
	<h1 class="text-3xl font-bold mb-2">CrowTools</h1>
	<p class="text-zinc-500 mb-4">Memory Visualizer</p>

	<div class="flex gap-2 mb-6">
		{#each programs as prog, i}
			<button
				onclick={() => selectProgram(i)}
				class="px-4 py-1.5 rounded text-sm font-mono transition-colors {!customMode && selected === i ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}"
			>
				{prog.name}
			</button>
		{/each}
		<button
			onclick={selectCustom}
			class="px-4 py-1.5 rounded text-sm font-mono transition-colors {customMode ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}"
		>
			Custom
		</button>
	</div>

	{#if customMode}
		<CustomEditor onProgram={handleCustomProgram} />
		{#if customProgram}
			<div class="mt-6 w-full flex justify-center">
				{#key customProgram}
					<ProgramStepper program={customProgram} />
				{/key}
			</div>
		{/if}
	{:else}
		{#key selected}
			<ProgramStepper program={programs[selected]} />
		{/key}
	{/if}
</div>
