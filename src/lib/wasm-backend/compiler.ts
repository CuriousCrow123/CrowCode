/**
 * xcc compiler integration.
 * Loads cc.wasm (the xcc C-to-WASM compiler) and compiles instrumented C source
 * to WASM binaries, all within the browser.
 */

import { WasiShim, VirtualFS, CompilationComplete } from './wasi-shim';

export type CompileResult = {
	wasm: Uint8Array | null;
	errors: string[];
};

let cachedCompilerBytes: ArrayBuffer | null = null;
let cachedHeaders: Map<string, Uint8Array> | null = null;
let cachedLibs: Map<string, Uint8Array> | null = null;

/**
 * Fetch and cache all xcc artifacts (compiler WASM, headers, libs).
 * Called lazily on first compilation.
 */
async function loadArtifacts(): Promise<{
	compilerBytes: ArrayBuffer;
	headers: Map<string, Uint8Array>;
	libs: Map<string, Uint8Array>;
}> {
	const base = import.meta.env.BASE_URL.endsWith('/')
		? import.meta.env.BASE_URL
		: `${import.meta.env.BASE_URL}/`;
	const xccBase = `${base}xcc/`;

	if (!cachedCompilerBytes) {
		const resp = await fetch(`${xccBase}cc.wasm`);
		if (!resp.ok) throw new Error(`Failed to fetch cc.wasm: ${resp.status}`);
		cachedCompilerBytes = await resp.arrayBuffer();
	}

	if (!cachedHeaders) {
		cachedHeaders = new Map();
		const headerFiles = [
			'assert.h', 'ctype.h', 'errno.h', 'fcntl.h', 'float.h',
			'inttypes.h', 'limits.h', 'math.h', 'setjmp.h', 'signal.h',
			'stdarg.h', 'stdbool.h', 'stddef.h', 'stdint.h', 'stdio.h',
			'stdlib.h', 'string.h', 'strings.h', 'time.h', 'unistd.h',
			'alloca.h',
		];
		const fetches = headerFiles.map(async (name) => {
			try {
				const resp = await fetch(`${xccBase}include/${name}`);
				if (resp.ok) {
					cachedHeaders!.set(name, new Uint8Array(await resp.arrayBuffer()));
				}
			} catch {
				// Skip missing headers — not all may be present
			}
		});
		await Promise.all(fetches);

		// Fetch __crow.h
		const crowResp = await fetch(`${xccBase}__crow.h`);
		if (crowResp.ok) {
			cachedHeaders.set('__crow.h', new Uint8Array(await crowResp.arrayBuffer()));
		}
	}

	if (!cachedLibs) {
		cachedLibs = new Map();
		for (const name of ['wcrt0.a', 'wlibc.a']) {
			const resp = await fetch(`${xccBase}lib/${name}`);
			if (resp.ok) {
				cachedLibs.set(name, new Uint8Array(await resp.arrayBuffer()));
			}
		}
	}

	return {
		compilerBytes: cachedCompilerBytes,
		headers: cachedHeaders,
		libs: cachedLibs,
	};
}

/**
 * Build a virtual filesystem populated with xcc's headers, libs, and the user source.
 */
function buildVirtualFS(
	headers: Map<string, Uint8Array>,
	libs: Map<string, Uint8Array>,
	source: string,
): VirtualFS {
	const fs = new VirtualFS();

	// Add headers to /usr/include/
	for (const [name, content] of headers) {
		fs.addFile(`/usr/include/${name}`, content);
	}

	// Add libs to /usr/lib/
	for (const [name, content] of libs) {
		fs.addFile(`/usr/lib/${name}`, content);
	}

	// Add user source
	fs.addFile('/input.c', source, true);

	// Create output file slot (writable)
	fs.addFile('/output.wasm', new Uint8Array(0), false);

	return fs;
}

/**
 * Compile C source to WASM using xcc running in the browser.
 *
 * @param source Instrumented C source (already transformed with __crow_* calls)
 * @returns CompileResult with WASM binary or errors
 */
export async function compile(source: string): Promise<CompileResult> {
	const { compilerBytes, headers, libs } = await loadArtifacts();

	const fs = buildVirtualFS(headers, libs, source);

	const errors: string[] = [];
	let stdoutBuf = '';

	const wasi = new WasiShim({
		args: [
			'wcc',
			'-I/usr/include',
			'-L/usr/lib',
			'-Wl,--allow-undefined',
			'-o', '/output.wasm',
			'/input.c',
		],
		fs,
		stdout: (text) => { stdoutBuf += text; },
		stderr: (text) => { errors.push(text); },
		onExit: (code) => { throw new CompilationComplete(code); },
	});

	try {
		const module = await WebAssembly.compile(compilerBytes);
		const instance = await WebAssembly.instantiate(module, {
			wasi_snapshot_preview1: wasi.getImports(),
		});

		wasi.setMemory(instance.exports.memory as WebAssembly.Memory);

		const start = instance.exports._start as () => void;
		start();
	} catch (e) {
		if (e instanceof CompilationComplete) {
			if (e.code !== 0) {
				if (errors.length === 0) {
					errors.push(`Compilation failed with exit code ${e.code}`);
				}
				return { wasm: null, errors };
			}

			// Success — read output.wasm from virtual FS
			const outputFile = fs.getFile('/output.wasm');
			if (!outputFile || outputFile.content.length === 0) {
				return { wasm: null, errors: ['Compilation produced no output'] };
			}

			return { wasm: outputFile.content, errors: [] };
		}

		// Unexpected error
		const msg = e instanceof Error ? e.message : String(e);
		return { wasm: null, errors: [`Internal compiler error: ${msg}`] };
	}

	// If we get here without CompilationComplete, something is wrong
	return { wasm: null, errors: ['Compiler did not exit normally'] };
}
