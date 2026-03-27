import type { Program } from '$lib/types';
import type { Parser as ParserType } from 'web-tree-sitter';

export type RunResult = {
	program: Program;
	errors: string[];
	warnings: string[];
};

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
