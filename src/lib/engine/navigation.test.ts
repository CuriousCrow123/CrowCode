import { describe, it, expect } from 'vitest';
import { getVisibleIndices, nearestVisibleIndex } from './navigation';
import type { ProgramStep } from '$lib/types';

function step(line: number, subStep?: boolean): ProgramStep {
	return { location: { line }, ops: [], subStep };
}

describe('getVisibleIndices', () => {
	const steps = [
		step(1),              // 0: anchor
		step(2, true),        // 1: sub-step
		step(2, true),        // 2: sub-step
		step(2),              // 3: anchor
		step(3, true),        // 4: sub-step
		step(3),              // 5: anchor
	];

	it('sub-step mode returns all indices', () => {
		expect(getVisibleIndices(steps, true)).toEqual([0, 1, 2, 3, 4, 5]);
	});

	it('line mode returns only non-subStep indices', () => {
		expect(getVisibleIndices(steps, false)).toEqual([0, 3, 5]);
	});

	it('handles all-anchor steps', () => {
		const allAnchors = [step(1), step(2), step(3)];
		expect(getVisibleIndices(allAnchors, false)).toEqual([0, 1, 2]);
	});

	it('handles empty steps', () => {
		expect(getVisibleIndices([], false)).toEqual([]);
		expect(getVisibleIndices([], true)).toEqual([]);
	});
});

describe('nearestVisibleIndex', () => {
	it('returns exact match when available', () => {
		expect(nearestVisibleIndex([0, 3, 5], 3)).toBe(3);
	});

	it('returns nearest when not exact', () => {
		expect(nearestVisibleIndex([0, 3, 5], 2)).toBe(3);
		expect(nearestVisibleIndex([0, 3, 5], 4)).toBe(3); // equidistant, picks first found
	});

	it('returns first index for empty-ish cases', () => {
		expect(nearestVisibleIndex([0], 5)).toBe(0);
	});

	it('returns 0 for empty visible indices', () => {
		expect(nearestVisibleIndex([], 5)).toBe(0);
	});

	// BUG DEMONSTRATION: what happens when visiblePosition is computed
	// from an internalIndex that isn't in the visible list?
	it('demonstrates the -1 visiblePosition problem', () => {
		const steps = [
			step(1),              // 0: anchor
			step(2, true),        // 1: sub-step
			step(2, true),        // 2: sub-step
			step(2),              // 3: anchor
		];

		// User is on sub-step index 2 in sub-step mode
		const internalIndex = 2;

		// Toggle to line mode
		const lineVisible = getVisibleIndices(steps, false); // [0, 3]

		// indexOf returns -1 because index 2 is not in [0, 3]
		const visiblePosition = lineVisible.indexOf(internalIndex);
		expect(visiblePosition).toBe(-1); // THIS IS THE BUG

		// With nearestVisibleIndex, we get a valid index
		const corrected = nearestVisibleIndex(lineVisible, internalIndex);
		expect(lineVisible.indexOf(corrected)).not.toBe(-1); // This is correct
	});
});
