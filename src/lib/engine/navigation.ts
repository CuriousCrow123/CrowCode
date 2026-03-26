import type { ProgramStep } from '$lib/types';

/** Get indices of steps visible in the current mode. */
export function getVisibleIndices(steps: ProgramStep[], subStepMode: boolean): number[] {
	if (subStepMode) {
		return steps.map((_, i) => i);
	}
	return steps
		.map((step, i) => ({ step, i }))
		.filter(({ step }) => !step.subStep)
		.map(({ i }) => i);
}

/** Find the nearest visible index to a given internal index. */
export function nearestVisibleIndex(visibleIndices: number[], currentIndex: number): number {
	if (visibleIndices.length === 0) return 0;

	let best = visibleIndices[0];
	let bestDist = Math.abs(best - currentIndex);

	for (const idx of visibleIndices) {
		const dist = Math.abs(idx - currentIndex);
		if (dist < bestDist) {
			best = idx;
			bestDist = dist;
		}
	}

	return best;
}
