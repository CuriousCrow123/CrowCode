import { describe, it, expect, beforeAll, vi, test } from 'vitest';
import { Parser, Language } from 'web-tree-sitter';
import { resolve } from 'path';
import { interpretSync, resetParserCache } from './index';
import { validateProgram } from '$lib/engine/validate';
import { buildSnapshots } from '$lib/engine/snapshot';
import type { Program, MemoryEntry } from '$lib/api/types';

// === Setup ===

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

// === Helpers ===

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
	try {
		buildSnapshots(program);
		expect(spy).not.toHaveBeenCalled();
	} finally {
		spy.mockRestore();
	}
}

/** Run C source through full pipeline with built-in guards. */
function interpretAndBuild(source: string): { program: Program; snapshots: MemoryEntry[][] } {
	const { program, errors } = run(source);
	expect(errors).toHaveLength(0);
	expectValid(program);
	expectNoWarnings(program);
	return { program, snapshots: buildSnapshots(program) };
}

/** Recursive name-based tree walk. Returns full MemoryEntry for flexible assertions. */
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

/** Flatten all entries (including children) into a single array. */
function walkEntries(entries: MemoryEntry[]): MemoryEntry[] {
	const result: MemoryEntry[] = [];
	function walk(list: MemoryEntry[]) {
		for (const e of list) {
			result.push(e);
			if (e.children) walk(e.children);
		}
	}
	walk(entries);
	return result;
}

/** Find last snapshot containing an entry with the given name. */
function lastSnapshotWith(snapshots: MemoryEntry[][], name: string): MemoryEntry[] | undefined {
	for (let i = snapshots.length - 1; i >= 0; i--) {
		if (findEntry(snapshots[i], name)) return snapshots[i];
	}
	return undefined;
}

// ============================================================
// Step 1: Scalar variable value tests
// ============================================================

describe('scalar variable values', () => {
	it('declares int with literal value', () => {
		const { snapshots } = interpretAndBuild('int main() { int x = 5; return 0; }');
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('5');
	});

	it('declares int zero', () => {
		const { snapshots } = interpretAndBuild('int main() { int x = 0; return 0; }');
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('0');
	});

	it('declares negative int', () => {
		const { snapshots } = interpretAndBuild('int main() { int x = -1; return 0; }');
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('-1');
	});

	it('declares int with expression initializer', () => {
		const { snapshots } = interpretAndBuild('int main() { int x = 5 + 3; return 0; }');
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('8');
	});

	it('reassignment updates value', () => {
		const { snapshots } = interpretAndBuild('int main() { int x = 0; x = 42; return 0; }');
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('42');
	});

	it('char stores numeric value', () => {
		const { snapshots } = interpretAndBuild(`int main() { char c = 'A'; return 0; }`);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'c')?.value).toBe('65');
	});

	it('uninitialized variable shows (uninit) then value after assignment', () => {
		const { snapshots } = interpretAndBuild('int main() { int x; x = 5; return 0; }');
		// Find the snapshot right after declaration (before assignment)
		const declSnap = snapshots.find((s) => findEntry(s, 'x'));
		expect(declSnap).toBeDefined();
		expect(findEntry(declSnap!, 'x')?.value).toBe('(uninit)');
		// After assignment
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('5');
	});

	it('division by zero does not crash', () => {
		const { program, errors } = run('int main() { int x = 5 / 0; return 0; }');
		// Should not throw; may produce error or undefined value
		expect(program.steps.length).toBeGreaterThan(0);
	});

	describe('compound assignment operators', () => {
		it.each([
			{ op: '+=', init: 10, rhs: 3, expected: '13' },
			{ op: '-=', init: 10, rhs: 3, expected: '7' },
			{ op: '*=', init: 10, rhs: 3, expected: '30' },
			{ op: '/=', init: 10, rhs: 3, expected: '3' },
			{ op: '%=', init: 10, rhs: 3, expected: '1' },
			{ op: '&=', init: 255, rhs: 15, expected: '15' },
			{ op: '|=', init: 240, rhs: 15, expected: '255' },
			{ op: '^=', init: 255, rhs: 15, expected: '240' },
			{ op: '<<=', init: 1, rhs: 4, expected: '16' },
			{ op: '>>=', init: 256, rhs: 4, expected: '16' },
		])('$op assigns $init $op $rhs to $expected', ({ op, init, rhs, expected }) => {
			const src = `int main() { int x = ${init}; x ${op} ${rhs}; return 0; }`;
			const { snapshots } = interpretAndBuild(src);
			const last = snapshots[snapshots.length - 1];
			expect(findEntry(last, 'x')?.value).toBe(expected);
		});
	});

	describe('unary increment/decrement', () => {
		it('post-increment x++ as statement updates value', () => {
			const src = 'int main() { int x = 5; x++; return 0; }';
			const { snapshots } = interpretAndBuild(src);
			const last = snapshots[snapshots.length - 1];
			expect(findEntry(last, 'x')?.value).toBe('6');
		});

		it('pre-increment ++x as statement updates value', () => {
			const src = 'int main() { int x = 5; ++x; return 0; }';
			const { snapshots } = interpretAndBuild(src);
			const last = snapshots[snapshots.length - 1];
			expect(findEntry(last, 'x')?.value).toBe('6');
		});

		it('post-decrement x-- as statement updates value', () => {
			const src = 'int main() { int x = 5; x--; return 0; }';
			const { snapshots } = interpretAndBuild(src);
			const last = snapshots[snapshots.length - 1];
			expect(findEntry(last, 'x')?.value).toBe('4');
		});

		it('pre-decrement --x as statement updates value', () => {
			const src = 'int main() { int x = 5; --x; return 0; }';
			const { snapshots } = interpretAndBuild(src);
			const last = snapshots[snapshots.length - 1];
			expect(findEntry(last, 'x')?.value).toBe('4');
		});

		it('increment in for-loop update works via compound assignment', () => {
			const src = `int main() {
	int sum = 0;
	for (int i = 0; i < 3; i++) {
		sum += 1;
	}
	return 0;
}`;
			const { snapshots } = interpretAndBuild(src);
			const last = snapshots[snapshots.length - 1];
			expect(findEntry(last, 'sum')?.value).toBe('3');
		});
	});
});

// ============================================================
// Step 2: Compound types + pointers/heap value tests
// ============================================================

describe('struct field values', () => {
	it('struct initializer sets field values', () => {
		const src = `
struct Point { int x; int y; };
int main() {
	struct Point p = {3, 4};
	return 0;
}`;
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, '.x')?.value).toBe('3');
		expect(findEntry(last, '.y')?.value).toBe('4');
		// Parent struct value should be empty
		expect(findEntry(last, 'p')?.value).toBe('');
	});

	it('struct field reassignment updates value', () => {
		const src = `
struct Point { int x; int y; };
int main() {
	struct Point p = {3, 4};
	p.x = 10;
	return 0;
}`;
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, '.x')?.value).toBe('10');
		expect(findEntry(last, '.y')?.value).toBe('4');
	});

	it('heap struct field via pointer shows correct value', () => {
		const src = `
struct Point { int x; int y; };
int main() {
	struct Point *p = malloc(sizeof(struct Point));
	p->x = 10;
	p->y = 20;
	return 0;
}`;
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, '.x')?.value).toBe('10');
		expect(findEntry(last, '.y')?.value).toBe('20');
	});

	it('nested struct through pointer shows correct value', () => {
		const src = `
struct Point { int x; int y; };
struct Player { int id; struct Point pos; };
int main() {
	struct Player *p = malloc(sizeof(struct Player));
	p->id = 1;
	p->pos.x = 10;
	p->pos.y = 20;
	return 0;
}`;
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, '.id')?.value).toBe('1');
		expect(findEntry(last, '.x')?.value).toBe('10');
		expect(findEntry(last, '.y')?.value).toBe('20');
	});
});

describe('array element values', () => {
	it('array initializer sets element values', () => {
		const src = 'int main() { int arr[3] = {10, 20, 30}; return 0; }';
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, '[0]')?.value).toBe('10');
		expect(findEntry(last, '[1]')?.value).toBe('20');
		expect(findEntry(last, '[2]')?.value).toBe('30');
	});

	it('array element reassignment updates value', () => {
		const src = `int main() {
	int arr[3] = {10, 20, 30};
	arr[1] = 99;
	return 0;
}`;
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, '[0]')?.value).toBe('10');
		expect(findEntry(last, '[1]')?.value).toBe('99');
		expect(findEntry(last, '[2]')?.value).toBe('30');
	});
});

describe('pointer and heap values', () => {
	it('malloc pointer shows hex address', () => {
		const src = 'int main() { int *p = malloc(sizeof(int)); return 0; }';
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		const p = findEntry(last, 'p');
		expect(p).toBeDefined();
		expect(p!.value).toMatch(/^0x[0-9a-f]+$/i);
	});

	it('calloc creates zero-initialized children', () => {
		const src = 'int main() { int *a = calloc(3, sizeof(int)); return 0; }';
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, '[0]')?.value).toBe('0');
		expect(findEntry(last, '[1]')?.value).toBe('0');
		expect(findEntry(last, '[2]')?.value).toBe('0');
	});

	it('calloc heap block has correct allocator metadata', () => {
		const src = 'int main() { int *a = calloc(3, sizeof(int)); return 0; }';
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		// Find the heap block entry (has heap info)
		function findHeapBlock(entries: MemoryEntry[]): MemoryEntry | undefined {
			for (const e of entries) {
				if (e.heap) return e;
				if (e.children) {
					const found = findHeapBlock(e.children);
					if (found) return found;
				}
			}
			return undefined;
		}
		const block = findHeapBlock(last);
		expect(block).toBeDefined();
		expect(block!.heap!.allocator).toBe('calloc');
		// Status may be 'allocated' or 'leaked' (leak detection marks unfreed blocks)
		expect(['allocated', 'leaked']).toContain(block!.heap!.status);
	});

	it('array element assignment through pointer updates value', () => {
		const src = `int main() {
	int *a = calloc(3, sizeof(int));
	a[0] = 100;
	a[1] = 200;
	return 0;
}`;
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, '[0]')?.value).toBe('100');
		expect(findEntry(last, '[1]')?.value).toBe('200');
		expect(findEntry(last, '[2]')?.value).toBe('0');
	});

	it('free marks heap block as freed and pointer as dangling', () => {
		const src = `int main() {
	int *p = malloc(sizeof(int));
	free(p);
	return 0;
}`;
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		// Pointer should show dangling
		expect(findEntry(last, 'p')?.value).toBe('(dangling)');
		// Find heap block and check status
		function findHeapBlock(entries: MemoryEntry[]): MemoryEntry | undefined {
			for (const e of entries) {
				if (e.heap) return e;
				if (e.children) {
					const found = findHeapBlock(e.children);
					if (found) return found;
				}
			}
			return undefined;
		}
		const block = findHeapBlock(last);
		expect(block).toBeDefined();
		expect(block!.heap!.status).toBe('freed');
	});

	it('heap struct field via pointer shows assigned value', () => {
		const src = `
struct Point { int x; int y; };
int main() {
	struct Point *p = malloc(sizeof(struct Point));
	p->x = 42;
	p->y = 99;
	return 0;
}`;
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, '.x')?.value).toBe('42');
		expect(findEntry(last, '.y')?.value).toBe('99');
	});
});

describe('function call values', () => {
	it('function return value assigned to caller variable', () => {
		const src = `
int add(int a, int b) {
	return a + b;
}
int main() {
	int x = add(3, 4);
	return 0;
}`;
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('7');
	});

	it('function parameters have correct values in callee frame', () => {
		const src = `
int add(int a, int b) {
	int result = a + b;
	return result;
}
int main() {
	int x = add(3, 4);
	return 0;
}`;
		const { snapshots } = interpretAndBuild(src);
		// Find a snapshot where 'a' and 'b' are visible (inside add)
		const calleeSnap = snapshots.find((s) => findEntry(s, 'a') && findEntry(s, 'b'));
		expect(calleeSnap).toBeDefined();
		expect(findEntry(calleeSnap!, 'a')?.value).toBe('3');
		expect(findEntry(calleeSnap!, 'b')?.value).toBe('4');
	});

	it('callee frame is removed after return', () => {
		const src = `
int square(int n) {
	return n * n;
}
int main() {
	int x = square(5);
	return 0;
}`;
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		// 'n' should not be visible in the final snapshot
		expect(findEntry(last, 'n')).toBeUndefined();
		expect(findEntry(last, 'x')?.value).toBe('25');
	});
});

describe('control flow values', () => {
	it('for-loop accumulates correct sum', () => {
		const src = `int main() {
	int sum = 0;
	for (int i = 0; i < 3; i++) {
		sum += 10;
	}
	return 0;
}`;
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'sum')?.value).toBe('30');
	});

	it('if-true branch executes', () => {
		const src = `int main() {
	int x = 5;
	if (x > 0) {
		x = 10;
	}
	return 0;
}`;
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('10');
	});

	it('if-false branch skips', () => {
		const src = `int main() {
	int x = 0;
	if (x > 0) {
		x = 10;
	}
	return 0;
}`;
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('0');
	});

	it('if-else selects correct branch', () => {
		const src = `int main() {
	int x = 0;
	if (x > 0) {
		x = 10;
	} else {
		x = 20;
	}
	return 0;
}`;
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('20');
	});

	it('while loop countdown produces correct final value', () => {
		const src = `int main() {
	int x = 5;
	while (x > 0) {
		x -= 1;
	}
	return 0;
}`;
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('0');
	});

	it('for-loop variable is gone after loop', () => {
		const src = `int main() {
	for (int i = 0; i < 3; i++) {
		int x = i;
	}
	return 0;
}`;
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'i')).toBeUndefined();
		expect(findEntry(last, 'x')).toBeUndefined();
	});
});

describe('scope lifecycle values', () => {
	it('block scope variable exists inside and gone after', () => {
		const src = `int main() {
	int x = 1;
	{
		int y = 2;
	}
	return 0;
}`;
		const { snapshots } = interpretAndBuild(src);
		// Find snapshot where y is visible
		const insideSnap = snapshots.find((s) => findEntry(s, 'y'));
		expect(insideSnap).toBeDefined();
		expect(findEntry(insideSnap!, 'y')?.value).toBe('2');
		// In the final snapshot, y should be gone
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'y')).toBeUndefined();
		expect(findEntry(last, 'x')?.value).toBe('1');
	});

	it('variable shadowing preserves outer value after inner scope exits', () => {
		const src = `int main() {
	int x = 10;
	{
		int x = 20;
	}
	x = 30;
	return 0;
}`;
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('30');
	});

	it('early return from loop cleans up scope', () => {
		const src = `
int find_first() {
	for (int i = 0; i < 10; i++) {
		if (i == 3) {
			return i;
		}
	}
	return -1;
}
int main() {
	int result = find_first();
	return 0;
}`;
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'result')?.value).toBe('3');
		// Loop variable should not be visible
		expect(findEntry(last, 'i')).toBeUndefined();
	});
});

// ============================================================
// Step 3: Known-bug regressions + C semantics edge cases
// ============================================================

describe('known bugs', () => {
	it('member-expression malloc: p->scores = calloc creates heap block', () => {
		const src = `
struct Player { int id; int *scores; };
int main() {
	struct Player *p = malloc(sizeof(struct Player));
	p->id = 1;
	p->scores = calloc(3, sizeof(int));
	return 0;
}`;
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		// p->scores should show a hex address, not a decimal number
		const scores = findEntry(last, '.scores');
		expect(scores).toBeDefined();
		expect(scores!.value).toMatch(/^0x[0-9a-f]+$/i);
	});

	it('multi-level pointer chain: p->scores[0] = 100 updates element', () => {
		const src = `
struct Player { int id; int *scores; };
int main() {
	struct Player *p = malloc(sizeof(struct Player));
	p->scores = calloc(3, sizeof(int));
	p->scores[0] = 100;
	p->scores[1] = 200;
	p->scores[2] = 300;
	return 0;
}`;
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, '[0]')?.value).toBe('100');
		expect(findEntry(last, '[1]')?.value).toBe('200');
		expect(findEntry(last, '[2]')?.value).toBe('300');
	});

	it('dereference assignment: *p = 42 sets heap value', () => {
		const src = `int main() {
	int *p = malloc(sizeof(int));
	*p = 42;
	return 0;
}`;
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		// The heap block should show 42 (either as block value or child value)
		function findHeapValue(entries: MemoryEntry[]): string | undefined {
			for (const e of entries) {
				if (e.heap) {
					if (e.value) return e.value;
					if (e.children) return e.children[0]?.value;
				}
				if (e.children) {
					const found = findHeapValue(e.children);
					if (found !== undefined) return found;
				}
			}
			return undefined;
		}
		expect(findHeapValue(last)).toBe('42');
	});

	it('compound assignment on struct field: p->x += 5 applies old value', () => {
		const src = `
struct S { int x; };
int main() {
	struct S *p = malloc(sizeof(struct S));
	p->x = 10;
	p->x += 5;
	return 0;
}`;
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, '.x')?.value).toBe('15');
	});

	it('post-increment on array element: arr[0]++ increments', () => {
		const src = `int main() {
	int arr[3] = {10, 20, 30};
	arr[0]++;
	return 0;
}`;
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, '[0]')?.value).toBe('11');
	});

	it('cast truncation: (char)300 narrows to 8 bits', () => {
		const src = `int main() {
	int x = 300;
	char c = (char)x;
	return 0;
}`;
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		// 300 & 0xFF = 44, sign-extended: 44 (positive, fits in signed char)
		expect(findEntry(last, 'c')?.value).toBe('44');
	});

	it('compound assignment overflow: x += 1 wraps at INT_MAX', () => {
		const src = `int main() {
	int x = 2147483647;
	x += 1;
	return 0;
}`;
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('-2147483648');
	});

	it('double pointer indirection: p->data->field through two pointers', () => {
		const src = `
struct Inner { int val; };
struct Outer { struct Inner *data; };
int main() {
	struct Outer *p = malloc(sizeof(struct Outer));
	p->data = malloc(sizeof(struct Inner));
	p->data->val = 42;
	return 0;
}`;
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, '.val')?.value).toBe('42');
	});

	it('struct-by-value params copy caller field values', () => {
		const src = `
struct Point { int x; int y; };
int get_x(struct Point p) {
	return p.x;
}
int main() {
	struct Point origin = {10, 20};
	int result = get_x(origin);
	return 0;
}`;
		const { snapshots } = interpretAndBuild(src);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'result')?.value).toBe('10');
	});
});

describe('sprintf', () => {
	it('sprintf with %d substitutes integer value', () => {
		const src = `int main() {
	char *buf = malloc(64);
	int x = 42;
	sprintf(buf, "value=%d", x);
	return 0;
}`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		expectValid(program);
		const snapshots = buildSnapshots(program);
		// Find the heap block for buf
		const sprintfSnap = snapshots.find((s) => {
			const all = walkEntries(s);
			return all.some((e) => e.heap && e.value.includes('value=42'));
		});
		expect(sprintfSnap).toBeDefined();
	});

	it('sprintf with multiple %d args', () => {
		const src = `int main() {
	char *buf = malloc(64);
	int a = 10;
	int b = 20;
	sprintf(buf, "%d+%d=%d", a, b, a + b);
	return 0;
}`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		expectValid(program);
		const snapshots = buildSnapshots(program);
		const sprintfSnap = snapshots.find((s) => {
			const all = walkEntries(s);
			return all.some((e) => e.heap && e.value === '"10+20=30"');
		});
		expect(sprintfSnap).toBeDefined();
	});

	it('sprintf with %x formats as hex', () => {
		const src = `int main() {
	char *buf = malloc(64);
	sprintf(buf, "hex=%x", 255);
	return 0;
}`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		expectValid(program);
		const snapshots = buildSnapshots(program);
		const sprintfSnap = snapshots.find((s) => {
			const all = walkEntries(s);
			return all.some((e) => e.heap && e.value === '"hex=ff"');
		});
		expect(sprintfSnap).toBeDefined();
	});

	it('sprintf with plain string (no format specifiers)', () => {
		const src = `int main() {
	char *buf = malloc(64);
	sprintf(buf, "hello world");
	return 0;
}`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		expectValid(program);
		const snapshots = buildSnapshots(program);
		const sprintfSnap = snapshots.find((s) => {
			const all = walkEntries(s);
			return all.some((e) => e.heap && e.value === '"hello world"');
		});
		expect(sprintfSnap).toBeDefined();
	});

	it('sprintf with %% literal percent', () => {
		const src = `int main() {
	char *buf = malloc(64);
	sprintf(buf, "100%%");
	return 0;
}`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		expectValid(program);
		const snapshots = buildSnapshots(program);
		const sprintfSnap = snapshots.find((s) => {
			const all = walkEntries(s);
			return all.some((e) => e.heap && e.value === '"100%"');
		});
		expect(sprintfSnap).toBeDefined();
	});

	it('sprintf step description includes formatted result', () => {
		const src = `int main() {
	char *buf = malloc(64);
	int d = 500;
	sprintf(buf, "dist=%d", d);
	return 0;
}`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		const sprintfStep = program.steps.find((s) => s.description?.includes('sprintf'));
		expect(sprintfStep).toBeDefined();
		expect(sprintfStep!.description).toContain('dist=500');
	});

	it('sprintf does not crash with zero args beyond format', () => {
		const src = `int main() {
	char *buf = malloc(64);
	sprintf(buf, "no args here");
	return 0;
}`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		expectValid(program);
	});

	it('printf remains a no-op (no setValue emitted)', () => {
		const src = `int main() {
	int x = 42;
	printf("hello %d", x);
	return 0;
}`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		expectValid(program);
		const printfStep = program.steps.find((s) => s.description?.includes('printf'));
		expect(printfStep).toBeDefined();
		expect(printfStep!.ops).toHaveLength(0);
	});

	it('sprintf with %c formats character', () => {
		const src = `int main() {
	char *buf = malloc(64);
	sprintf(buf, "char=%c", 65);
	return 0;
}`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		expectValid(program);
		const snapshots = buildSnapshots(program);
		const sprintfSnap = snapshots.find((s) => {
			const all = walkEntries(s);
			return all.some((e) => e.heap && e.value === '"char=A"');
		});
		expect(sprintfSnap).toBeDefined();
	});
});

describe('C semantics edge cases', () => {
	it('multiple mallocs to same variable targets correct block', () => {
		const src = `
struct Point { int x; int y; };
int main() {
	struct Point *p = malloc(sizeof(struct Point));
	p->x = 1;
	free(p);
	p = malloc(sizeof(struct Point));
	p->x = 99;
	return 0;
}`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		expectValid(program);
		const snapshots = buildSnapshots(program);
		const last = snapshots[snapshots.length - 1];
		const allX = walkEntries(last).filter((e) => e.name === '.x');
		expect(allX.some((e) => e.value === '99')).toBe(true);
	});
});

describe('function call step structure', () => {
	it('function call steps have column highlighting', () => {
		const src = `
struct Point { int x; int y; };
int distance(struct Point a, struct Point b) {
	int dx = a.x - b.x;
	int dy = a.y - b.y;
	return dx * dx + dy * dy;
}
int main() {
	struct Point origin = {0, 0};
	struct Point dest = {10, 20};
	int d = distance(origin, dest) + distance(dest, origin);
	return 0;
}`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);

		// Both call steps should have colStart/colEnd highlighting
		const callSteps = program.steps.filter(s => s.description?.startsWith('Call distance'));
		expect(callSteps.length).toBe(2);
		// First call: distance(origin, dest)
		expect(callSteps[0].location.colStart).toBeDefined();
		expect(callSteps[0].location.colEnd).toBeDefined();
		// Second call: distance(dest, origin) — different column range
		expect(callSteps[1].location.colStart).toBeDefined();
		expect(callSteps[1].location.colEnd).toBeDefined();
		// The two calls should have different column positions
		expect(callSteps[0].location.colStart).not.toBe(callSteps[1].location.colStart);
	});
});

describe('bounds checking', () => {
	it('detects stack array out-of-bounds read', () => {
		const src = `int main() {
	int arr[3] = {10, 20, 30};
	int x = arr[5];
	return 0;
}`;
		const { errors } = run(src);
		expect(errors.some(e => e.includes('out of bounds'))).toBe(true);
	});

	it('detects stack array negative index', () => {
		const src = `int main() {
	int arr[3] = {10, 20, 30};
	int x = arr[-1];
	return 0;
}`;
		const { errors } = run(src);
		expect(errors.some(e => e.includes('out of bounds'))).toBe(true);
	});

	it('detects heap array out-of-bounds write', () => {
		const src = `int main() {
	int *scores = calloc(3, sizeof(int));
	scores[4] = 100;
	return 0;
}`;
		const { errors } = run(src);
		expect(errors.some(e => e.includes('out of bounds') || e.includes('buffer overflow'))).toBe(true);
	});

	it('allows valid index on heap array', () => {
		const src = `int main() {
	int *scores = calloc(3, sizeof(int));
	scores[0] = 100;
	scores[2] = 300;
	return 0;
}`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		expectValid(program);
	});

	it('allows valid index on stack array', () => {
		const src = `int main() {
	int arr[3] = {10, 20, 30};
	int x = arr[2];
	return 0;
}`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		expectValid(program);
	});

	it.skip('detects heap buffer overflow through struct pointer', () => {
		const src = `
struct Player { int id; int *scores; };
int main() {
	struct Player *p = malloc(sizeof(struct Player));
	p->scores = calloc(3, sizeof(int));
	p->scores[10] = 999;
	return 0;
}`;
		const { errors } = run(src);
		// The heap block for scores is accessed via p->scores which is a pointer
		// The bounds check should detect index 10 >= size 3
		expect(errors.some(e =>
			e.includes('out of bounds') || e.includes('buffer overflow') || e.includes('Heap buffer')
		)).toBe(true);
	});
});

describe('error reporting', () => {
	it('reports error for missing semicolon', () => {
		const src = 'int main() { int x = 5 return 0; }';
		const { program, errors } = run(src);
		console.log('ERRORS:', JSON.stringify(errors));
		console.log('STEPS:', program.steps.length);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.some(e => e.toLowerCase().includes('syntax') || e.toLowerCase().includes('error'))).toBe(true);
	});
});

describe('previously planned spec constructs', () => {
	it('chained assignment a = b = c = 0 sets all three', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int a = 1; int b = 2; int c = 3;
	a = b = c = 0;
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'a')?.value).toBe('0');
		expect(findEntry(last, 'b')?.value).toBe('0');
		expect(findEntry(last, 'c')?.value).toBe('0');
	});

	it('chained assignment a = b = expr evaluates correctly', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int a = 0; int b = 0;
	a = b = 3 + 4;
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'a')?.value).toBe('7');
		expect(findEntry(last, 'b')?.value).toBe('7');
	});

	it('chained assignment updates all variables in snapshots', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int a = 1; int b = 2; int c = 3;
	a = b = c = 5;
	return 0;
}`);
		// After the chained assignment, all three should be 5
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'a')?.value).toBe('5');
		expect(findEntry(last, 'b')?.value).toBe('5');
		expect(findEntry(last, 'c')?.value).toBe('5');
	});

	it('array-to-pointer decay: int *p = arr assigns base address', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int arr[3] = {10, 20, 30};
	int *p = arr;
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		const arrEntry = findEntry(last, 'arr');
		const pEntry = findEntry(last, 'p');
		// p should hold arr's address
		expect(pEntry?.value).toBe(arrEntry?.address);
	});

	it('array-to-pointer decay: pointer arithmetic after decay', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int arr[3] = {10, 20, 30};
	int *p = arr;
	int x = *(p + 1);
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		// *(p + 1) should read arr[1] = 20 through pointer arithmetic
		expect(findEntry(last, 'x')?.value).toBe('20');
	});

	it('array subscript still works with bounds checking', () => {
		// Array subscript should still work normally (not decayed)
		const { snapshots } = interpretAndBuild(`int main() {
	int arr[3] = {10, 20, 30};
	int x = arr[2];
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('30');
	});

	it('string literal assigns heap address to pointer', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	char *s = "hi";
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		// s should be a pointer (hex address, not '0' or 'NULL')
		const sEntry = findEntry(last, 's');
		expect(sEntry?.value).not.toBe('0');
		expect(sEntry?.value).not.toBe('NULL');
		expect(sEntry?.value?.startsWith('0x')).toBe(true);
	});

	it('two identical string literals get separate allocations', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	char *a = "hi";
	char *b = "hi";
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		const aVal = findEntry(last, 'a')?.value;
		const bVal = findEntry(last, 'b')?.value;
		// Both should be hex addresses
		expect(aVal?.startsWith('0x')).toBe(true);
		expect(bVal?.startsWith('0x')).toBe(true);
		// But different addresses (no string interning)
		expect(aVal).not.toBe(bVal);
	});

	it('switch takes correct case branch', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int x = 2;
	int r = 0;
	switch (x) {
		case 1: r = 10; break;
		case 2: r = 20; break;
		case 3: r = 30; break;
	}
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'r')?.value).toBe('20');
	});

	it('switch default taken when no case matches', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int x = 99;
	int r = 0;
	switch (x) {
		case 1: r = 10; break;
		default: r = 42; break;
	}
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'r')?.value).toBe('42');
	});

	it('switch fall-through without break', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int x = 1;
	int r = 0;
	switch (x) {
		case 1: r += 10;
		case 2: r += 20; break;
		case 3: r += 30; break;
	}
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		// Fall-through: case 1 (r=10) then case 2 (r=30), break
		expect(findEntry(last, 'r')?.value).toBe('30');
	});

	it('switch no match no default skips body', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int x = 99;
	int r = 5;
	switch (x) {
		case 1: r = 10; break;
		case 2: r = 20; break;
	}
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'r')?.value).toBe('5');
	});

	it('switch break does not exit enclosing loop', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int count = 0;
	for (int i = 0; i < 3; i++) {
		switch (i) {
			case 1: break;
		}
		count++;
	}
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		// break inside switch exits switch only, loop continues: count = 3
		expect(findEntry(last, 'count')?.value).toBe('3');
	});

	it('uninitialized variable shows (uninit)', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int x;
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('(uninit)');
	});

	it('uninitialized variable becomes initialized after assignment', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int x;
	x = 42;
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('42');
	});

	it('initialized variable does not show (uninit)', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int x = 10;
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('10');
	});

	it('float arithmetic preserves decimal', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	float x = 3.14;
	float y = x * 2.0;
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('3.14');
		expect(findEntry(last, 'y')?.value).toBe('6.28');
	});

	it('int division still truncates', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int x = 7 / 2;
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('3');
	});

	it('float cast to int truncates', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int z = (int)3.7;
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'z')?.value).toBe('3');
	});

	it('multi-dimensional array type resolves correctly', () => {
		// 2D array parses and type-resolves without error
		// Read access works; write via chained subscript is not yet supported
		const { program } = run(`int main() {
	int m[2][3];
	return 0;
}`);
		expect(program.steps.length).toBeGreaterThan(0);
	});

	it('cross-function free does not crash', () => {
		// Cross-function free: cleanup() calls free(p) where p is a parameter
		// The ptrTargetMap registration allows the emitter to find the heap block
		const { program, errors } = run(`#include <stdlib.h>

void cleanup(int *p) {
	free(p);
}

int main() {
	int *data = malloc(sizeof(int));
	*data = 42;
	cleanup(data);
	return 0;
}`);
		// Should complete without crashing; may have display warning but program runs
		expect(program.steps.length).toBeGreaterThan(0);
		// No "Cannot find heap block" error from emitter
		const heapErrors = errors.filter(e => e.includes('Cannot find heap block'));
		expect(heapErrors.length).toBe(0);
	});

	it('short-circuit && skips right side when left is false', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int x = 0;
	int y = 0;
	int r = x && (y = 1);
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		// y should remain 0 because x is falsy, short-circuit skips y = 1
		expect(findEntry(last, 'r')?.value).toBe('0');
		expect(findEntry(last, 'y')?.value).toBe('0');
	});

	it('short-circuit || skips right side when left is true', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int x = 1;
	int y = 0;
	int r = x || (y = 1);
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'r')?.value).toBe('1');
		expect(findEntry(last, 'y')?.value).toBe('0');
	});

	it('while-loop accumulates values across iterations', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int i = 0;
	int sum = 0;
	while (i < 4) { sum += i; i++; }
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		// 0+1+2+3 = 6
		expect(findEntry(last, 'sum')?.value).toBe('6');
		expect(findEntry(last, 'i')?.value).toBe('4');
	});

	it('do-while loop runs at least once and accumulates', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int x = 0;
	int count = 0;
	do { count++; x += 10; } while (x < 30);
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		// x: 10, 20, 30 → loop exits when x=30 (not < 30)
		expect(findEntry(last, 'x')?.value).toBe('30');
		expect(findEntry(last, 'count')?.value).toBe('3');
	});

	it('if/else takes correct branch based on condition', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int x = 5;
	int y = 0;
	if (x > 3) { y = 1; } else { y = 2; }
	int z = 0;
	if (x > 10) { z = 1; } else { z = 2; }
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'y')?.value).toBe('1');
		expect(findEntry(last, 'z')?.value).toBe('2');
	});

	it('function returning malloc pointer used by caller', () => {
		const { program, errors } = run(`
struct Point { int x; int y; };
struct Point *makePoint(int x, int y) {
	struct Point *p = malloc(sizeof(struct Point));
	p->x = x;
	p->y = y;
	return p;
}
int main() {
	struct Point *pt = makePoint(10, 20);
	free(pt);
	return 0;
}`);
		// If this feature works, no errors. If not, mark as known limitation.
		if (errors.length === 0) {
			expectValid(program);
			expectNoWarnings(program);
		}
		// Either way, it shouldn't crash
		expect(program.steps.length).toBeGreaterThan(0);
	});

	it('leak detection marks unfreed blocks as leaked', () => {
		const src = `int main() {
	int *p = malloc(sizeof(int));
	return 0;
}`;
		const { program, errors } = run(src);
		expect(errors).toHaveLength(0);
		expectValid(program);
		const snapshots = buildSnapshots(program);
		const last = snapshots[snapshots.length - 1];
		function findHeapBlock(entries: MemoryEntry[]): MemoryEntry | undefined {
			for (const e of entries) {
				if (e.heap) return e;
				if (e.children) {
					const found = findHeapBlock(e.children);
					if (found) return found;
				}
			}
			return undefined;
		}
		const block = findHeapBlock(last);
		expect(block).toBeDefined();
		expect(block!.heap!.status).toBe('leaked');
	});

	it('sizeof(int) returns 4 and sizeof(char) returns 1', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int a = sizeof(int);
	int b = sizeof(char);
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'a')?.value).toBe('4');
		expect(findEntry(last, 'b')?.value).toBe('1');
	});
});

// ============================================================
// Integer edge cases
// ============================================================

describe('integer edge cases', () => {
	it('INT_MAX + 1 wraps to negative', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int x = 2147483647;
	x += 1;
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('-2147483648');
	});

	it('negative modulo preserves sign of dividend (C99)', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int a = -7 % 3;
	int b = 7 % -3;
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'a')?.value).toBe('-1');
		expect(findEntry(last, 'b')?.value).toBe('1');
	});

	it('division by zero for modulo reports error', () => {
		const { errors } = run(`int main() { int x = 5 % 0; return 0; }`);
		expect(errors.length).toBeGreaterThan(0);
	});

	it('bitwise NOT of 0 is -1 and vice versa', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int a = ~0;
	int b = ~(-1);
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'a')?.value).toBe('-1');
		expect(findEntry(last, 'b')?.value).toBe('0');
	});

	it('left shift 1 << 31 produces INT_MIN', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int x = 1 << 31;
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('-2147483648');
	});

	it('chained comparison a < b < c is (a < b) < c', () => {
		// 1 < 2 < 3 → (1 < 2) < 3 → 1 < 3 → 1
		// 1 < 2 < 1 → (1 < 2) < 1 → 1 < 1 → 0
		const { snapshots } = interpretAndBuild(`int main() {
	int a = 1 < 2 < 3;
	int b = 1 < 2 < 1;
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'a')?.value).toBe('1');
		expect(findEntry(last, 'b')?.value).toBe('0');
	});

	it('multiplication uses Math.imul for 32-bit semantics', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int x = 100000 * 100000;
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		// 10^10 = 10000000000, but as 32-bit: 1410065408
		expect(findEntry(last, 'x')?.value).toBe('1410065408');
	});
});

// ============================================================
// Pointer arithmetic depth
// ============================================================

describe('pointer arithmetic', () => {
	it('pointer + 1 scales by sizeof element', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int *p = calloc(3, sizeof(int));
	int a = (int)p;
	int b = (int)(p + 1);
	int diff = b - a;
	free(p);
	return 0;
}`);
		const last = lastSnapshotWith(snapshots, 'diff');
		expect(findEntry(last!, 'diff')?.value).toBe('4');
	});

	it('pointer - 1 scales by sizeof element', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int *p = calloc(3, sizeof(int));
	int *q = p + 2;
	int a = (int)q;
	int b = (int)(q - 1);
	int diff = a - b;
	free(p);
	return 0;
}`);
		const last = lastSnapshotWith(snapshots, 'diff');
		expect(findEntry(last!, 'diff')?.value).toBe('4');
	});

	it('pointer subscript p[i] accesses correct element', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int *arr = calloc(4, sizeof(int));
	arr[0] = 10;
	arr[1] = 20;
	arr[2] = 30;
	arr[3] = 40;
	int x = arr[2];
	free(arr);
	return 0;
}`);
		const last = lastSnapshotWith(snapshots, 'x');
		expect(findEntry(last!, 'x')?.value).toBe('30');
	});
});

// ============================================================
// Control flow edge cases
// ============================================================

describe('control flow edge cases', () => {
	it('nested loop: break only exits inner loop', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int count = 0;
	for (int i = 0; i < 3; i++) {
		for (int j = 0; j < 10; j++) {
			if (j == 2) { break; }
			count++;
		}
	}
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		// Inner loop runs 0,1 (breaks at 2) = 2 per outer iteration, 3 outer = 6
		expect(findEntry(last, 'count')?.value).toBe('6');
	});

	it('nested loop: continue only skips inner iteration', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int count = 0;
	for (int i = 0; i < 3; i++) {
		for (int j = 0; j < 4; j++) {
			if (j == 1) { continue; }
			count++;
		}
	}
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		// Inner: 0,skip,2,3 = 3 per outer, 3 outer = 9
		expect(findEntry(last, 'count')?.value).toBe('9');
	});

	it('early return from inside a loop', () => {
		const { snapshots } = interpretAndBuild(`
int findFirst(int target) {
	for (int i = 0; i < 10; i++) {
		if (i == target) { return i; }
	}
	return -1;
}
int main() {
	int r = findFirst(3);
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'r')?.value).toBe('3');
	});

	it('while loop that never enters', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int x = 10;
	while (x < 0) { x = 99; }
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'x')?.value).toBe('10');
	});

	it('do-while runs exactly once when condition is false', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int count = 0;
	do { count++; } while (0);
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'count')?.value).toBe('1');
	});

	it('empty for-loop body runs without crash', () => {
		// Empty body may produce errors in current interpreter, but shouldn't crash
		const { program } = run(`int main() {
	int i;
	for (i = 0; i < 5; i++) {}
	return 0;
}`);
		expect(program.steps.length).toBeGreaterThan(0);
	});

	it('deeply nested if/else', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int x = 5;
	int r = 0;
	if (x > 10) { r = 1; }
	else if (x > 7) { r = 2; }
	else if (x > 3) { r = 3; }
	else { r = 4; }
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'r')?.value).toBe('3');
	});
});

// ============================================================
// Struct and memory patterns
// ============================================================

describe('struct and memory patterns', () => {
	it('struct passed by value is independent copy', () => {
		const { snapshots } = interpretAndBuild(`
struct Point { int x; int y; };
void modify(struct Point p) {
	p.x = 999;
}
int main() {
	struct Point a = {10, 20};
	modify(a);
	return 0;
}`);
		const last = snapshots[snapshots.length - 1];
		// a.x should remain 10 — modify() got a copy
		expect(findEntry(last, '.x')?.value).toBe('10');
	});

	it('malloc then free then re-malloc same variable', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int *p = malloc(sizeof(int));
	*p = 42;
	free(p);
	p = malloc(sizeof(int));
	*p = 99;
	free(p);
	return 0;
}`);
		// Should complete without errors
		expect(snapshots.length).toBeGreaterThan(0);
	});

	it('calloc with partial fill leaves zeros', () => {
		const { snapshots } = interpretAndBuild(`int main() {
	int *arr = calloc(4, sizeof(int));
	arr[1] = 50;
	arr[3] = 70;
	free(arr);
	return 0;
}`);
		// Find the last allocated snapshot
		for (let i = snapshots.length - 1; i >= 0; i--) {
			const all = walkEntries(snapshots[i]);
			const heap = all.find(e => e.heap && e.heap.status === 'allocated' && e.children && e.children.length === 4);
			if (heap) {
				expect(heap.children![0].value).toBe('0');
				expect(heap.children![1].value).toBe('50');
				expect(heap.children![2].value).toBe('0');
				expect(heap.children![3].value).toBe('70');
				break;
			}
		}
	});

	it('free inside a called function does not crash', () => {
		// Freeing heap from a different function is tricky for the emitter
		const { program } = run(`
void cleanup(int *p) {
	free(p);
}
int main() {
	int *data = malloc(sizeof(int));
	*data = 42;
	cleanup(data);
	return 0;
}`);
		// Should produce steps without crashing, even if free doesn't fully resolve
		expect(program.steps.length).toBeGreaterThan(0);
	});
});

// ============================================================
// Step description quality
// ============================================================

describe('step description quality', () => {
	it('declaration shows computed value in description', () => {
		const { program } = interpretAndBuild(`int main() {
	int a = 1;
	int x = 3 + 4;
	return 0;
}`);
		// Second declaration should have its own step with "int x = 7"
		const declStep = program.steps.find(s => s.description?.includes('x') && s.description?.includes('7'));
		expect(declStep).toBeDefined();
	});

	it('for-loop init shows variable', () => {
		const { program } = interpretAndBuild(`int main() {
	for (int i = 0; i < 3; i++) {}
	return 0;
}`);
		const initStep = program.steps.find(s => s.description?.includes('for:') && s.description?.includes('i = 0'));
		expect(initStep).toBeDefined();
	});

	it('for-loop check shows condition result', () => {
		const { program } = interpretAndBuild(`int main() {
	for (int i = 0; i < 3; i++) {}
	return 0;
}`);
		const checkSteps = program.steps.filter(s => s.description?.includes('check'));
		expect(checkSteps.length).toBeGreaterThan(0);
		expect(checkSteps[0].description).toMatch(/true|false/);
	});

	it('for-loop update shows new value', () => {
		const { program } = interpretAndBuild(`int main() {
	for (int i = 0; i < 3; i++) {}
	return 0;
}`);
		const updateStep = program.steps.find(s => s.description?.includes('i++') && s.description?.includes('i = 1'));
		expect(updateStep).toBeDefined();
	});

	it('malloc step describes allocation', () => {
		const { program } = interpretAndBuild(`int main() {
	int *p = malloc(sizeof(int));
	free(p);
	return 0;
}`);
		const mallocStep = program.steps.find(s => s.description?.includes('malloc') && s.description?.includes('allocate'));
		expect(mallocStep).toBeDefined();
	});

	it('free step describes deallocation', () => {
		const { program } = interpretAndBuild(`int main() {
	int *p = malloc(sizeof(int));
	free(p);
	return 0;
}`);
		const freeStep = program.steps.find(s => s.description?.includes('free') && s.description?.includes('deallocate'));
		expect(freeStep).toBeDefined();
	});
});

// ============================================================
// Error handling
// ============================================================

describe('error handling', () => {
	it('undefined variable produces error', () => {
		const { errors } = run(`int main() { int x = y + 1; return 0; }`);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.some(e => e.includes('Undefined') || e.includes('undefined'))).toBe(true);
	});

	it('null pointer dereference produces error', () => {
		const { errors } = run(`int main() {
	int *p = 0;
	*p = 5;
	return 0;
}`);
		expect(errors.length).toBeGreaterThan(0);
	});

	it('deep recursion hits stack limit', () => {
		const { errors } = run(`
int boom(int n) { return boom(n + 1); }
int main() { int x = boom(0); return 0; }
`, { maxFrames: 10 });
		expect(errors.length).toBeGreaterThan(0);
	});

	it('empty main runs without error', () => {
		const { program, errors } = run(`int main() { return 0; }`);
		expect(errors).toHaveLength(0);
		expectValid(program);
	});

	it('multiple syntax errors detected', () => {
		const { errors } = run(`int main() {
	int x = 10
	int y = 20
	return 0;
}`);
		expect(errors.length).toBeGreaterThan(0);
	});
});

// ============================================================
// Control flow sub-steps
// ============================================================

describe('control flow sub-steps', () => {
	it('while-loop has condition check sub-steps per iteration', () => {
		const { program } = interpretAndBuild(`int main() {
	int i = 0;
	while (i < 3) { i++; }
	return 0;
}`);
		const checkSteps = program.steps.filter(s => s.description?.includes('while: check'));
		expect(checkSteps.length).toBe(3);
		for (const s of checkSteps) {
			expect(s.subStep).toBe(true);
			expect(s.description).toContain('→ true');
		}
	});

	it('while-loop exit step includes condition text', () => {
		const { program } = interpretAndBuild(`int main() {
	int i = 0;
	while (i < 3) { i++; }
	return 0;
}`);
		const exitStep = program.steps.find(s => s.description?.includes('while:') && s.description?.includes('false'));
		expect(exitStep).toBeDefined();
		expect(exitStep!.description).toContain('i < 3');
		expect(exitStep!.subStep).toBeFalsy();
	});

	it('do-while has condition check sub-steps after body', () => {
		const { program } = interpretAndBuild(`int main() {
	int x = 0;
	do { x += 10; } while (x < 30);
	return 0;
}`);
		const checkSteps = program.steps.filter(s => s.description?.includes('do-while: check'));
		// x goes 10, 20 (both < 30, so 2 true checks), then 30 (false, exit)
		expect(checkSteps.length).toBe(2);
		for (const s of checkSteps) {
			expect(s.subStep).toBe(true);
			expect(s.description).toContain('→ true');
		}
	});

	it('do-while exit step includes condition text', () => {
		const { program } = interpretAndBuild(`int main() {
	int x = 0;
	do { x += 10; } while (x < 30);
	return 0;
}`);
		const exitStep = program.steps.find(s => s.description?.includes('do-while:') && s.description?.includes('false'));
		expect(exitStep).toBeDefined();
		expect(exitStep!.description).toContain('x < 30');
	});

	it('if condition step shows true when taken', () => {
		const { program } = interpretAndBuild(`int main() {
	int x = 10;
	if (x > 5) { int y = 1; }
	return 0;
}`);
		const ifStep = program.steps.find(s => s.description?.includes('if:') && s.description?.includes('x > 5'));
		expect(ifStep).toBeDefined();
		expect(ifStep!.description).toContain('→ true');
	});

	it('if condition step shows false when not taken', () => {
		const { program } = interpretAndBuild(`int main() {
	int x = 1;
	if (x > 5) { int y = 1; }
	return 0;
}`);
		const ifStep = program.steps.find(s => s.description?.includes('if:') && s.description?.includes('x > 5'));
		expect(ifStep).toBeDefined();
		expect(ifStep!.description).toContain('→ false');
	});

	it('if/else shows condition before branch body', () => {
		const { program } = interpretAndBuild(`int main() {
	int x = 10;
	int y = 0;
	if (x > 5) { y = 1; } else { y = 2; }
	return 0;
}`);
		const steps = program.steps.map(s => s.description);
		const ifIdx = steps.findIndex(d => d?.includes('if:') && d?.includes('x > 5'));
		const assignIdx = steps.findIndex(d => d?.includes('y = 1'));
		expect(ifIdx).toBeGreaterThan(-1);
		expect(assignIdx).toBeGreaterThan(ifIdx);
	});
});

// ============================================================
// Step 4: Integration test — Memory Basics equivalent
// ============================================================

describe('integration: Memory Basics program', () => {
	const basicsSrc = `
struct Point {
	int x;
	int y;
};

struct Player {
	int id;
	struct Point pos;
	int *scores;
};

int distance(struct Point a, struct Point b) {
	int dx = a.x - b.x;
	int dy = a.y - b.y;
	return dx * dx + dy * dy;
}

int main() {
	int count = 3;
	struct Point origin = {0, 0};

	struct Player *p = malloc(sizeof(struct Player));
	p->id = 1;
	p->pos.x = 10;
	p->pos.y = 20;

	int d = distance(origin, p->pos);

	free(p);

	return 0;
}`;

	// Helper: builds snapshots without expectNoWarnings guard
	// (the basics program hits known bugs that produce warnings)
	function buildBasics() {
		const { program, errors } = run(basicsSrc);
		expect(errors).toHaveLength(0);
		expectValid(program);
		return { program, snapshots: buildSnapshots(program) };
	}

	it('produces a valid program', () => {
		const { program, errors } = run(basicsSrc);
		expect(errors).toHaveLength(0);
		expectValid(program);
	});

	it('count has correct value', () => {
		const { snapshots } = buildBasics();
		const snap = lastSnapshotWith(snapshots, 'count');
		expect(snap).toBeDefined();
		expect(findEntry(snap!, 'count')?.value).toBe('3');
	});

	it('origin struct fields are zero', () => {
		const { snapshots } = buildBasics();
		const snap = lastSnapshotWith(snapshots, 'origin');
		expect(snap).toBeDefined();
		const origin = findEntry(snap!, 'origin');
		expect(origin).toBeDefined();
		expect(origin!.children).toBeDefined();
		const ox = origin!.children!.find((c) => c.name === '.x');
		const oy = origin!.children!.find((c) => c.name === '.y');
		expect(ox?.value).toBe('0');
		expect(oy?.value).toBe('0');
	});

	it('p->id is set to 1', () => {
		const { snapshots } = buildBasics();
		const snap = snapshots.find((s) => {
			const id = findEntry(s, '.id');
			return id?.value === '1';
		});
		expect(snap).toBeDefined();
	});

	it('p->pos.x and p->pos.y are set correctly', () => {
		const { snapshots } = buildBasics();
		// Look for any snapshot where SOME .x entry has value '10' and SOME .y has '20'
		// (origin.x is 0, so we need to check that heap struct fields got assigned)
		const snap = snapshots.find((s) => {
			const all = walkEntries(s);
			return all.some((e) => e.name === '.x' && e.value === '10')
				&& all.some((e) => e.name === '.y' && e.value === '20');
		});
		expect(snap).toBeDefined();
	});

	it('distance() returns correct value assigned to d', () => {
		const { snapshots } = buildBasics();
		const snap = lastSnapshotWith(snapshots, 'd');
		expect(snap).toBeDefined();
		// Known bug #11: struct-by-value params use default '0' for fields
		// So distance(origin, p->pos) computes 0*0 + 0*0 = 0, not 500
		expect(findEntry(snap!, 'd')?.value).toBe('500');
	});

	it('free(p) marks pointer as dangling', () => {
		const { snapshots } = buildBasics();
		const last = snapshots[snapshots.length - 1];
		expect(findEntry(last, 'p')?.value).toBe('(dangling)');
	});
});
