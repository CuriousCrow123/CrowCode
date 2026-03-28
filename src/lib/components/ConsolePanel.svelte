<script lang="ts">
	let {
		stdout,
		newOutput,
		stdinHistory = [],
		waitingForInput = false,
		onSubmitInput,
		onEof,
	}: {
		stdout: string;
		newOutput: string;
		/** Echoed stdin entries interleaved after each pause point's output. */
		stdinHistory?: string[];
		waitingForInput?: boolean;
		onSubmitInput?: (text: string) => void;
		onEof?: () => void;
	} = $props();

	let inputValue = $state('');
	let scrollTarget: HTMLDivElement;
	let inputEl: HTMLInputElement;

	$effect(() => {
		stdout;
		stdinHistory;
		waitingForInput;
		scrollTarget?.scrollIntoView({ behavior: 'smooth', block: 'end' });
	});

	$effect(() => {
		if (waitingForInput) {
			requestAnimationFrame(() => inputEl?.focus());
		}
	});

	const previousOutput = $derived(
		newOutput.length > 0 && stdout.endsWith(newOutput)
			? stdout.slice(0, stdout.length - newOutput.length)
			: stdout
	);

	const hasNewOutput = $derived(newOutput.length > 0);
	const hasContent = $derived(stdout.length > 0 || stdinHistory.length > 0 || waitingForInput);

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
			{waitingForInput || stdinHistory.length > 0 ? 'Program Console' : 'Console Output'}
		</span>
		{#if waitingForInput}
			<span class="text-xs text-amber-400/80 flex items-center gap-1.5">
				<span class="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
				Waiting for input...
			</span>
		{/if}
	</div>
	<div class="h-32 overflow-y-auto p-3 font-mono text-sm" role="log" aria-live="polite">
		{#if !hasContent}
			<span class="text-zinc-600 italic">No output yet</span>
		{:else}
			<pre class="whitespace-pre-wrap break-all m-0"><span class="text-zinc-300">{previousOutput}</span>{#if hasNewOutput}<span class="text-emerald-400 bg-emerald-400/10">{newOutput}</span>{/if}{#each stdinHistory as entry}<span class="text-blue-400">{entry}</span>{/each}</pre>
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
