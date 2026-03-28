import { describe, it, expect } from 'vitest';
import { processEscapes, processCharLiteral } from './escapes';

describe('processEscapes', () => {
	describe('named escapes', () => {
		it('converts \\n to newline', () => {
			expect(processEscapes('hello\\nworld').value).toBe('hello\nworld');
		});

		it('converts \\t to tab', () => {
			expect(processEscapes('a\\tb').value).toBe('a\tb');
		});

		it('converts \\r to carriage return', () => {
			expect(processEscapes('a\\rb').value).toBe('a\rb');
		});

		it('converts \\0 to null byte', () => {
			expect(processEscapes('a\\0b').value).toBe('a\0b');
		});

		it('converts \\\\ to single backslash', () => {
			expect(processEscapes('a\\\\b').value).toBe('a\\b');
		});

		it("converts \\' to single quote", () => {
			expect(processEscapes("a\\'b").value).toBe("a'b");
		});

		it('converts \\" to double quote', () => {
			expect(processEscapes('a\\"b').value).toBe('a"b');
		});
	});

	describe('unknown escapes', () => {
		it('drops backslash and keeps character (GCC behavior)', () => {
			const result = processEscapes('a\\qb');
			expect(result.value).toBe('aqb');
		});

		it('produces a warning for unknown escape', () => {
			const result = processEscapes('a\\qb');
			expect(result.warnings).toHaveLength(1);
			expect(result.warnings[0]).toContain('\\q');
		});
	});

	describe('mixed and edge cases', () => {
		it('handles adjacent escapes', () => {
			expect(processEscapes('\\n\\t').value).toBe('\n\t');
		});

		it('handles escape at start of string', () => {
			expect(processEscapes('\\nhello').value).toBe('\nhello');
		});

		it('handles escape at end of string', () => {
			expect(processEscapes('hello\\n').value).toBe('hello\n');
		});

		it('handles string with no escapes', () => {
			expect(processEscapes('hello').value).toBe('hello');
		});

		it('handles empty string', () => {
			expect(processEscapes('').value).toBe('');
		});

		it('handles multiple newlines', () => {
			expect(processEscapes('\\n\\n\\n').value).toBe('\n\n\n');
		});

		it('handles trailing lone backslash', () => {
			// Backslash at end with no following char — keep as-is
			expect(processEscapes('hello\\').value).toBe('hello\\');
		});

		it('produces no warnings for known escapes', () => {
			expect(processEscapes('hello\\nworld').warnings).toHaveLength(0);
		});
	});
});

describe('processCharLiteral', () => {
	describe('simple characters', () => {
		it("'A' → 65", () => {
			expect(processCharLiteral("'A'").value).toBe(65);
		});

		it("'0' → 48", () => {
			expect(processCharLiteral("'0'").value).toBe(48);
		});

		it("' ' → 32", () => {
			expect(processCharLiteral("' '").value).toBe(32);
		});
	});

	describe('escape sequences', () => {
		it("'\\n' → 10", () => {
			expect(processCharLiteral("'\\n'").value).toBe(10);
		});

		it("'\\t' → 9", () => {
			expect(processCharLiteral("'\\t'").value).toBe(9);
		});

		it("'\\r' → 13", () => {
			expect(processCharLiteral("'\\r'").value).toBe(13);
		});

		it("'\\0' → 0", () => {
			expect(processCharLiteral("'\\0'").value).toBe(0);
		});

		it("'\\\\' → 92", () => {
			expect(processCharLiteral("'\\\\'").value).toBe(92);
		});

		it("'\\'' → 39", () => {
			expect(processCharLiteral("'\\''").value).toBe(39);
		});
	});

	describe('edge cases', () => {
		it('warns on multi-character literal', () => {
			const result = processCharLiteral("'ab'");
			expect(result.value).toBe(97); // 'a'
			expect(result.warnings).toHaveLength(1);
			expect(result.warnings[0]).toContain('Multi-character');
		});

		it('warns on empty character literal', () => {
			const result = processCharLiteral("''");
			expect(result.value).toBe(0);
			expect(result.warnings).toHaveLength(1);
		});

		it('warns on unknown escape in char literal', () => {
			const result = processCharLiteral("'\\q'");
			expect(result.value).toBe('q'.charCodeAt(0));
			expect(result.warnings).toHaveLength(1);
			expect(result.warnings[0]).toContain('\\q');
		});

		it('no warnings for valid escape', () => {
			expect(processCharLiteral("'\\n'").warnings).toHaveLength(0);
		});
	});
});
