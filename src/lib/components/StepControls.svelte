<script lang="ts">
	let {
		current,
		total,
		playing,
		speed,
		subStepMode,
		description,
		evaluation,
		onprev,
		onnext,
		ontoggleplay,
		onspeedchange,
		ontogglesubstep,
	}: {
		current: number;
		total: number;
		playing: boolean;
		speed: number;
		subStepMode: boolean;
		description?: string;
		evaluation?: string;
		onprev: () => void;
		onnext: () => void;
		ontoggleplay: () => void;
		onspeedchange: (speed: number) => void;
		ontogglesubstep: () => void;
	} = $props();

	const speeds = [2000, 1000, 500, 250];
	const speedLabels: Record<number, string> = { 2000: '0.5x', 1000: '1x', 500: '2x', 250: '4x' };
	const speedIndex = $derived(speeds.indexOf(speed));
</script>

<div class="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 space-y-2">
	<!-- Controls row -->
	<div class="flex items-center gap-3 flex-wrap">
		<!-- Step buttons -->
		<div class="flex items-center gap-1">
			<button
				onclick={onprev}
				disabled={current <= 0}
				class="px-3 py-1.5 rounded text-sm font-mono bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
			>
				&#9664; Prev
			</button>
			<button
				onclick={onnext}
				disabled={current >= total - 1}
				class="px-3 py-1.5 rounded text-sm font-mono bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
			>
				Next &#9654;
			</button>
			<button
				onclick={ontoggleplay}
				class="px-3 py-1.5 rounded text-sm font-mono bg-zinc-800 hover:bg-zinc-700 transition-colors"
			>
				{playing ? '⏸ Pause' : '▶ Play'}
			</button>
		</div>

		<!-- Step counter -->
		<span class="text-sm font-mono text-zinc-400">
			Step {current + 1} / {total}
		</span>

		<!-- Sub-step toggle -->
		<button
			onclick={ontogglesubstep}
			class="px-3 py-1.5 rounded text-xs font-mono transition-colors {subStepMode ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'}"
		>
			Sub-steps
		</button>

		<!-- Speed -->
		<div class="flex items-center gap-2 ml-auto">
			<span class="text-xs text-zinc-500 font-mono">Speed</span>
			<input
				type="range"
				min="0"
				max={speeds.length - 1}
				value={speedIndex}
				oninput={(e) => onspeedchange(speeds[parseInt(e.currentTarget.value)])}
				class="w-20 accent-blue-500"
			/>
			<span class="text-xs text-zinc-400 font-mono w-8">{speedLabels[speed]}</span>
		</div>
	</div>

	<!-- Description row -->
	{#if description || evaluation}
		<div class="flex items-center gap-3 text-sm font-mono">
			{#if description}
				<span class="text-zinc-400">{description}</span>
			{/if}
			{#if evaluation}
				<span class="text-emerald-500">{evaluation}</span>
			{/if}
		</div>
	{/if}
</div>
