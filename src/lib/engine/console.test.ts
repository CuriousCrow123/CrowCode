import { describe, it, expect } from 'vitest';
import { buildConsoleOutputs } from './console';
import type { ProgramStep } from '$lib/types';

function step(ioEvents?: ProgramStep['ioEvents']): ProgramStep {
	return { location: { line: 1 }, ops: [], ioEvents };
}

describe('buildConsoleOutputs', () => {
	it('accumulates stdout text across steps', () => {
		const steps = [
			step([{ kind: 'write', target: 'stdout', text: 'hello ' }]),
			step([{ kind: 'write', target: 'stdout', text: 'world' }]),
			step(undefined),
		];
		const outputs = buildConsoleOutputs(steps);
		expect(outputs[0]).toBe('hello ');
		expect(outputs[1]).toBe('hello world');
		expect(outputs[2]).toBe('hello world');
	});

	it('backward stepping: outputs[0] does not include step 1 text', () => {
		const steps = [
			step([{ kind: 'write', target: 'stdout', text: 'first' }]),
			step([{ kind: 'write', target: 'stdout', text: 'second' }]),
		];
		const outputs = buildConsoleOutputs(steps);
		expect(outputs[0]).toBe('first');
		expect(outputs[1]).toBe('firstsecond');
	});

	it('handles steps with no ioEvents', () => {
		const steps = [step(undefined), step(undefined)];
		const outputs = buildConsoleOutputs(steps);
		expect(outputs[0]).toBe('');
		expect(outputs[1]).toBe('');
	});

	it('read events do not add text to console output (no echo in pre-supplied mode)', () => {
		const steps = [
			step([{ kind: 'write', target: 'stdout', text: 'Enter: ' }]),
			step([{ kind: 'read', source: 'stdin', consumed: '42', cursorPos: 2 }]),
			step([{ kind: 'write', target: 'stdout', text: 'Got it!' }]),
		];
		const outputs = buildConsoleOutputs(steps);
		expect(outputs[0]).toBe('Enter: ');
		expect(outputs[1]).toBe('Enter: ');
		expect(outputs[2]).toBe('Enter: Got it!');
	});

	it('handles empty steps array', () => {
		expect(buildConsoleOutputs([])).toEqual([]);
	});
});
