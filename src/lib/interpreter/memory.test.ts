import { describe, it, expect, vi } from 'vitest';
import { Memory, formatAddress } from './memory';
import type { SnapshotOp, MemoryEntry, SourceLocation } from '$lib/api/types';
import type { ChildSpec, CType } from './types';
import { primitiveType, pointerType, arrayType, sizeOf } from './types-c';

function makeMem(): Memory {
	return new Memory('test', 'int main() {}');
}

function loc(line: number, colStart?: number, colEnd?: number): SourceLocation {
	const l: SourceLocation = { line };
	if (colStart !== undefined) l.colStart = colStart;
	if (colEnd !== undefined) l.colEnd = colEnd;
	return l;
}

function intType(): CType {
	return primitiveType('int');
}

/** Helper: push a main scope with a step (common test setup). */
function setupMain(mem: Memory): void {
	mem.beginStep(loc(1), 'Enter main()');
	mem.pushScope('main', [], { caller: '_start' });
}

/** Get all ops from all steps. */
function allOps(mem: Memory): SnapshotOp[] {
	const { program } = mem.finish();
	return program.steps.flatMap((s) => s.ops);
}

/** Get ops from a specific step index. */
function stepOps(mem: Memory, stepIndex: number): SnapshotOp[] {
	const { program } = mem.finish();
	return program.steps[stepIndex]?.ops ?? [];
}

// ========================================
// From environment.test.ts — scope/variable/heap correctness
// ========================================

describe('scope chain', () => {
	it('variable declared in inner scope shadows outer; after popScope, outer value restored (scenario 1)', () => {
		const mem = makeMem();
		setupMain(mem);
		mem.declareVariable('x', intType(), '1');

		mem.beginStep(loc(2));
		const blockId = mem.pushBlock('inner');
		mem.declareVariable('x', intType(), '2');
		expect(mem.lookupVariable('x')?.data).toBe(2);

		mem.beginStep(loc(3));
		mem.popBlock();
		expect(mem.lookupVariable('x')?.data).toBe(1);
	});

	it('popScope on empty scope chain returns gracefully (scenario 2)', () => {
		const mem = makeMem();
		mem.beginStep(loc(1));
		// No scope pushed — popScope should not throw
		mem.popScope();
	});

	it('stack addresses decrease monotonically across two declareVariable calls (scenario 3)', () => {
		const mem = makeMem();
		setupMain(mem);
		const v1 = mem.declareVariable('a', intType(), '0');
		const v2 = mem.declareVariable('b', intType(), '0');
		expect(v1.address).toBeGreaterThan(v2.address);
	});

	it('declareVariable for double type returns 8-byte aligned address (scenario 4)', () => {
		const mem = makeMem();
		setupMain(mem);
		const v = mem.declareVariable('d', primitiveType('double'), '0');
		expect(v.address % 8).toBe(0);
	});

	it('pushScope/popScope save/restore stack pointer (scenario 5)', () => {
		const mem = makeMem();
		setupMain(mem);
		const v1 = mem.declareVariable('x', intType(), '0');
		const sp1 = v1.address; // stack pointer after x

		mem.beginStep(loc(2));
		mem.pushScope('inner', []);
		mem.declareVariable('y', intType(), '0');

		mem.beginStep(loc(3));
		mem.popScope();

		// After pop, next variable should reuse freed stack range
		mem.declareVariable('z', intType(), '0');
		const z = mem.lookupVariable('z');
		// z should get an address that's at or above where y was (stack was restored)
		expect(z!.address).toBeGreaterThanOrEqual(sp1 - sizeOf(intType()));
	});
});

describe('heap management', () => {
	it('double-free returns error containing "double free" (scenario 6)', () => {
		const mem = makeMem();
		setupMain(mem);

		mem.beginStep(loc(2));
		mem.malloc(16, 'p', intType(), 'malloc', 2);
		mem.freeByAddress(mem.lookupVariable('p')?.data ?? 0);

		// First free works — now get the address from the heap block
		const ops = allOps(mem);
		// We need a fresh memory for this test
		const mem2 = makeMem();
		mem2.beginStep(loc(1));
		mem2.pushScope('main', []);
		mem2.beginStep(loc(2));
		const { address } = mem2.malloc(16, 'p', intType(), 'malloc', 2);
		const r1 = mem2.freeByAddress(address);
		expect(r1.error).toBeUndefined();
		const r2 = mem2.freeByAddress(address);
		expect(r2.error).toContain('double free');
	});

	it('free of unknown address returns error containing "invalid pointer" (scenario 7)', () => {
		const mem = makeMem();
		setupMain(mem);
		const result = mem.freeByAddress(0xDEADBEEF);
		expect(result.error).toContain('invalid pointer');
	});

	it('heap exhaustion returns error (scenario 8)', () => {
		const mem = new Memory('test', 'int main() {}', 32);
		mem.beginStep(loc(1));
		mem.pushScope('main', []);
		mem.beginStep(loc(2));
		mem.malloc(16, 'p1', intType(), 'malloc', 1);
		const result = mem.malloc(32, 'p2', intType(), 'malloc', 2);
		expect(result.error).toContain('Heap exhausted');
	});

	it('getHeapBlock returns correct size, allocator, allocSite.line (scenario 9)', () => {
		const mem = makeMem();
		setupMain(mem);
		mem.beginStep(loc(2));
		const { address } = mem.malloc(64, 'p', intType(), 'calloc', 5);
		const block = mem.getHeapBlock(address);
		expect(block?.size).toBe(64);
		expect(block?.allocator).toBe('calloc');
		expect(block?.allocSite.line).toBe(5);
		expect(block?.status).toBe('allocated');
	});
});

// ========================================
// From emitter.test.ts — op shape/ID generation
// ========================================

describe('scope operations and heap container', () => {
	it('pushScope produces addEntry with kind=scope AND heap container on first call (scenario 10)', () => {
		const mem = makeMem();
		mem.beginStep(loc(1), 'enter main');
		mem.pushScope('main', [], { caller: '_start', returnAddr: '0x00400580' });
		const { program } = mem.finish();
		const ops = program.steps[0].ops;
		expect(ops.length).toBe(2);
		expect(ops[0].op).toBe('addEntry');
		if (ops[0].op === 'addEntry') {
			expect(ops[0].entry.kind).toBe('scope');
			expect(ops[0].entry.id).toBe('main');
			expect(ops[0].parentId).toBeNull();
		}
		if (ops[1].op === 'addEntry') {
			expect(ops[1].entry.kind).toBe('heap');
			expect(ops[1].entry.id).toBe('heap');
		}
	});

	it('heap container is only added once', () => {
		const mem = makeMem();
		mem.beginStep(loc(1));
		mem.pushScope('main', []);
		mem.beginStep(loc(2));
		mem.pushScope('helper', []);
		const ops = allOps(mem);
		const heapOps = ops.filter((op) => op.op === 'addEntry' && (op as any).entry.kind === 'heap');
		expect(heapOps).toHaveLength(1);
	});
});

describe('variable operations', () => {
	it('declareVariable produces addEntry with correct id, name, type, value, address, parentId (scenario 11)', () => {
		const mem = makeMem();
		setupMain(mem);
		mem.beginStep(loc(2));
		mem.declareVariable('x', intType(), '42');
		const { program } = mem.finish();
		const addOps = program.steps[1].ops.filter((op) => op.op === 'addEntry');
		expect(addOps).toHaveLength(1);
		if (addOps[0].op === 'addEntry') {
			expect(addOps[0].entry.id).toBe('main-x');
			expect(addOps[0].entry.name).toBe('x');
			expect(addOps[0].entry.type).toBe('int');
			expect(addOps[0].entry.value).toBe('42');
			expect(addOps[0].entry.address).not.toBe('');
			expect(addOps[0].parentId).toBe('main');
		}
	});

	it('assignVariable emits setValue op with correct id and new value (scenario 12)', () => {
		const mem = makeMem();
		setupMain(mem);
		mem.declareVariable('x', intType(), '0');
		mem.beginStep(loc(2));
		mem.assignVariable('x', '42');
		const { program } = mem.finish();
		const setOps = program.steps[1].ops.filter((op) => op.op === 'setValue');
		expect(setOps).toHaveLength(1);
		if (setOps[0].op === 'setValue') {
			expect(setOps[0].id).toBe('main-x');
			expect(setOps[0].value).toBe('42');
		}
	});
});

describe('struct children', () => {
	it('nested struct children have IDs like main-player-pos-x with correct addresses (scenario 13)', () => {
		const mem = makeMem();
		setupMain(mem);
		mem.beginStep(loc(2));

		const children: ChildSpec[] = [
			{ name: 'id', displayName: '.id', type: intType(), value: '0', addressOffset: 0 },
			{
				name: 'pos', displayName: '.pos', type: intType(), value: '', addressOffset: 4,
				children: [
					{ name: 'x', displayName: '.x', type: intType(), value: '0', addressOffset: 0 },
					{ name: 'y', displayName: '.y', type: intType(), value: '0', addressOffset: 4 },
				],
			},
		];
		mem.declareVariableWithAddress('player', intType(), '', 0x1000, children);

		const { program } = mem.finish();
		const addOps = program.steps[1].ops;
		if (addOps[0].op === 'addEntry') {
			const pos = addOps[0].entry.children![1];
			expect(pos.id).toBe('main-player-pos');
			expect(pos.children).toHaveLength(2);
			expect(pos.children![0].id).toBe('main-player-pos-x');
			expect(pos.children![0].address).toBe('0x00001004');
			expect(pos.children![1].id).toBe('main-player-pos-y');
			expect(pos.children![1].address).toBe('0x00001008');
		}
	});
});

describe('block ID generation', () => {
	it('two sequential pushBlock/popBlock produce scope entries with different IDs (scenario 14)', () => {
		const mem = makeMem();
		setupMain(mem);
		mem.beginStep(loc(2));
		mem.pushBlock('for');
		mem.beginStep(loc(3));
		mem.popBlock();
		mem.beginStep(loc(4));
		mem.pushBlock('for');
		const ops = allOps(mem);
		const forOps = ops.filter((op) =>
			op.op === 'addEntry' && (op as any).entry.kind === 'scope' && (op as any).entry.name === 'for'
		);
		expect(forOps.length).toBe(2);
		if (forOps[0].op === 'addEntry' && forOps[1].op === 'addEntry') {
			expect(forOps[0].entry.id).not.toBe(forOps[1].entry.id);
		}
	});
});

describe('heap free', () => {
	it('free(pointer) produces setHeapStatus with status=freed (scenario 15)', () => {
		const mem = makeMem();
		setupMain(mem);
		mem.beginStep(loc(2));
		mem.malloc(8, 'p', intType(), 'malloc', 2);
		mem.beginStep(loc(3));
		mem.free('p');
		const { program } = mem.finish();
		const freeOps = program.steps[2].ops.filter((op) => op.op === 'setHeapStatus');
		expect(freeOps).toHaveLength(1);
		if (freeOps[0].op === 'setHeapStatus') {
			expect(freeOps[0].id).toBe('heap-p');
			expect(freeOps[0].status).toBe('freed');
		}
	});

	it('detectLeaks produces setHeapStatus with status=leaked for unfreed blocks (scenario 16)', () => {
		const mem = makeMem();
		setupMain(mem);
		mem.beginStep(loc(2));
		mem.malloc(8, 'p', intType(), 'malloc', 2);
		mem.beginStep(loc(3));
		mem.detectLeaks();
		const { program } = mem.finish();
		const leakOps = program.steps[2].ops.filter((op) => op.op === 'setHeapStatus');
		expect(leakOps).toHaveLength(1);
		if (leakOps[0].op === 'setHeapStatus') {
			expect(leakOps[0].status).toBe('leaked');
		}
	});
});

describe('scope removal', () => {
	it('popScope produces removeEntry op for the scope (scenario 17)', () => {
		const mem = makeMem();
		setupMain(mem);
		mem.beginStep(loc(2));
		mem.popScope();
		const { program } = mem.finish();
		const removeOps = program.steps[1].ops.filter((op) => op.op === 'removeEntry');
		expect(removeOps).toHaveLength(1);
		if (removeOps[0].op === 'removeEntry') {
			expect(removeOps[0].id).toBe('main');
		}
	});
});

describe('step lifecycle', () => {
	it('flushStep with no pending ops produces step with empty ops array (scenario 18)', () => {
		const mem = makeMem();
		mem.beginStep(loc(1), 'empty step');
		// No ops added
		const { program } = mem.finish();
		expect(program.steps).toHaveLength(1);
		expect(program.steps[0].ops).toHaveLength(0);
	});

	it('markSubStep sets subStep: true on current step (scenario 23)', () => {
		const mem = makeMem();
		mem.beginStep(loc(1), 'sub');
		mem.markSubStep();
		const { program } = mem.finish();
		expect(program.steps[0].subStep).toBe(true);
	});

	it('evaluation field is preserved', () => {
		const mem = makeMem();
		mem.beginStep(loc(1), 'check', '0 < 4 → true');
		const { program } = mem.finish();
		expect(program.steps[0].evaluation).toBe('0 < 4 → true');
	});
});

describe('error handling', () => {
	it('error when setValue for undeclared variable (scenario 19)', () => {
		const mem = makeMem();
		setupMain(mem);
		mem.beginStep(loc(2));
		mem.assignVariable('nonexistent', '42');
		const { errors } = mem.finish();
		expect(errors.some((e) => e.includes('Cannot resolve variable'))).toBe(true);
	});

	it('error when op emitted without active step', () => {
		const mem = makeMem();
		mem.pushScope('main', []);
		const { errors } = mem.finish();
		expect(errors.some((e) => e.includes('without active step'))).toBe(true);
	});
});

// ========================================
// New cases from review findings
// ========================================

describe('pointer shadowing (scenario 20)', () => {
	it('heapEntryByPointer is restored on scope exit', () => {
		const mem = makeMem();
		setupMain(mem);

		// Allocate heap block for 'p' in outer scope
		mem.beginStep(loc(2));
		mem.malloc(8, 'p', intType(), 'malloc', 2);
		const outerBlockId = mem.getHeapBlockId('p');
		expect(outerBlockId).toBe('heap-p');

		// Push inner scope with new 'p'
		mem.beginStep(loc(3));
		mem.pushScope('inner', []);
		mem.beginStep(loc(4));
		mem.malloc(16, 'p', intType(), 'malloc', 4);
		const innerBlockId = mem.getHeapBlockId('p');
		expect(innerBlockId).toBe('heap-p2');

		// Pop inner scope — should restore outer 'p' pointer target
		mem.beginStep(loc(5));
		mem.popScope();
		expect(mem.getHeapBlockId('p')).toBe('heap-p');
	});
});

describe('freeByBlockId (scenario 22)', () => {
	it('works for free(p->field) pattern', () => {
		const mem = makeMem();
		setupMain(mem);
		mem.beginStep(loc(2));
		mem.malloc(8, 'scores', intType(), 'malloc', 2);
		mem.beginStep(loc(3));
		mem.freeByBlockId('heap-scores');
		const { program } = mem.finish();
		const freeOps = program.steps[2].ops.filter((op) => op.op === 'setHeapStatus');
		expect(freeOps).toHaveLength(1);
		if (freeOps[0].op === 'setHeapStatus') {
			expect(freeOps[0].id).toBe('heap-scores');
			expect(freeOps[0].status).toBe('freed');
		}
	});
});

describe('formatAddress (scenario 24)', () => {
	it('formats 0x100 to 0x00000100 — zero-padded to 8 hex digits', () => {
		expect(formatAddress(0x100)).toBe('0x00000100');
	});

	it('formats zero', () => {
		expect(formatAddress(0)).toBe('0x00000000');
	});

	it('formats typical stack address', () => {
		expect(formatAddress(0x7ffc0060)).toBe('0x7ffc0060');
	});
});

describe('path resolution through pointers', () => {
	it('resolves pointer → heap block path', () => {
		const mem = makeMem();
		setupMain(mem);
		mem.beginStep(loc(2));
		mem.malloc(8, 'p', intType(), 'malloc', 1, [
			{ name: 'x', displayName: '.x', type: intType(), value: '0', addressOffset: 0 },
		]);

		const blockId = mem.resolvePointerPath(['p', 'x']);
		expect(blockId).toBe('heap-p-x');
	});

	it('resolves nested struct path through pointer', () => {
		const mem = makeMem();
		setupMain(mem);
		mem.beginStep(loc(2));
		mem.malloc(16, 'p', intType(), 'malloc', 1, [
			{
				name: 'pos', displayName: '.pos', type: intType(), value: '', addressOffset: 4,
				children: [
					{ name: 'x', displayName: '.x', type: intType(), value: '0', addressOffset: 0 },
				],
			},
		]);

		expect(mem.resolvePointerPath(['p', 'pos', 'x'])).toBe('heap-p-pos-x');
	});
});

describe('function table', () => {
	it('defines and retrieves function', () => {
		const mem = makeMem();
		const fn = {
			type: 'function_definition' as const,
			name: 'add',
			returnType: { base: 'int', pointer: 0 },
			params: [],
			body: { type: 'compound_statement' as const, children: [], line: 1 },
			line: 1,
		};
		mem.defineFunction('add', fn);
		expect(mem.getFunction('add')).toBe(fn);
	});

	it('getFunctionIndex returns index > 0 for defined function', () => {
		const mem = makeMem();
		const fn = {
			type: 'function_definition' as const,
			name: 'add',
			returnType: { base: 'int', pointer: 0 },
			params: [],
			body: { type: 'compound_statement' as const, children: [], line: 1 },
			line: 1,
		};
		mem.defineFunction('add', fn);
		expect(mem.getFunctionIndex('add')).toBeGreaterThan(0);
	});

	it('getFunctionByIndex round-trips', () => {
		const mem = makeMem();
		const fn = {
			type: 'function_definition' as const,
			name: 'add',
			returnType: { base: 'int', pointer: 0 },
			params: [],
			body: { type: 'compound_statement' as const, children: [], line: 1 },
			line: 1,
		};
		mem.defineFunction('add', fn);
		const idx = mem.getFunctionIndex('add');
		const result = mem.getFunctionByIndex(idx);
		expect(result?.name).toBe('add');
		expect(result?.node).toBe(fn);
	});

	it('returns undefined/0 for unknown function', () => {
		const mem = makeMem();
		expect(mem.getFunction('nope')).toBeUndefined();
		expect(mem.getFunctionIndex('nope')).toBe(0);
		expect(mem.getFunctionByIndex(999)).toBeUndefined();
	});
});

describe('parameter handling', () => {
	it('pushScope with params creates scope + param variables', () => {
		const mem = makeMem();
		mem.beginStep(loc(1));
		mem.pushScope('distance', [
			{ name: 'a', type: intType(), value: '0' },
			{ name: 'b', type: intType(), value: '0' },
		], { caller: 'main()' });

		const { program } = mem.finish();
		const ops = program.steps[0].ops;
		// scope + heap + 2 params
		expect(ops.length).toBe(4);
		const paramOps = ops.filter((op) => op.op === 'addEntry' && !(op as any).entry.kind);
		expect(paramOps).toHaveLength(2);
	});

	it('pushScope with params that have addresses', () => {
		const mem = makeMem();
		mem.beginStep(loc(1));
		mem.pushScope('distance', [
			{ name: 'a', type: intType(), value: '5', address: 0x7ffc0060 },
		]);

		const { program } = mem.finish();
		const paramOps = program.steps[0].ops.filter((op) => op.op === 'addEntry' && !(op as any).entry.kind);
		if (paramOps[0]?.op === 'addEntry') {
			expect(paramOps[0].entry.address).toBe('0x7ffc0060');
		}
	});
});

describe('integration: Memory output passes validation', () => {
	it('simple program structure is well-formed', () => {
		const mem = new Memory('test', 'int main() { int x = 5; return 0; }');
		mem.beginStep(loc(1), 'Enter main()');
		mem.pushScope('main', [], { caller: '_start', returnAddr: '0x00400580' });
		mem.declareVariableWithAddress('x', intType(), '5', 0x7ffc0060);
		mem.beginStep(loc(2), 'return 0');
		const { program, errors } = mem.finish();
		expect(errors).toHaveLength(0);
		expect(program.steps).toHaveLength(2);
		expect(program.name).toBe('test');
	});
});

describe('readMemory / writeMemory', () => {
	it('writes and reads back values', () => {
		const mem = makeMem();
		mem.writeMemory(0x1000, 42);
		expect(mem.readMemory(0x1000)).toBe(42);
	});

	it('returns undefined for unwritten address', () => {
		const mem = makeMem();
		expect(mem.readMemory(0x9999)).toBeUndefined();
	});
});

describe('isFreedAddress', () => {
	it('returns true for address in a freed block', () => {
		const mem = makeMem();
		setupMain(mem);
		mem.beginStep(loc(2));
		const { address } = mem.malloc(16, 'p', intType(), 'malloc', 2);
		mem.freeByAddress(address);
		expect(mem.isFreedAddress(address)).toBe(true);
		expect(mem.isFreedAddress(address + 4)).toBe(true); // inside the block
	});

	it('returns false for non-freed address', () => {
		const mem = makeMem();
		setupMain(mem);
		mem.beginStep(loc(2));
		const { address } = mem.malloc(16, 'p', intType(), 'malloc', 2);
		expect(mem.isFreedAddress(address)).toBe(false);
	});
});
