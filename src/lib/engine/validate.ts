import type { MemoryEntry, Program } from '$lib/types';
import { buildSnapshots } from './snapshot';

export type ValidationError = {
	step: number;
	message: string;
};

/** Collect all ids in a snapshot tree */
function collectIds(entries: MemoryEntry[]): string[] {
	const ids: string[] = [];

	function walk(list: MemoryEntry[]) {
		for (const entry of list) {
			ids.push(entry.id);
			if (entry.children) walk(entry.children);
		}
	}

	walk(entries);
	return ids;
}

/** Validate a program's steps and resulting snapshots. */
export function validateProgram(program: Program): ValidationError[] {
	const errors: ValidationError[] = [];

	if (program.steps.length === 0) {
		errors.push({ step: -1, message: 'Program has no steps' });
		return errors;
	}

	const snapshots = buildSnapshots(program);

	for (let i = 0; i < snapshots.length; i++) {
		const snapshot = snapshots[i];
		const ids = collectIds(snapshot);

		// Check for duplicate ids
		const seen = new Set<string>();
		for (const id of ids) {
			if (seen.has(id)) {
				errors.push({ step: i, message: `Duplicate id '${id}'` });
			}
			seen.add(id);
		}

		// Check non-scope, non-heap, non-io entries have addresses
		function checkAddresses(entries: MemoryEntry[]) {
			for (const entry of entries) {
				if (!entry.kind && !entry.address) {
					errors.push({ step: i, message: `Entry '${entry.id}' (${entry.name}) has no address` });
				}
				if (entry.children) checkAddresses(entry.children);
			}
		}
		checkAddresses(snapshot);
	}

	// Check subStep anchor rule: if all steps for a line are subStep, warn
	const lineSteps = new Map<number, boolean[]>();
	for (const step of program.steps) {
		const line = step.location.line;
		if (!lineSteps.has(line)) lineSteps.set(line, []);
		lineSteps.get(line)!.push(step.subStep ?? false);
	}
	for (const [line, subs] of lineSteps) {
		if (subs.every((s) => s)) {
			errors.push({
				step: -1,
				message: `Line ${line}: all steps are subStep=true, last should be promoted to anchor`,
			});
		}
	}

	return errors;
}
