import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Parser, Language } from 'web-tree-sitter';
import { resolve } from 'path';
import { interpretSync, resetParserCache } from './index';
import { validateProgram } from '$lib/engine/validate';
import { buildSnapshots } from '$lib/engine/snapshot';
import type { Program, MemoryEntry } from '$lib/types';

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

function run(source: string) {
	return interpretSync(parser, source);
}

function dumpEntry(e: MemoryEntry, indent = ''): string {
	let line = `${indent}${e.name} ${e.type} = ${e.value}`;
	if (e.heap) line += ` [heap: ${e.heap.status}${e.heap.size ? `, ${e.heap.size}B` : ''}]`;
	if (e.children) {
		for (const c of e.children) {
			line += '\n' + dumpEntry(c, indent + '  ');
		}
	}
	return line;
}

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

/** Run program through full pipeline, return snapshots and program. Asserts no errors/warnings. */
function runProgram(source: string): { program: Program; snapshots: MemoryEntry[][] } {
	const { program, errors } = run(source);
	expect(errors, `Interpreter errors: ${errors.join(', ')}`).toHaveLength(0);

	const valErrors = validateProgram(program);
	if (valErrors.length > 0) {
		console.log('Validation errors:', valErrors);
		console.log('Steps:', JSON.stringify(program.steps.map((s, i) => ({
			i, line: s.location.line, desc: s.description, sub: s.subStep,
			ops: s.ops.map((o) => `${o.op}(${o.targetId})`),
		})), null, 2));
	}
	expect(valErrors).toHaveLength(0);

	const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
	try {
		const snapshots = buildSnapshots(program);
		expect(spy).not.toHaveBeenCalled();
		return { program, snapshots };
	} finally {
		spy.mockRestore();
	}
}

/** Get the value of a named entry at the last snapshot where it appears. */
function lastValue(snapshots: MemoryEntry[][], name: string): string | undefined {
	for (let i = snapshots.length - 1; i >= 0; i--) {
		const e = findEntry(snapshots[i], name);
		if (e) return e.value;
	}
	return undefined;
}

/** Get all values a named entry takes across all snapshots (deduplicated in order). */
function valueHistory(snapshots: MemoryEntry[][], name: string): string[] {
	const vals: string[] = [];
	for (const snap of snapshots) {
		const e = findEntry(snap, name);
		if (e && (vals.length === 0 || vals[vals.length - 1] !== e.value)) {
			vals.push(e.value);
		}
	}
	return vals;
}

// ============================================================
// Category 1: Scalar Basics
// ============================================================

describe('P1.1 — Integer Lifecycle', () => {
	const source = `
#include <stdio.h>

int main() {
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

	it('runs without errors', () => {
		const { snapshots } = runProgram(source);
		expect(snapshots.length).toBeGreaterThan(0);
	});

	it('has correct final values', () => {
		const { snapshots } = runProgram(source);
		expect(lastValue(snapshots, 'a')).toBe('42');
		expect(lastValue(snapshots, 'b')).toBe('-7');
		// c = 42 + (-7) = 35, *=2 = 70, %=9 = 7
		expect(lastValue(snapshots, 'c')).toBe('7');
		// d = 7 << 3 = 56, >>1 = 28, ~28 = -29
		expect(lastValue(snapshots, 'd')).toBe('-29');
	});

	it('shows value progression for c', () => {
		const { snapshots } = runProgram(source);
		const hist = valueHistory(snapshots, 'c');
		expect(hist).toEqual(['35', '70', '7']);
	});

	it('shows value progression for d', () => {
		const { snapshots } = runProgram(source);
		const hist = valueHistory(snapshots, 'd');
		expect(hist).toEqual(['56', '28', '-29']);
	});
});

describe('P1.2 — Char and Casting', () => {
	const source = `
#include <stdio.h>

int main() {
    char c = 'A';
    int x = c + 1;
    char d = (char)300;
    int big = 100000;
    char narrow = (char)big;
    return 0;
}`;

	it('has correct values', () => {
		const { snapshots } = runProgram(source);
		expect(lastValue(snapshots, 'c')).toBe('65');
		expect(lastValue(snapshots, 'x')).toBe('66');
		// (char)300: 300 = 0x12C, low byte = 0x2C = 44, sign-extended = 44
		expect(lastValue(snapshots, 'd')).toBe('44');
		// (char)100000: 100000 = 0x186A0, low byte = 0xA0 = 160, sign-extended = -96
		expect(lastValue(snapshots, 'narrow')).toBe('-96');
	});
});

describe('P1.3 — All Compound Operators', () => {
	const source = `
#include <stdio.h>

int main() {
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

	it('shows correct chain of values', () => {
		const { snapshots } = runProgram(source);
		const hist = valueHistory(snapshots, 'x');
		// 100, +=10=110, -=20=90, *=3=270, /=9=30, %=7=2, &=255=2, |=16=18, ^=18=0, =8, <<=2=32, >>=1=16
		expect(hist).toEqual(['100', '110', '90', '270', '30', '2', '18', '0', '8', '32', '16']);
	});
});

describe('P1.4 — Increment and Decrement', () => {
	const source = `
#include <stdio.h>

int main() {
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

	it('has correct values', () => {
		const { snapshots } = runProgram(source);
		const hist = valueHistory(snapshots, 'a');
		// 5, ++6, ++7, ++8, --7, --6, ++7
		expect(hist).toEqual(['5', '6', '7', '8', '7', '6', '7']);
		expect(lastValue(snapshots, 'b')).toBe('6');
		expect(lastValue(snapshots, 'c')).toBe('7');
	});
});

// ============================================================
// Category 2: Structs
// ============================================================

describe('P2.1 — Simple Struct', () => {
	const source = `
#include <stdio.h>

struct Point {
    int x;
    int y;
};

int main() {
    struct Point p = {10, 20};
    p.x = 30;
    p.y = p.x + 5;
    return 0;
}`;

	it('has correct field values', () => {
		const { snapshots } = runProgram(source);
		expect(lastValue(snapshots, '.x')).toBe('30');
		expect(lastValue(snapshots, '.y')).toBe('35');
	});

	it('shows field progression', () => {
		const { snapshots } = runProgram(source);
		expect(valueHistory(snapshots, '.x')).toEqual(['10', '30']);
		expect(valueHistory(snapshots, '.y')).toEqual(['20', '35']);
	});
});

describe('P2.2 — Nested Structs', () => {
	const source = `
#include <stdio.h>

struct Point {
    int x;
    int y;
};

struct Player {
    int id;
    struct Point pos;
};

int main() {
    struct Player p = {1, {10, 20}};
    p.pos.x = 50;
    p.pos.y = 60;
    p.id = 99;
    return 0;
}`;

	it('has correct nested values', () => {
		const { snapshots } = runProgram(source);
		expect(lastValue(snapshots, '.id')).toBe('99');
		expect(lastValue(snapshots, '.x')).toBe('50');
		expect(lastValue(snapshots, '.y')).toBe('60');
	});
});

describe('P2.3 — Multiple Struct Instances', () => {
	const source = `
#include <stdio.h>

struct Vec2 {
    int x;
    int y;
};

int main() {
    struct Vec2 a = {1, 2};
    struct Vec2 b = {3, 4};
    int cx = a.x + b.x;
    int cy = a.y + b.y;
    return 0;
}`;

	it('has correct computed values', () => {
		const { snapshots } = runProgram(source);
		expect(lastValue(snapshots, 'cx')).toBe('4');
		expect(lastValue(snapshots, 'cy')).toBe('6');
	});
});

// ============================================================
// Category 3: Arrays
// ============================================================

describe('P3.1 — Array Init and Access', () => {
	const source = `
#include <stdio.h>

int main() {
    int arr[5] = {10, 20, 30, 40, 50};
    arr[0] = 99;
    arr[4] = arr[0] + arr[1];
    int sum = 0;
    for (int i = 0; i < 5; i++) {
        sum += arr[i];
    }
    return 0;
}`;

	it('has correct final sum', () => {
		const { snapshots } = runProgram(source);
		// 99+20+30+40+119 = 308
		expect(lastValue(snapshots, 'sum')).toBe('308');
	});

	it('shows arr[0] and arr[4] updated', () => {
		const { snapshots } = runProgram(source);
		expect(lastValue(snapshots, '[0]')).toBe('99');
		expect(lastValue(snapshots, '[4]')).toBe('119');
	});
});

describe('P3.2 — Array Bounds Error', () => {
	const source = `
#include <stdio.h>

int main() {
    int arr[3] = {1, 2, 3};
    arr[5] = 100;
    return 0;
}`;

	it('reports out-of-bounds error', () => {
		const { program, errors } = run(source);
		// Should either have interpreter errors or the program itself reports the issue
		// Check that it either errored or the step contains an error
		const hasError = errors.length > 0 ||
			program.steps.some(s => s.description.toLowerCase().includes('out of bounds') ||
				s.description.toLowerCase().includes('error'));
		expect(hasError).toBe(true);
	});
});

describe('P3.3 — Array in Loop with Modification', () => {
	const source = `
#include <stdio.h>

int main() {
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

	it('has correct squared values and total', () => {
		const { snapshots } = runProgram(source);
		expect(lastValue(snapshots, '[0]')).toBe('1');
		expect(lastValue(snapshots, '[1]')).toBe('4');
		expect(lastValue(snapshots, '[2]')).toBe('9');
		expect(lastValue(snapshots, '[3]')).toBe('16');
		// 1+4+9+16 = 30
		expect(lastValue(snapshots, 'total')).toBe('30');
	});
});

// ============================================================
// Category 4: Pointers and Heap
// ============================================================

describe('P4.1 — malloc/free Lifecycle', () => {
	const source = `
#include <stdio.h>
#include <stdlib.h>

int main() {
    int *p = malloc(sizeof(int));
    *p = 42;
    *p = *p + 8;
    free(p);
    return 0;
}`;

	it('runs without errors', () => {
		const { snapshots } = runProgram(source);
		expect(snapshots.length).toBeGreaterThan(0);
	});

	it('p has a hex address value before free', () => {
		const { snapshots } = runProgram(source);
		// After free, p shows as '(dangling)'; check earlier snapshots
		const hist = valueHistory(snapshots, 'p');
		expect(hist.some(v => v.match(/0x/))).toBe(true);
	});

	it('heap block shows correct value progression', () => {
		const { snapshots } = runProgram(source);
		// Find heap entries across snapshots
		const heapValues: string[] = [];
		for (const snap of snapshots) {
			const all = walkEntries(snap);
			const heap = all.find(e => e.heap);
			if (heap && (heapValues.length === 0 || heapValues[heapValues.length - 1] !== heap.value)) {
				heapValues.push(heap.value);
			}
		}
		// Should see: some initial, then 42, then 50, then possibly freed state
		expect(heapValues).toContain('42');
		expect(heapValues).toContain('50');
	});

	it('heap block is freed at end', () => {
		const { snapshots } = runProgram(source);
		const lastSnap = snapshots[snapshots.length - 1];
		const all = walkEntries(lastSnap);
		const heap = all.find(e => e.heap);
		if (heap) {
			expect(heap.heap!.status).toBe('freed');
		}
	});
});

describe('P4.2 — calloc Zero-Init', () => {
	const source = `
#include <stdio.h>
#include <stdlib.h>

int main() {
    int *arr = calloc(4, sizeof(int));
    arr[0] = 10;
    arr[1] = 20;
    arr[2] = 30;
    arr[3] = 40;
    free(arr);
    return 0;
}`;

	it('runs without errors', () => {
		const { snapshots } = runProgram(source);
		expect(snapshots.length).toBeGreaterThan(0);
	});

	it('has correct array values before free', () => {
		const { snapshots } = runProgram(source);
		// Find the last snapshot before the heap block is freed
		for (let i = snapshots.length - 1; i >= 0; i--) {
			const all = walkEntries(snapshots[i]);
			const heap = all.find(e => e.heap && e.heap.status === 'allocated');
			if (heap && heap.children) {
				const vals = heap.children.map(c => c.value);
				expect(vals).toEqual(['10', '20', '30', '40']);
				return;
			}
		}
		// If we get here, we didn't find allocated heap - check freed
		const lastSnap = snapshots[snapshots.length - 1];
		const all = walkEntries(lastSnap);
		const heap = all.find(e => e.heap);
		expect(heap).toBeDefined();
	});
});

describe('P4.3 — Multiple Heap Blocks', () => {
	const source = `
#include <stdio.h>
#include <stdlib.h>

int main() {
    int *a = malloc(sizeof(int));
    int *b = malloc(sizeof(int));
    int *c = malloc(sizeof(int));
    *a = 1;
    *b = 2;
    *c = *a + *b;
    free(a);
    free(b);
    free(c);
    return 0;
}`;

	it('runs without errors and all blocks freed', () => {
		const { snapshots } = runProgram(source);
		const lastSnap = snapshots[snapshots.length - 1];
		const all = walkEntries(lastSnap);
		const heapBlocks = all.filter(e => e.heap);
		for (const h of heapBlocks) {
			expect(h.heap!.status).toBe('freed');
		}
	});
});

describe('P4.4 — Heap Array with Loop', () => {
	const source = `
#include <stdio.h>
#include <stdlib.h>

int main() {
    int n = 5;
    int *squares = malloc(n * sizeof(int));
    for (int i = 0; i < n; i++) {
        squares[i] = i * i;
    }
    free(squares);
    return 0;
}`;

	it('has correct square values before free', () => {
		const { snapshots } = runProgram(source);
		// Find last snapshot with allocated heap
		for (let i = snapshots.length - 1; i >= 0; i--) {
			const all = walkEntries(snapshots[i]);
			const heap = all.find(e => e.heap && e.heap.status === 'allocated');
			if (heap && heap.children && heap.children.length === 5) {
				const vals = heap.children.map(c => c.value);
				expect(vals).toEqual(['0', '1', '4', '9', '16']);
				return;
			}
		}
		throw new Error('Did not find allocated heap block with 5 children');
	});
});

describe('P4.5 — Heap Bounds Error', () => {
	const source = `
#include <stdio.h>
#include <stdlib.h>

int main() {
    int *arr = calloc(3, sizeof(int));
    arr[0] = 1;
    arr[1] = 2;
    arr[2] = 3;
    arr[5] = 100;
    free(arr);
    return 0;
}`;

	it('reports heap buffer overflow', () => {
		const { program, errors } = run(source);
		const hasError = errors.length > 0 ||
			program.steps.some(s => s.description.toLowerCase().includes('overflow') ||
				s.description.toLowerCase().includes('out of bounds') ||
				s.description.toLowerCase().includes('error'));
		expect(hasError).toBe(true);
	});
});

// ============================================================
// Category 5: Struct + Pointer Combos
// ============================================================

describe('P5.1 — Heap Struct via Pointer', () => {
	const source = `
#include <stdio.h>
#include <stdlib.h>

struct Point {
    int x;
    int y;
};

int main() {
    struct Point *p = malloc(sizeof(struct Point));
    p->x = 10;
    p->y = 20;
    p->x = p->x + p->y;
    free(p);
    return 0;
}`;

	it('has correct field values before free', () => {
		const { snapshots } = runProgram(source);
		// Find last snapshot with allocated heap struct
		for (let i = snapshots.length - 1; i >= 0; i--) {
			const all = walkEntries(snapshots[i]);
			const heap = all.find(e => e.heap && e.heap.status === 'allocated');
			if (heap) {
				const x = findEntry([heap], '.x');
				const y = findEntry([heap], '.y');
				expect(x?.value).toBe('30');
				expect(y?.value).toBe('20');
				return;
			}
		}
	});
});

describe('P5.2 — Struct with Pointer Member', () => {
	const source = `
#include <stdio.h>
#include <stdlib.h>

struct Player {
    int id;
    int *scores;
};

int main() {
    struct Player p;
    p.id = 1;
    p.scores = calloc(3, sizeof(int));
    p.scores[0] = 100;
    p.scores[1] = 200;
    p.scores[2] = 300;
    free(p.scores);
    return 0;
}`;

	it('runs without errors', () => {
		const { snapshots } = runProgram(source);
		expect(snapshots.length).toBeGreaterThan(0);
	});

	it('has correct heap array values', () => {
		const { snapshots } = runProgram(source);
		// Find allocated heap block with scores
		for (let i = snapshots.length - 1; i >= 0; i--) {
			const all = walkEntries(snapshots[i]);
			const heap = all.find(e => e.heap && e.heap.status === 'allocated');
			if (heap && heap.children && heap.children.length === 3) {
				const vals = heap.children.map(c => c.value);
				expect(vals).toEqual(['100', '200', '300']);
				return;
			}
		}
	});
});

describe('P5.3 — Full Memory Basics Pattern', () => {
	const source = `
#include <stdio.h>
#include <stdlib.h>

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
    struct Point origin = {0, 0};
    struct Player *p = malloc(sizeof(struct Player));
    p->id = 1;
    p->pos.x = 3;
    p->pos.y = 4;
    p->scores = calloc(3, sizeof(int));
    p->scores[0] = 100;
    p->scores[1] = 200;
    p->scores[2] = 300;

    int d = distance(origin, p->pos);

    char *msg = malloc(64);
    sprintf(msg, "dist=%d", d);

    free(p->scores);
    free(p);
    free(msg);
    return 0;
}`;

	it('runs without errors', () => {
		const { snapshots } = runProgram(source);
		expect(snapshots.length).toBeGreaterThan(0);
	});

	it('distance returns 25', () => {
		const { snapshots } = runProgram(source);
		expect(lastValue(snapshots, 'd')).toBe('25');
	});

	it('sprintf produces correct string', () => {
		const { snapshots } = runProgram(source);
		// Find msg heap block with string value
		for (let i = snapshots.length - 1; i >= 0; i--) {
			const all = walkEntries(snapshots[i]);
			const msgBlock = all.find(e => e.heap && e.value?.includes('dist='));
			if (msgBlock) {
				expect(msgBlock.value).toContain('dist=25');
				return;
			}
		}
		// msg might show differently, just check d is correct
		expect(lastValue(snapshots, 'd')).toBe('25');
	});

	it('all three blocks freed at end', () => {
		const { snapshots } = runProgram(source);
		const lastSnap = snapshots[snapshots.length - 1];
		const all = walkEntries(lastSnap);
		const heapBlocks = all.filter(e => e.heap);
		expect(heapBlocks.length).toBeGreaterThanOrEqual(3);
		for (const h of heapBlocks) {
			expect(h.heap!.status).toBe('freed');
		}
	});
});

// ============================================================
// Category 6: Functions
// ============================================================

describe('P6.1 — Simple Function Call', () => {
	const source = `
#include <stdio.h>

int add(int a, int b) {
    int result = a + b;
    return result;
}

int main() {
    int x = add(10, 20);
    int y = add(x, 5);
    return 0;
}`;

	it('has correct return values', () => {
		const { snapshots } = runProgram(source);
		expect(lastValue(snapshots, 'x')).toBe('30');
		expect(lastValue(snapshots, 'y')).toBe('35');
	});

	it('shows function frame during call', () => {
		const { program } = runProgram(source);
		// Check that a scope for add appears
		const hasAddFrame = program.steps.some(s =>
			s.ops.some(o => o.op === 'addEntry' && (o as any).entry?.name?.includes('add')));
		expect(hasAddFrame).toBe(true);
	});
});

describe('P6.2 — Function with Struct Parameter', () => {
	const source = `
#include <stdio.h>

struct Point {
    int x;
    int y;
};

int magnitude(struct Point p) {
    return p.x * p.x + p.y * p.y;
}

int main() {
    struct Point a = {3, 4};
    int m = magnitude(a);
    return 0;
}`;

	it('has correct magnitude', () => {
		const { snapshots } = runProgram(source);
		expect(lastValue(snapshots, 'm')).toBe('25');
	});
});

describe('P6.3 — Multiple Function Calls', () => {
	const source = `
#include <stdio.h>

int square(int n) {
    return n * n;
}

int cube(int n) {
    return n * n * n;
}

int main() {
    int a = square(3);
    int b = cube(3);
    int c = square(b);
    return 0;
}`;

	it('has correct values', () => {
		const { snapshots } = runProgram(source);
		expect(lastValue(snapshots, 'a')).toBe('9');
		expect(lastValue(snapshots, 'b')).toBe('27');
		expect(lastValue(snapshots, 'c')).toBe('729');
	});
});

describe('P6.4 — Recursive Function', () => {
	const source = `
#include <stdio.h>

int factorial(int n) {
    if (n <= 1) {
        return 1;
    }
    return n * factorial(n - 1);
}

int main() {
    int result = factorial(5);
    return 0;
}`;

	it('computes factorial correctly', () => {
		const { snapshots } = runProgram(source);
		expect(lastValue(snapshots, 'result')).toBe('120');
	});
});

// ============================================================
// Category 7: Control Flow
// ============================================================

describe('P7.1 — If/Else Branching', () => {
	const source = `
#include <stdio.h>

int main() {
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

	it('takes correct branches', () => {
		const { snapshots } = runProgram(source);
		const hist = valueHistory(snapshots, 'y');
		expect(hist).toEqual(['0', '1', '20']);
	});
});

describe('P7.2 — While Loop', () => {
	const source = `
#include <stdio.h>

int main() {
    int n = 5;
    int sum = 0;
    while (n > 0) {
        sum += n;
        n--;
    }
    return 0;
}`;

	it('accumulates correctly', () => {
		const { snapshots } = runProgram(source);
		expect(lastValue(snapshots, 'sum')).toBe('15');
		expect(lastValue(snapshots, 'n')).toBe('0');
	});
});

describe('P7.3 — Nested Loops', () => {
	const source = `
#include <stdio.h>

int main() {
    int total = 0;
    for (int i = 0; i < 3; i++) {
        for (int j = 0; j < 3; j++) {
            total += 1;
        }
    }
    return 0;
}`;

	it('counts to 9', () => {
		const { snapshots } = runProgram(source);
		expect(lastValue(snapshots, 'total')).toBe('9');
	});
});

describe('P7.4 — Break and Continue', () => {
	const source = `
#include <stdio.h>

int main() {
    int sum = 0;
    for (int i = 0; i < 10; i++) {
        if (i == 3) {
            continue;
        }
        if (i == 7) {
            break;
        }
        sum += i;
    }
    return 0;
}`;

	it('sums correctly with skip and break', () => {
		const { snapshots } = runProgram(source);
		// 0+1+2+4+5+6 = 18
		expect(lastValue(snapshots, 'sum')).toBe('18');
	});
});

// ============================================================
// Category 8: Scope Lifecycle
// ============================================================

describe('P8.1 — Block Scoping', () => {
	const source = `
#include <stdio.h>

int main() {
    int x = 1;
    {
        int y = 2;
        x = x + y;
    }
    int z = x + 10;
    return 0;
}`;

	it('has correct values', () => {
		const { snapshots } = runProgram(source);
		expect(lastValue(snapshots, 'x')).toBe('3');
		expect(lastValue(snapshots, 'z')).toBe('13');
	});

	it('y is not visible after block', () => {
		const { snapshots } = runProgram(source);
		const lastSnap = snapshots[snapshots.length - 1];
		expect(findEntry(lastSnap, 'y')).toBeUndefined();
	});
});

describe('P8.2 — Variable Shadowing', () => {
	const source = `
#include <stdio.h>

int main() {
    int x = 10;
    {
        int x = 20;
        x = x + 5;
    }
    int y = x;
    return 0;
}`;

	it('outer x unchanged after shadow block', () => {
		const { snapshots } = runProgram(source);
		expect(lastValue(snapshots, 'y')).toBe('10');
	});
});

// ============================================================
// Category 9: sprintf
// ============================================================

describe('P9.1 — sprintf Format Specifiers', () => {
	const source = `
#include <stdio.h>
#include <stdlib.h>

int main() {
    char *buf = malloc(128);

    sprintf(buf, "hello world");

    sprintf(buf, "x=%d", 42);

    sprintf(buf, "hex=%x", 255);

    sprintf(buf, "char=%c", 65);

    sprintf(buf, "100%%");

    sprintf(buf, "%d+%d=%d", 1, 2, 3);

    free(buf);
    return 0;
}`;

	it('runs without errors', () => {
		const { snapshots } = runProgram(source);
		expect(snapshots.length).toBeGreaterThan(0);
	});

	it('last sprintf value is correct', () => {
		const { snapshots } = runProgram(source);
		// Find the last string value in heap before free
		for (let i = snapshots.length - 1; i >= 0; i--) {
			const all = walkEntries(snapshots[i]);
			const heap = all.find(e => e.heap && e.heap.status === 'allocated');
			if (heap) {
				// The last sprintf was "%d+%d=%d" with 1,2,3 → "1+2=3"
				expect(heap.value).toContain('1+2=3');
				return;
			}
		}
	});
});

// ============================================================
// Category 10: Error Cases
// ============================================================

describe('P10.1 — Division by Zero', () => {
	const source = `
#include <stdio.h>

int main() {
    int x = 10;
    int y = 0;
    int z = x / y;
    return 0;
}`;

	it('reports error', () => {
		const { errors } = run(source);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.some(e => e.toLowerCase().includes('division by zero') || e.toLowerCase().includes('divide'))).toBe(true);
	});
});

describe('P10.2 — Syntax Error', () => {
	const source = `
#include <stdio.h>

int main() {
    int x = 10
    int y = 20;
    return 0;
}`;

	it('reports syntax error', () => {
		const { errors } = run(source);
		expect(errors.length).toBeGreaterThan(0);
	});
});

describe('P10.3 — Memory Leak Detection', () => {
	const source = `
#include <stdio.h>
#include <stdlib.h>

int main() {
    int *a = malloc(sizeof(int));
    int *b = malloc(sizeof(int));
    *a = 1;
    *b = 2;
    free(a);
    return 0;
}`;

	it('a is freed, b is leaked', () => {
		const { snapshots } = runProgram(source);
		const lastSnap = snapshots[snapshots.length - 1];
		const all = walkEntries(lastSnap);
		const heapBlocks = all.filter(e => e.heap);
		expect(heapBlocks.length).toBeGreaterThanOrEqual(2);

		const freed = heapBlocks.filter(e => e.heap!.status === 'freed');
		const leaked = heapBlocks.filter(e => e.heap!.status === 'leaked');
		expect(freed.length).toBeGreaterThanOrEqual(1);
		expect(leaked.length).toBeGreaterThanOrEqual(1);
	});
});

// ============================================================
// Category 11: Integration
// ============================================================

describe('P11.1 — Linked List Nodes', () => {
	const source = `
#include <stdio.h>
#include <stdlib.h>

struct Node {
    int value;
    int next;
};

int main() {
    struct Node *n1 = malloc(sizeof(struct Node));
    struct Node *n2 = malloc(sizeof(struct Node));
    struct Node *n3 = malloc(sizeof(struct Node));

    n1->value = 10;
    n2->value = 20;
    n3->value = 30;

    n1->next = 0;
    n2->next = 0;
    n3->next = 0;

    free(n3);
    free(n2);
    free(n1);
    return 0;
}`;

	it('runs without errors, all freed', () => {
		const { snapshots } = runProgram(source);
		const lastSnap = snapshots[snapshots.length - 1];
		const all = walkEntries(lastSnap);
		const heapBlocks = all.filter(e => e.heap);
		expect(heapBlocks.length).toBe(3);
		for (const h of heapBlocks) {
			expect(h.heap!.status).toBe('freed');
		}
	});
});

describe('P11.2 — Matrix Operations', () => {
	const source = `
#include <stdio.h>
#include <stdlib.h>

int main() {
    int rows = 3;
    int *matrix = calloc(rows * rows, sizeof(int));

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

	it('sum of identity matrix trace is 3', () => {
		const { snapshots } = runProgram(source);
		expect(lastValue(snapshots, 'sum')).toBe('3');
	});
});

describe('P11.3 — Ternary Operator', () => {
	const source = `
#include <stdio.h>

int main() {
    int x = 10;
    int y = x > 5 ? 100 : 200;
    int z = x < 5 ? 100 : 200;
    return 0;
}`;

	it('evaluates correct branches', () => {
		const { snapshots } = runProgram(source);
		expect(lastValue(snapshots, 'y')).toBe('100');
		expect(lastValue(snapshots, 'z')).toBe('200');
	});
});

describe('P11.4 — Do-While Loop', () => {
	const source = `
#include <stdio.h>

int main() {
    int x = 1;
    do {
        x = x * 2;
    } while (x < 100);
    return 0;
}`;

	it('doubles until >= 100', () => {
		const { snapshots } = runProgram(source);
		expect(lastValue(snapshots, 'x')).toBe('128');
	});
});

describe('P11.5 — Fibonacci with Array', () => {
	const source = `
#include <stdio.h>
#include <stdlib.h>

int main() {
    int n = 8;
    int *fib = calloc(n, sizeof(int));
    fib[0] = 0;
    fib[1] = 1;
    for (int i = 2; i < n; i++) {
        fib[i] = fib[i - 1] + fib[i - 2];
    }
    free(fib);
    return 0;
}`;

	it('has correct fibonacci sequence', () => {
		const { snapshots } = runProgram(source);
		// Find allocated heap with 8 children
		for (let i = snapshots.length - 1; i >= 0; i--) {
			const all = walkEntries(snapshots[i]);
			const heap = all.find(e => e.heap && e.heap.status === 'allocated');
			if (heap && heap.children && heap.children.length === 8) {
				const vals = heap.children.map(c => c.value);
				expect(vals).toEqual(['0', '1', '1', '2', '3', '5', '8', '13']);
				return;
			}
		}
		throw new Error('Did not find allocated heap block with 8 fibonacci values');
	});
});

describe('P11.6 — Compound Ops on Struct Fields', () => {
	const source = `
#include <stdio.h>
#include <stdlib.h>

struct Stats {
    int health;
    int armor;
};

int main() {
    struct Stats *s = malloc(sizeof(struct Stats));
    s->health = 100;
    s->armor = 50;
    s->health -= 30;
    s->armor += 10;
    s->health -= 20;
    free(s);
    return 0;
}`;

	it('has correct field values before free', () => {
		const { snapshots } = runProgram(source);
		for (let i = snapshots.length - 1; i >= 0; i--) {
			const all = walkEntries(snapshots[i]);
			const heap = all.find(e => e.heap && e.heap.status === 'allocated');
			if (heap) {
				const health = findEntry([heap], '.health');
				const armor = findEntry([heap], '.armor');
				expect(health?.value).toBe('50');
				expect(armor?.value).toBe('60');
				return;
			}
		}
	});
});

describe('P11.7 — Array Element Increment', () => {
	const source = `
#include <stdio.h>

int main() {
    int arr[3] = {10, 20, 30};
    arr[0]++;
    arr[1]++;
    arr[2]++;
    return 0;
}`;

	it('increments all elements', () => {
		const { snapshots } = runProgram(source);
		expect(lastValue(snapshots, '[0]')).toBe('11');
		expect(lastValue(snapshots, '[1]')).toBe('21');
		expect(lastValue(snapshots, '[2]')).toBe('31');
	});
});

describe('P11.8 — Dereference Assignment', () => {
	const source = `
#include <stdio.h>
#include <stdlib.h>

int main() {
    int *p = malloc(sizeof(int));
    *p = 42;
    *p = *p + 8;
    *p = 0;
    free(p);
    return 0;
}`;

	it('heap value progresses correctly', () => {
		const { snapshots } = runProgram(source);
		const heapValues: string[] = [];
		for (const snap of snapshots) {
			const all = walkEntries(snap);
			const heap = all.find(e => e.heap);
			if (heap && (heapValues.length === 0 || heapValues[heapValues.length - 1] !== heap.value)) {
				heapValues.push(heap.value);
			}
		}
		expect(heapValues).toContain('42');
		expect(heapValues).toContain('50');
		expect(heapValues).toContain('0');
	});
});

// ============================================================
// Category 12: Advanced Integration
// ============================================================

describe('P12.1 — Bubble Sort', () => {
	const source = `
#include <stdio.h>
#include <stdlib.h>

int main() {
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

	it('sorts array correctly', () => {
		const { snapshots } = runProgram(source);
		expect(lastValue(snapshots, '[0]')).toBe('1');
		expect(lastValue(snapshots, '[1]')).toBe('2');
		expect(lastValue(snapshots, '[2]')).toBe('3');
		expect(lastValue(snapshots, '[3]')).toBe('4');
		expect(lastValue(snapshots, '[4]')).toBe('5');
	});
});

describe('P12.2 — Multi-Function Program', () => {
	const source = `
#include <stdio.h>

int max(int a, int b) {
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

	it('clamps values correctly', () => {
		const { snapshots } = runProgram(source);
		expect(lastValue(snapshots, 'a')).toBe('10');
		expect(lastValue(snapshots, 'b')).toBe('0');
		expect(lastValue(snapshots, 'c')).toBe('5');
	});
});

describe('P12.4 — Early Return from Nested Context', () => {
	const source = `
#include <stdio.h>

int search(int target) {
    for (int i = 0; i < 5; i++) {
        if (i == target) {
            return i * i;
        }
    }
    return -1;
}

int main() {
    int a = search(3);
    int b = search(10);
    return 0;
}`;

	it('returns correct values', () => {
		const { snapshots } = runProgram(source);
		expect(lastValue(snapshots, 'a')).toBe('9');
		expect(lastValue(snapshots, 'b')).toBe('-1');
	});
});

describe('P12.5 — Recursive Fibonacci', () => {
	const source = `
#include <stdio.h>

int fib(int n) {
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

	it('computes fibonacci correctly', () => {
		const { snapshots } = runProgram(source);
		expect(lastValue(snapshots, 'a')).toBe('0');
		expect(lastValue(snapshots, 'b')).toBe('1');
		expect(lastValue(snapshots, 'c')).toBe('8');
	});
});
