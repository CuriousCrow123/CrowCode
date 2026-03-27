import { describe, it, expect } from 'vitest';
import { getVisibleIndices, nearestVisibleIndex } from './navigation';
import type { ProgramStep } from '$lib/types';

function step(line: number, subStep?: boolean): ProgramStep {
	return { location: { line }, ops: [], subStep };
}

describe('BUG: visiblePosition can be -1', () => {
	// This demonstrates the bug in ProgramStepper where
	// visibleIndices.indexOf(internalIndex) returns -1
	// when internalIndex is on a sub-step that's not visible in line mode.

	const steps = [
		step(1),           // 0: anchor
		step(2, true),     // 1: sub-step (for init)
		step(2, true),     // 2: sub-step (condition check)
		step(3),           // 3: anchor (body)
		step(2, true),     // 4: sub-step (increment)
		step(2, true),     // 5: sub-step (condition check)
		step(3),           // 6: anchor (body)
		step(2, true),     // 7: sub-step (final check, exit)
	];

	it('indexOf returns -1 for sub-step indices in line mode', () => {
		const lineVisible = getVisibleIndices(steps, false); // [0, 3, 6]

		// These sub-step indices are NOT in the visible list
		expect(lineVisible.indexOf(1)).toBe(-1);
		expect(lineVisible.indexOf(2)).toBe(-1);
		expect(lineVisible.indexOf(4)).toBe(-1);
		expect(lineVisible.indexOf(5)).toBe(-1);
		expect(lineVisible.indexOf(7)).toBe(-1);
	});

	it('simulates the ProgramStepper bug: prev/next with -1 position', () => {
		const lineVisible = getVisibleIndices(steps, false); // [0, 3, 6]

		// Simulate: user is on sub-step index 2, toggles to line mode
		// WITHOUT using nearestVisibleIndex to correct
		const internalIndex = 2;
		const visiblePosition = lineVisible.indexOf(internalIndex); // -1

		// Simulate next(): pos < length - 1 → -1 < 2 → true
		// visibleIndices[-1 + 1] = visibleIndices[0] → jumps to start!
		const nextIndex = visiblePosition < lineVisible.length - 1
			? lineVisible[visiblePosition + 1]
			: undefined;
		expect(nextIndex).toBe(lineVisible[0]); // WRONG: jumps to start instead of next logical step

		// Simulate prev(): pos > 0 → -1 > 0 → false → does nothing
		const canGoPrev = visiblePosition > 0;
		expect(canGoPrev).toBe(false); // WRONG: should be able to go prev from middle of program
	});

	it('nearestVisibleIndex fixes the problem', () => {
		const lineVisible = getVisibleIndices(steps, false); // [0, 3, 6]

		// For every possible internal index, nearestVisibleIndex returns a valid visible index
		for (let i = 0; i < steps.length; i++) {
			const mapped = nearestVisibleIndex(lineVisible, i);
			const pos = lineVisible.indexOf(mapped);
			expect(pos).not.toBe(-1);
		}
	});
});

describe('BUG: visiblePosition should use nearestVisibleIndex, not indexOf', () => {
	// The fix: ProgramStepper.visiblePosition should be computed via
	// nearestVisibleIndex when indexOf returns -1, ensuring prev/next
	// always work correctly.

	const steps = [
		step(1),           // 0
		step(2, true),     // 1
		step(2),           // 2
		step(3, true),     // 3
		step(3),           // 4
	];

	it('safe visiblePosition always returns valid index into visibleIndices', () => {
		const lineVisible = getVisibleIndices(steps, false); // [0, 2, 4]

		function safeVisiblePosition(internalIndex: number): number {
			const direct = lineVisible.indexOf(internalIndex);
			if (direct !== -1) return direct;
			const nearest = nearestVisibleIndex(lineVisible, internalIndex);
			return lineVisible.indexOf(nearest);
		}

		// All internal indices produce valid positions
		for (let i = 0; i < steps.length; i++) {
			const pos = safeVisiblePosition(i);
			expect(pos).toBeGreaterThanOrEqual(0);
			expect(pos).toBeLessThan(lineVisible.length);
		}
	});
});
