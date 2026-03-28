import type { ProgramStep } from '$lib/types';

/** Pre-compute cumulative console output per step. consoleOutputs[i] = full text after step i. */
export function buildConsoleOutputs(steps: ProgramStep[]): string[] {
	const outputs: string[] = [];
	let accumulated = '';

	for (const step of steps) {
		if (step.ioEvents) {
			for (const event of step.ioEvents) {
				if (event.kind === 'write') {
					accumulated += event.text;
				}
			}
		}
		outputs.push(accumulated);
	}

	return outputs;
}
