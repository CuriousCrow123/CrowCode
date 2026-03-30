/**
 * WASM backend diagnostic dump.
 *
 * Runs programs through the full pipeline and writes detailed dumps
 * to docs/diagnostics/ for manual line-by-line audit.
 *
 * Each dump includes:
 *   - Numbered source lines
 *   - Full instrumented source
 *   - Every step with line, ops, and ioEvents
 *   - Every snapshot with full entry tree
 *
 * Run: npx vitest run src/lib/wasm-backend/diagnostic.test.ts
 */
import { describe, it, beforeAll } from 'vitest';
import { Parser, Language } from 'web-tree-sitter';
import { resolve } from 'path';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { transformSource } from './transformer';
import { OpCollector, StdinExhausted } from './op-collector';
import { WasiShim, VirtualFS, CompilationComplete } from './wasi-shim';
import { buildSnapshots } from '$lib/engine/snapshot';
import type { MemoryEntry, Program, SnapshotOp } from '$lib/types';

const DIAG_DIR = resolve('docs/diagnostics');

// === Setup ===

let parser: Parser;

beforeAll(async () => {
	mkdirSync(DIAG_DIR, { recursive: true });
	await Parser.init({
		locateFile: () => resolve('static/tree-sitter.wasm'),
	});
	parser = new Parser();
	const lang = await Language.load(resolve('static/tree-sitter-c.wasm'));
	parser.setLanguage(lang);
});

// === xcc artifact loading ===

let cachedArtifacts: { compilerBytes: Buffer; headers: Map<string, Uint8Array>; libs: Map<string, Uint8Array> } | null = null;

function getArtifacts() {
	if (cachedArtifacts) return cachedArtifacts;
	const base = resolve('static/xcc');
	const compilerBytes = readFileSync(`${base}/cc.wasm`);

	const headers = new Map<string, Uint8Array>();
	const headerFiles = [
		'alloca.h', 'ar.h', 'assert.h', 'ctype.h', 'elf.h',
		'errno.h', 'fcntl.h', 'float.h', 'inttypes.h', 'libgen.h',
		'limits.h', 'math.h', 'setjmp.h', 'signal.h',
		'stdarg.h', 'stdbool.h', 'stddef.h', 'stdint.h', 'stdio.h',
		'stdlib.h', 'stdnoreturn.h', 'string.h', 'strings.h',
		'time.h', 'unistd.h', 'wchar.h',
		'sys/types.h', 'sys/stat.h', 'sys/wait.h', 'sys/ioctl.h', 'sys/random.h',
	];
	for (const name of headerFiles) {
		try { headers.set(name, readFileSync(`${base}/include/${name}`)); } catch { /* skip */ }
	}
	headers.set('__crow.h', readFileSync(`${base}/__crow.h`));

	const libs = new Map<string, Uint8Array>();
	for (const name of ['wcrt0.a', 'wlibc.a']) {
		libs.set(name, readFileSync(`${base}/lib/${name}`));
	}

	cachedArtifacts = { compilerBytes, headers, libs };
	return cachedArtifacts;
}

// === Pipeline ===

async function compile(source: string): Promise<Uint8Array | string[]> {
	const { compilerBytes, headers, libs } = getArtifacts();
	const fs = new VirtualFS();
	for (const [name, content] of headers) fs.addFile(`/usr/include/${name}`, content);
	for (const [name, content] of libs) fs.addFile(`/usr/lib/${name}`, content);
	fs.addFile('/input.c', source, true);
	fs.addFile('/output.wasm', new Uint8Array(0), false);

	const errors: string[] = [];
	const wasi = new WasiShim({
		args: ['wcc', '-I/usr/include', '-L/usr/lib', '-Wl,--allow-undefined', '-e', 'malloc,free', '-o', '/output.wasm', '/input.c'],
		fs,
		stdout: () => {},
		stderr: (text) => errors.push(text),
		onExit: (code) => { throw new CompilationComplete(code); },
	});

	try {
		const mod = await WebAssembly.compile(compilerBytes);
		const inst = await WebAssembly.instantiate(mod, { wasi_snapshot_preview1: wasi.getImports() });
		wasi.setMemory(inst.exports.memory as WebAssembly.Memory);
		(inst.exports._start as () => void)();
	} catch (e) {
		if (e instanceof CompilationComplete) {
			if (e.code !== 0) return errors;
			const out = fs.getFile('/output.wasm');
			if (!out || out.content.length === 0) return ['No output'];
			return out.content;
		}
		return [`Unexpected: ${e}`];
	}
	return ['Compiler did not exit'];
}

async function runPipeline(source: string, stdin?: string): Promise<{
	instrumented: string;
	program: Program;
	snapshots: MemoryEntry[][];
	errors: string[];
	compileErrors: string[];
}> {
	const { instrumented, errors: tErrors, structRegistry } = transformSource(parser, source);
	if (tErrors.length > 0) {
		return { instrumented, program: { name: '', source, steps: [] }, snapshots: [], errors: tErrors, compileErrors: [] };
	}

	const result = await compile(instrumented);
	if (Array.isArray(result)) {
		return { instrumented, program: { name: '', source, steps: [] }, snapshots: [], errors: [], compileErrors: result };
	}

	const collector = new OpCollector(500, structRegistry);
	if (stdin) collector.setStdin(stdin);
	const runtimeErrors: string[] = [];

	const pfs = new VirtualFS();
	const pwasi = new WasiShim({
		args: ['program'], fs: pfs,
		stdout: (text) => collector.onPrintf(text),
		stderr: (text) => runtimeErrors.push(text),
		onExit: (code) => { throw { type: 'exit', code }; },
	});

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const env: Record<string, (...args: any[]) => any> = {
		__crow_step: (line: number) => collector.onStep(line),
		__crow_push_scope: (namePtr: number, line: number) => collector.onPushScope(namePtr, line),
		__crow_pop_scope: () => collector.onPopScope(),
		__crow_decl: (namePtr: number, addr: number, size: number, typePtr: number, line: number) =>
			collector.onDecl(namePtr, addr, size, typePtr, line),
		__crow_set: (namePtr: number, addr: number, line: number) => collector.onSet(namePtr, addr, line),
		__crow_malloc: (size: number, line: number) => collector.onMalloc(size, line),
		__crow_calloc: (count: number, size: number, line: number) => collector.onCalloc(count, size, line),
		__crow_realloc: (ptr: number, size: number, line: number) => collector.onRealloc(ptr, size, line),
		__crow_free: (ptr: number, line: number) => collector.onFree(ptr, line),
		__crow_scanf_int: (ptr: number, line: number) => collector.onScanfInt(ptr, line),
		__crow_scanf_float: (ptr: number, line: number) => collector.onScanfFloat(ptr, line),
		__crow_scanf_double: (ptr: number, line: number) => collector.onScanfDouble(ptr, line),
		__crow_scanf_char: (ptr: number, line: number) => collector.onScanfChar(ptr, line),
		__crow_scanf_string: (bufPtr: number, bufSize: number, line: number) =>
			collector.onScanfString(bufPtr, bufSize, line),
		puts: (strPtr: number) => { collector.onPrintf(collector.readCString(strPtr) + '\n'); return 0; },
		putchar: (ch: number) => { collector.onPrintf(String.fromCharCode(ch)); return ch; },
		printf: () => {},
		getchar: () => { throw new StdinExhausted(); },
	};

	try {
		const mod = await WebAssembly.compile(result);
		const inst = await WebAssembly.instantiate(mod, { env, wasi_snapshot_preview1: pwasi.getImports() });
		const memory = inst.exports.memory as WebAssembly.Memory;
		pwasi.setMemory(memory);
		collector.setMemory(memory);
		if (inst.exports.malloc && inst.exports.free) {
			collector.setWasmExports({
				malloc: inst.exports.malloc as (n: number) => number,
				free: inst.exports.free as (p: number) => void,
				memory,
			});
		}
		(inst.exports._start as () => void)();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} catch (e: any) {
		if (e?.type === 'exit') { /* normal */ }
		else if (e instanceof StdinExhausted) { /* partial */ }
		else if (e instanceof WebAssembly.RuntimeError) { runtimeErrors.push(`WASM trap: ${e.message}`); }
		else { runtimeErrors.push(`${e?.message ?? e}`); }
	}

	const program = collector.finish('test', source);
	const snapshots = buildSnapshots(program);
	return { instrumented, program, snapshots, errors: runtimeErrors, compileErrors: [] };
}

// === Dump formatter ===

function formatOp(op: SnapshotOp): string {
	switch (op.op) {
		case 'addEntry':
			return `addEntry(parent=${op.parentId ?? 'null'}, id=${op.entry.id}, name=${op.entry.name}, type=${op.entry.type}, val=${op.entry.value}, kind=${op.entry.kind ?? ''}, addr=${op.entry.address ?? ''}, children=${op.entry.children?.length ?? 0})`;
		case 'removeEntry':
			return `removeEntry(id=${op.id})`;
		case 'setValue':
			return `setValue(id=${op.id}, val=${op.value})`;
		case 'setHeapStatus':
			return `setHeapStatus(id=${op.id}, status=${op.status})`;
		default:
			return JSON.stringify(op);
	}
}

function formatEntry(entry: MemoryEntry, indent = 0): string {
	const pad = '  '.repeat(indent);
	let line = `${pad}- ${entry.id} | name=${entry.name} | type=${entry.type} | val=${entry.value} | addr=${entry.address ?? ''} | kind=${entry.kind ?? ''} | heap=${entry.heap ? `${entry.heap.status},${entry.heap.size}b` : ''}`;
	if (entry.children) {
		for (const child of entry.children) {
			line += '\n' + formatEntry(child, indent + 1);
		}
	}
	return line;
}

function writeDump(
	filename: string,
	title: string,
	source: string,
	instrumented: string,
	program: Program,
	snapshots: MemoryEntry[][],
	errors: string[],
	compileErrors: string[],
): void {
	const lines: string[] = [];

	lines.push(`# ${title}`);
	lines.push('');

	// Errors
	if (compileErrors.length > 0) {
		lines.push('## Compile Errors');
		for (const e of compileErrors) lines.push(`- ${e}`);
		lines.push('');
	}
	if (errors.length > 0) {
		lines.push('## Runtime Errors');
		for (const e of errors) lines.push(`- ${e}`);
		lines.push('');
	}

	// Source with line numbers
	lines.push('## Source (with line numbers)');
	lines.push('```c');
	const srcLines = source.split('\n');
	for (let i = 0; i < srcLines.length; i++) {
		lines.push(`${String(i + 1).padStart(3)} | ${srcLines[i]}`);
	}
	lines.push('```');
	lines.push('');

	// Instrumented source
	lines.push('## Instrumented Source');
	lines.push('```c');
	lines.push(instrumented);
	lines.push('```');
	lines.push('');

	// Steps
	lines.push(`## Steps (${program.steps.length} total)`);
	lines.push('');
	for (let i = 0; i < program.steps.length; i++) {
		const step = program.steps[i];
		lines.push(`### Step ${i} | Line ${step.location.line} | ${step.ops.length} ops`);
		for (const op of step.ops) {
			lines.push(`- ${formatOp(op)}`);
		}
		if (step.ioEvents) {
			for (const io of step.ioEvents) {
				lines.push(`- IO: ${io.kind} ${io.kind === 'write' ? io.text : io.consumed}`);
			}
		}
		lines.push('');
	}

	// Snapshots
	lines.push(`## Snapshots (${snapshots.length} total)`);
	lines.push('');
	for (let i = 0; i < snapshots.length; i++) {
		lines.push(`### Snapshot ${i} (after step ${i})`);
		if (snapshots[i].length === 0) {
			lines.push('(empty)');
		}
		for (const entry of snapshots[i]) {
			lines.push(formatEntry(entry));
		}
		lines.push('');
	}

	writeFileSync(`${DIAG_DIR}/${filename}`, lines.join('\n'));
}

// === Round 1: Minimal programs ===

describe('Round 1: minimal programs', () => {
	it('custom — Minimal Scalar', async () => {
		const source = `int main() {
    int x = 5;
    x = 10;
    x = x + 1;
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('custom.md', 'custom — Minimal Scalar', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p1.1 — Integer Lifecycle', async () => {
		const source = `int main() {
    int a = 42;
    int b = -7;
    int c = a + b;
    c *= 2;
    c %= 9;
    int d = c << 3;
    d = d >> 1;
    d = ~d;
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p1.1.md', 'p1.1 — Integer Lifecycle', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p1.3 — All Compound Operators', async () => {
		const source = `int main() {
    int x = 100;
    x += 10;
    x -= 20;
    x *= 3;
    x /= 9;
    x %= 7;
    x &= 255;
    x |= 16;
    x ^= 18;
    x = 8;
    x <<= 2;
    x >>= 1;
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p1.3.md', 'p1.3 — All Compound Operators', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p1.4 — Increment / Decrement', async () => {
		const source = `int main() {
    int a = 5;
    a++;
    a++;
    ++a;
    a--;
    --a;
    int b = a;
    a++;
    int c = a;
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p1.4.md', 'p1.4 — Increment / Decrement', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);
});

// === Round 2: Control flow ===
// (added below Round 1 in the file)


describe('Round 2: control flow', () => {
	it('p7.1 — If / Else Branching', async () => {
		const source = `int main() {
    int x = 10;
    int y = 0;
    if (x > 5) {
        y = 1;
    } else {
        y = 2;
    }
    if (x < 5) {
        y = 10;
    } else {
        y = 20;
    }
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p7.1.md', 'p7.1 — If / Else Branching', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p7.2 — While Loop', async () => {
		const source = `int main() {
    int n = 5;
    int sum = 0;
    while (n > 0) {
        sum += n;
        n--;
    }
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p7.2.md', 'p7.2 — While Loop', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p7.3 — Nested Loops', async () => {
		const source = `int main() {
    int total = 0;
    for (int i = 0; i < 3; i++) {
        for (int j = 0; j < 3; j++) {
            total += 1;
        }
    }
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p7.3.md', 'p7.3 — Nested Loops', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p7.4 — Break and Continue', async () => {
		const source = `int main() {
    int sum = 0;
    for (int i = 0; i < 10; i++) {
        if (i == 3) { continue; }
        if (i == 7) { break; }
        sum += i;
    }
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p7.4.md', 'p7.4 — Break and Continue', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);
});

// === Round 3: Functions ===

describe('Round 3: functions', () => {
	it('p6.1 — Simple Function Call', async () => {
		const source = `int add(int a, int b) {
    int result = a + b;
    return result;
}
int main() {
    int x = add(10, 20);
    int y = add(x, 5);
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p6.1.md', 'p6.1 — Simple Function Call', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p6.4 — Recursive Factorial', async () => {
		const source = `int factorial(int n) {
    if (n <= 1) { return 1; }
    return n * factorial(n - 1);
}
int main() {
    int result = factorial(5);
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p6.4.md', 'p6.4 — Recursive Factorial', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p12.2 — Multi-Function Clamp', async () => {
		const source = `int max(int a, int b) {
    if (a > b) { return a; }
    return b;
}
int clamp(int val, int lo, int hi) {
    return max(lo, val > hi ? hi : val);
}
int main() {
    int a = clamp(15, 0, 10);
    int b = clamp(-5, 0, 10);
    int c = clamp(5, 0, 10);
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p12.2.md', 'p12.2 — Multi-Function Clamp', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p12.5 — Recursive Fibonacci', async () => {
		const source = `int fib(int n) {
    if (n <= 0) { return 0; }
    if (n == 1) { return 1; }
    return fib(n - 1) + fib(n - 2);
}
int main() {
    int a = fib(0);
    int b = fib(1);
    int c = fib(6);
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p12.5.md', 'p12.5 — Recursive Fibonacci', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);
});

// === Round 4: Types ===

describe('Round 4: types', () => {
	it('p1.2 — Char and Casting', async () => {
		const source = `int main() {
    char c = 'A';
    int x = c + 1;
    char d = (char)300;
    int big = 100000;
    char narrow = (char)big;
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p1.2.md', 'p1.2 — Char and Casting', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p13.3 — Float Arithmetic', async () => {
		const source = `int main() {
    float pi = 3.14159;
    float r = 5.0;
    float area = pi * r * r;
    int truncated = (int)area;
    float half = 1.0 / 2.0;
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p13.3.md', 'p13.3 — Float Arithmetic', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p13.4 — Uninitialized Variable', async () => {
		const source = `int main() {
    int x;
    int y = 10;
    x = y + 5;
    int z = x * 2;
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p13.4.md', 'p13.4 — Uninitialized Variable', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p13.5 — Chained Assignment', async () => {
		const source = `int main() {
    int a = 0;
    int b = 0;
    int c = 0;
    a = b = c = 42;
    a = b = c + 8;
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p13.5.md', 'p13.5 — Chained Assignment', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);
});

// === Round 5: Arrays ===

describe('Round 5: arrays', () => {
	it('p3.1 — Array Init and Loop', async () => {
		const source = `int main() {
    int arr[5] = {10, 20, 30, 40, 50};
    arr[0] = 99;
    arr[4] = arr[0] + arr[1];
    int sum = 0;
    for (int i = 0; i < 5; i++) {
        sum += arr[i];
    }
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p3.1.md', 'p3.1 — Array Init and Loop', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p3.3 — Array Squared in Loop', async () => {
		const source = `int main() {
    int data[4] = {1, 2, 3, 4};
    for (int i = 0; i < 4; i++) {
        data[i] = data[i] * data[i];
    }
    int total = 0;
    for (int i = 0; i < 4; i++) {
        total += data[i];
    }
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p3.3.md', 'p3.3 — Array Squared in Loop', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p12.1 — Bubble Sort', async () => {
		const source = `int main() {
    int arr[5] = {5, 3, 1, 4, 2};
    for (int i = 0; i < 4; i++) {
        for (int j = 0; j < 4 - i; j++) {
            if (arr[j] > arr[j + 1]) {
                int tmp = arr[j];
                arr[j] = arr[j + 1];
                arr[j + 1] = tmp;
            }
        }
    }
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p12.1.md', 'p12.1 — Bubble Sort', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);
});

// === Round 6: Structs ===

describe('Round 6: structs', () => {
	it('p2.1 — Simple Struct', async () => {
		const source = `struct Point { int x; int y; };
int main() {
    struct Point p = {10, 20};
    p.x = 30;
    p.y = p.x + 5;
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p2.1.md', 'p2.1 — Simple Struct', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p2.2 — Nested Structs', async () => {
		const source = `struct Vec2 { int x; int y; };
struct Rect { struct Vec2 pos; struct Vec2 size; };
int main() {
    struct Rect r = {{10, 20}, {100, 50}};
    r.pos.x = 30;
    r.size.y = 75;
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p2.2.md', 'p2.2 — Nested Structs', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);
});

// === Round 7: Heap ===

describe('Round 7: heap', () => {
	it('p4.1 — malloc / free Lifecycle', async () => {
		const source = `#include <stdlib.h>
int main() {
    int *p = (int*)malloc(sizeof(int));
    *p = 42;
    *p = *p + 8;
    free(p);
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p4.1.md', 'p4.1 — malloc / free Lifecycle', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p4.2 — calloc Zero-Init', async () => {
		const source = `#include <stdlib.h>
int main() {
    int *arr = (int*)calloc(4, sizeof(int));
    arr[0] = 10;
    arr[1] = 20;
    arr[2] = 30;
    arr[3] = 40;
    free(arr);
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p4.2.md', 'p4.2 — calloc Zero-Init', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p4.4 — Heap Array with Loop', async () => {
		const source = `#include <stdlib.h>
int main() {
    int n = 5;
    int *squares = (int*)malloc(n * sizeof(int));
    for (int i = 0; i < n; i++) {
        squares[i] = i * i;
    }
    free(squares);
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p4.4.md', 'p4.4 — Heap Array with Loop', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p10.3 — Memory Leak Detection', async () => {
		const source = `#include <stdlib.h>
int main() {
    int *a = (int*)malloc(sizeof(int));
    int *b = (int*)malloc(sizeof(int));
    *a = 1;
    *b = 2;
    free(a);
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p10.3.md', 'p10.3 — Memory Leak Detection', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);
});

// === Round 8: Struct + Pointer ===

describe('Round 8: struct + pointer', () => {
	it('p5.1 — Heap Struct via Pointer', async () => {
		const source = `#include <stdlib.h>
struct Point { int x; int y; };
int main() {
    struct Point *p = (struct Point*)malloc(sizeof(struct Point));
    p->x = 10;
    p->y = 20;
    free(p);
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p5.1.md', 'p5.1 — Heap Struct via Pointer', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);
});

// === Round 9: Scope ===

describe('Round 9: scope', () => {
	it('p8.2 — Variable Shadowing', async () => {
		const source = `int main() {
    int x = 10;
    {
        int x = 20;
        x = x + 5;
    }
    int y = x;
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p8.2.md', 'p8.2 — Variable Shadowing', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p13.1 — Switch / Case', async () => {
		const source = `int main() {
    int day = 3;
    int type = 0;
    switch (day) {
        case 1: case 2: case 3: case 4: case 5:
            type = 1;
            break;
        case 6: case 7:
            type = 2;
            break;
        default:
            type = 0;
    }
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p13.1.md', 'p13.1 — Switch / Case', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);
});

// === Round 10: Integration ===

describe('Round 10: integration', () => {
	it('p11.5 — Fibonacci Array', async () => {
		const source = `int main() {
    int fib[10];
    fib[0] = 0;
    fib[1] = 1;
    for (int i = 2; i < 10; i++) {
        fib[i] = fib[i - 1] + fib[i - 2];
    }
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p11.5.md', 'p11.5 — Fibonacci Array', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p15.1 — Entity System', async () => {
		const source = `#include <stdlib.h>
struct Vec2 { int x; int y; };
struct Entity { int id; struct Vec2 pos; int score; };
int sumScores(struct Entity *e, int count) {
    int total = 0;
    for (int i = 0; i < count; i++) {
        total += e[i].score;
    }
    return total;
}
int main() {
    struct Entity *player = (struct Entity*)malloc(sizeof(struct Entity));
    player->id = 1;
    player->pos.x = 3;
    player->pos.y = 7;
    player->score = 100;
    struct Vec2 dir = {1, 0};
    player->pos.x += dir.x;
    player->pos.y += dir.y;
    int total = sumScores(player, 1);
    if (total > 50) {
        player->score += 10;
    }
    free(player);
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p15.1.md', 'p15.1 — Entity System', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);
});

// === Round 11: stdio ===

describe('Round 11: stdio', () => {
	it('p16.1 — Basic printf', async () => {
		const source = `#include <stdio.h>
int main() {
    int x = 42;
    int y = -7;
    printf("x = %d\\n", x);
    printf("y = %d, hex = %x\\n", y, y);
    printf("sum = %d\\n", x + y);
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p16.1.md', 'p16.1 — Basic printf', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p16.2 — puts and putchar', async () => {
		const source = `#include <stdio.h>
int main() {
    puts("Hello, World!");
    putchar('A');
    putchar('\\n');
    puts("Done.");
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p16.2.md', 'p16.2 — puts and putchar', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p16.3 — getchar Loop', async () => {
		const source = `#include <stdio.h>
int main() {
    int c;
    int count = 0;
    c = getchar();
    while (c != -1) {
        count++;
        c = getchar();
    }
    return 0;
}`;
		const r = await runPipeline(source, 'ABC');
		writeDump('p16.3.md', 'p16.3 — getchar Loop', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p16.4 — scanf + printf', async () => {
		const source = `#include <stdio.h>
int main() {
    int x;
    int y;
    printf("Enter two numbers:\\n");
    scanf("%d", &x);
    scanf("%d", &y);
    printf("Sum = %d\\n", x + y);
    return 0;
}`;
		const r = await runPipeline(source, '10 20');
		writeDump('p16.4.md', 'p16.4 — scanf + printf', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p16.5 — scanf \\n Residue', async () => {
		const source = `#include <stdio.h>
int main() {
    int num;
    char ch;
    scanf("%d", &num);
    scanf("%c", &ch);
    return 0;
}`;
		const r = await runPipeline(source, '42\nA');
		writeDump('p16.5.md', 'p16.5 — scanf newline Residue', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p16.6 — printf Format Specifiers', async () => {
		const source = `#include <stdio.h>
int main() {
    int i = 255;
    printf("decimal: %d\\n", i);
    printf("hex:     %x\\n", i);
    printf("HEX:     %X\\n", i);
    printf("char:    %c\\n", 65);
    printf("padded:  %05d\\n", 42);
    printf("left:    %-10d|\\n", 42);
    printf("percent: 100%%\\n");
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p16.6.md', 'p16.6 — printf Format Specifiers', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p16.7 — Grade Calculator', async () => {
		const source = `#include <stdio.h>
int main() {
    int score;
    int total = 0;
    int count = 0;
    int highest = 0;
    printf("Enter scores (-1 to finish):\\n");
    while (1) {
        scanf("%d", &score);
        if (score == -1) { break; }
        if (score < 0 || score > 100) {
            printf("Invalid! Use 0-100.\\n");
        } else {
            total = total + score;
            count = count + 1;
            if (score > highest) { highest = score; }
            printf("  Score #%d: %d\\n", count, score);
        }
    }
    printf("Scores entered: %d\\n", count);
    printf("Total: %d\\n", total);
    printf("Highest: %d\\n", highest);
    if (count > 0) {
        int avg = total / count;
        printf("Average: %d\\n", avg);
    }
    return 0;
}`;
		const r = await runPipeline(source, '85 92 78 -1');
		writeDump('p16.7.md', 'p16.7 — Grade Calculator', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);
});

// === Round 12: Edge cases ===

describe('Round 12: edge cases', () => {
	it('p13.2 — String Literal', async () => {
		const source = `#include <stdio.h>
#include <stdlib.h>
int main() {
    char *greeting = "hello";
    char *name = "world";
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p13.2.md', 'p13.2 — String Literal', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p13.6 — Function Pointer', async () => {
		const source = `int add(int a, int b) { return a + b; }
int sub(int a, int b) { return a - b; }
int main() {
    int (*fp)(int, int) = add;
    int a = fp(10, 3);
    fp = sub;
    int b = fp(10, 3);
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p13.6.md', 'p13.6 — Function Pointer', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p13.7 — 2D Array', async () => {
		const source = `int main() {
    int m[3][3] = {{1, 0, 0}, {0, 1, 0}, {0, 0, 1}};
    int trace = 0;
    for (int i = 0; i < 3; i++) {
        trace += m[i][i];
    }
    m[1][2] = 5;
    m[2][0] = 7;
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p13.7.md', 'p13.7 — 2D Array', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p13.8 — Array-to-Pointer Decay', async () => {
		const source = `int main() {
    int arr[4] = {10, 20, 30, 40};
    int *p = arr;
    int first = *p;
    int third = *(p + 2);
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p13.8.md', 'p13.8 — Array-to-Pointer Decay', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p14.1 — Use-After-Free', async () => {
		const source = `#include <stdlib.h>
int main() {
    int *p = (int*)malloc(sizeof(int));
    *p = 42;
    free(p);
    int x = *p;
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p14.1.md', 'p14.1 — Use-After-Free', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p14.2 — String Functions', async () => {
		const source = `#include <string.h>
#include <stdlib.h>
int main() {
    char *s = "hello";
    int len = strlen(s);
    char *a = "abc";
    char *b = "abd";
    int cmp = strcmp(a, b);
    char *dst = (char*)malloc(8);
    strcpy(dst, s);
    int len2 = strlen(dst);
    free(dst);
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p14.2.md', 'p14.2 — String Functions', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p14.3 — Math Functions', async () => {
		const source = `#include <math.h>
#include <stdlib.h>
int main() {
    int a = abs(-7);
    float s = sqrt(25.0);
    float p = pow(2.0, 10.0);
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p14.3.md', 'p14.3 — Math Functions', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p9.1 — sprintf Formats', async () => {
		const source = `#include <stdio.h>
#include <stdlib.h>
int main() {
    char *buf = (char*)malloc(128);
    sprintf(buf, "hello world");
    sprintf(buf, "x=%d", 42);
    sprintf(buf, "hex=%x", 255);
    sprintf(buf, "char=%c", 65);
    sprintf(buf, "100%%");
    sprintf(buf, "%d+%d=%d", 1, 2, 3);
    free(buf);
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p9.1.md', 'p9.1 — sprintf Formats', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p5.3 — Full Memory Basics', async () => {
		const source = `#include <stdlib.h>
struct Point { int x; int y; };
struct Player { int id; struct Point pos; int *scores; };
int distance(struct Point a, struct Point b) {
    int dx = a.x - b.x;
    int dy = a.y - b.y;
    return dx * dx + dy * dy;
}
int main() {
    struct Point origin = {0, 0};
    struct Player *p = (struct Player*)malloc(sizeof(struct Player));
    p->id = 1;
    p->pos.x = 3;
    p->pos.y = 4;
    p->scores = (int*)calloc(3, sizeof(int));
    p->scores[0] = 100;
    p->scores[1] = 200;
    p->scores[2] = 300;
    int d = distance(origin, p->pos);
    free(p->scores);
    free(p);
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p5.3.md', 'p5.3 — Full Memory Basics', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);

	it('p11.2 — Matrix Identity', async () => {
		const source = `#include <stdlib.h>
int main() {
    int rows = 3;
    int *matrix = (int*)calloc(rows * rows, sizeof(int));
    for (int i = 0; i < rows; i++) {
        matrix[i * rows + i] = 1;
    }
    int sum = 0;
    for (int i = 0; i < rows * rows; i++) {
        sum += matrix[i];
    }
    free(matrix);
    return 0;
}`;
		const r = await runPipeline(source);
		writeDump('p11.2.md', 'p11.2 — Matrix Identity', source, r.instrumented, r.program, r.snapshots, r.errors, r.compileErrors);
	}, 30000);
});
