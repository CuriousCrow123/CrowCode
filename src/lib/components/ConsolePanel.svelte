<script lang="ts">
	export type ConsoleSegment = { type: 'stdout' | 'stdin'; text: string };

	let {
		segments = [],
		newOutputFrom = -1,
		waitingForInput = false,
		onSubmitInput,
		onEof,
	}: {
		/** Interleaved output segments (stdout + echoed stdin). */
		segments?: ConsoleSegment[];
		/** Index in segments where new (highlighted) output starts. -1 = no highlighting. */
		newOutputFrom?: number;
		waitingForInput?: boolean;
		onSubmitInput?: (text: string) => void;
		onEof?: () => void;
	} = $props();

	let inputValue = $state('');
	let scrollTarget: HTMLDivElement;
	let inputEl: HTMLInputElement;

	$effect(() => {
		segments;
		waitingForInput;
		scrollTarget?.scrollIntoView({ behavior: 'smooth', block: 'end' });
	});

	$effect(() => {
		if (waitingForInput) {
			requestAnimationFrame(() => inputEl?.focus());
		}
	});

	const hasContent = $derived(segments.length > 0 || waitingForInput);
	const isInteractive = $derived(waitingForInput || segments.some((s) => s.type === 'stdin'));

	function handleSubmit(e: Event) {
		e.preventDefault();
		if (!onSubmitInput) return;
		const text = inputValue;
		inputValue = '';
		onSubmitInput(text + '\n');
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'd' && e.ctrlKey && inputValue === '') {
			e.preventDefault();
			onEof?.();
			return;
		}
		if (e.key === 'Tab') {
			e.preventDefault();
		}
	}
</script>

<div class="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
	<div class="px-3 py-1.5 bg-zinc-900/80 border-b border-zinc-800 flex items-center justify-between">
		<span class="text-xs font-mono text-zinc-500 uppercase tracking-wider">
			{isInteractive ? 'Program Console' : 'Console Output'}
		</span>
		{#if waitingForInput}
			<div class="flex items-center gap-2">
				<span class="text-xs text-amber-400/80 flex items-center gap-1.5">
					<span class="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
					Waiting for input...
				</span>
				{#if onEof}
					<button
						onclick={() => onEof?.()}
						class="text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 px-2 py-0.5 rounded font-mono transition-colors"
						title="Send EOF (Ctrl+D) — signals end of input"
					>
						Ctrl+D
					</button>
				{/if}
			</div>
		{/if}
	</div>
	<div class="h-32 overflow-y-auto p-3 font-mono text-sm" role="log" aria-live="polite">
		{#if !hasContent}
			<span class="text-zinc-600 italic">No output yet</span>
		{:else}
			<pre class="whitespace-pre-wrap break-all m-0">{#each segments as seg, i}{#if seg.type === 'stdin'}<span class="text-blue-400">{seg.text}</span>{:else if newOutputFrom >= 0 && i >= newOutputFrom}<span class="text-emerald-400 bg-emerald-400/10">{seg.text}</span>{:else}<span class="text-zinc-300">{seg.text}</span>{/if}{/each}</pre>
			{#if waitingForInput}
				<form onsubmit={handleSubmit} class="mt-0">
					<input
						bind:this={inputEl}
						bind:value={inputValue}
						onkeydown={handleKeydown}
						class="bg-transparent border-none outline-none text-emerald-400 font-mono text-sm caret-emerald-400 w-full p-0"
						aria-label="Program input — type a value and press Enter"
						autocomplete="off"
						spellcheck="false"
					/>
				</form>
			{/if}
		{/if}
		<div bind:this={scrollTarget}></div>
	</div>
</div>
