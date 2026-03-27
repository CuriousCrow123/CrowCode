import { describe, it, expect } from 'vitest';
import { applyOps, buildSnapshots, indexById } from './snapshot';
import type { MemoryEntry, Program } from '$lib/types';

function entry(id: string, name: string, value: string = '', children?: MemoryEntry[]): MemoryEntry {
	return { id, name, type: 'int', value, address: '0x00', children };
}

function heapEntry(id: string, status: 'allocated' | 'freed' | 'leaked' = 'allocated'): MemoryEntry {
	return {
		id, name: '', type: 'int', value: '0', address: '0x55',
		heap: { size: 4, status, allocator: 'malloc', allocSite: { file: 'test.c', line: 1 } },
	};
}

describe('applyOps edge cases', () => {
	describe('setHeapStatus', () => {
		it('changes allocated to freed', () => {
			const initial = [heapEntry('h1', 'allocated')];
			const { snapshot } = applyOps(initial, [
				{ op: 'setHeapStatus', id: 'h1', status: 'freed' },
			]);
			expect(snapshot[0].heap?.status).toBe('freed');
		});

		it('changes allocated to leaked', () => {
			const initial = [heapEntry('h1', 'allocated')];
			const { snapshot } = applyOps(initial, [
				{ op: 'setHeapStatus', id: 'h1', status: 'leaked' },
			]);
			expect(snapshot[0].heap?.status).toBe('leaked');
		});

		it('errors on entry without heap info', () => {
			const initial = [entry('a', 'x')];
			const { errors } = applyOps(initial, [
				{ op: 'setHeapStatus', id: 'a', status: 'freed' },
			]);
			expect(errors).toHaveLength(1);
			expect(errors[0]).toContain('no heap info');
		});

		it('errors on missing entry', () => {
			const { errors } = applyOps([], [
				{ op: 'setHeapStatus', id: 'ghost', status: 'freed' },
			]);
			expect(errors).toHaveLength(1);
		});

		it('does not mutate original', () => {
			const original = [heapEntry('h1', 'allocated')];
			applyOps(original, [{ op: 'setHeapStatus', id: 'h1', status: 'freed' }]);
			expect(original[0].heap?.status).toBe('allocated');
		});
	});

	describe('deep nesting', () => {
		it('setValue on deeply nested entry', () => {
			const initial = [
				entry('a', 'root', '', [
					entry('b', 'child', '', [
						entry('c', 'grandchild', '', [
							entry('d', 'leaf', 'old'),
						]),
					]),
				]),
			];
			const { snapshot, errors } = applyOps(initial, [
				{ op: 'setValue', id: 'd', value: 'new' },
			]);
			expect(errors).toHaveLength(0);
			expect(snapshot[0].children![0].children![0].children![0].value).toBe('new');
		});

		it('removeEntry on deeply nested entry', () => {
			const initial = [
				entry('a', 'root', '', [
					entry('b', 'child', '', [
						entry('c', 'target'),
						entry('d', 'sibling'),
					]),
				]),
			];
			const { snapshot } = applyOps(initial, [
				{ op: 'removeEntry', id: 'c' },
			]);
			expect(snapshot[0].children![0].children).toHaveLength(1);
			expect(snapshot[0].children![0].children![0].id).toBe('d');
		});

		it('addEntry to deeply nested parent', () => {
			const initial = [
				entry('a', 'root', '', [
					entry('b', 'child', '', [
						entry('c', 'grandchild'),
					]),
				]),
			];
			const { snapshot, errors } = applyOps(initial, [
				{ op: 'addEntry', parentId: 'c', entry: entry('d', 'new-leaf', '99') },
			]);
			expect(errors).toHaveLength(0);
			expect(snapshot[0].children![0].children![0].children).toHaveLength(1);
			expect(snapshot[0].children![0].children![0].children![0].value).toBe('99');
		});
	});

	describe('multiple ops interaction', () => {
		it('add then immediately set value', () => {
			const { snapshot, errors } = applyOps([], [
				{ op: 'addEntry', parentId: null, entry: entry('a', 'x', '0') },
				{ op: 'setValue', id: 'a', value: '42' },
			]);
			expect(errors).toHaveLength(0);
			expect(snapshot[0].value).toBe('42');
		});

		it('add parent then add child in same step', () => {
			const { snapshot, errors } = applyOps([], [
				{ op: 'addEntry', parentId: null, entry: entry('parent', 'p') },
				{ op: 'addEntry', parentId: 'parent', entry: entry('child', 'c', '10') },
			]);
			expect(errors).toHaveLength(0);
			expect(snapshot[0].children).toHaveLength(1);
		});

		it('add then remove in same step', () => {
			const { snapshot, errors } = applyOps([], [
				{ op: 'addEntry', parentId: null, entry: entry('temp', 'tmp') },
				{ op: 'removeEntry', id: 'temp' },
			]);
			expect(errors).toHaveLength(0);
			expect(snapshot).toHaveLength(0);
		});

		it('set value then remove in same step', () => {
			const initial = [entry('a', 'x', '0')];
			const { snapshot, errors } = applyOps(initial, [
				{ op: 'setValue', id: 'a', value: '99' },
				{ op: 'removeEntry', id: 'a' },
			]);
			expect(errors).toHaveLength(0);
			expect(snapshot).toHaveLength(0);
		});

		it('remove parent also removes children', () => {
			const initial = [
				entry('parent', 'p', '', [
					entry('child1', 'c1', '1'),
					entry('child2', 'c2', '2'),
				]),
			];
			const { snapshot } = applyOps(initial, [
				{ op: 'removeEntry', id: 'parent' },
			]);
			expect(snapshot).toHaveLength(0);
			// Children should also be gone
			const idx = indexById(snapshot);
			expect(idx.has('child1')).toBe(false);
			expect(idx.has('child2')).toBe(false);
		});

		it('ops after removing entry correctly error', () => {
			const initial = [entry('a', 'x', '0')];
			const { errors } = applyOps(initial, [
				{ op: 'removeEntry', id: 'a' },
				{ op: 'setValue', id: 'a', value: '1' }, // a is gone
			]);
			expect(errors).toHaveLength(1);
			expect(errors[0]).toContain("'a' not found");
		});
	});

	describe('empty and edge states', () => {
		it('empty ops on empty snapshot', () => {
			const { snapshot, errors } = applyOps([], []);
			expect(snapshot).toHaveLength(0);
			expect(errors).toHaveLength(0);
		});

		it('empty ops on non-empty snapshot returns clone', () => {
			const initial = [entry('a', 'x', '1')];
			const { snapshot } = applyOps(initial, []);
			expect(snapshot).toHaveLength(1);
			expect(snapshot[0].value).toBe('1');
			// Must be a different reference
			expect(snapshot).not.toBe(initial);
			expect(snapshot[0]).not.toBe(initial[0]);
		});
	});
});

describe('buildSnapshots edge cases', () => {
	it('single step program', () => {
		const p: Program = {
			name: 'test', source: '',
			steps: [{ location: { line: 1 }, ops: [{ op: 'addEntry', parentId: null, entry: entry('a', 'x', '1') }] }],
		};
		const snapshots = buildSnapshots(p);
		expect(snapshots).toHaveLength(1);
	});

	it('step with no ops produces clone of previous', () => {
		const p: Program = {
			name: 'test', source: '',
			steps: [
				{ location: { line: 1 }, ops: [{ op: 'addEntry', parentId: null, entry: entry('a', 'x', '1') }] },
				{ location: { line: 2 }, ops: [] }, // no-op step
			],
		};
		const snapshots = buildSnapshots(p);
		expect(snapshots[1][0].value).toBe('1');
		// But should be different reference
		expect(snapshots[1]).not.toBe(snapshots[0]);
	});

	it('scope appears and disappears across steps', () => {
		const scope: MemoryEntry = {
			id: 'fn', name: 'foo()', kind: 'scope', type: '', value: '', address: '',
			children: [entry('a', 'a', '5')],
		};
		const p: Program = {
			name: 'test', source: '',
			steps: [
				{ location: { line: 1 }, ops: [{ op: 'addEntry', parentId: null, entry: scope }] },
				{ location: { line: 2 }, ops: [{ op: 'setValue', id: 'a', value: '10' }] },
				{ location: { line: 3 }, ops: [{ op: 'removeEntry', id: 'fn' }] },
			],
		};
		const snapshots = buildSnapshots(p);
		expect(snapshots[0]).toHaveLength(1);
		expect(snapshots[1][0].children![0].value).toBe('10');
		expect(snapshots[2]).toHaveLength(0);
	});

	it('heap lifecycle: alloc → use → free', () => {
		const block: MemoryEntry = {
			id: 'hb', name: '', type: 'int', value: '0', address: '0x55',
			heap: { size: 4, status: 'allocated', allocator: 'malloc', allocSite: { file: 't.c', line: 1 } },
		};
		const p: Program = {
			name: 'test', source: '',
			steps: [
				{ location: { line: 1 }, ops: [{ op: 'addEntry', parentId: null, entry: block }] },
				{ location: { line: 2 }, ops: [{ op: 'setValue', id: 'hb', value: '42' }] },
				{ location: { line: 3 }, ops: [{ op: 'setHeapStatus', id: 'hb', status: 'freed' }] },
			],
		};
		const snapshots = buildSnapshots(p);
		expect(snapshots[0][0].heap?.status).toBe('allocated');
		expect(snapshots[1][0].value).toBe('42');
		expect(snapshots[2][0].heap?.status).toBe('freed');
	});
});

describe('indexById edge cases', () => {
	it('empty tree', () => {
		const idx = indexById([]);
		expect(idx.size).toBe(0);
	});

	it('entries with no children field', () => {
		const idx = indexById([entry('a', 'x')]);
		expect(idx.size).toBe(1);
	});

	it('entries with empty children array', () => {
		const idx = indexById([entry('a', 'x', '', [])]);
		expect(idx.size).toBe(1);
	});

	it('large flat tree', () => {
		const entries = Array.from({ length: 100 }, (_, i) => entry(`e${i}`, `var${i}`));
		const idx = indexById(entries);
		expect(idx.size).toBe(100);
		expect(idx.get('e50')?.name).toBe('var50');
	});
});
