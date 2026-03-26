import { describe, it, expect } from 'vitest';
import { applyOps, buildSnapshots, indexById } from './snapshot';
import type { MemoryEntry, Program, SnapshotOp } from '$lib/api/types';

function entry(id: string, name: string, value: string = '', children?: MemoryEntry[]): MemoryEntry {
	return { id, name, type: 'int', value, address: '0x00', children };
}

describe('indexById', () => {
	it('indexes flat entries', () => {
		const entries = [entry('a', 'x'), entry('b', 'y')];
		const idx = indexById(entries);
		expect(idx.get('a')?.name).toBe('x');
		expect(idx.get('b')?.name).toBe('y');
		expect(idx.size).toBe(2);
	});

	it('indexes nested entries', () => {
		const entries = [
			entry('parent', 'p', '', [
				entry('child', 'c', '', [
					entry('grandchild', 'gc'),
				]),
			]),
		];
		const idx = indexById(entries);
		expect(idx.size).toBe(3);
		expect(idx.get('grandchild')?.name).toBe('gc');
	});
});

describe('applyOps', () => {
	it('addEntry to root', () => {
		const { snapshot, errors } = applyOps([], [
			{ op: 'addEntry', parentId: null, entry: entry('a', 'x', '5') },
		]);
		expect(errors).toHaveLength(0);
		expect(snapshot).toHaveLength(1);
		expect(snapshot[0].value).toBe('5');
	});

	it('addEntry to parent', () => {
		const initial = [entry('parent', 'p')];
		const { snapshot, errors } = applyOps(initial, [
			{ op: 'addEntry', parentId: 'parent', entry: entry('child', 'c', '10') },
		]);
		expect(errors).toHaveLength(0);
		expect(snapshot[0].children).toHaveLength(1);
		expect(snapshot[0].children![0].value).toBe('10');
	});

	it('addEntry to missing parent reports error', () => {
		const { errors } = applyOps([], [
			{ op: 'addEntry', parentId: 'nonexistent', entry: entry('a', 'x') },
		]);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain('nonexistent');
	});

	it('setValue changes value', () => {
		const initial = [entry('a', 'x', '0')];
		const { snapshot } = applyOps(initial, [
			{ op: 'setValue', id: 'a', value: '42' },
		]);
		expect(snapshot[0].value).toBe('42');
	});

	it('setValue on missing id reports error', () => {
		const { errors } = applyOps([], [
			{ op: 'setValue', id: 'missing', value: '1' },
		]);
		expect(errors).toHaveLength(1);
	});

	it('removeEntry removes from root', () => {
		const initial = [entry('a', 'x'), entry('b', 'y')];
		const { snapshot } = applyOps(initial, [
			{ op: 'removeEntry', id: 'a' },
		]);
		expect(snapshot).toHaveLength(1);
		expect(snapshot[0].id).toBe('b');
	});

	it('removeEntry removes nested entry', () => {
		const initial = [entry('parent', 'p', '', [entry('child', 'c')])];
		const { snapshot } = applyOps(initial, [
			{ op: 'removeEntry', id: 'child' },
		]);
		expect(snapshot[0].children).toHaveLength(0);
	});

	it('removeEntry on missing id reports error', () => {
		const { errors } = applyOps([], [
			{ op: 'removeEntry', id: 'ghost' },
		]);
		expect(errors).toHaveLength(1);
	});

	it('does not mutate original snapshot', () => {
		const original = [entry('a', 'x', '0')];
		applyOps(original, [{ op: 'setValue', id: 'a', value: '99' }]);
		expect(original[0].value).toBe('0');
	});

	it('op can target entry added by earlier op in same step', () => {
		const { snapshot, errors } = applyOps([], [
			{ op: 'addEntry', parentId: null, entry: entry('a', 'x', '0') },
			{ op: 'setValue', id: 'a', value: '1' },
		]);
		expect(errors).toHaveLength(0);
		expect(snapshot[0].value).toBe('1');
	});
});

describe('buildSnapshots', () => {
	it('produces one snapshot per step starting from empty', () => {
		const program: Program = {
			name: 'test',
			source: '',
			steps: [
				{ location: { line: 1 }, ops: [{ op: 'addEntry', parentId: null, entry: entry('a', 'x', '1') }] },
				{ location: { line: 2 }, ops: [{ op: 'setValue', id: 'a', value: '2' }] },
				{ location: { line: 3 }, ops: [{ op: 'setValue', id: 'a', value: '3' }] },
			],
		};
		const snapshots = buildSnapshots(program);
		expect(snapshots).toHaveLength(3);
		expect(snapshots[0][0].value).toBe('1');
		expect(snapshots[1][0].value).toBe('2');
		expect(snapshots[2][0].value).toBe('3');
	});

	it('each snapshot is independent (mutating one does not affect others)', () => {
		const program: Program = {
			name: 'test',
			source: '',
			steps: [
				{ location: { line: 1 }, ops: [{ op: 'addEntry', parentId: null, entry: entry('a', 'x', '1') }] },
				{ location: { line: 2 }, ops: [{ op: 'setValue', id: 'a', value: '2' }] },
			],
		};
		const snapshots = buildSnapshots(program);

		// Mutate snapshot 1
		snapshots[1][0].value = 'MUTATED';

		// Snapshot 0 must be unaffected
		expect(snapshots[0][0].value).toBe('1');
	});
});
