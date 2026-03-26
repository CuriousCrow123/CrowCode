import { describe, it, expect } from 'vitest';
import { DefaultEmitter } from './emitter';
import type { ProgramStep, SnapshotOp, MemoryEntry, SourceLocation } from '$lib/api/types';
import type { ChildSpec, CType } from './types';
import { primitiveType, pointerType, arrayType, TypeRegistry } from './types-c';
import { buildSnapshots } from '$lib/engine/snapshot';
import { validateProgram } from '$lib/engine/validate';

function makeEmitter(): DefaultEmitter {
	return new DefaultEmitter('test', 'int main() {}');
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

describe('step lifecycle', () => {
	it('creates steps with location and description', () => {
		const em = makeEmitter();
		em.beginStep(loc(1), 'test step');
		em.enterFunction('main', [], { caller: '_start' });
		const { program } = em.finish();
		expect(program.steps).toHaveLength(1);
		expect(program.steps[0].location.line).toBe(1);
		expect(program.steps[0].description).toBe('test step');
	});

	it('marks steps as subStep', () => {
		const em = makeEmitter();
		em.beginStep(loc(1), 'sub');
		em.markSubStep();
		em.enterFunction('main', []);
		const { program } = em.finish();
		expect(program.steps[0].subStep).toBe(true);
	});

	it('evaluation field is preserved', () => {
		const em = makeEmitter();
		em.beginStep(loc(1), 'check', '0 < 4 → true');
		em.enterFunction('main', []);
		const { program } = em.finish();
		expect(program.steps[0].evaluation).toBe('0 < 4 → true');
	});

	it('multiple steps are accumulated', () => {
		const em = makeEmitter();
		em.beginStep(loc(1), 'step 1');
		em.enterFunction('main', []);
		em.beginStep(loc(2), 'step 2');
		em.declareVariable('x', intType(), '0');
		const { program } = em.finish();
		expect(program.steps).toHaveLength(2);
	});
});

describe('scope operations', () => {
	it('enterFunction creates scope entry and heap container', () => {
		const em = makeEmitter();
		em.beginStep(loc(1), 'enter main');
		em.enterFunction('main', [], { caller: '_start', returnAddr: '0x00400580' });
		const { program } = em.finish();
		const ops = program.steps[0].ops;
		// Should have scope entry + heap container
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
		const em = makeEmitter();
		em.beginStep(loc(1));
		em.enterFunction('main', []);
		em.beginStep(loc(2));
		em.enterFunction('helper', []);
		const { program } = em.finish();
		const allOps = program.steps.flatMap((s) => s.ops);
		const heapOps = allOps.filter((op) => op.op === 'addEntry' && (op as any).entry.kind === 'heap');
		expect(heapOps).toHaveLength(1);
	});

	it('exitFunction removes scope', () => {
		const em = makeEmitter();
		em.beginStep(loc(1));
		em.enterFunction('main', []);
		em.beginStep(loc(2));
		em.exitFunction('main');
		const { program } = em.finish();
		const removeOps = program.steps[1].ops.filter((op) => op.op === 'removeEntry');
		expect(removeOps).toHaveLength(1);
	});

	it('enterBlock creates nested scope', () => {
		const em = makeEmitter();
		em.beginStep(loc(1));
		em.enterFunction('main', []);
		em.beginStep(loc(2));
		em.enterBlock('for');
		const { program } = em.finish();
		const addOps = program.steps[1].ops.filter((op) => op.op === 'addEntry');
		expect(addOps).toHaveLength(1);
		if (addOps[0].op === 'addEntry') {
			expect(addOps[0].entry.kind).toBe('scope');
			expect(addOps[0].parentId).toBe('main');
		}
	});

	it('exitBlock removes block scope', () => {
		const em = makeEmitter();
		em.beginStep(loc(1));
		em.enterFunction('main', []);
		em.beginStep(loc(2));
		em.enterBlock('for');
		em.beginStep(loc(3));
		em.exitBlock('for1');
		const { program } = em.finish();
		const removeOps = program.steps[2].ops.filter((op) => op.op === 'removeEntry');
		expect(removeOps).toHaveLength(1);
	});
});

describe('variable operations', () => {
	it('declareVariable adds entry to current scope', () => {
		const em = makeEmitter();
		em.beginStep(loc(1));
		em.enterFunction('main', []);
		em.beginStep(loc(2));
		em.declareVariable('x', intType(), '42');
		const { program } = em.finish();
		const addOps = program.steps[1].ops.filter((op) => op.op === 'addEntry');
		expect(addOps).toHaveLength(1);
		if (addOps[0].op === 'addEntry') {
			expect(addOps[0].entry.id).toBe('main-x');
			expect(addOps[0].entry.name).toBe('x');
			expect(addOps[0].entry.type).toBe('int');
			expect(addOps[0].entry.value).toBe('42');
			expect(addOps[0].parentId).toBe('main');
		}
	});

	it('declareVariableWithAddress includes hex address', () => {
		const em = makeEmitter();
		em.beginStep(loc(1));
		em.enterFunction('main', []);
		em.beginStep(loc(2));
		em.declareVariableWithAddress('x', intType(), '42', 0x7ffc0060);
		const { program } = em.finish();
		const addOps = program.steps[1].ops.filter((op) => op.op === 'addEntry');
		if (addOps[0].op === 'addEntry') {
			expect(addOps[0].entry.address).toBe('0x7ffc0060');
		}
	});

	it('assignVariable emits setValue op', () => {
		const em = makeEmitter();
		em.beginStep(loc(1));
		em.enterFunction('main', []);
		em.declareVariable('x', intType(), '0');
		em.beginStep(loc(2));
		em.assignVariable('x', '42');
		const { program } = em.finish();
		const setOps = program.steps[1].ops.filter((op) => op.op === 'setValue');
		expect(setOps).toHaveLength(1);
		if (setOps[0].op === 'setValue') {
			expect(setOps[0].id).toBe('main-x');
			expect(setOps[0].value).toBe('42');
		}
	});
});

describe('struct children', () => {
	it('builds ChildSpec into nested MemoryEntry children', () => {
		const em = makeEmitter();
		em.beginStep(loc(1));
		em.enterFunction('main', []);
		em.beginStep(loc(2));

		const children: ChildSpec[] = [
			{ name: 'x', displayName: '.x', type: intType(), value: '0', addressOffset: 0 },
			{ name: 'y', displayName: '.y', type: intType(), value: '0', addressOffset: 4 },
		];
		em.declareVariableWithAddress('origin', primitiveType('int'), '', 0x7ffc0064, children);

		const { program } = em.finish();
		const addOps = program.steps[1].ops.filter((op) => op.op === 'addEntry');
		if (addOps[0].op === 'addEntry') {
			const entry = addOps[0].entry;
			expect(entry.children).toHaveLength(2);
			expect(entry.children![0].id).toBe('main-origin-x');
			expect(entry.children![0].name).toBe('.x');
			expect(entry.children![0].address).toBe('0x7ffc0064');
			expect(entry.children![1].id).toBe('main-origin-y');
			expect(entry.children![1].address).toBe('0x7ffc0068');
		}
	});

	it('builds nested struct children recursively', () => {
		const em = makeEmitter();
		em.beginStep(loc(1));
		em.enterFunction('main', []);
		em.beginStep(loc(2));

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
		em.declareVariableWithAddress('player', intType(), '', 0x1000, children);

		const { program } = em.finish();
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

describe('heap operations', () => {
	it('allocHeapWithAddress creates heap block entry', () => {
		const em = makeEmitter();
		em.beginStep(loc(1));
		em.enterFunction('main', []);
		em.beginStep(loc(2));

		const children: ChildSpec[] = [
			{ name: 'x', displayName: '.x', type: intType(), value: '0', addressOffset: 0 },
			{ name: 'y', displayName: '.y', type: intType(), value: '0', addressOffset: 4 },
		];
		em.allocHeapWithAddress('p', intType(), 8, 'malloc', { line: 2 }, 0x55a00000, children);

		const { program } = em.finish();
		const allOps = program.steps.flatMap((s) => s.ops);
		const heapAlloc = allOps.find((op) => op.op === 'addEntry' && (op as any).entry.heap);
		expect(heapAlloc).toBeDefined();
		if (heapAlloc?.op === 'addEntry') {
			expect(heapAlloc.entry.id).toBe('heap-p');
			expect(heapAlloc.entry.heap!.size).toBe(8);
			expect(heapAlloc.entry.heap!.allocator).toBe('malloc');
			expect(heapAlloc.entry.address).toBe('0x55a00000');
			expect(heapAlloc.entry.children).toHaveLength(2);
			expect(heapAlloc.entry.children![0].id).toBe('heap-p-x');
		}
	});

	it('freeHeap emits setHeapStatus freed', () => {
		const em = makeEmitter();
		em.beginStep(loc(1));
		em.enterFunction('main', []);
		em.beginStep(loc(2));
		em.allocHeapWithAddress('p', intType(), 8, 'malloc', { line: 2 }, 0x55a00000);
		em.beginStep(loc(3));
		em.freeHeap('p');
		const { program } = em.finish();
		const freeOps = program.steps[2].ops.filter((op) => op.op === 'setHeapStatus');
		expect(freeOps).toHaveLength(1);
		if (freeOps[0].op === 'setHeapStatus') {
			expect(freeOps[0].id).toBe('heap-p');
			expect(freeOps[0].status).toBe('freed');
		}
	});

	it('leakHeap emits setHeapStatus leaked', () => {
		const em = makeEmitter();
		em.beginStep(loc(1));
		em.enterFunction('main', []);
		em.beginStep(loc(2));
		em.allocHeapWithAddress('p', intType(), 8, 'malloc', { line: 2 }, 0x55a00000);
		em.beginStep(loc(3));
		em.leakHeap('heap-p');
		const { program } = em.finish();
		const leakOps = program.steps[2].ops.filter((op) => op.op === 'setHeapStatus');
		expect(leakOps).toHaveLength(1);
		if (leakOps[0].op === 'setHeapStatus') {
			expect(leakOps[0].status).toBe('leaked');
		}
	});

	it('removeHeapBlock emits removeEntry', () => {
		const em = makeEmitter();
		em.beginStep(loc(1));
		em.enterFunction('main', []);
		em.beginStep(loc(2));
		em.allocHeapWithAddress('p', intType(), 8, 'malloc', { line: 2 }, 0x55a00000);
		em.beginStep(loc(3));
		em.freeHeap('p');
		em.beginStep(loc(4));
		em.removeHeapBlock('heap-p');
		const { program } = em.finish();
		const removeOps = program.steps[3].ops.filter((op) => op.op === 'removeEntry');
		expect(removeOps).toHaveLength(1);
		if (removeOps[0].op === 'removeEntry') {
			expect(removeOps[0].id).toBe('heap-p');
		}
	});
});

describe('ID generation', () => {
	it('generates unique scope IDs for same name', () => {
		const em = makeEmitter();
		em.beginStep(loc(1));
		em.enterFunction('main', []);
		em.beginStep(loc(2));
		em.enterBlock('for');
		em.beginStep(loc(3));
		em.exitBlock('for1');
		em.beginStep(loc(4));
		em.enterBlock('for');
		const { program } = em.finish();
		// First for block and second for block should have different IDs
		const addOps = program.steps.flatMap((s) => s.ops).filter((op) =>
			op.op === 'addEntry' && (op as any).entry.kind === 'scope' && (op as any).entry.name === 'for'
		);
		expect(addOps.length).toBe(2);
		if (addOps[0].op === 'addEntry' && addOps[1].op === 'addEntry') {
			expect(addOps[0].entry.id).not.toBe(addOps[1].entry.id);
		}
	});

	it('variable IDs are prefixed with scope ID', () => {
		const em = makeEmitter();
		em.beginStep(loc(1));
		em.enterFunction('main', []);
		em.declareVariable('x', intType(), '0');
		const { program } = em.finish();
		const addOps = program.steps[0].ops.filter((op) => op.op === 'addEntry' && !(op as any).entry.kind);
		if (addOps[0]?.op === 'addEntry') {
			expect(addOps[0].entry.id).toBe('main-x');
		}
	});

	it('heap block IDs use pointer variable name', () => {
		const em = makeEmitter();
		em.beginStep(loc(1));
		em.enterFunction('main', []);
		em.beginStep(loc(2));
		em.allocHeapWithAddress('scores', intType(), 16, 'malloc', { line: 2 }, 0x55a00000);
		const { program } = em.finish();
		const allOps = program.steps.flatMap((s) => s.ops);
		const heapOp = allOps.find((op) => op.op === 'addEntry' && (op as any).entry.heap);
		if (heapOp?.op === 'addEntry') {
			expect(heapOp.entry.id).toBe('heap-scores');
		}
	});
});

describe('path resolution', () => {
	it('resolves simple variable path', () => {
		const em = makeEmitter();
		em.beginStep(loc(1));
		em.enterFunction('main', []);
		em.declareVariable('x', intType(), '0');
		expect(em.getVarEntryId('x')).toBe('main-x');
	});

	it('resolves pointer → heap block path', () => {
		const em = makeEmitter();
		em.beginStep(loc(1));
		em.enterFunction('main', []);
		em.allocHeapWithAddress('p', intType(), 8, 'malloc', { line: 1 }, 0x55a00000, [
			{ name: 'x', displayName: '.x', type: intType(), value: '0', addressOffset: 0 },
		]);

		const blockId = em.resolvePointerPath(['p', 'x']);
		expect(blockId).toBe('heap-p-x');
	});

	it('resolves nested struct path through pointer', () => {
		const em = makeEmitter();
		em.beginStep(loc(1));
		em.enterFunction('main', []);
		em.allocHeapWithAddress('p', intType(), 16, 'malloc', { line: 1 }, 0x55a00000, [
			{
				name: 'pos', displayName: '.pos', type: intType(), value: '', addressOffset: 4,
				children: [
					{ name: 'x', displayName: '.x', type: intType(), value: '0', addressOffset: 0 },
				],
			},
		]);

		expect(em.resolvePointerPath(['p', 'pos', 'x'])).toBe('heap-p-pos-x');
	});
});

describe('parameter handling', () => {
	it('enterFunction with params creates scope + param variables', () => {
		const em = makeEmitter();
		em.beginStep(loc(1));
		em.enterFunction('distance', [
			{ name: 'a', type: intType(), value: '0' },
			{ name: 'b', type: intType(), value: '0' },
		], { caller: 'main()' });

		const { program } = em.finish();
		const ops = program.steps[0].ops;
		// scope + heap + 2 params
		expect(ops.length).toBe(4);
		const paramOps = ops.filter((op) => op.op === 'addEntry' && !(op as any).entry.kind);
		expect(paramOps).toHaveLength(2);
	});

	it('struct param has children', () => {
		const em = makeEmitter();
		em.beginStep(loc(1));
		em.enterFunction('distance', [
			{
				name: 'a', type: intType(), value: '',
				children: [
					{ name: 'x', displayName: '.x', type: intType(), value: '5', addressOffset: 0 },
					{ name: 'y', displayName: '.y', type: intType(), value: '10', addressOffset: 4 },
				],
			},
		]);

		const { program } = em.finish();
		const paramOps = program.steps[0].ops.filter((op) => op.op === 'addEntry' && !(op as any).entry.kind);
		if (paramOps[0]?.op === 'addEntry') {
			expect(paramOps[0].entry.children).toHaveLength(2);
			expect(paramOps[0].entry.children![0].name).toBe('.x');
			expect(paramOps[0].entry.children![0].value).toBe('5');
		}
	});
});

describe('description formatting', () => {
	it('preserves description strings', () => {
		const em = makeEmitter();
		em.beginStep(loc(1), 'int count = 3');
		em.enterFunction('main', []);
		const { program } = em.finish();
		expect(program.steps[0].description).toBe('int count = 3');
	});

	it('preserves column ranges in location', () => {
		const em = makeEmitter();
		em.beginStep(loc(8, 20, 25), 'for: check');
		em.markSubStep();
		em.enterFunction('main', []);
		const { program } = em.finish();
		expect(program.steps[0].location.colStart).toBe(20);
		expect(program.steps[0].location.colEnd).toBe(25);
		expect(program.steps[0].subStep).toBe(true);
	});
});

describe('integration: emitter output passes validation', () => {
	it('simple program passes validateProgram', () => {
		const em = new DefaultEmitter('test', 'int main() { int x = 5; return 0; }');
		em.beginStep(loc(1), 'Enter main()');
		em.enterFunction('main', [], { caller: '_start', returnAddr: '0x00400580' });
		em.declareVariableWithAddress('x', intType(), '5', 0x7ffc0060);
		em.beginStep(loc(2), 'return 0');
		// empty ops
		const { program } = em.finish();
		const errors = validateProgram(program);
		expect(errors).toHaveLength(0);
	});

	it('program with for-loop sub-steps passes validation', () => {
		const em = new DefaultEmitter('test', 'int main() {\n  for (int i = 0; i < 2; i++) {}\n}');
		// Enter main
		em.beginStep(loc(1), 'Enter main()');
		em.enterFunction('main', [], { caller: '_start' });
		em.declareVariableWithAddress('sum', intType(), '0', 0x7ffc0060);

		// For init
		em.beginStep(loc(2), 'for: int i = 0');
		em.enterBlock('for');
		em.declareVariableWithAddress('i', intType(), '0', 0x7ffc0064);

		// Check (sub)
		em.beginStep(loc(2, 15, 20), 'for: check');
		em.markSubStep();

		// Increment (sub)
		em.beginStep(loc(2, 22, 25), 'for: i++');
		em.markSubStep();
		em.assignVariable('i', '1');

		// Check (sub)
		em.beginStep(loc(2, 15, 20), 'for: check');
		em.markSubStep();

		// Increment (sub)
		em.beginStep(loc(2, 22, 25), 'for: i++');
		em.markSubStep();
		em.assignVariable('i', '2');

		// Exit (anchor)
		em.beginStep(loc(2), 'for: exit');
		em.exitBlock('for1');

		em.beginStep(loc(3), 'return 0');

		const { program } = em.finish();
		const errors = validateProgram(program);
		expect(errors).toHaveLength(0);
	});

	it('emitter output builds snapshots without warnings', () => {
		const em = new DefaultEmitter('test', 'int main() { int x = 5; }');
		em.beginStep(loc(1), 'Enter main');
		em.enterFunction('main', [], { caller: '_start' });
		em.declareVariableWithAddress('x', intType(), '5', 0x7ffc0060);
		const { program } = em.finish();

		const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		buildSnapshots(program);
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});
});

import { vi } from 'vitest';

describe('error collection', () => {
	it('collects error when op emitted without step', () => {
		const em = makeEmitter();
		// Don't call beginStep — directly try to declare
		em.enterFunction('main', []);
		const { errors } = em.finish();
		expect(errors.some((e) => e.includes('without active step'))).toBe(true);
	});

	it('collects error for unknown variable assignment', () => {
		const em = makeEmitter();
		em.beginStep(loc(1));
		em.enterFunction('main', []);
		em.beginStep(loc(2));
		em.assignVariable('nonexistent', '42');
		const { errors } = em.finish();
		expect(errors.some((e) => e.includes('Cannot resolve variable'))).toBe(true);
	});

	it('collects error for unknown pointer in freeHeap', () => {
		const em = makeEmitter();
		em.beginStep(loc(1));
		em.enterFunction('main', []);
		em.beginStep(loc(2));
		em.freeHeap('nonexistent');
		const { errors } = em.finish();
		expect(errors.some((e) => e.includes('Cannot find heap block'))).toBe(true);
	});
});
