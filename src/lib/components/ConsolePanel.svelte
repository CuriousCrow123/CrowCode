<script lang="ts">
	let {
		stdout,
		newOutput,
	}: {
		stdout: string;
		newOutput: string;
	} = $props();

	let scrollTarget: HTMLDivElement;

	$effect(() => {
		stdout;
		scrollTarget?.scrollIntoView({ behavior: 'smooth', block: 'end' });
	});

	const previousOutput = $derived(
		newOutput.length > 0 && stdout.endsWith(newOutput)
			? stdout.slice(0, stdout.length - newOutput.length)
			: stdout
	);

	const hasNewOutput = $derived(newOutput.length > 0);
</script>

<div class="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
	<div class="px-3 py-1.5 bg-zinc-900/80 border-b border-zinc-800">
		<span class="text-xs font-mono text-zinc-500 uppercase tracking-wider">Console Output</span>
	</div>
	<div class="h-32 overflow-y-auto p-3 font-mono text-sm">
		{#if stdout.length === 0}
			<span class="text-zinc-600 italic">No output yet</span>
		{:else}
			<pre class="whitespace-pre-wrap break-all m-0"><span class="text-zinc-300">{previousOutput}</span>{#if hasNewOutput}<span class="text-emerald-400 bg-emerald-400/10">{newOutput}</span>{/if}</pre>
		{/if}
		<div bind:this={scrollTarget}></div>
	</div>
</div>
