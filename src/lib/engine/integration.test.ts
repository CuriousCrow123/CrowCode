import { describe, it, expect, vi } from 'vitest';
import { buildSnapshots } from './snapshot';
import { diffSnapshots } from './diff';
import { getVisibleIndices, nearestVisibleIndex } from './navigation';
import { basics } from '$lib/programs/basics';
import { loops } from '$lib/programs/loops';
import type { MemoryEntry, Program } from '$lib/api/types';

function entry(id: string, value: string = ''): MemoryEntry {
	return { id, name: id, type: 'int', value, address: '0x00' };
}

describe('buildSnapshots integration', () => {
	it('basics program builds without errors', () => {
		const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const snapshots = buildSnapshots(basics);
		expect(snapshots.length).toBe(basics.steps.length);
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it('loops program builds without errors', () => {
		const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const snapshots = buildSnapshots(loops);
		expect(snapshots.length).toBe(loops.steps.length);
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it('basics: first snapshot has main scope', () => {
		const snapshots = buildSnapshots(basics);
		const firstIds = snapshots[0].map((e) => e.id);
		expect(firstIds).toContain('main');
		expect(firstIds).toContain('heap');
	});

	it('basics: last snapshot still has main scope', () => {
		const snapshots = buildSnapshots(basics);
		const last = snapshots[snapshots.length - 1];
		const ids = last.map((e) => e.id);
		expect(ids).toContain('main');
	});

	it('loops: for scope appears and disappears', () => {
		const snapshots = buildSnapshots(loops);

		function hasId(snapshot: MemoryEntry[], id: string): boolean {
			for (const e of snapshot) {
				if (e.id === id) return true;
				if (e.children) {
					for (const c of e.children) {
						if (c.id === id) return true;
					}
				}
			}
			return false;
		}

		// Find a snapshot where for1 scope exists
		const hasFor = snapshots.some((s) => hasId(s, 'for1'));
		expect(hasFor).toBe(true);

		// Last snapshot should not have for1
		const last = snapshots[snapshots.length - 1];
		expect(hasId(last, 'for1')).toBe(false);
	});

	it('snapshot isolation: mutating one snapshot does not affect adjacent', () => {
		const program: Program = {
			name: 'test',
			source: '',
			steps: [
				{
					location: { line: 1 },
					ops: [{ op: 'addEntry', parentId: null, entry: entry('a', '1') }],
				},
				{
					location: { line: 2 },
					ops: [{ op: 'setValue', id: 'a', value: '2' }],
				},
				{
					location: { line: 3 },
					ops: [{ op: 'setValue', id: 'a', value: '3' }],
				},
			],
		};
		const snapshots = buildSnapshots(program);

		// Mutate snapshot at index 1
		snapshots[1][0].value = 'CORRUPTED';

		// Adjacent snapshots must be unaffected
		expect(snapshots[0][0].value).toBe('1');
		expect(snapshots[2][0].value).toBe('3');
	});
});

describe('navigation with real programs', () => {
	it('loops: line mode has fewer steps than sub-step mode', () => {
		const lineVisible = getVisibleIndices(loops.steps, false);
		const subVisible = getVisibleIndices(loops.steps, true);
		expect(lineVisible.length).toBeLessThan(subVisible.length);
		expect(subVisible.length).toBe(loops.steps.length);
	});

	it('every visible index in line mode maps to a non-subStep step', () => {
		const lineVisible = getVisibleIndices(loops.steps, false);
		for (const idx of lineVisible) {
			expect(loops.steps[idx].subStep).not.toBe(true);
		}
	});

	it('toggling from sub-step to line mode always lands on a visible step', () => {
		const lineVisible = getVisibleIndices(loops.steps, false);

		// Try every possible sub-step position
		for (let i = 0; i < loops.steps.length; i++) {
			const mapped = nearestVisibleIndex(lineVisible, i);
			expect(lineVisible).toContain(mapped);
		}
	});
});

describe('diff with real programs', () => {
	it('basics: stepping forward always produces a valid diff', () => {
		const snapshots = buildSnapshots(basics);
		for (let i = 1; i < snapshots.length; i++) {
			const diff = diffSnapshots(snapshots[i - 1], snapshots[i]);
			// diff should not throw and should have valid arrays
			expect(Array.isArray(diff.added)).toBe(true);
			expect(Array.isArray(diff.removed)).toBe(true);
			expect(Array.isArray(diff.changed)).toBe(true);
		}
	});

	it('first step diff from empty shows everything as added', () => {
		const snapshots = buildSnapshots(basics);
		const diff = diffSnapshots([], snapshots[0]);
		expect(diff.added.length).toBeGreaterThan(0);
		expect(diff.removed).toHaveLength(0);
	});
});
