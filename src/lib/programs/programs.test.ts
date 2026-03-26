import { describe, it, expect, vi } from 'vitest';
import { basics } from './basics';
import { loops } from './loops';
import { buildSnapshots, indexById } from '$lib/engine/snapshot';
import { validateProgram } from '$lib/engine/validate';
import { getVisibleIndices } from '$lib/engine/navigation';
import type { Program, MemoryEntry } from '$lib/api/types';

function testProgram(name: string, program: Program) {
	describe(name, () => {
		it('has steps', () => {
			expect(program.steps.length).toBeGreaterThan(0);
		});

		it('has source', () => {
			expect(program.source.length).toBeGreaterThan(0);
		});

		it('has a name', () => {
			expect(program.name.length).toBeGreaterThan(0);
		});

		it('builds without engine errors', () => {
			const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			buildSnapshots(program);
			expect(spy).not.toHaveBeenCalled();
			spy.mockRestore();
		});

		it('passes validation', () => {
			const errors = validateProgram(program);
			if (errors.length > 0) {
				console.log('Validation errors:', errors);
			}
			expect(errors).toHaveLength(0);
		});

		it('all step line numbers are within source range', () => {
			const lineCount = program.source.split('\n').length;
			for (let i = 0; i < program.steps.length; i++) {
				const step = program.steps[i];
				expect(step.location.line).toBeGreaterThanOrEqual(1);
				expect(step.location.line).toBeLessThanOrEqual(lineCount);
			}
		});

		it('all step column ranges are within line length', () => {
			const lines = program.source.split('\n');
			for (let i = 0; i < program.steps.length; i++) {
				const step = program.steps[i];
				const loc = step.location;
				if (loc.colStart !== undefined && loc.colEnd !== undefined) {
					const lineText = lines[loc.line - 1];
					expect(loc.colStart).toBeGreaterThanOrEqual(0);
					expect(loc.colEnd).toBeLessThanOrEqual(lineText.length);
					expect(loc.colStart).toBeLessThan(loc.colEnd);
				}
			}
		});

		it('all ids are unique within each snapshot', () => {
			const snapshots = buildSnapshots(program);
			for (let i = 0; i < snapshots.length; i++) {
				const idx = indexById(snapshots[i]);
				// indexById overwrites duplicates, so size < count means duplicates
				let count = 0;
				function walk(entries: MemoryEntry[]) {
					for (const e of entries) {
						count++;
						if (e.children) walk(e.children);
					}
				}
				walk(snapshots[i]);
				expect(idx.size).toBe(count);
			}
		});

		it('every snapshot is independently cloned', () => {
			const snapshots = buildSnapshots(program);
			if (snapshots.length < 2) return;

			// Mutate first snapshot
			const original = snapshots[1].length;
			snapshots[0].push(
				{ id: 'INJECTED', name: 'injected', type: '', value: '', address: '' }
			);
			// Second snapshot must be unaffected
			expect(snapshots[1].length).toBe(original);
		});

		it('line mode has at least one visible step', () => {
			const visible = getVisibleIndices(program.steps, false);
			expect(visible.length).toBeGreaterThan(0);
		});

		it('sub-step mode includes all steps', () => {
			const visible = getVisibleIndices(program.steps, true);
			expect(visible.length).toBe(program.steps.length);
		});

		it('line mode is a subset of sub-step mode', () => {
			const lineVisible = getVisibleIndices(program.steps, false);
			const subVisible = getVisibleIndices(program.steps, true);
			for (const idx of lineVisible) {
				expect(subVisible).toContain(idx);
			}
		});

		it('every step has a location', () => {
			for (const step of program.steps) {
				expect(step.location).toBeDefined();
				expect(step.location.line).toBeGreaterThan(0);
			}
		});

		it('first step creates at least one entry', () => {
			const snapshots = buildSnapshots(program);
			expect(snapshots[0].length).toBeGreaterThan(0);
		});
	});
}

testProgram('basics', basics);
testProgram('loops', loops);
