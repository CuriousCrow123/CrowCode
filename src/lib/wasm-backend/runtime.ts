/**
 * WASM Runtime: instantiates a compiled user program .wasm module
 * with the op collector's callbacks as WASM imports, executes it,
 * and handles traps, limits, and stdin exhaustion.
 */

import type { Program } from '$lib/types';
import { OpCollector, StepLimitExceeded, StdinExhausted } from './op-collector';
import type { StructRegistry } from './transformer';
import { WasiShim, VirtualFS, ProgramExit } from './wasi-shim';

export type ExecuteResult = {
	program: Program;
	errors: string[];
	stdinExhausted: boolean;
};

/**
 * Execute a compiled WASM binary with instrumentation callbacks.
 *
 * @param binary - The compiled .wasm bytes from xcc
 * @param name - Program name for the resulting Program
 * @param source - Original (non-instrumented) C source
 * @param maxSteps - Maximum number of __crow_step calls before truncation
 * @param stdin - Optional stdin string for scanf
 */
export async function executeWasm(
	binary: Uint8Array,
	name: string,
	source: string,
	maxSteps: number,
	stdin?: string,
	structRegistry?: StructRegistry,
): Promise<ExecuteResult> {
	const collector = new OpCollector(maxSteps, structRegistry);
	if (stdin) collector.setStdin(stdin);

	let stdinExhausted = false;
	const errors: string[] = [];

	// Build a minimal WASI shim for the user program
	const fs = new VirtualFS();
	const wasi = new WasiShim({
		args: ['program'],
		fs,
		stdout: (text) => collector.onPrintf(text),
		stderr: (text) => errors.push(text),
		onExit: (code) => { throw new ProgramExit(code); },
	});

	// Build the import object
	const envImports: Record<string, (...args: number[]) => number | void> = {
		// Instrumentation callbacks
		__crow_step: (line: number) => collector.onStep(line),
		__crow_push_scope: (namePtr: number, line: number) => collector.onPushScope(namePtr, line),
		__crow_pop_scope: () => collector.onPopScope(),
		__crow_decl: (namePtr: number, addr: number, size: number, typePtr: number, line: number, flags: number) =>
			collector.onDecl(namePtr, addr, size, typePtr, line, flags),
		__crow_set: (namePtr: number, addr: number, line: number) =>
			collector.onSet(namePtr, addr, line),

		// Heap callbacks
		__crow_malloc: (size: number, line: number) => collector.onMalloc(size, line),
		__crow_calloc: (count: number, size: number, line: number) => collector.onCalloc(count, size, line),
		__crow_realloc: (ptr: number, size: number, line: number) => collector.onRealloc(ptr, size, line),
		__crow_free: (ptr: number, line: number) => collector.onFree(ptr, line),

		// scanf callbacks
		__crow_scanf_int: (ptr: number, line: number) => collector.onScanfInt(ptr, line),
		__crow_scanf_float: (ptr: number, line: number) => collector.onScanfFloat(ptr, line),
		__crow_scanf_double: (ptr: number, line: number) => collector.onScanfDouble(ptr, line),
		__crow_scanf_char: (ptr: number, line: number) => collector.onScanfChar(ptr, line),
		__crow_scanf_string: (bufPtr: number, bufSize: number, line: number) =>
			collector.onScanfString(bufPtr, bufSize, line),

		// String function callbacks
		__crow_strcpy: (dest: number, src: number, line: number) => collector.onStrcpy(dest, src, line),

		// stdio functions implemented in JS
		printf: () => {
			// printf with format string is complex — we handle it via fd_write in WASI
			// This is a fallback for direct printf calls; real output goes through fd_write
		},
		puts: (strPtr: number) => {
			const text = collector.readCString(strPtr) + '\n';
			collector.onPrintf(text);
			return text.length;
		},
		putchar: (ch: number) => {
			collector.onPrintf(String.fromCharCode(ch));
			return ch;
		},
		getchar: () => {
			// Simple getchar from stdin
			throw new StdinExhausted();
		},
	};

	try {
		const module = await WebAssembly.compile(binary);
		const instance = await WebAssembly.instantiate(module, {
			env: envImports,
			wasi_snapshot_preview1: wasi.getImports(),
		});

		// Set up memory references
		const memory = instance.exports.memory as WebAssembly.Memory;
		wasi.setMemory(memory);
		collector.setMemory(memory);

		// Set up WASM exports for heap functions (may not exist if program doesn't use malloc)
		if (instance.exports.malloc && instance.exports.free) {
			collector.setWasmExports({
				malloc: instance.exports.malloc as (size: number) => number,
				free: instance.exports.free as (ptr: number) => void,
				memory,
			});
		}

		// Execute
		const start = instance.exports._start as () => void;
		start();
	} catch (e) {
		if (e instanceof ProgramExit) {
			// Normal program exit
			if (e.code !== 0) {
				errors.push(`Program exited with code ${e.code}`);
			}
		} else if (e instanceof StepLimitExceeded) {
			// Partial program — will be returned with warning
		} else if (e instanceof StdinExhausted) {
			stdinExhausted = true;
		} else if (e instanceof WebAssembly.RuntimeError) {
			const msg = e.message;
			if (msg.includes('divide by zero') || msg.includes('integer divide by zero')) {
				errors.push('Runtime error: division by zero');
			} else if (msg.includes('out of bounds') || msg.includes('unreachable')) {
				errors.push(`Runtime error: ${msg}`);
			} else {
				errors.push(`WASM runtime error: ${msg}`);
			}
		} else {
			const msg = e instanceof Error ? e.message : String(e);
			errors.push(`Execution error: ${msg}`);
		}
	}

	const program = collector.finish(name, source);
	return { program, errors, stdinExhausted };
}
