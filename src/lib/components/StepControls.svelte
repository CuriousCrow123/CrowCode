<script lang="ts">
	let {
		current,
		total,
		subStepMode,
		onprev,
		onnext,
		onseek,
		ontogglesubstep,
	}: {
		current: number;
		total: number;
		subStepMode: boolean;
		onprev: () => void;
		onnext: () => void;
		onseek: (position: number) => void;
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

	{#if total > 1}
		<input
			type="range"
			min={0}
			max={total - 1}
			value={current}
			oninput={(e) => onseek(parseInt(e.currentTarget.value))}
			class="scrubber"
			aria-label="Step scrubber"
		/>
	{/if}

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

<style>
	.scrubber {
		width: 120px;
		height: 6px;
		appearance: none;
		background: transparent;
		cursor: pointer;
	}

	.scrubber::-webkit-slider-runnable-track {
		height: 4px;
		border-radius: 2px;
		background: #3f3f46; /* zinc-700 */
	}

	.scrubber::-webkit-slider-thumb {
		appearance: none;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: #a1a1aa; /* zinc-400 */
		margin-top: -5px;
		transition: background 0.15s;
	}

	.scrubber::-webkit-slider-thumb:hover {
		background: #d4d4d8; /* zinc-300 */
	}

	.scrubber::-moz-range-track {
		height: 4px;
		border-radius: 2px;
		background: #3f3f46;
	}

	.scrubber::-moz-range-thumb {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: #a1a1aa;
		border: none;
	}

	.scrubber::-moz-range-thumb:hover {
		background: #d4d4d8;
	}
</style>
