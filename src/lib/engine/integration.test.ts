import { describe, it, expect, vi } from 'vitest';
import { buildSnapshots } from './snapshot';
import { diffSnapshots } from './diff';
import { getVisibleIndices, nearestVisibleIndex } from './navigation';
import type { MemoryEntry, Program, ProgramStep } from '$lib/types';

function entry(id: string, value: string = '', opts: Partial<MemoryEntry> = {}): MemoryEntry {
	return { id, name: id, type: 'int', value, address: '0x00', ...opts };
}

function scope(id: string, name: string): MemoryEntry {
	return { id, name, type: '', value: '', address: '', kind: 'scope' };
}

/** A multi-step program with a scope that appears and later disappears. */
const scopeLifecycleProgram: Program = {
	name: 'scope-lifecycle',
	source: '',
	steps: [
		{
			location: { line: 1 },
			ops: [{ op: 'addEntry', parentId: null, entry: scope('main', 'main()') }],
		},
		{
			location: { line: 2 },
			ops: [{ op: 'addEntry', parentId: 'main', entry: entry('x', '1') }],
		},
		{
			location: { line: 3 },
			ops: [{ op: 'addEntry', parentId: 'main', entry: scope('inner', '{ }') }],
		},
		{
			location: { line: 4 },
			ops: [{ op: 'addEntry', parentId: 'inner', entry: entry('y', '2') }],
		},
		{
			location: { line: 5 },
			ops: [{ op: 'removeEntry', id: 'inner' }],
		},
		{
			location: { line: 6 },
			ops: [{ op: 'setValue', id: 'x', value: '99' }],
		},
	],
};

/** A program with sub-steps (like a for-loop) for testing navigation. */
const subStepProgram: Program = {
	name: 'sub-steps',
	source: '',
	steps: [
		{ location: { line: 1 }, ops: [{ op: 'addEntry', parentId: null, entry: entry('a', '0') }] },
		{ location: { line: 2 }, subStep: true, ops: [{ op: 'setValue', id: 'a', value: '1' }] },
		{ location: { line: 2 }, subStep: true, ops: [{ op: 'setValue', id: 'a', value: '2' }] },
		{ location: { line: 2 }, ops: [{ op: 'setValue', id: 'a', value: '3' }] },
		{ location: { line: 3 }, subStep: true, ops: [{ op: 'setValue', id: 'a', value: '4' }] },
		{ location: { line: 3 }, ops: [{ op: 'setValue', id: 'a', value: '5' }] },
	],
};

describe('buildSnapshots integration', () => {
	it('multi-step program builds without errors', () => {
		const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const snapshots = buildSnapshots(scopeLifecycleProgram);
		expect(snapshots.length).toBe(scopeLifecycleProgram.steps.length);
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it('first snapshot has main scope', () => {
		const snapshots = buildSnapshots(scopeLifecycleProgram);
		const firstIds = snapshots[0].map((e) => e.id);
		expect(firstIds).toContain('main');
	});

	it('last snapshot still has main scope', () => {
		const snapshots = buildSnapshots(scopeLifecycleProgram);
		const last = snapshots[snapshots.length - 1];
		const ids = last.map((e) => e.id);
		expect(ids).toContain('main');
	});

	it('inner scope appears and disappears', () => {
		const snapshots = buildSnapshots(scopeLifecycleProgram);

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

		// Inner scope exists in some snapshots
		const hasInner = snapshots.some((s) => hasId(s, 'inner'));
		expect(hasInner).toBe(true);

		// Last snapshot should not have inner scope
		const last = snapshots[snapshots.length - 1];
		expect(hasId(last, 'inner')).toBe(false);
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

describe('navigation with sub-step programs', () => {
	it('line mode has fewer steps than sub-step mode', () => {
		const lineVisible = getVisibleIndices(subStepProgram.steps, false);
		const subVisible = getVisibleIndices(subStepProgram.steps, true);
		expect(lineVisible.length).toBeLessThan(subVisible.length);
		expect(subVisible.length).toBe(subStepProgram.steps.length);
	});

	it('every visible index in line mode maps to a non-subStep step', () => {
		const lineVisible = getVisibleIndices(subStepProgram.steps, false);
		for (const idx of lineVisible) {
			expect(subStepProgram.steps[idx].subStep).not.toBe(true);
		}
	});

	it('toggling from sub-step to line mode always lands on a visible step', () => {
		const lineVisible = getVisibleIndices(subStepProgram.steps, false);

		for (let i = 0; i < subStepProgram.steps.length; i++) {
			const mapped = nearestVisibleIndex(lineVisible, i);
			expect(lineVisible).toContain(mapped);
		}
	});
});

describe('diff integration', () => {
	it('stepping forward always produces a valid diff', () => {
		const snapshots = buildSnapshots(scopeLifecycleProgram);
		for (let i = 1; i < snapshots.length; i++) {
			const diff = diffSnapshots(snapshots[i - 1], snapshots[i]);
			expect(Array.isArray(diff.added)).toBe(true);
			expect(Array.isArray(diff.removed)).toBe(true);
			expect(Array.isArray(diff.changed)).toBe(true);
		}
	});

	it('first step diff from empty shows everything as added', () => {
		const snapshots = buildSnapshots(scopeLifecycleProgram);
		const diff = diffSnapshots([], snapshots[0]);
		expect(diff.added.length).toBeGreaterThan(0);
		expect(diff.removed).toHaveLength(0);
	});
});
