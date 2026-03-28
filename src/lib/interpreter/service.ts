import type { Program } from '$lib/types';
import type { Parser as ParserType } from 'web-tree-sitter';
import type { InteractiveGenerator, InterpretResult } from '$lib/interpreter/index';

export type RunResult = {
	program: Program;
	errors: string[];
	warnings: string[];
};

export type InteractiveSession =
	| { state: 'complete'; result: RunResult }
	| { state: 'paused'; program: Program; errors: string[]; warnings: string[]; resume: (input: string) => Promise<InteractiveSession>; cancel: () => void };

const MAX_STEPS = 500;

let parser: ParserType | null = null;

async function getParser(): Promise<ParserType> {
	if (parser) return parser;

	const TreeSitter = await import('web-tree-sitter');
	const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
	const wasmUrl = `${base}tree-sitter.wasm`;
	const langUrl = `${base}tree-sitter-c.wasm`;

	await TreeSitter.Parser.init({
		locateFile: (_file: string, _scriptDir: string) => wasmUrl,
	});
	parser = new TreeSitter.Parser();
	const lang = await TreeSitter.Language.load(langUrl);
	parser.setLanguage(lang);
	return parser;
}

/**
 * Lazy-loaded interpreter service.
 * Initializes tree-sitter on first call, caches parser for subsequent calls.
 */
export async function runProgram(source: string, stdin?: string): Promise<RunResult> {
	const p = await getParser();
	const { interpretSync } = await import('$lib/interpreter/index');

	// Yield to let browser paint before blocking
	await new Promise((resolve) => requestAnimationFrame(resolve));

	const result = interpretSync(p, source, { maxSteps: MAX_STEPS, stdin });

	const warnings: string[] = [];
	if (result.program.steps.length >= MAX_STEPS) {
		warnings.push(`Program truncated at ${MAX_STEPS} steps. Simplify your code to see the full execution.`);
	}

	return {
		program: result.program,
		errors: result.errors,
		warnings,
	};
}

/**
 * Interactive interpreter service — pauses when stdin is needed.
 * Returns an InteractiveSession that is either complete or paused with a resume function.
 */
export async function runProgramInteractive(source: string): Promise<InteractiveSession> {
	const p = await getParser();
	const { interpretInteractive } = await import('$lib/interpreter/index');

	await new Promise((resolve) => requestAnimationFrame(resolve));

	const { generator, parseErrors } = interpretInteractive(p, source, { maxSteps: MAX_STEPS });
	let cancelled = false;

	function advance(result: IteratorResult<{ type: 'need_input'; program: Program }, InterpretResult>): InteractiveSession {
		if (result.done) {
			const warnings: string[] = [];
			if (result.value.program.steps.length >= MAX_STEPS) {
				warnings.push(`Program truncated at ${MAX_STEPS} steps. Simplify your code to see the full execution.`);
			}
			return {
				state: 'complete',
				result: {
					program: result.value.program,
					errors: [...parseErrors, ...result.value.errors],
					warnings,
				},
			};
		}

		// Paused — needs input
		let resumed = false;
		return {
			state: 'paused',
			program: result.value.program,
			errors: parseErrors,
			warnings: [],
			async resume(input: string): Promise<InteractiveSession> {
				if (resumed || cancelled) throw new Error('Session already resumed or cancelled');
				resumed = true;
				// Yield to let Svelte flush DOM updates
				await Promise.resolve();
				const next = generator.next(input);
				return advance(next);
			},
			cancel() {
				cancelled = true;
				generator.return({ program: { name: '', source: '', steps: [] }, errors: [] });
			},
		};
	}

	// First advancement — run until first yield or completion
	const first = generator.next();
	return advance(first);
}
