<script lang="ts">
	import type { Program } from '$lib/types';
	import type { Parser as ParserType } from 'web-tree-sitter';

	let { onProgram }: { onProgram: (program: Program) => void } = $props();

	let source = $state(`#include <stdio.h>
#include <stdlib.h>

struct Point {
    int x;
    int y;
};

int main() {
    int count = 3;
    struct Point origin = {0, 0};

    int *scores = calloc(count, sizeof(int));
    scores[0] = 100;
    scores[1] = 200;
    scores[2] = 300;

    for (int i = 0; i < count; i++) {
        scores[i] = scores[i] * 2;
    }

    free(scores);
    return 0;
}`);

	let loading = $state(false);
	let errors = $state<string[]>([]);
	let parser: ParserType | null = null;

	async function getParser(): Promise<ParserType> {
		if (parser) return parser;

		const TreeSitter = await import('web-tree-sitter');
		await TreeSitter.Parser.init({
			locateFile: () => `${import.meta.env.BASE_URL}tree-sitter.wasm`,
		});
		parser = new TreeSitter.Parser();
		const lang = await TreeSitter.Language.load(`${import.meta.env.BASE_URL}tree-sitter-c.wasm`);
		parser.setLanguage(lang);
		return parser;
	}

	async function run() {
		loading = true;
		errors = [];

		try {
			const p = await getParser();
			const { interpretSync } = await import('$lib/interpreter/index');

			// Yield to let browser paint "Running..." before blocking
			await new Promise((resolve) => requestAnimationFrame(resolve));

			const result = interpretSync(p, source, { maxSteps: 500 });

			if (result.errors.length > 0) {
				errors = result.errors;
			}
			if (result.program.steps.length > 0) {
				onProgram(result.program);
			} else if (errors.length === 0) {
				errors = ['No steps generated — check your code.'];
			}
		} catch (err) {
			errors = [err instanceof Error ? err.message : String(err)];
		} finally {
			loading = false;
		}
	}
</script>

<div class="flex flex-col gap-3 w-full max-w-2xl">
	<div class="flex items-center justify-between">
		<p class="text-xs text-zinc-500">
			Supports a subset of C for educational visualization
		</p>
		<button
			onclick={run}
			disabled={loading}
			class="px-4 py-1.5 rounded text-sm font-mono bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
		>
			{loading ? 'Running...' : 'Run'}
		</button>
	</div>

	<textarea
		bind:value={source}
		spellcheck="false"
		class="w-full h-80 bg-zinc-900 text-zinc-100 font-mono text-sm p-4 rounded border border-zinc-700 focus:border-blue-500/50 focus:outline-none resize-y"
		placeholder="Type your C code here..."
	></textarea>

	{#if errors.length > 0}
		<div class="bg-red-500/10 border border-red-500/30 rounded p-3">
			{#each errors as error}
				<p class="text-red-400 text-sm font-mono">{error}</p>
			{/each}
		</div>
	{/if}
</div>
