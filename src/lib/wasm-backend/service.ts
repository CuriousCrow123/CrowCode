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

export type ProgressCallback = (stage: string, pct: number) => void;

/**
 * Run a C program through the WASM compilation backend.
 * Returns the same RunResult as the interpreter service.
 */
export async function runWasmProgram(source: string, stdin?: string, onProgress?: ProgressCallback): Promise<RunResult> {
	const t0 = performance.now();

	onProgress?.('Initializing parser...', 0);
	const parser = await getParser();
	const tParser = performance.now();

	onProgress?.('Instrumenting source...', 15);
	const { transformSource } = await import('./transformer');
	const { instrumented, errors: transformErrors, structRegistry, descriptionMap } = transformSource(parser, source);
	const tTransform = performance.now();

	if (transformErrors.length > 0) {
		return { program: emptyProgram, errors: transformErrors, warnings: [] };
	}

	onProgress?.('Loading compiler...', 30);
	const { compile } = await import('./compiler');

	onProgress?.('Compiling to WASM...', 45);
	// Yield so the UI can paint the progress update
	await new Promise((resolve) => requestAnimationFrame(resolve));
	const { wasm, errors: compileErrors } = await compile(instrumented);
	const tCompile = performance.now();

	if (compileErrors.length > 0 || !wasm) {
		return { program: emptyProgram, errors: compileErrors, warnings: [] };
	}

	onProgress?.('Executing program...', 75);
	const { executeWasm } = await import('./runtime');

	// Yield to let browser paint before blocking
	await new Promise((resolve) => requestAnimationFrame(resolve));

	const { program, errors: runtimeErrors } = await executeWasm(
		wasm, 'user_program', source, MAX_STEPS, stdin, structRegistry, descriptionMap,
	);
	const tExec = performance.now();

	console.log(
		`[wasm-backend] parser: ${(tParser - t0).toFixed(0)}ms, ` +
		`transform: ${(tTransform - tParser).toFixed(0)}ms, ` +
		`compile: ${(tCompile - tTransform).toFixed(0)}ms, ` +
		`execute: ${(tExec - tCompile).toFixed(0)}ms, ` +
		`total: ${(tExec - t0).toFixed(0)}ms`
	);

	onProgress?.('Done', 100);

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
export async function runWasmProgramInteractive(source: string, onProgress?: ProgressCallback): Promise<InteractiveSession> {
	onProgress?.('Initializing parser...', 0);
	const parser = await getParser();

	onProgress?.('Instrumenting source...', 15);
	const { transformSource } = await import('./transformer');
	const { instrumented, errors: transformErrors, structRegistry, descriptionMap } = transformSource(parser, source);

	if (transformErrors.length > 0) {
		return {
			state: 'complete',
			result: { program: emptyProgram, errors: transformErrors, warnings: [] },
		};
	}

	onProgress?.('Loading compiler...', 30);
	const { compile } = await import('./compiler');

	onProgress?.('Compiling to WASM...', 45);
	await new Promise((resolve) => requestAnimationFrame(resolve));
	const { wasm, errors: compileErrors } = await compile(instrumented);

	if (compileErrors.length > 0 || !wasm) {
		return {
			state: 'complete',
			result: { program: emptyProgram, errors: compileErrors, warnings: [] },
		};
	}

	let accumulatedStdin = '';
	let cancelled = false;

	onProgress?.('Executing program...', 75);

	async function runWithStdin(stdin: string): Promise<InteractiveSession> {
		const { executeWasm } = await import('./runtime');
		const { program, errors, stdinExhausted } = await executeWasm(
			wasm!, 'user_program', source, MAX_STEPS, stdin, structRegistry, descriptionMap,
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
					// Re-run with stdinEof flag — fd_read returns 0 (EOF) instead of pausing
					const result = await executeWasm(
						wasm!, 'user_program', source, MAX_STEPS, accumulatedStdin, structRegistry, descriptionMap, true,
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
