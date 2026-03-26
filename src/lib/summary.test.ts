import { describe, it, expect } from 'vitest';
import { summarize } from './summary';
import type { MemoryEntry } from '$lib/types';

function entry(id: string, type: string, value: string, children?: MemoryEntry[]): MemoryEntry {
	return { id, name: id, type, value, address: '0x00', children };
}

describe('summarize', () => {
	it('returns value for leaf entry', () => {
		expect(summarize(entry('x', 'int', '42'))).toBe('42');
	});

	it('returns value for entry with empty children', () => {
		expect(summarize(entry('x', 'int', '42', []))).toBe('42');
	});

	it('returns {...} for struct', () => {
		const s = entry('p', 'struct Point', '', [
			entry('x', 'int', '10'),
			entry('y', 'int', '20'),
		]);
		expect(summarize(s)).toBe('{...}');
	});

	it('returns preview for array with <= 3 elements', () => {
		const a = entry('arr', 'int[2]', '', [
			entry('0', 'int', '1'),
			entry('1', 'int', '2'),
		]);
		expect(summarize(a)).toBe('{1, 2}');
	});

	it('returns preview for array with exactly 3 elements', () => {
		const a = entry('arr', 'int[3]', '', [
			entry('0', 'int', '10'),
			entry('1', 'int', '20'),
			entry('2', 'int', '30'),
		]);
		expect(summarize(a)).toBe('{10, 20, 30}');
	});

	it('returns truncated preview for array with > 3 elements', () => {
		const a = entry('arr', 'int[5]', '', [
			entry('0', 'int', '1'),
			entry('1', 'int', '2'),
			entry('2', 'int', '3'),
			entry('3', 'int', '4'),
			entry('4', 'int', '5'),
		]);
		expect(summarize(a)).toBe('{1, 2, 3, ...2 more}');
	});

	it('handles array of structs recursively', () => {
		const a = entry('arr', 'struct Point[2]', '', [
			entry('0', 'struct Point', '', [
				entry('x', 'int', '1'),
				entry('y', 'int', '2'),
			]),
			entry('1', 'struct Point', '', [
				entry('x', 'int', '3'),
				entry('y', 'int', '4'),
			]),
		]);
		// Each child struct summarizes to {...}
		expect(summarize(a)).toBe('{{...}, {...}}');
	});

	it('handles pointer type as array-like', () => {
		const p = entry('ptr', 'int*', '', [
			entry('0', 'int', '10'),
			entry('1', 'int', '20'),
		]);
		expect(summarize(p)).toBe('{10, 20}');
	});

	it('struct array uses array preview, not struct shorthand', () => {
		// type is "struct X[3]" — includes both "struct" and "["
		const a = entry('arr', 'struct Entity[3]', '', [
			entry('0', 'struct Entity', '', [entry('id', 'int', '1')]),
			entry('1', 'struct Entity', '', [entry('id', 'int', '2')]),
			entry('2', 'struct Entity', '', [entry('id', 'int', '3')]),
		]);
		expect(summarize(a)).toBe('{{...}, {...}, {...}}');
	});
});
