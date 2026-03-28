<script lang="ts">
	export type TranscriptEntry = { type: 'stdout'; text: string } | { type: 'stdin'; text: string };

	let {
		transcript,
		waitingForInput = false,
		onSubmitInput,
		onEof,
	}: {
		transcript: TranscriptEntry[];
		waitingForInput?: boolean;
		onSubmitInput?: (text: string) => void;
		onEof?: () => void;
	} = $props();

	let inputValue = $state('');
	let scrollTarget: HTMLDivElement;
	let inputEl: HTMLInputElement;

	$effect(() => {
		transcript;
		scrollTarget?.scrollIntoView({ behavior: 'instant', block: 'end' });
	});

	$effect(() => {
		if (waitingForInput) {
			// Auto-focus the input when waiting for input
			requestAnimationFrame(() => inputEl?.focus());
		}
	});

	function handleSubmit(e: Event) {
		e.preventDefault();
		if (!onSubmitInput) return;
		const text = inputValue;
		inputValue = '';
		onSubmitInput(text + '\n');
	}

	function handleKeydown(e: KeyboardEvent) {
		// Ctrl+D on empty input = EOF
		if (e.key === 'd' && e.ctrlKey && inputValue === '') {
			e.preventDefault();
			onEof?.();
			return;
		}
		// Trap Tab to prevent focus escape
		if (e.key === 'Tab') {
			e.preventDefault();
		}
	}
</script>

<div class="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
	<div class="px-3 py-1.5 bg-zinc-900/80 border-b border-zinc-800 flex items-center justify-between">
		<span class="text-xs font-mono text-zinc-500 uppercase tracking-wider">Program Console</span>
		{#if waitingForInput}
			<span class="text-xs text-amber-400/80 flex items-center gap-1.5">
				<span class="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
				Waiting for input...
			</span>
		{/if}
	</div>
	<div class="h-40 overflow-y-auto p-3 font-mono text-sm" role="log" aria-live="polite">
		{#if transcript.length === 0 && !waitingForInput}
			<span class="text-zinc-600 italic">No output yet</span>
		{:else}
			<pre class="whitespace-pre-wrap break-all m-0">{#each transcript as entry}{#if entry.type === 'stdout'}<span class="text-zinc-300">{entry.text}</span>{:else}<span class="text-blue-400">{entry.text}</span>{/if}{/each}</pre>
			{#if waitingForInput}
				<form onsubmit={handleSubmit} class="inline">
					<input
						bind:this={inputEl}
						bind:value={inputValue}
						onkeydown={handleKeydown}
						class="bg-transparent border-none outline-none text-emerald-400 font-mono text-sm caret-emerald-400 w-full"
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
