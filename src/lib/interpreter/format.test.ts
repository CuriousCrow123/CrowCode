import { describe, it, expect } from 'vitest';
import {
	parseFormatString,
	applyPrintfFormat,
	parseScanfFormat,
	applyStringPrecision,
} from './format';

describe('parseFormatString', () => {
	it('parses simple literal', () => {
		const tokens = parseFormatString('hello');
		expect(tokens).toEqual([{ kind: 'literal', text: 'hello' }]);
	});

	it('parses %d specifier', () => {
		const tokens = parseFormatString('%d');
		expect(tokens).toHaveLength(1);
		expect(tokens[0]).toMatchObject({ kind: 'specifier', specifier: 'd' });
	});

	it('parses %% as literal percent', () => {
		const tokens = parseFormatString('%%');
		expect(tokens).toEqual([{ kind: 'literal', text: '%' }]);
	});

	it('parses mixed format string', () => {
		const tokens = parseFormatString('x=%d, y=%d');
		expect(tokens).toHaveLength(4);
		expect(tokens[0]).toEqual({ kind: 'literal', text: 'x=' });
		expect(tokens[1]).toMatchObject({ kind: 'specifier', specifier: 'd' });
		expect(tokens[2]).toEqual({ kind: 'literal', text: ', y=' });
		expect(tokens[3]).toMatchObject({ kind: 'specifier', specifier: 'd' });
	});

	it('parses field width', () => {
		const tokens = parseFormatString('%5d');
		expect(tokens[0]).toMatchObject({ kind: 'specifier', width: 5, specifier: 'd' });
	});

	it('parses precision', () => {
		const tokens = parseFormatString('%.2f');
		expect(tokens[0]).toMatchObject({ kind: 'specifier', precision: 2, specifier: 'f' });
	});

	it('parses width and precision together', () => {
		const tokens = parseFormatString('%8.2f');
		expect(tokens[0]).toMatchObject({ kind: 'specifier', width: 8, precision: 2, specifier: 'f' });
	});

	it('parses flags', () => {
		const tokens = parseFormatString('%-5d');
		expect(tokens[0]).toMatchObject({ kind: 'specifier', flags: '-', specifier: 'd' });
	});

	it('parses zero-pad flag', () => {
		const tokens = parseFormatString('%05d');
		expect(tokens[0]).toMatchObject({ kind: 'specifier', flags: '0', width: 5, specifier: 'd' });
	});

	it('parses %% embedded in longer format', () => {
		const tokens = parseFormatString('%d%%');
		expect(tokens).toHaveLength(2);
		expect(tokens[0]).toMatchObject({ kind: 'specifier', specifier: 'd' });
		expect(tokens[1]).toEqual({ kind: 'literal', text: '%' });
	});
});

describe('applyPrintfFormat', () => {
	describe('basic specifiers', () => {
		it('%d with positive integer', () => {
			expect(applyPrintfFormat('%d', [42]).output).toBe('42');
		});

		it('%d with negative integer', () => {
			expect(applyPrintfFormat('%d', [-1]).output).toBe('-1');
		});

		it('%i is same as %d for printf', () => {
			expect(applyPrintfFormat('%i', [42]).output).toBe('42');
		});

		it('%u with negative (unsigned wrap)', () => {
			expect(applyPrintfFormat('%u', [-1]).output).toBe('4294967295');
		});

		it('%x lowercase hex', () => {
			expect(applyPrintfFormat('%x', [255]).output).toBe('ff');
		});

		it('%X uppercase hex', () => {
			expect(applyPrintfFormat('%X', [255]).output).toBe('FF');
		});

		it('%c character', () => {
			expect(applyPrintfFormat('%c', [65]).output).toBe('A');
		});

		it('%s with pre-resolved string', () => {
			expect(applyPrintfFormat('%s', ['hello']).output).toBe('hello');
		});

		it('%s with NULL (0)', () => {
			expect(applyPrintfFormat('%s', [0]).output).toBe('(null)');
		});

		it('%s with unresolved numeric address', () => {
			expect(applyPrintfFormat('%s', [12345]).output).toBe('(string)');
		});

		it('%.3s truncates string', () => {
			expect(applyPrintfFormat('%.3s', ['hello']).output).toBe('hel');
		});

		it('%s mixed with other specifiers', () => {
			expect(applyPrintfFormat('name=%s, age=%d', ['Alice', 30]).output).toBe('name=Alice, age=30');
		});

		it('%f default precision', () => {
			expect(applyPrintfFormat('%f', [3.14]).output).toBe('3.140000');
		});

		it('%p pointer', () => {
			expect(applyPrintfFormat('%p', [0x55a0]).output).toBe('0x55a0');
		});

		it('%% literal percent', () => {
			expect(applyPrintfFormat('%%', []).output).toBe('%');
		});
	});

	describe('field width and precision', () => {
		it('right-pads with spaces for width', () => {
			expect(applyPrintfFormat('%5d', [42]).output).toBe('   42');
		});

		it('left-aligns with - flag', () => {
			expect(applyPrintfFormat('%-5d', [42]).output).toBe('42   ');
		});

		it('zero-pads with 0 flag', () => {
			expect(applyPrintfFormat('%05d', [42]).output).toBe('00042');
		});

		it('precision truncates float', () => {
			expect(applyPrintfFormat('%.2f', [3.14159]).output).toBe('3.14');
		});

		it('width and precision together', () => {
			expect(applyPrintfFormat('%8.2f', [3.14]).output).toBe('    3.14');
		});
	});

	describe('concatenated format strings', () => {
		it('multiple specifiers', () => {
			expect(applyPrintfFormat('x=%d, y=%d', [1, 2]).output).toBe('x=1, y=2');
		});

		it('multiple %c specifiers', () => {
			expect(applyPrintfFormat('[%c][%c]', [65, 66]).output).toBe('[A][B]');
		});

		it('%% embedded with specifier', () => {
			expect(applyPrintfFormat('%d%%', [50]).output).toBe('50%');
		});
	});

	describe('missing and excess arguments', () => {
		it('missing argument shows (missing) and warns', () => {
			const result = applyPrintfFormat('%d %d', [1]);
			expect(result.output).toBe('1 (missing)');
			expect(result.warnings).toHaveLength(1);
			expect(result.warnings[0]).toContain('missing');
		});

		it('extra arguments are silently ignored', () => {
			const result = applyPrintfFormat('%d', [1, 2]);
			expect(result.output).toBe('1');
			expect(result.warnings).toHaveLength(0);
		});
	});

	describe('edge cases', () => {
		it('empty format string', () => {
			expect(applyPrintfFormat('', []).output).toBe('');
		});

		it('no specifiers', () => {
			expect(applyPrintfFormat('hello world', []).output).toBe('hello world');
		});

		it('zero-pad with negative number preserves sign', () => {
			expect(applyPrintfFormat('%05d', [-42]).output).toBe('-0042');
		});
	});
});

describe('applyStringPrecision', () => {
	it('truncates string to precision', () => {
		expect(applyStringPrecision('hello', 3)).toBe('hel');
	});

	it('does not truncate shorter string', () => {
		expect(applyStringPrecision('hi', 5)).toBe('hi');
	});

	it('undefined precision returns full string', () => {
		expect(applyStringPrecision('hello', undefined)).toBe('hello');
	});
});

describe('parseScanfFormat', () => {
	it('parses %d as whitespace-skipping specifier', () => {
		const tokens = parseScanfFormat('%d');
		expect(tokens).toHaveLength(1);
		expect(tokens[0]).toMatchObject({
			kind: 'specifier',
			specifier: 'd',
			suppress: false,
			skipsWhitespace: true,
		});
	});

	it('parses %c as NON-whitespace-skipping specifier', () => {
		const tokens = parseScanfFormat('%c');
		expect(tokens).toHaveLength(1);
		expect(tokens[0]).toMatchObject({
			kind: 'specifier',
			specifier: 'c',
			skipsWhitespace: false,
		});
	});

	it('parses %*d as assignment-suppressed', () => {
		const tokens = parseScanfFormat('%*d');
		expect(tokens).toHaveLength(1);
		expect(tokens[0]).toMatchObject({
			kind: 'specifier',
			specifier: 'd',
			suppress: true,
		});
	});

	it('parses %s as whitespace-skipping, stops-at-whitespace', () => {
		const tokens = parseScanfFormat('%s');
		expect(tokens).toHaveLength(1);
		expect(tokens[0]).toMatchObject({
			kind: 'specifier',
			specifier: 's',
			skipsWhitespace: true,
		});
	});

	it('parses whitespace in format string as whitespace token', () => {
		const tokens = parseScanfFormat('%d %d');
		expect(tokens).toHaveLength(3);
		expect(tokens[0]).toMatchObject({ kind: 'specifier', specifier: 'd' });
		expect(tokens[1]).toEqual({ kind: 'whitespace' });
		expect(tokens[2]).toMatchObject({ kind: 'specifier', specifier: 'd' });
	});

	it('collapses consecutive whitespace into one token', () => {
		const tokens = parseScanfFormat('%d   %d');
		expect(tokens).toHaveLength(3);
		expect(tokens[1]).toEqual({ kind: 'whitespace' });
	});

	it('parses width specifier', () => {
		const tokens = parseScanfFormat('%3d');
		expect(tokens[0]).toMatchObject({ kind: 'specifier', width: 3, specifier: 'd' });
	});

	it('parses %i as whitespace-skipping', () => {
		const tokens = parseScanfFormat('%i');
		expect(tokens[0]).toMatchObject({
			kind: 'specifier',
			specifier: 'i',
			skipsWhitespace: true,
		});
	});

	it('parses %x as whitespace-skipping', () => {
		const tokens = parseScanfFormat('%x');
		expect(tokens[0]).toMatchObject({
			kind: 'specifier',
			specifier: 'x',
			skipsWhitespace: true,
		});
	});

	it('parses %f as whitespace-skipping', () => {
		const tokens = parseScanfFormat('%f');
		expect(tokens[0]).toMatchObject({
			kind: 'specifier',
			specifier: 'f',
			skipsWhitespace: true,
		});
	});

	it('parses literal characters', () => {
		const tokens = parseScanfFormat('(%d,%d)');
		expect(tokens).toHaveLength(5);
		expect(tokens[0]).toEqual({ kind: 'literal', char: '(' });
		expect(tokens[1]).toMatchObject({ kind: 'specifier', specifier: 'd' });
		expect(tokens[2]).toEqual({ kind: 'literal', char: ',' });
		expect(tokens[3]).toMatchObject({ kind: 'specifier', specifier: 'd' });
		expect(tokens[4]).toEqual({ kind: 'literal', char: ')' });
	});
});
