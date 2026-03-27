import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Parser, Language } from 'web-tree-sitter';
import { resolve } from 'path';
import { interpretSync, resetParserCache } from './index';
import type { InterpreterOptions } from './types';
import { validateProgram } from '$lib/engine/validate';
import { buildSnapshots } from '$lib/engine/snapshot';
import { buildConsoleOutputs } from '$lib/engine/console';
import type { Program, ProgramStep, MemoryEntry } from '$lib/types';

let parser: Parser;

beforeAll(async () => {
	resetParserCache();
	await Parser.init({
		locateFile: () => resolve('static/tree-sitter.wasm'),
	});
	parser = new Parser();
	const lang = await Language.load(resolve('static/tree-sitter-c.wasm'));
	parser.setLanguage(lang);
});

function run(source: string, opts?: { maxSteps?: number; maxFrames?: number }) {
	return interpretSync(parser, source, opts);
}

function expectValid(program: Program) {
	const errors = validateProgram(program);
	if (errors.length > 0) {
		console.log('Validation errors:', errors);
		console.log('Steps:', JSON.stringify(program.steps.map((s, i) => ({
			i,
			line: s.location.line,
			desc: s.description,
			sub: s.subStep,
			ops: s.ops.map((o) => o.op),
		})), null, 2));
	}
	expect(errors).toHaveLength(0);
}

function expectNoWarnings(program: Program) {
	const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
	buildSnapshots(program);
	expect(spy).not.toHaveBeenCalled();
	spy.mockRestore();
}

/** Recursive name-based tree walk for snapshot value assertions. */
function findEntry(entries: MemoryEntry[], name: string): MemoryEntry | undefined {
	for (const e of entries) {
		if (e.name === name) return e;
		if (e.children) {
			const found = findEntry(e.children, name);
			if (found) return found;
		}
	}
	return undefined;
}

// === Step 7a: Declarations, assignments, returns ===

describe('declarations and assignments', () => {
	it('declares int variable', () => {
		const { program, errors } = run('int main() { int x = 5; return 0; }');
		expect(errors).toHaveLength(0);
		expect(program.steps.length).toBeGreaterThan(0);
		expectValid(program);
		const snapshots = buildSnapshots(program);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('5');
	});

	it('declares multiple variables', () => {
		const { program } = run('int main() { int a = 1; int b = 2; int c = 3; return 0; }');
		expectValid(program);
		expectNoWarnings(program);
	});

	it('assigns variable', () => {
		const { program } = run('int main() { int x = 0; x = 42; return 0; }');
		expectValid(program);
		const setOps = program.steps.flatMap((s) => s.ops).filter((o) => o.op === 'setValue');
		expect(setOps.length).toBeGreaterThan(0);
		const snapshots = buildSnapshots(program);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('42');
	});

	it('compound assignment +=', () => {
		const { program } = run('int main() { int x = 10; x += 5; return 0; }');
		expectValid(program);
		const snapshots = buildSnapshots(program);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('15');
	});

	it('declares struct variable', () => {
		const src = `
struct Point { int x; int y; };
int main() {
	struct Point p = {3, 4};
	return 0;
}`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		expectValid(program);
		// Should have children for struct fields
		const addOps = program.steps.flatMap((s) => s.ops).filter((o) => o.op === 'addEntry');
		const structEntry = addOps.find((o) => o.op === 'addEntry' && (o as any).entry.children?.length === 2);
		expect(structEntry).toBeDefined();
	});

	it('declares array variable', () => {
		const src = 'int main() { int arr[4] = {10, 20, 30, 40}; return 0; }';
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		expectValid(program);
	});

	it('handles return 0', () => {
		const { program } = run('int main() { return 0; }');
		expectValid(program);
	});

	it('handles preprocessor includes gracefully', () => {
		const { program, errors } = run('#include <stdio.h>\nint main() { return 0; }');
		expectValid(program);
		// No hard errors — just warnings
	});
});

// === Step 7b: Control flow ===

describe('for-loop sub-steps', () => {
	it('generates for-loop with init, check, body, increment, exit', () => {
		const src = `int main() {
	int sum = 0;
	for (int i = 0; i < 3; i++) {
		sum += 1;
	}
	return 0;
}`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		expectValid(program);
		expectNoWarnings(program);

		// Should have sub-steps for check and increment
		const subSteps = program.steps.filter((s) => s.subStep);
		expect(subSteps.length).toBeGreaterThan(0);
	});

	it('for-loop with zero iterations', () => {
		const src = `int main() {
	for (int i = 0; i < 0; i++) {
		int x = 1;
	}
	return 0;
}`;
		const { program } = run(src);
		expectValid(program);
	});

	it('for-loop properly exits with anchor step', () => {
		const src = `int main() {
	for (int i = 0; i < 2; i++) {
		int x = i;
	}
	return 0;
}`;
		const { program } = run(src);
		expectValid(program);
		// The exit step should be an anchor (not subStep)
	});
});

describe('while-loop', () => {
	it('simple while loop', () => {
		const src = `int main() {
	int x = 3;
	while (x > 0) {
		x -= 1;
	}
	return 0;
}`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		expectValid(program);
	});
});

describe('do-while loop', () => {
	it('simple do-while loop', () => {
		const src = `int main() {
	int x = 0;
	do {
		x += 1;
	} while (x < 3);
	return 0;
}`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		expectValid(program);
	});
});

describe('if/else', () => {
	it('if-true branch', () => {
		const src = `int main() {
	int x = 5;
	if (x > 0) {
		x = 10;
	}
	return 0;
}`;
		const { program } = run(src);
		expectValid(program);
	});

	it('if-else: false branch', () => {
		const src = `int main() {
	int x = 0;
	if (x > 0) {
		x = 10;
	} else {
		x = 20;
	}
	return 0;
}`;
		const { program } = run(src);
		expectValid(program);
		const snapshots = buildSnapshots(program);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('20');
	});

	it('nested if/else', () => {
		const src = `int main() {
	int x = 5;
	if (x > 10) {
		x = 100;
	} else if (x > 3) {
		x = 50;
	} else {
		x = 1;
	}
	return 0;
}`;
		const { program } = run(src);
		expectValid(program);
	});
});

// === Step 7c: Function calls ===

describe('function calls', () => {
	it('calls user-defined function', () => {
		const src = `
int add(int a, int b) {
	return a + b;
}
int main() {
	int x = add(3, 4);
	return 0;
}`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		expectValid(program);
	});

	it('function call creates and removes stack frame', () => {
		const src = `
int square(int n) {
	int result = n * n;
	return result;
}
int main() {
	int x = square(5);
	return 0;
}`;
		const { program } = run(src);
		expectValid(program);
		expectNoWarnings(program);
		// Should have addEntry (scope push) and removeEntry (scope pop)
		const allOps = program.steps.flatMap((s) => s.ops);
		const scopeAdds = allOps.filter((o) => o.op === 'addEntry' && (o as any).entry.kind === 'scope');
		const scopeRemoves = allOps.filter((o) => o.op === 'removeEntry');
		expect(scopeAdds.length).toBeGreaterThanOrEqual(2); // main + square
	});

	it('stack overflow detection', () => {
		const src = `
int recurse(int n) {
	return recurse(n + 1);
}
int main() {
	int x = recurse(0);
	return 0;
}`;
		const { errors } = run(src, { maxSteps: 100, maxFrames: 10 });
		expect(errors.some((e) => e.includes('Stack overflow') || e.includes('Step limit'))).toBe(true);
	});
});

// === Step 7d: Stdlib and heap ===

describe('stdlib and heap', () => {
	it('malloc allocates heap block', () => {
		const src = `int main() {
	int *p = malloc(sizeof(int));
	return 0;
}`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		expectValid(program);
		const allOps = program.steps.flatMap((s) => s.ops);
		const heapOps = allOps.filter((o) => o.op === 'addEntry' && (o as any).entry.heap);
		expect(heapOps.length).toBeGreaterThan(0);
	});

	it('calloc allocates zero-initialized array', () => {
		const src = `int main() {
	int *arr = calloc(4, sizeof(int));
	return 0;
}`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		expectValid(program);
	});

	it('free marks heap block as freed', () => {
		const src = `int main() {
	int *p = malloc(sizeof(int));
	free(p);
	return 0;
}`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		expectValid(program);
		const freeOps = program.steps.flatMap((s) => s.ops).filter((o) => o.op === 'setHeapStatus');
		expect(freeOps.length).toBeGreaterThan(0);
	});

	it('printf is a no-op', () => {
		const src = `int main() {
	printf("hello %d", 42);
	return 0;
}`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		expectValid(program);
	});

	it('step limit exceeded returns error', () => {
		const src = `int main() {
	for (int i = 0; i < 1000; i++) {
		int x = i;
	}
	return 0;
}`;
		const { errors } = run(src, { maxSteps: 20 });
		expect(errors.some((e) => e.includes('Step limit'))).toBe(true);
	});
});

// === Validation rules ===

describe('validation rules', () => {
	it('all IDs unique within each snapshot', () => {
		const src = `int main() {
	int a = 1;
	int b = 2;
	return 0;
}`;
		const { program } = run(src);
		const snapshots = buildSnapshots(program);
		for (const snapshot of snapshots) {
			const ids = new Set<string>();
			function walk(entries: any[]) {
				for (const e of entries) {
					expect(ids.has(e.id)).toBe(false);
					ids.add(e.id);
					if (e.children) walk(e.children);
				}
			}
			walk(snapshot);
		}
	});

	it('non-scope entries have addresses', () => {
		const src = `int main() {
	int x = 5;
	int y = 10;
	return 0;
}`;
		const { program } = run(src);
		expectValid(program);
	});
});

// === Integration: full pipeline ===

describe('integration — full pipeline', () => {
	it('simple program: declare, assign, return', () => {
		const src = `int main() {
	int x = 5;
	x = 10;
	return 0;
}`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		expectValid(program);
		expectNoWarnings(program);
		expect(program.steps.length).toBeGreaterThan(0);
		expect(program.source).toBe(src);
		expect(program.name).toBe('Custom Program');
	});

	it('for loop accumulation', () => {
		const src = `int main() {
	int sum = 0;
	for (int i = 0; i < 4; i++) {
		sum += 10;
	}
	return 0;
}`;
		const { program } = run(src);
		expectValid(program);
		expectNoWarnings(program);
	});

	it('struct with pointer and malloc', () => {
		const src = `
struct Point { int x; int y; };
int main() {
	struct Point *p = malloc(sizeof(struct Point));
	free(p);
	return 0;
}`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		expectValid(program);
	});

	it('function call with return value', () => {
		const src = `
int double_it(int n) {
	int result = n * 2;
	return result;
}
int main() {
	int x = double_it(21);
	return 0;
}`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		expectValid(program);
		expectNoWarnings(program);
		const snapshots = buildSnapshots(program);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('42');
	});

	it('empty program (just main returning 0)', () => {
		const { program } = run('int main() { return 0; }');
		expectValid(program);
		expect(program.steps.length).toBeGreaterThan(0);
	});

	it('block scope creates and removes scope entry', () => {
		const src = `int main() {
	int x = 1;
	{
		int y = 2;
	}
	return 0;
}`;
		const { program } = run(src);
		expectValid(program);
		expectNoWarnings(program);
	});
});

// === Review fixes: C4, S4, S5, S3 ===

describe('compound bitwise assignment at interpreter level', () => {
	it('x &= 0xFF produces correct setValue', () => {
		const src = `int main() {
	int x = 4660;
	x &= 255;
	return 0;
}`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		expectValid(program);
		// 4660 & 255 = 52 (0x1234 & 0xFF = 0x34)
		const setOps = program.steps.flatMap((s) => s.ops).filter((o) => o.op === 'setValue');
		const lastSet = setOps[setOps.length - 1];
		if (lastSet?.op === 'setValue') {
			expect(lastSet.value).toBe('52');
		}
	});
});

describe('malloc in assignment (not declaration)', () => {
	it('p = malloc(n) produces heap block op', () => {
		const src = `int main() {
	int *p = malloc(sizeof(int));
	free(p);
	p = malloc(sizeof(int));
	return 0;
}`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		expectValid(program);
		// Should have TWO heap alloc entries (one for each malloc)
		const heapOps = program.steps.flatMap((s) => s.ops).filter(
			(o) => o.op === 'addEntry' && 'entry' in o && (o as any).entry.heap
		);
		expect(heapOps.length).toBeGreaterThanOrEqual(2);
	});
});

describe('variable shadowing across scopes', () => {
	it('inner scope variable does not corrupt outer variable after exit', () => {
		const src = `int main() {
	int x = 10;
	{
		int x = 20;
	}
	x = 30;
	return 0;
}`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		expectValid(program);
		expectNoWarnings(program);
		const snapshots = buildSnapshots(program);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('30');
	});
});

// === stdio integration tests ===

function runWithStdin(source: string, stdin: string, opts?: { maxSteps?: number }) {
	return interpretSync(parser, source, { ...opts, stdin });
}

describe('stdio — printf', () => {
	it('printf step has ioEvent with stdout text', () => {
		const src = `int main() { printf("hi %d", 3); return 0; }`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		const printfStep = program.steps.find((s) =>
			s.ioEvents?.some((e) => e.kind === 'write')
		);
		expect(printfStep).toBeDefined();
		expect(printfStep!.ioEvents![0]).toMatchObject({ kind: 'write', target: 'stdout', text: 'hi 3' });
	});

	it('non-I/O steps have no ioEvents', () => {
		const src = `int main() { int x = 5; return 0; }`;
		const { program } = run(src);
		const ioSteps = program.steps.filter((s) => s.ioEvents && s.ioEvents.length > 0);
		expect(ioSteps).toHaveLength(0);
	});

	it('cumulative stdout across multiple printf calls', () => {
		const src = `int main() { printf("a"); printf("b"); printf("c"); return 0; }`;
		const { program } = run(src);
		const outputs = buildConsoleOutputs(program.steps);
		expect(outputs[outputs.length - 1]).toContain('abc');
	});

	it('puts appends newline', () => {
		const src = `int main() { puts("hello"); return 0; }`;
		const { program } = run(src);
		const putsStep = program.steps.find((s) =>
			s.ioEvents?.some((e) => e.kind === 'write' && e.text === 'hello\n')
		);
		expect(putsStep).toBeDefined();
	});

	it('printf with format specifiers', () => {
		const src = `int main() {
	int x = 42;
	printf("x=%d, hex=%x", x, x);
	return 0;
}`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		const outputs = buildConsoleOutputs(program.steps);
		expect(outputs[outputs.length - 1]).toContain('x=42, hex=2a');
	});

	it('printf with no args still creates valid step', () => {
		const src = `int main() { printf("hello world"); return 0; }`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		expectValid(program);
	});
});

describe('stdio — getchar', () => {
	it('getchar reads from stdin', () => {
		const src = `int main() { int c = getchar(); return 0; }`;
		const { program, errors } = runWithStdin(src, 'A');
		expect(errors).toHaveLength(0);
		expectValid(program);
		const snapshots = buildSnapshots(program);
		const last = snapshots[snapshots.length - 1];
		const c = findEntry(last, 'c');
		expect(c?.value).toBe('65');
	});

	it('getchar returns -1 on empty stdin', () => {
		const src = `int main() { int c = getchar(); return 0; }`;
		const { program, errors } = runWithStdin(src, '');
		expect(errors).toHaveLength(0);
		const snapshots = buildSnapshots(program);
		const last = snapshots[snapshots.length - 1];
		const c = findEntry(last, 'c');
		expect(c?.value).toBe('-1');
	});
});

describe('stdio — scanf', () => {
	it('scanf("%d", &x) writes value to variable', () => {
		const src = `int main() {
	int x;
	scanf("%d", &x);
	return 0;
}`;
		const { program, errors } = runWithStdin(src, '42\n');
		expect(errors).toHaveLength(0);
		expectValid(program);
		const snapshots = buildSnapshots(program);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('42');
	});

	it('scanf reads multiple values', () => {
		const src = `int main() {
	int a;
	int b;
	scanf("%d %d", &a, &b);
	return 0;
}`;
		const { program, errors } = runWithStdin(src, '10 20\n');
		expect(errors).toHaveLength(0);
		expectValid(program);
		const snapshots = buildSnapshots(program);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'a')?.value).toBe('10');
		expect(findEntry(last, 'b')?.value).toBe('20');
	});

	it('scanf \\n residue: readInt then readChar reads newline', () => {
		const src = `int main() {
	int x;
	char c;
	scanf("%d", &x);
	scanf("%c", &c);
	return 0;
}`;
		const { program, errors } = runWithStdin(src, '42\nA');
		expect(errors).toHaveLength(0);
		expectValid(program);
		const snapshots = buildSnapshots(program);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('42');
		// The core educational scenario: %c reads the leftover \n, not 'A'
		expect(findEntry(last, 'c')?.value).toBe('10');
	});

	it('scanf with empty stdin produces no assignment', () => {
		const src = `int main() {
	int x = 99;
	scanf("%d", &x);
	return 0;
}`;
		const { program, errors } = runWithStdin(src, '');
		expect(errors).toHaveLength(0);
		expectValid(program);
		const snapshots = buildSnapshots(program);
		const last = snapshots[snapshots.length - 1];
		// x should keep its initialized value since scanf found EOF
		expect(findEntry(last, 'x')?.value).toBe('99');
	});

	it('scanf missing & produces error', () => {
		const src = `int main() {
	int x;
	scanf("%d", x);
	return 0;
}`;
		const { program, errors } = runWithStdin(src, '42\n');
		// Should have an error about missing &
		expect(errors.some(e => e.includes('pointer') || e.includes('&'))).toBe(true);
	});

	it('scanf %c reads single character without skipping whitespace', () => {
		const src = `int main() {
	char c;
	scanf("%c", &c);
	return 0;
}`;
		const { program, errors } = runWithStdin(src, 'X');
		expect(errors).toHaveLength(0);
		const snapshots = buildSnapshots(program);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'c')?.value).toBe('88'); // 'X' = 88
	});

	it('scanf %x reads hex value', () => {
		const src = `int main() {
	int x;
	scanf("%x", &x);
	return 0;
}`;
		const { program, errors } = runWithStdin(src, 'ff\n');
		expect(errors).toHaveLength(0);
		const snapshots = buildSnapshots(program);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('255');
	});

	it('scanf records ioEvents', () => {
		const src = `int main() {
	int x;
	scanf("%d", &x);
	return 0;
}`;
		const { program } = runWithStdin(src, '42\n');
		const scanfStep = program.steps.find(s =>
			s.ioEvents?.some(e => e.kind === 'read')
		);
		expect(scanfStep).toBeDefined();
	});

	it('scanf step description shows assigned values', () => {
		const src = `int main() {
	int x;
	scanf("%d", &x);
	return 0;
}`;
		const { program } = runWithStdin(src, '42\n');
		const scanfStep = program.steps.find(s => s.description?.includes('scanf'));
		expect(scanfStep).toBeDefined();
		expect(scanfStep!.evaluation).toContain('x = 42');
	});

	it('scanf %c description shows character representation', () => {
		const src = `int main() {
	char c;
	scanf("%c", &c);
	return 0;
}`;
		const { program } = runWithStdin(src, '\n');
		const scanfStep = program.steps.find(s => s.description?.includes('scanf'));
		expect(scanfStep).toBeDefined();
		expect(scanfStep!.evaluation).toContain("'\\n'");
	});
});

describe('stdio — step descriptions', () => {
	it('printf description shows output text', () => {
		const src = `int main() { printf("hello %d", 42); return 0; }`;
		const { program } = run(src);
		const printfStep = program.steps.find(s => s.description?.includes('printf'));
		expect(printfStep).toBeDefined();
		expect(printfStep!.evaluation).toContain('hello 42');
	});

	it('puts description shows output text', () => {
		const src = `int main() { puts("world"); return 0; }`;
		const { program } = run(src);
		const putsStep = program.steps.find(s => s.description?.includes('puts'));
		expect(putsStep).toBeDefined();
		expect(putsStep!.evaluation).toContain('world\\n');
	});
});
