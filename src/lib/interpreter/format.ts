// === Printf/Scanf Format String Parser ===

export type FormatToken =
	| { kind: 'literal'; text: string }
	| {
			kind: 'specifier';
			rawText: string;
			flags: string;
			width?: number;
			precision?: number;
			specifier: string;
			suppress?: boolean;
	  };

// Regex matching a printf/scanf format specifier:
// %[flags][width][.precision][length]specifier
const FORMAT_RE = /%([-+0# ]*)(\*|\d+)?(?:\.(\*|\d+))?(hh?|ll?|[Lzjt])?([diouxXeEfFgGaAcspn%])/g;

/** Parse a format string into literal and specifier tokens. */
export function parseFormatString(format: string): FormatToken[] {
	const tokens: FormatToken[] = [];
	let lastIndex = 0;

	FORMAT_RE.lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = FORMAT_RE.exec(format)) !== null) {
		// Add literal text before this match
		if (match.index > lastIndex) {
			tokens.push({ kind: 'literal', text: format.slice(lastIndex, match.index) });
		}

		const [rawText, flags, width, precision, , specifier] = match;

		if (specifier === '%') {
			// %% is a literal percent
			tokens.push({ kind: 'literal', text: '%' });
		} else {
			tokens.push({
				kind: 'specifier',
				rawText,
				flags,
				width: width === '*' ? undefined : width !== undefined ? parseInt(width, 10) : undefined,
				precision: precision === '*' ? undefined : precision !== undefined ? parseInt(precision, 10) : undefined,
				specifier,
			});
		}

		lastIndex = FORMAT_RE.lastIndex;
	}

	// Add trailing literal text
	if (lastIndex < format.length) {
		tokens.push({ kind: 'literal', text: format.slice(lastIndex) });
	}

	return tokens;
}

// === Printf Formatting ===

export type PrintfResult = {
	output: string;
	warnings: string[];
};

/** Format a printf-style string with the given arguments.
 *  Args can be numbers or pre-resolved strings (for %s). */
export function applyPrintfFormat(format: string, args: (number | string)[]): PrintfResult {
	const tokens = parseFormatString(format);
	const warnings: string[] = [];
	let output = '';
	let argIdx = 0;

	for (const token of tokens) {
		if (token.kind === 'literal') {
			output += token.text;
			continue;
		}

		if (argIdx >= args.length) {
			output += '(missing)';
			warnings.push(`format '${token.rawText}': missing argument ${argIdx}`);
			argIdx++;
			continue;
		}

		const val = args[argIdx];
		argIdx++;

		output += formatValue(val, token, warnings);
	}

	return { output, warnings };
}

/** Format a single value according to a specifier token. */
function formatValue(val: number | string, token: FormatToken & { kind: 'specifier' }, warnings: string[]): string {
	const { specifier, flags, width, precision } = token;
	let result: string;

	// Handle %s with pre-resolved string values
	if (specifier === 's') {
		if (typeof val === 'string') {
			result = applyStringPrecision(val, precision);
		} else if (val === 0) {
			result = '(null)';
		} else {
			result = '(string)';
		}
		return applyWidthAndFlags(result, flags ?? '', width, specifier);
	}

	// All other specifiers expect numeric values
	const num = typeof val === 'number' ? val : 0;

	switch (specifier) {
		case 'd':
		case 'i':
			result = String(Math.trunc(num));
			break;
		case 'u':
			result = String(num < 0 ? (num >>> 0) : Math.trunc(num));
			break;
		case 'x':
			result = (num < 0 ? (num >>> 0) : Math.trunc(num)).toString(16);
			break;
		case 'X':
			result = (num < 0 ? (num >>> 0) : Math.trunc(num)).toString(16).toUpperCase();
			break;
		case 'f':
		case 'F':
			result = num.toFixed(precision ?? 6);
			break;
		case 'c':
			result = String.fromCharCode(num & 0xff);
			break;
		case 'p':
			result = '0x' + (num < 0 ? (num >>> 0) : num).toString(16);
			break;
		default:
			result = `%${specifier}`;
			warnings.push(`unsupported format specifier '${specifier}'`);
			return result;
	}

	return applyWidthAndFlags(result, flags ?? '', width, specifier);
}

/** Apply field width, alignment, and padding to a formatted value. */
function applyWidthAndFlags(value: string, flags: string, width: number | undefined, specifier: string): string {
	if (width === undefined || value.length >= width) return value;

	const leftAlign = flags.includes('-');
	const zeroPad = flags.includes('0') && !leftAlign && 'diouxXfFeEgG'.includes(specifier);
	const padChar = zeroPad ? '0' : ' ';
	const padding = padChar.repeat(width - value.length);

	if (leftAlign) {
		return value + ' '.repeat(width - value.length);
	}

	if (zeroPad && (value.startsWith('-') || value.startsWith('+'))) {
		return value[0] + padding + value.slice(1);
	}

	return padding + value;
}

// === Scanf Token Types ===

export type ScanfToken =
	| { kind: 'whitespace' }
	| { kind: 'literal'; char: string }
	| {
			kind: 'specifier';
			specifier: string;
			suppress: boolean;
			width?: number;
			/** Whether this specifier auto-skips leading whitespace before matching */
			skipsWhitespace: boolean;
	  };

// Scanf format regex: %[*][width][length]specifier
const SCANF_RE = /%([\*]?)(\d+)?(hh?|ll?|[Lzjt])?([diouxXeEfFgGcspn\[])/g;

/** Parse a scanf format string into tokens. */
export function parseScanfFormat(format: string): ScanfToken[] {
	const tokens: ScanfToken[] = [];
	let lastIndex = 0;

	SCANF_RE.lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = SCANF_RE.exec(format)) !== null) {
		// Process literal characters between specifiers
		for (let i = lastIndex; i < match.index; i++) {
			const ch = format[i];
			if (ch === ' ' || ch === '\t' || ch === '\n') {
				// Any whitespace in format = "skip any whitespace in input"
				// Collapse consecutive whitespace into one token
				if (tokens.length === 0 || tokens[tokens.length - 1].kind !== 'whitespace') {
					tokens.push({ kind: 'whitespace' });
				}
			} else if (ch === '%' && i + 1 < format.length && format[i + 1] === '%') {
				tokens.push({ kind: 'literal', char: '%' });
				i++; // skip second %
			} else {
				tokens.push({ kind: 'literal', char: ch });
			}
		}

		const [, suppress, width, , specifier] = match;

		// %c, %n, %[ do NOT skip leading whitespace
		const noSkipSpecifiers = 'cn[';
		const skipsWhitespace = !noSkipSpecifiers.includes(specifier);

		tokens.push({
			kind: 'specifier',
			specifier,
			suppress: suppress === '*',
			width: width !== undefined ? parseInt(width, 10) : undefined,
			skipsWhitespace,
		});

		lastIndex = SCANF_RE.lastIndex;
	}

	// Process trailing literal characters
	for (let i = lastIndex; i < format.length; i++) {
		const ch = format[i];
		if (ch === ' ' || ch === '\t' || ch === '\n') {
			if (tokens.length === 0 || tokens[tokens.length - 1].kind !== 'whitespace') {
				tokens.push({ kind: 'whitespace' });
			}
		} else {
			tokens.push({ kind: 'literal', char: ch });
		}
	}

	return tokens;
}

/** Apply string precision truncation for %s format. */
export function applyStringPrecision(value: string, precision: number | undefined): string {
	if (precision !== undefined && value.length > precision) {
		return value.slice(0, precision);
	}
	return value;
}
