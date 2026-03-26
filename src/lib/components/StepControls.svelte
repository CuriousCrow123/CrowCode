<script lang="ts">
	let {
		current,
		total,
		subStepMode,
		description,
		evaluation,
		onprev,
		onnext,
		ontogglesubstep,
	}: {
		current: number;
		total: number;
		subStepMode: boolean;
		description?: string;
		evaluation?: string;
		onprev: () => void;
		onnext: () => void;
		ontogglesubstep: () => void;
	} = $props();
</script>

<div class="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-2">
	<div class="flex items-center gap-3 flex-wrap">
		<!-- Step buttons -->
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

		<!-- Step counter -->
		<span class="text-sm font-mono text-zinc-400" role="status" aria-live="polite" aria-atomic="true">
			Step {current + 1} / {total}
		</span>

		<!-- Sub-step toggle -->
		<button
			onclick={ontogglesubstep}
			aria-pressed={subStepMode}
			class="px-3 py-1 rounded text-xs font-mono transition-colors {subStepMode ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'}"
		>
			Sub-steps
		</button>

		<!-- Description -->
		{#if description || evaluation}
			<div class="flex items-center gap-2 ml-auto text-sm font-mono">
				{#if description}
					<span class="text-zinc-400">{description}</span>
				{/if}
				{#if evaluation}
					<span class="text-emerald-500">{evaluation}</span>
				{/if}
			</div>
		{/if}
	</div>
</div>
