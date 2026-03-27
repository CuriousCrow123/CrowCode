/**
 * Snapshot regression tests.
 *
 * Capture current interpreter output structure for representative C programs.
 * Safety net during the Memory refactor — any change to step count, op types,
 * entry IDs, or address formatting will fail here.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Parser, Language } from 'web-tree-sitter';
import { resolve } from 'path';
import { interpretSync, resetParserCache } from './index';
import { validateProgram } from '$lib/engine/validate';
import { buildSnapshots } from '$lib/engine/snapshot';
import type { Program, SnapshotOp } from '$lib/types';

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

function run(source: string) {
	return interpretSync(parser, source);
}

/** Extract all addEntry ops across all steps. */
function addEntryOps(program: Program) {
	return program.steps.flatMap((s) => s.ops)
		.filter((op): op is SnapshotOp & { op: 'addEntry' } => op.op === 'addEntry');
}

/** Collect all entry IDs including nested children recursively. */
function allEntryIds(program: Program): string[] {
	const ids: string[] = [];
	for (const op of addEntryOps(program)) {
		const collect = (entry: { id: string; children?: Array<{ id: string; children?: any[] }> }) => {
			ids.push(entry.id);
			if (entry.children) {
				for (const child of entry.children) {
					collect(child);
				}
			}
		};
		collect(op.entry);
	}
	return ids;
}

// ========================================
// Program 1: Simple variable declarations and assignment
// ========================================

const SIMPLE_VARS_SRC = `
int main() {
    int x = 5;
    int y = 10;
    x = x + y;
    return 0;
}
`;

describe('snapshot: simple variables', () => {
	it('no interpreter errors', () => {
		const { errors } = run(SIMPLE_VARS_SRC);
		expect(errors).toHaveLength(0);
	});

	it('passes validation', () => {
		const { program } = run(SIMPLE_VARS_SRC);
		expect(validateProgram(program)).toHaveLength(0);
	});

	it('has expected entry IDs', () => {
		const { program } = run(SIMPLE_VARS_SRC);
		const ids = allEntryIds(program);
		expect(ids).toContain('main');
		expect(ids).toContain('heap');
		expect(ids).toContain('main-x');
		expect(ids).toContain('main-y');
	});

	it('x gets updated via setValue', () => {
		const { program } = run(SIMPLE_VARS_SRC);
		const setOps = program.steps.flatMap((s) => s.ops)
			.filter((op): op is SnapshotOp & { op: 'setValue' } => op.op === 'setValue')
			.filter((op) => op.id === 'main-x');
		expect(setOps.length).toBeGreaterThanOrEqual(1);
		expect(setOps[setOps.length - 1].value).toBe('15');
	});

	it('variables have non-empty addresses', () => {
		const { program } = run(SIMPLE_VARS_SRC);
		for (const op of addEntryOps(program)) {
			if (!op.entry.kind) {
				expect(op.entry.address).toMatch(/^0x/);
			}
		}
	});
});

// ========================================
// Program 2: For-loop with sub-steps
// ========================================

const FOR_LOOP_SRC = `
int main() {
    int sum = 0;
    for (int i = 0; i < 3; i++) {
        sum = sum + i;
    }
    return 0;
}
`;

describe('snapshot: for-loop', () => {
	it('no errors and passes validation', () => {
		const { program, errors } = run(FOR_LOOP_SRC);
		expect(errors).toHaveLength(0);
		expect(validateProgram(program)).toHaveLength(0);
	});

	it('has sub-steps for condition checks and increments', () => {
		const { program } = run(FOR_LOOP_SRC);
		const subSteps = program.steps.filter((s) => s.subStep);
		expect(subSteps.length).toBeGreaterThanOrEqual(3);
	});

	it('has for block scope', () => {
		const { program } = run(FOR_LOOP_SRC);
		const ids = allEntryIds(program);
		expect(ids.some((id) => id.startsWith('for'))).toBe(true);
	});

	it('loop variable i has setValue ops', () => {
		const { program } = run(FOR_LOOP_SRC);
		const setOps = program.steps.flatMap((s) => s.ops)
			.filter((op): op is SnapshotOp & { op: 'setValue' } => op.op === 'setValue')
			.filter((op) => op.id.endsWith('-i'));
		expect(setOps.length).toBeGreaterThanOrEqual(2);
	});

	it('for block scope is removed at exit', () => {
		const { program } = run(FOR_LOOP_SRC);
		const removeOps = program.steps.flatMap((s) => s.ops)
			.filter((op) => op.op === 'removeEntry');
		const forRemoves = removeOps.filter((op) => op.id.startsWith('for'));
		expect(forRemoves.length).toBeGreaterThanOrEqual(1);
	});
});

// ========================================
// Program 3: Malloc and free
// ========================================

const MALLOC_FREE_SRC = `
int main() {
    int *p = malloc(sizeof(int));
    *p = 42;
    free(p);
    return 0;
}
`;

describe('snapshot: malloc/free', () => {
	it('no errors', () => {
		const { errors } = run(MALLOC_FREE_SRC);
		expect(errors).toHaveLength(0);
	});

	it('has heap block and pointer variable', () => {
		const { program } = run(MALLOC_FREE_SRC);
		const ids = allEntryIds(program);
		expect(ids).toContain('heap-p');
		expect(ids).toContain('main-p');
	});

	it('has freed heap block', () => {
		const { program } = run(MALLOC_FREE_SRC);
		const freeOps = program.steps.flatMap((s) => s.ops)
			.filter((op) => op.op === 'setHeapStatus' && op.status === 'freed');
		expect(freeOps.length).toBe(1);
	});

	it('heap block has address', () => {
		const { program } = run(MALLOC_FREE_SRC);
		const heapEntries = addEntryOps(program).filter((op) => op.entry.heap);
		expect(heapEntries.length).toBe(1);
		expect(heapEntries[0].entry.address).toMatch(/^0x/);
	});
});

// ========================================
// Program 4: Leak detection
// ========================================

const LEAK_SRC = `
int main() {
    int *a = malloc(sizeof(int));
    int *b = malloc(sizeof(int));
    free(a);
    return 0;
}
`;

describe('snapshot: leak detection', () => {
	it('detects leaked block', () => {
		const { program } = run(LEAK_SRC);
		const statusOps = program.steps.flatMap((s) => s.ops)
			.filter((op): op is SnapshotOp & { op: 'setHeapStatus' } => op.op === 'setHeapStatus');
		const statuses = statusOps.map((op) => op.status);
		expect(statuses).toContain('freed');
		expect(statuses).toContain('leaked');
	});
});

// ========================================
// Program 5: Multi-function calls
// ========================================

const MULTI_FUNCTION_SRC = `
int square(int n) {
    return n * n;
}

int main() {
    int x = 5;
    int y = square(x);
    return 0;
}
`;

describe('snapshot: multi-function', () => {
	it('no errors and passes validation', () => {
		const { program, errors } = run(MULTI_FUNCTION_SRC);
		expect(errors).toHaveLength(0);
		expect(validateProgram(program)).toHaveLength(0);
	});

	it('has scope entries for main and square', () => {
		const { program } = run(MULTI_FUNCTION_SRC);
		const ids = allEntryIds(program);
		expect(ids).toContain('main');
		expect(ids).toContain('square');
	});

	it('square scope is added then removed', () => {
		const { program } = run(MULTI_FUNCTION_SRC);
		const allOps = program.steps.flatMap((s) => s.ops);
		const addSquare = allOps.find((op) => op.op === 'addEntry' && (op as any).entry.id === 'square');
		const removeSquare = allOps.find((op) => op.op === 'removeEntry' && op.id === 'square');
		expect(addSquare).toBeDefined();
		expect(removeSquare).toBeDefined();
	});

	it('parameter n appears in square scope', () => {
		const { program } = run(MULTI_FUNCTION_SRC);
		const ids = allEntryIds(program);
		expect(ids).toContain('square-n');
	});
});

// ========================================
// Program 6: While loop
// ========================================

const WHILE_LOOP_SRC = `
int main() {
    int count = 3;
    int total = 0;
    while (count > 0) {
        total = total + count;
        count = count - 1;
    }
    return 0;
}
`;

describe('snapshot: while loop', () => {
	it('no errors and passes validation', () => {
		const { program, errors } = run(WHILE_LOOP_SRC);
		expect(errors).toHaveLength(0);
		expect(validateProgram(program)).toHaveLength(0);
	});

	it('has sub-steps for condition checks', () => {
		const { program } = run(WHILE_LOOP_SRC);
		const subSteps = program.steps.filter((s) => s.subStep);
		expect(subSteps.length).toBeGreaterThanOrEqual(3);
	});

	it('total accumulates correctly', () => {
		const { program } = run(WHILE_LOOP_SRC);
		const setOps = program.steps.flatMap((s) => s.ops)
			.filter((op): op is SnapshotOp & { op: 'setValue' } => op.op === 'setValue')
			.filter((op) => op.id === 'main-total');
		// total should go 3, 5, 6
		expect(setOps.length).toBe(3);
		expect(setOps[setOps.length - 1].value).toBe('6');
	});
});

// ========================================
// Program 7: Struct on stack
// ========================================

const STRUCT_STACK_SRC = `
struct Point {
    int x;
    int y;
};

int main() {
    struct Point p = {3, 7};
    p.x = 10;
    return 0;
}
`;

describe('snapshot: struct on stack', () => {
	it('no errors and passes validation', () => {
		const { program, errors } = run(STRUCT_STACK_SRC);
		expect(errors).toHaveLength(0);
		expect(validateProgram(program)).toHaveLength(0);
	});

	it('has struct variable with children', () => {
		const { program } = run(STRUCT_STACK_SRC);
		const ids = allEntryIds(program);
		expect(ids).toContain('main-p');
		expect(ids).toContain('main-p-x');
		expect(ids).toContain('main-p-y');
	});

	it('field x gets updated', () => {
		const { program } = run(STRUCT_STACK_SRC);
		const setOps = program.steps.flatMap((s) => s.ops)
			.filter((op): op is SnapshotOp & { op: 'setValue' } => op.op === 'setValue');
		const xSet = setOps.find((op) => op.id === 'main-p-x');
		expect(xSet).toBeDefined();
		expect(xSet!.value).toBe('10');
	});
});

// ========================================
// Program 8: Big integration — structs, heap, functions, loops, branching
// ========================================

const BIG_INTEGRATION_SRC = `
struct Vec2 {
    int x;
    int y;
};

struct Entity {
    int id;
    struct Vec2 pos;
    int *scores;
    int numScores;
};

int dot(struct Vec2 a, struct Vec2 b) {
    return a.x * b.x + a.y * b.y;
}

int sumScores(int *arr, int n) {
    int total = 0;
    for (int i = 0; i < n; i++) {
        total += arr[i];
    }
    return total;
}

int main() {
    struct Entity *player = malloc(sizeof(struct Entity));
    player->id = 1;
    player->pos.x = 3;
    player->pos.y = 4;

    player->scores = calloc(4, sizeof(int));
    player->numScores = 4;

    for (int i = 0; i < 4; i++) {
        player->scores[i] = (i + 1) * 10;
    }

    struct Vec2 dir = {1, 0};
    int d = dot(player->pos, dir);

    int total = sumScores(player->scores, player->numScores);

    if (total > 50) {
        player->pos.x += d;
    } else {
        player->pos.y += d;
    }

    free(player->scores);
    free(player);
    return 0;
}
`;

describe('snapshot: big integration', () => {
	it('no interpreter errors', () => {
		const { errors } = run(BIG_INTEGRATION_SRC);
		expect(errors).toHaveLength(0);
	});

	it('passes validation', () => {
		const { program } = run(BIG_INTEGRATION_SRC);
		expect(validateProgram(program)).toHaveLength(0);
	});

	it('has all expected scopes', () => {
		const { program } = run(BIG_INTEGRATION_SRC);
		const ids = allEntryIds(program);
		expect(ids).toContain('main');
		expect(ids).toContain('dot');
		expect(ids).toContain('sumScores');
	});

	it('has heap blocks for player and scores', () => {
		const { program } = run(BIG_INTEGRATION_SRC);
		const ids = allEntryIds(program);
		expect(ids).toContain('heap-player');
		expect(ids).toContain('heap-scores');
	});

	it('has nested struct fields on heap', () => {
		const { program } = run(BIG_INTEGRATION_SRC);
		const ids = allEntryIds(program);
		expect(ids).toContain('heap-player-id');
		expect(ids).toContain('heap-player-pos');
		expect(ids).toContain('heap-player-pos-x');
		expect(ids).toContain('heap-player-pos-y');
	});

	it('scores array gets populated via loop', () => {
		const { program } = run(BIG_INTEGRATION_SRC);
		const setOps = program.steps.flatMap((s) => s.ops)
			.filter((op): op is SnapshotOp & { op: 'setValue' } => op.op === 'setValue');
		const scoreSets = setOps.filter((op) => op.id.startsWith('heap-scores-'));
		// scores[0]=10, scores[1]=20, scores[2]=30, scores[3]=40
		expect(scoreSets.length).toBeGreaterThanOrEqual(4);
	});

	it('both heap blocks are freed (no leaks)', () => {
		const { program } = run(BIG_INTEGRATION_SRC);
		const statusOps = program.steps.flatMap((s) => s.ops)
			.filter((op): op is SnapshotOp & { op: 'setHeapStatus' } => op.op === 'setHeapStatus');
		const freed = statusOps.filter((op) => op.status === 'freed');
		expect(freed.length).toBe(2);
		const leaked = statusOps.filter((op) => op.status === 'leaked');
		expect(leaked.length).toBe(0);
	});

	it('dot and sumScores scopes are created and removed', () => {
		const { program } = run(BIG_INTEGRATION_SRC);
		const allOps = program.steps.flatMap((s) => s.ops);
		for (const fn of ['dot', 'sumScores']) {
			expect(allOps.find((op) => op.op === 'addEntry' && (op as any).entry.id === fn)).toBeDefined();
			expect(allOps.find((op) => op.op === 'removeEntry' && op.id === fn)).toBeDefined();
		}
	});

	it('has sub-steps from for-loops', () => {
		const { program } = run(BIG_INTEGRATION_SRC);
		const subSteps = program.steps.filter((s) => s.subStep);
		expect(subSteps.length).toBeGreaterThanOrEqual(4);
	});
});
