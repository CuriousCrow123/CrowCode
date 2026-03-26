import { describe, it, expect } from 'vitest';
import { validateProgram } from './validate';
import type { Program, MemoryEntry } from '$lib/api/types';

function entry(id: string, name: string, address: string = '0x00'): MemoryEntry {
	return { id, name, type: 'int', value: '0', address };
}

function scopeEntry(id: string, name: string, children?: MemoryEntry[]): MemoryEntry {
	return { id, name, kind: 'scope', type: '', value: '', address: '', children };
}

function program(steps: Program['steps']): Program {
	return { name: 'test', source: '', steps };
}

describe('validateProgram', () => {
	it('returns error for empty program', () => {
		const errors = validateProgram(program([]));
		expect(errors).toHaveLength(1);
		expect(errors[0].message).toContain('no steps');
	});

	it('valid program returns no errors', () => {
		const errors = validateProgram(program([
			{
				location: { line: 1 },
				ops: [{ op: 'addEntry', parentId: null, entry: scopeEntry('main', 'main()', [entry('x', 'x')]) }],
			},
		]));
		expect(errors).toHaveLength(0);
	});

	it('detects duplicate ids within a snapshot', () => {
		const errors = validateProgram(program([
			{
				location: { line: 1 },
				ops: [
					{ op: 'addEntry', parentId: null, entry: entry('a', 'x') },
					{ op: 'addEntry', parentId: null, entry: entry('a', 'y') },
				],
			},
		]));
		expect(errors.some((e) => e.message.includes("Duplicate id 'a'"))).toBe(true);
	});

	it('detects missing address on non-scope entry', () => {
		const noAddr: MemoryEntry = { id: 'x', name: 'x', type: 'int', value: '0', address: '' };
		const errors = validateProgram(program([
			{
				location: { line: 1 },
				ops: [{ op: 'addEntry', parentId: null, entry: noAddr }],
			},
		]));
		expect(errors.some((e) => e.message.includes('no address'))).toBe(true);
	});

	it('scope entries are allowed to have empty address', () => {
		const errors = validateProgram(program([
			{
				location: { line: 1 },
				ops: [{ op: 'addEntry', parentId: null, entry: scopeEntry('main', 'main()') }],
			},
		]));
		expect(errors).toHaveLength(0);
	});

	it('detects all-subStep lines (missing anchor)', () => {
		const errors = validateProgram(program([
			{
				location: { line: 5 },
				subStep: true,
				ops: [{ op: 'addEntry', parentId: null, entry: entry('a', 'x') }],
			},
			{
				location: { line: 5 },
				subStep: true,
				ops: [{ op: 'setValue', id: 'a', value: '1' }],
			},
		]));
		expect(errors.some((e) => e.message.includes('Line 5') && e.message.includes('anchor'))).toBe(true);
	});

	it('mixed subStep and anchor on same line is valid', () => {
		const errors = validateProgram(program([
			{
				location: { line: 5 },
				subStep: true,
				ops: [{ op: 'addEntry', parentId: null, entry: entry('a', 'x') }],
			},
			{
				location: { line: 5 },
				ops: [{ op: 'setValue', id: 'a', value: '1' }],
			},
		]));
		const anchorErrors = errors.filter((e) => e.message.includes('anchor'));
		expect(anchorErrors).toHaveLength(0);
	});

	it('validates across multiple steps', () => {
		// Step 0 adds entry, step 1 adds duplicate
		const errors = validateProgram(program([
			{
				location: { line: 1 },
				ops: [{ op: 'addEntry', parentId: null, entry: entry('a', 'x') }],
			},
			{
				location: { line: 2 },
				ops: [{ op: 'addEntry', parentId: null, entry: entry('a', 'y') }],
			},
		]));
		// Step 1 should have the duplicate
		expect(errors.some((e) => e.step === 1 && e.message.includes("Duplicate id 'a'"))).toBe(true);
	});
});
