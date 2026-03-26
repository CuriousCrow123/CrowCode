import { describe, it, expect } from 'vitest';
import { diffSnapshots } from './diff';
import type { MemoryEntry } from '$lib/api/types';

function entry(id: string, value: string, children?: MemoryEntry[]): MemoryEntry {
	return { id, name: id, type: 'int', value, address: '0x00', children };
}

describe('diffSnapshots', () => {
	it('detects added entries', () => {
		const prev = [entry('a', '1')];
		const next = [entry('a', '1'), entry('b', '2')];
		const diff = diffSnapshots(prev, next);
		expect(diff.added).toEqual(['b']);
		expect(diff.removed).toEqual([]);
		expect(diff.changed).toEqual([]);
	});

	it('detects removed entries', () => {
		const prev = [entry('a', '1'), entry('b', '2')];
		const next = [entry('a', '1')];
		const diff = diffSnapshots(prev, next);
		expect(diff.removed).toEqual(['b']);
		expect(diff.added).toEqual([]);
	});

	it('detects changed values', () => {
		const prev = [entry('a', '1')];
		const next = [entry('a', '2')];
		const diff = diffSnapshots(prev, next);
		expect(diff.changed).toEqual([{ id: 'a', from: '1', to: '2' }]);
	});

	it('handles nested entries', () => {
		const prev = [entry('parent', '', [entry('child', '10')])];
		const next = [entry('parent', '', [entry('child', '20')])];
		const diff = diffSnapshots(prev, next);
		expect(diff.changed).toEqual([{ id: 'child', from: '10', to: '20' }]);
	});

	it('handles empty snapshots', () => {
		const diff = diffSnapshots([], []);
		expect(diff.added).toEqual([]);
		expect(diff.removed).toEqual([]);
		expect(diff.changed).toEqual([]);
	});

	it('handles first step (empty to populated)', () => {
		const diff = diffSnapshots([], [entry('a', '1'), entry('b', '2')]);
		expect(diff.added).toEqual(['a', 'b']);
	});
});
