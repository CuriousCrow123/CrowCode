/**
 * WASM backend service: public API that orchestrates the full pipeline.
 *
 * C source → transformer → xcc compiler → WASM runtime → Program
 */

import type { Program } from '$lib/types';
import type { RunResult, InteractiveSession } from '$lib/interpreter/service';
import type { Parser as ParserType } from 'web-tree-sitter';

const MAX_STEPS = 500;

let cachedParser: ParserType | null = null;

async function getParser(): Promise<ParserType> {
	if (cachedParser) return cachedParser;

	const TreeSitter = await import('web-tree-sitter');
	const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
	const wasmUrl = `${base}tree-sitter.wasm`;
	const langUrl = `${base}tree-sitter-c.wasm`;

	await TreeSitter.Parser.init({
		locateFile: (_file: string, _scriptDir: string) => wasmUrl,
	});
	cachedParser = new TreeSitter.Parser();
	const lang = await TreeSitter.Language.load(langUrl);
	cachedParser.setLanguage(lang);
	return cachedParser;
}

const emptyProgram: Program = { name: '', source: '', steps: [] };

/**
 * Run a C program through the WASM compilation backend.
 * Returns the same RunResult as the interpreter service.
 */
export async function runWasmProgram(source: string, stdin?: string): Promise<RunResult> {
	const parser = await getParser();
	const { transformSource } = await import('./transformer');
	const { instrumented, errors: transformErrors } = transformSource(parser, source);

	if (transformErrors.length > 0) {
		return { program: emptyProgram, errors: transformErrors, warnings: [] };
	}

	const { compile } = await import('./compiler');
	const { wasm, errors: compileErrors } = await compile(instrumented);

	if (compileErrors.length > 0 || !wasm) {
		return { program: emptyProgram, errors: compileErrors, warnings: [] };
	}

	const { executeWasm } = await import('./runtime');

	// Yield to let browser paint before blocking
	await new Promise((resolve) => requestAnimationFrame(resolve));

	const { program, errors: runtimeErrors } = await executeWasm(
		wasm, 'user_program', source, MAX_STEPS, stdin,
	);

	const warnings: string[] = [];
	if (program.steps.length >= MAX_STEPS) {
		warnings.push(`Program truncated at ${MAX_STEPS} steps. Simplify your code to see the full execution.`);
	}

	return { program, errors: runtimeErrors, warnings };
}

/**
 * Interactive WASM execution — pauses when stdin is needed.
 * Uses progressive re-execution: on input, re-runs with accumulated stdin.
 */
export async function runWasmProgramInteractive(source: string): Promise<InteractiveSession> {
	const parser = await getParser();
	const { transformSource } = await import('./transformer');
	const { instrumented, errors: transformErrors } = transformSource(parser, source);

	if (transformErrors.length > 0) {
		return {
			state: 'complete',
			result: { program: emptyProgram, errors: transformErrors, warnings: [] },
		};
	}

	const { compile } = await import('./compiler');
	const { wasm, errors: compileErrors } = await compile(instrumented);

	if (compileErrors.length > 0 || !wasm) {
		return {
			state: 'complete',
			result: { program: emptyProgram, errors: compileErrors, warnings: [] },
		};
	}

	let accumulatedStdin = '';
	let cancelled = false;

	async function runWithStdin(stdin: string): Promise<InteractiveSession> {
		const { executeWasm } = await import('./runtime');
		const { program, errors, stdinExhausted } = await executeWasm(
			wasm!, 'user_program', source, MAX_STEPS, stdin,
		);

		const warnings: string[] = [];
		if (program.steps.length >= MAX_STEPS) {
			warnings.push(`Program truncated at ${MAX_STEPS} steps.`);
		}

		if (stdinExhausted && !cancelled) {
			let resumed = false;
			return {
				state: 'paused',
				program,
				errors,
				warnings,
				async resume(input: string): Promise<InteractiveSession> {
					if (resumed || cancelled) throw new Error('Session already resumed or cancelled');
					resumed = true;
					accumulatedStdin += input + '\n';
					return runWithStdin(accumulatedStdin);
				},
				async sendEof(): Promise<InteractiveSession> {
					if (resumed || cancelled) throw new Error('Session already resumed or cancelled');
					resumed = true;
					// Re-run with EOF flag — no more input
					const result = await executeWasm(
						wasm!, 'user_program', source, MAX_STEPS, accumulatedStdin,
					);
					const w: string[] = [];
					if (result.program.steps.length >= MAX_STEPS) {
						w.push(`Program truncated at ${MAX_STEPS} steps.`);
					}
					return {
						state: 'complete',
						result: { program: result.program, errors: result.errors, warnings: w },
					};
				},
				cancel() {
					cancelled = true;
				},
			};
		}

		return {
			state: 'complete',
			result: { program, errors, warnings },
		};
	}

	return runWithStdin(accumulatedStdin);
}
