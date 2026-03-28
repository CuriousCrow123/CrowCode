/**
 * C escape sequence processing for string and character literals.
 *
 * Supports 7 common escapes: \n \t \r \0 \\ \' \"
 * Unknown escapes: drop backslash, keep char (GCC behavior).
 */

const ESCAPE_MAP: Record<string, string> = {
	n: '\n',
	t: '\t',
	r: '\r',
	'0': '\0',
	'\\': '\\',
	"'": "'",
	'"': '"',
};

/**
 * Process C escape sequences in a string literal value (quotes already stripped).
 * Returns the processed string and any warnings for unknown escapes.
 */
export function processEscapes(raw: string): { value: string; warnings: string[] } {
	const warnings: string[] = [];
	let result = '';
	let i = 0;

	while (i < raw.length) {
		if (raw[i] === '\\' && i + 1 < raw.length) {
			const next = raw[i + 1];
			const mapped = ESCAPE_MAP[next];
			if (mapped !== undefined) {
				result += mapped;
			} else {
				// GCC behavior: drop backslash, keep character, warn
				result += next;
				warnings.push(`Unknown escape sequence '\\${next}'`);
			}
			i += 2;
		} else {
			result += raw[i];
			i++;
		}
	}

	return { value: result, warnings };
}

/**
 * Process a C character literal (including surrounding quotes).
 * Returns the numeric char code and any warnings.
 *
 * Examples: 'A' → 65, '\n' → 10, '\0' → 0
 */
export function processCharLiteral(text: string): { value: number; warnings: string[] } {
	// Strip surrounding quotes
	const inner = text.slice(1, -1);
	const warnings: string[] = [];

	if (inner.length === 0) {
		warnings.push('Empty character literal');
		return { value: 0, warnings };
	}

	if (inner[0] === '\\' && inner.length >= 2) {
		const mapped = ESCAPE_MAP[inner[1]];
		if (mapped !== undefined) {
			if (inner.length > 2) {
				warnings.push(`Multi-character character literal '${text}'`);
			}
			return { value: mapped.charCodeAt(0), warnings };
		}
		// Unknown escape: drop backslash, use next char
		warnings.push(`Unknown escape sequence '\\${inner[1]}'`);
		return { value: inner.charCodeAt(1), warnings };
	}

	// Simple character literal
	if (inner.length > 1) {
		warnings.push(`Multi-character character literal '${text}'`);
	}
	return { value: inner.charCodeAt(0), warnings };
}
