<script lang="ts">
	let {
		current,
		total,
		subStepMode,
		onprev,
		onnext,
		ontogglesubstep,
	}: {
		current: number;
		total: number;
		subStepMode: boolean;
		onprev: () => void;
		onnext: () => void;
		ontogglesubstep: () => void;
	} = $props();
</script>

<div class="flex items-center gap-3">
	<div class="flex items-center gap-1">
		<button
			onclick={onprev}
			disabled={current <= 0}
			class="px-3 py-1 rounded text-sm font-mono bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
		>
			&#9664; Prev
		</button>
		<button
			onclick={onnext}
			disabled={current >= total - 1}
			class="px-3 py-1 rounded text-sm font-mono bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
		>
			Next &#9654;
		</button>
	</div>

	<span class="text-sm font-mono text-zinc-400" role="status" aria-live="polite" aria-atomic="true">
		Step {current + 1} / {total}
	</span>

	<button
		onclick={ontogglesubstep}
		aria-pressed={subStepMode}
		class="px-3 py-1 rounded text-xs font-mono transition-colors {subStepMode ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'}"
	>
		Sub-steps
	</button>
</div>
