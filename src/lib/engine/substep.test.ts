import { describe, it, expect } from 'vitest';
import { applyOps, buildSnapshots } from './snapshot';
import { getVisibleIndices, nearestVisibleIndex } from './navigation';
import { diffSnapshots } from './diff';
import type { MemoryEntry, Program, ProgramStep } from '$lib/api/types';

function entry(id: string, value: string = ''): MemoryEntry {
	return { id, name: id, type: 'int', value, address: '0x00' };
}

function step(line: number, ops: ProgramStep['ops'], subStep?: boolean): ProgramStep {
	return { location: { line }, ops, subStep };
}

function program(steps: ProgramStep[]): Program {
	return { name: 'test', source: 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10', steps };
}

describe('sub-step: snapshot correctness', () => {
	it('line mode anchor snapshot includes all prior sub-step ops', () => {
		// Sub-steps add elements, anchor sets the last one
		// In line mode, user jumps to anchor — snapshot must have all elements
		const p = program([
			step(1, [{ op: 'addEntry', parentId: null, entry: entry('a', '1') }], true),
			step(1, [{ op: 'addEntry', parentId: null, entry: entry('b', '2') }], true),
			step(1, [{ op: 'addEntry', parentId: null, entry: entry('c', '3') }]),  // anchor
		]);

		const snapshots = buildSnapshots(p);
		const lineVisible = getVisibleIndices(p.steps, false);

		// Only the anchor (index 2) is visible in line mode
		expect(lineVisible).toEqual([2]);

		// Snapshot at anchor must have all three entries
		const anchor = snapshots[2];
		expect(anchor).toHaveLength(3);
		expect(anchor.map(e => e.id)).toEqual(['a', 'b', 'c']);
	});

	it('sub-step snapshots show incremental state', () => {
		const p = program([
			step(1, [{ op: 'addEntry', parentId: null, entry: entry('a', '1') }], true),
			step(1, [{ op: 'addEntry', parentId: null, entry: entry('b', '2') }], true),
			step(1, [{ op: 'addEntry', parentId: null, entry: entry('c', '3') }]),
		]);

		const snapshots = buildSnapshots(p);

		// Sub-step mode: each snapshot shows progressive state
		expect(snapshots[0]).toHaveLength(1); // just 'a'
		expect(snapshots[1]).toHaveLength(2); // 'a' + 'b'
		expect(snapshots[2]).toHaveLength(3); // 'a' + 'b' + 'c'
	});

	it('anchor with no ops shows same state as previous sub-step', () => {
		const p = program([
			step(1, [{ op: 'addEntry', parentId: null, entry: entry('a', '1') }], true),
			step(1, [{ op: 'setValue', id: 'a', value: '2' }], true),
			step(1, []),  // anchor with no ops — just a pause point
		]);

		const snapshots = buildSnapshots(p);
		expect(snapshots[2][0].value).toBe('2'); // same as snapshot[1]
	});

	it('sub-step ops compound across steps', () => {
		// Simulates for-loop: init, check, body, increment, check, body
		const p = program([
			// init i=0
			step(3, [{ op: 'addEntry', parentId: null, entry: entry('i', '0') }], true),
			// check (no-op)
			step(3, [], true),
			// body: set value
			step(4, [{ op: 'addEntry', parentId: null, entry: entry('sum', '10') }]),
			// increment i
			step(3, [{ op: 'setValue', id: 'i', value: '1' }], true),
			// check (no-op)
			step(3, [], true),
			// body: update value
			step(4, [{ op: 'setValue', id: 'sum', value: '30' }]),
		]);

		const snapshots = buildSnapshots(p);

		// After first body (index 2): i=0, sum=10
		expect(snapshots[2].find(e => e.id === 'i')?.value).toBe('0');
		expect(snapshots[2].find(e => e.id === 'sum')?.value).toBe('10');

		// After increment (index 3): i=1, sum=10
		expect(snapshots[3].find(e => e.id === 'i')?.value).toBe('1');

		// After second body (index 5): i=1, sum=30
		expect(snapshots[5].find(e => e.id === 'sum')?.value).toBe('30');

		// Line mode visible: [2, 5] (the two body steps)
		const lineVisible = getVisibleIndices(p.steps, false);
		expect(lineVisible).toEqual([2, 5]);

		// In line mode, jumping from step 2 to step 5:
		// snapshot[5] must correctly reflect i=1 (from sub-step increment)
		expect(snapshots[5].find(e => e.id === 'i')?.value).toBe('1');
	});
});

describe('sub-step: navigation edge cases', () => {
	it('all steps are sub-steps — line mode has no visible steps', () => {
		const p = program([
			step(1, [{ op: 'addEntry', parentId: null, entry: entry('a', '1') }], true),
			step(1, [{ op: 'setValue', id: 'a', value: '2' }], true),
		]);

		const lineVisible = getVisibleIndices(p.steps, false);
		expect(lineVisible).toHaveLength(0);
	});

	it('no sub-steps — both modes identical', () => {
		const p = program([
			step(1, [{ op: 'addEntry', parentId: null, entry: entry('a', '1') }]),
			step(2, [{ op: 'setValue', id: 'a', value: '2' }]),
		]);

		const lineVisible = getVisibleIndices(p.steps, false);
		const subVisible = getVisibleIndices(p.steps, true);
		expect(lineVisible).toEqual(subVisible);
	});

	it('sub-step as first step', () => {
		const p = program([
			step(1, [{ op: 'addEntry', parentId: null, entry: entry('a', '1') }], true),
			step(1, [{ op: 'setValue', id: 'a', value: '2' }]),
			step(2, [{ op: 'setValue', id: 'a', value: '3' }]),
		]);

		const lineVisible = getVisibleIndices(p.steps, false);
		expect(lineVisible).toEqual([1, 2]);
		// Snapshot at index 1 must include sub-step 0's ops
		const snapshots = buildSnapshots(p);
		expect(snapshots[1][0].value).toBe('2');
	});

	it('sub-step as last step', () => {
		const p = program([
			step(1, [{ op: 'addEntry', parentId: null, entry: entry('a', '1') }]),
			step(2, [{ op: 'setValue', id: 'a', value: '2' }], true),
		]);

		const lineVisible = getVisibleIndices(p.steps, false);
		expect(lineVisible).toEqual([0]); // only first step visible

		// In sub-step mode, both visible
		const subVisible = getVisibleIndices(p.steps, true);
		expect(subVisible).toEqual([0, 1]);
	});

	it('toggle at every position maps to valid visible index', () => {
		// Complex mix of sub-steps and anchors
		const steps: ProgramStep[] = [
			step(1, [{ op: 'addEntry', parentId: null, entry: entry('a', '0') }]),     // 0: anchor
			step(2, [{ op: 'setValue', id: 'a', value: '1' }], true),                   // 1: sub
			step(2, [{ op: 'setValue', id: 'a', value: '2' }], true),                   // 2: sub
			step(2, [{ op: 'setValue', id: 'a', value: '3' }]),                          // 3: anchor
			step(3, [{ op: 'setValue', id: 'a', value: '4' }], true),                   // 4: sub
			step(3, [{ op: 'setValue', id: 'a', value: '5' }]),                          // 5: anchor
			step(4, [{ op: 'setValue', id: 'a', value: '6' }], true),                   // 6: sub
			step(4, [{ op: 'setValue', id: 'a', value: '7' }], true),                   // 7: sub
			step(4, [{ op: 'setValue', id: 'a', value: '8' }], true),                   // 8: sub
			step(4, [{ op: 'setValue', id: 'a', value: '9' }]),                          // 9: anchor
		];
		const p = program(steps);
		const lineVisible = getVisibleIndices(p.steps, false); // [0, 3, 5, 9]
		const subVisible = getVisibleIndices(p.steps, true);   // [0..9]

		// Toggle from sub-step to line mode at every position
		for (let i = 0; i < steps.length; i++) {
			const mapped = nearestVisibleIndex(lineVisible, i);
			expect(lineVisible).toContain(mapped);
		}

		// Toggle from line mode to sub-step mode at every visible position
		for (const idx of lineVisible) {
			const mapped = nearestVisibleIndex(subVisible, idx);
			expect(subVisible).toContain(mapped);
			// Should map to itself since all indices are visible in sub-step mode
			expect(mapped).toBe(idx);
		}
	});

	it('nearest visible index picks closest, not first', () => {
		const steps: ProgramStep[] = [
			step(1, [], false),  // 0
			step(2, [], true),   // 1
			step(2, [], true),   // 2
			step(2, [], true),   // 3
			step(2, [], true),   // 4
			step(2, [], true),   // 5
			step(2, [], true),   // 6
			step(2, [], true),   // 7
			step(2, [], false),  // 8
		];

		const lineVisible = getVisibleIndices(steps, false); // [0, 8]

		// Index 1 is closer to 0
		expect(nearestVisibleIndex(lineVisible, 1)).toBe(0);
		// Index 7 is closer to 8
		expect(nearestVisibleIndex(lineVisible, 7)).toBe(8);
		// Index 4 is equidistant — should pick one (implementation picks first found with min distance)
		const mapped = nearestVisibleIndex(lineVisible, 4);
		expect(lineVisible).toContain(mapped);
	});
});

describe('sub-step: diffing', () => {
	it('diff between sub-steps shows incremental changes', () => {
		const p = program([
			step(1, [{ op: 'addEntry', parentId: null, entry: entry('a', '0') }], true),
			step(1, [{ op: 'addEntry', parentId: null, entry: entry('b', '0') }], true),
			step(1, [{ op: 'setValue', id: 'a', value: '1' }]),
		]);

		const snapshots = buildSnapshots(p);

		// Diff 0→1: b was added
		const diff01 = diffSnapshots(snapshots[0], snapshots[1]);
		expect(diff01.added).toEqual(['b']);
		expect(diff01.changed).toHaveLength(0);

		// Diff 1→2: a changed value
		const diff12 = diffSnapshots(snapshots[1], snapshots[2]);
		expect(diff12.added).toHaveLength(0);
		expect(diff12.changed).toEqual([{ id: 'a', from: '0', to: '1' }]);
	});

	it('diff in line mode skips intermediate sub-step states', () => {
		const p = program([
			step(1, [{ op: 'addEntry', parentId: null, entry: entry('a', '0') }]),     // anchor 0
			step(2, [{ op: 'setValue', id: 'a', value: '1' }], true),                   // sub
			step(2, [{ op: 'setValue', id: 'a', value: '2' }], true),                   // sub
			step(2, [{ op: 'setValue', id: 'a', value: '3' }]),                          // anchor 3
		]);

		const snapshots = buildSnapshots(p);
		const lineVisible = getVisibleIndices(p.steps, false); // [0, 3]

		// Line mode diff: 0 → 3 (skipping intermediate states)
		const diff = diffSnapshots(snapshots[lineVisible[0]], snapshots[lineVisible[1]]);
		expect(diff.changed).toEqual([{ id: 'a', from: '0', to: '3' }]);
		// The intermediate values '1' and '2' are not visible in this diff
	});
});

describe('sub-step: scope lifecycle in for-loops', () => {
	it('for-loop scope appears in sub-step init and disappears in sub-step exit', () => {
		const forScope: MemoryEntry = {
			id: 'for1', name: 'for', kind: 'scope', type: '', value: '', address: '',
			children: [entry('i', '0')],
		};

		const p = program([
			// Before loop
			step(1, [{ op: 'addEntry', parentId: null, entry: entry('x', '5') }]),
			// For init (sub-step)
			step(2, [{ op: 'addEntry', parentId: null, entry: forScope }], true),
			// Condition check (sub-step, no-op)
			step(2, [], true),
			// Body (anchor)
			step(3, [{ op: 'setValue', id: 'x', value: '10' }]),
			// Increment (sub-step)
			step(2, [{ op: 'setValue', id: 'i', value: '1' }], true),
			// Final check fails, remove scope (sub-step)
			step(2, [{ op: 'removeEntry', id: 'for1' }], true),
			// After loop (anchor)
			step(4, [{ op: 'setValue', id: 'x', value: '15' }]),
		]);

		const snapshots = buildSnapshots(p);

		// Before loop: no for scope
		expect(snapshots[0].find(e => e.id === 'for1')).toBeUndefined();

		// After init: for scope exists
		expect(snapshots[1].find(e => e.id === 'for1')).toBeDefined();

		// After body: for scope still exists
		expect(snapshots[3].find(e => e.id === 'for1')).toBeDefined();

		// After exit: for scope gone
		expect(snapshots[5].find(e => e.id === 'for1')).toBeUndefined();

		// After loop: for scope still gone
		expect(snapshots[6].find(e => e.id === 'for1')).toBeUndefined();

		// Line mode visible: [0, 3, 6]
		const lineVisible = getVisibleIndices(p.steps, false);
		expect(lineVisible).toEqual([0, 3, 6]);

		// In line mode, jumping from step 0 to step 3:
		// snapshot[3] must have the for scope (init ops were applied)
		expect(snapshots[3].find(e => e.id === 'for1')).toBeDefined();

		// Jumping from step 3 to step 6:
		// snapshot[6] must NOT have the for scope (exit ops were applied)
		expect(snapshots[6].find(e => e.id === 'for1')).toBeUndefined();
	});

	it('for-loop variable visible only during loop in line mode', () => {
		const p = program([
			step(1, [{ op: 'addEntry', parentId: null, entry: entry('sum', '0') }]),
			// init
			step(2, [{ op: 'addEntry', parentId: null, entry: entry('i', '0') }], true),
			// body
			step(3, [{ op: 'setValue', id: 'sum', value: '10' }]),
			// increment + exit
			step(2, [{ op: 'removeEntry', id: 'i' }], true),
			// after loop
			step(4, []),
		]);

		const snapshots = buildSnapshots(p);
		const lineVisible = getVisibleIndices(p.steps, false); // [0, 2, 4]

		// Step 0: no 'i'
		expect(snapshots[0].find(e => e.id === 'i')).toBeUndefined();
		// Step 2 (body): 'i' exists (from sub-step init)
		expect(snapshots[2].find(e => e.id === 'i')).toBeDefined();
		// Step 4 (after loop): 'i' gone (from sub-step exit)
		expect(snapshots[4].find(e => e.id === 'i')).toBeUndefined();
	});
});
