<script lang="ts">
	let {
		value,
		onchange,
		disabled,
		consumed,
	}: {
		value: string;
		onchange: (value: string) => void;
		disabled?: boolean;
		consumed?: number;
	} = $props();
</script>

<div class="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
	<div class="px-3 py-1.5 bg-zinc-900/80 border-b border-zinc-800">
		<span class="text-xs font-mono text-zinc-500 uppercase tracking-wider">stdin Input</span>
	</div>
	<div class="p-3">
		{#if disabled}
			<div class="font-mono text-sm whitespace-pre-wrap break-all min-h-[3rem]">
				{#if value.length === 0}
					<span class="text-zinc-600 italic">No input provided</span>
				{:else}
					<span class="text-zinc-600 line-through">{value.slice(0, consumed ?? 0)}</span><span class="text-zinc-300">{value.slice(consumed ?? 0)}</span>
				{/if}
			</div>
		{:else}
			<textarea
				{value}
				oninput={(e) => onchange(e.currentTarget.value)}
				placeholder="Enter program input (e.g., 42&#10;hello)..."
				class="w-full bg-zinc-900 text-zinc-300 font-mono text-sm p-2 rounded border border-zinc-700 focus:border-blue-500/50 focus:outline-none resize-y"
				rows="3"
			></textarea>
		{/if}
	</div>
</div>
