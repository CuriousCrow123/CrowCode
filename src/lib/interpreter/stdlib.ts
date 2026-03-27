import type { CType, CValue, ChildSpec } from './types';
import { sizeOf, primitiveType, isStructType, isArrayType } from './types-c';
import type { IoState } from './io-state';
import { applyPrintfFormat, parseFormatString } from './format';

export type StdlibHandler = (
	name: string,
	args: CValue[],
	line: number,
) => { value: CValue; error?: string };

export type MemoryAccess = {
	read: (address: number) => number | undefined;
	write: (address: number, value: number) => void;
};

/** Interface for the subset of Memory/Environment that stdlib needs. */
export interface StdlibEnv {
	malloc(size: number, allocator: string, line: number): { address: number; error?: string };
	free(address: number): { error?: string };
}

export function createStdlib(
	env: StdlibEnv,
	mem?: MemoryAccess,
	io?: IoState,
): StdlibHandler {
	return (name: string, args: CValue[], line: number) => {
		switch (name) {
			case 'malloc':
				return handleMalloc(env, args, line);
			case 'calloc':
				return handleCalloc(env, args, line);
			case 'free':
				return handleFree(env, args, line);
			case 'printf':
				return handlePrintf(io, args, mem);
			case 'fprintf':
				return handleFprintf(io, args, mem);
			case 'puts':
				return handlePuts(io, args, mem);
			case 'putchar':
				return handlePutchar(io, args);
			case 'fputs':
				return handleFputs(io, args, mem);
			case 'getchar':
				return handleGetchar(io);
			case 'sprintf':
			case 'snprintf':
				// Handled at the statement level (executeCallStatement) for op emission
				return ok(0);
			case 'sizeof':
				return ok(args[0]?.data ?? 0);
			case 'strlen':
				return handleStrlen(mem, args);
			case 'strcpy':
				return handleStrcpy(mem, args);
			case 'strcmp':
				return handleStrcmp(mem, args);
			case 'strcat':
				return handleStrcat(mem, args);
			case 'abs':
				return handleAbs(args);
			case 'sqrt':
				return handleSqrt(args);
			case 'pow':
				return handlePow(args);
			default:
				return { value: voidVal(), error: `Unknown stdlib function: ${name}` };
		}
	};
}

function handleMalloc(
	env: StdlibEnv,
	args: CValue[],
	line: number,
): { value: CValue; error?: string } {
	const size = args[0]?.data ?? 0;
	const { address, error } = env.malloc(size, 'malloc', line);
	if (error) {
		return { value: voidVal(), error };
	}
	return {
		value: {
			type: { kind: 'pointer', pointsTo: primitiveType('void') },
			data: address,
			address: 0,
		},
	};
}

function handleCalloc(
	env: StdlibEnv,
	args: CValue[],
	line: number,
): { value: CValue; error?: string } {
	const count = args[0]?.data ?? 0;
	const elemSize = args[1]?.data ?? 0;
	const totalSize = count * elemSize;
	const { address, error } = env.malloc(totalSize, 'calloc', line);
	if (error) {
		return { value: voidVal(), error };
	}
	return {
		value: {
			type: { kind: 'pointer', pointsTo: primitiveType('void') },
			data: address,
			address: 0,
		},
	};
}

function handleFree(
	env: StdlibEnv,
	args: CValue[],
	line: number,
): { value: CValue; error?: string } {
	const ptr = args[0]?.data ?? 0;
	if (ptr === 0) {
		// free(NULL) is valid, does nothing
		return ok(0);
	}
	const result = env.free(ptr);
	if (result.error) {
		return { value: voidVal(), error: result.error };
	}
	return ok(0);
}

function ok(data: number): { value: CValue } {
	return { value: { type: primitiveType('int'), data, address: 0 } };
}

function voidVal(): CValue {
	return { type: primitiveType('void'), data: 0, address: 0 };
}

// === Child spec builders ===

export function buildStructChildSpecs(
	type: CType & { kind: 'struct' },
	initValues?: Map<string, string>,
): ChildSpec[] {
	return type.fields.map((field) => {
		const value = initValues?.get(field.name) ?? (isStructType(field.type) ? '' : '0');
		const spec: ChildSpec = {
			name: field.name,
			displayName: `.${field.name}`,
			type: field.type,
			value,
			addressOffset: field.offset,
		};

		if (isStructType(field.type)) {
			spec.children = buildStructChildSpecs(field.type);
		}

		return spec;
	});
}

export function buildArrayChildSpecs(
	elementType: CType,
	size: number,
	initValues?: string[],
): ChildSpec[] {
	const specs: ChildSpec[] = [];

	// Multi-dimensional: flatten nested array type into [i][j] children
	if (isArrayType(elementType)) {
		const innerSize = elementType.size;
		const innerElemType = elementType.elementType;
		const leafSize = sizeOf(innerElemType);
		const totalChildren = size * innerSize;
		const maxChildren = Math.min(totalChildren, 20);
		let flat = 0;
		for (let i = 0; i < size && flat < maxChildren; i++) {
			for (let j = 0; j < innerSize && flat < maxChildren; j++) {
				const value = initValues?.[flat] ?? '0';
				specs.push({
					name: String(flat),
					displayName: `[${i}][${j}]`,
					type: innerElemType,
					value,
					addressOffset: flat * leafSize,
				});
				flat++;
			}
		}
		return specs;
	}

	// Single-dimensional
	const elemSize = sizeOf(elementType);
	const maxChildren = Math.min(size, 20); // Cap at 20

	for (let i = 0; i < maxChildren; i++) {
		const value = initValues?.[i] ?? '0';
		specs.push({
			name: String(i),
			displayName: `[${i}]`,
			type: elementType,
			value,
			addressOffset: i * elemSize,
		});
	}

	return specs;
}

// === String functions ===

function handleStrlen(mem: MemoryAccess | undefined, args: CValue[]): { value: CValue; error?: string } {
	const addr = args[0]?.data ?? 0;
	if (addr === 0) return { value: voidVal(), error: 'strlen: null pointer' };
	if (!mem) return ok(0);
	let len = 0;
	const maxLen = 10000;
	while (len < maxLen) {
		const byte = mem.read(addr + len);
		if (byte === undefined || byte === 0) break;
		len++;
	}
	return ok(len);
}

function handleStrcpy(mem: MemoryAccess | undefined, args: CValue[]): { value: CValue; error?: string } {
	const dst = args[0]?.data ?? 0;
	const src = args[1]?.data ?? 0;
	if (dst === 0 || src === 0) return { value: voidVal(), error: 'strcpy: null pointer' };
	if (!mem) return ptrVal(dst);
	let i = 0;
	const maxLen = 10000;
	while (i < maxLen) {
		const byte = mem.read(src + i) ?? 0;
		mem.write(dst + i, byte);
		if (byte === 0) break;
		i++;
	}
	return ptrVal(dst);
}

function handleStrcmp(mem: MemoryAccess | undefined, args: CValue[]): { value: CValue; error?: string } {
	const a = args[0]?.data ?? 0;
	const b = args[1]?.data ?? 0;
	if (a === 0 || b === 0) return { value: voidVal(), error: 'strcmp: null pointer' };
	if (!mem) return ok(0);
	let i = 0;
	const maxLen = 10000;
	while (i < maxLen) {
		const ca = mem.read(a + i) ?? 0;
		const cb = mem.read(b + i) ?? 0;
		if (ca !== cb) return ok(ca < cb ? -1 : 1);
		if (ca === 0) break;
		i++;
	}
	return ok(0);
}

function handleStrcat(mem: MemoryAccess | undefined, args: CValue[]): { value: CValue; error?: string } {
	const dst = args[0]?.data ?? 0;
	const src = args[1]?.data ?? 0;
	if (dst === 0 || src === 0) return { value: voidVal(), error: 'strcat: null pointer' };
	if (!mem) return ptrVal(dst);
	// Find end of dst
	let dstEnd = 0;
	const maxLen = 10000;
	while (dstEnd < maxLen) {
		const byte = mem.read(dst + dstEnd) ?? 0;
		if (byte === 0) break;
		dstEnd++;
	}
	// Copy src
	let i = 0;
	while (i < maxLen) {
		const byte = mem.read(src + i) ?? 0;
		mem.write(dst + dstEnd + i, byte);
		if (byte === 0) break;
		i++;
	}
	return ptrVal(dst);
}

// === I/O output functions ===

function handlePrintf(io: IoState | undefined, args: CValue[], mem?: MemoryAccess): { value: CValue; error?: string } {
	if (!io) return ok(0);
	if (args.length === 0) return { value: voidVal(), error: 'printf: requires at least one argument' };

	const fmtStr = resolveStringArg(args[0], mem);
	if (fmtStr === null) return { value: voidVal(), error: 'printf: first argument must be a string' };

	const resolvedArgs = resolvePrintfArgs(fmtStr, args.slice(1), mem);
	const { output } = applyPrintfFormat(fmtStr, resolvedArgs);
	io.writeStdout(output);
	return ok(output.length);
}

function handleFprintf(io: IoState | undefined, args: CValue[], mem?: MemoryAccess): { value: CValue; error?: string } {
	if (!io) return ok(0);
	if (args.length < 2) return { value: voidVal(), error: 'fprintf: requires at least two arguments' };

	// First arg is the stream (1 = stdout, 2 = stderr in our model)
	const stream = args[0]?.data ?? 1;
	const fmtStr = resolveStringArg(args[1], mem);
	if (fmtStr === null) return ok(0);

	const resolvedArgs = resolvePrintfArgs(fmtStr, args.slice(2), mem);
	const { output } = applyPrintfFormat(fmtStr, resolvedArgs);

	if (stream === 2) {
		io.writeStderr(output);
	} else {
		io.writeStdout(output);
	}
	return ok(output.length);
}

function handlePuts(io: IoState | undefined, args: CValue[], mem?: MemoryAccess): { value: CValue; error?: string } {
	if (!io) return ok(0);
	const str = resolveStringArg(args[0], mem);
	const output = (str ?? '') + '\n';
	io.writeStdout(output);
	return ok(1); // puts returns non-negative on success
}

function handlePutchar(io: IoState | undefined, args: CValue[]): { value: CValue; error?: string } {
	if (!io) return ok(0);
	const ch = args[0]?.data ?? 0;
	io.writeStdout(String.fromCharCode(ch & 0xff));
	return ok(ch & 0xff);
}

function handleFputs(io: IoState | undefined, args: CValue[], mem?: MemoryAccess): { value: CValue; error?: string } {
	if (!io) return ok(0);
	const str = resolveStringArg(args[0], mem);
	if (str === null) return ok(0);
	// Second arg is stream (1 = stdout, 2 = stderr)
	const stream = args[1]?.data ?? 1;
	if (stream === 2) {
		io.writeStderr(str);
	} else {
		io.writeStdout(str);
	}
	return ok(1);
}

// === I/O input functions ===

function handleGetchar(io: IoState | undefined): { value: CValue; error?: string } {
	if (!io || io.isExhausted()) return ok(-1); // EOF
	const result = io.readChar();
	if (!result) return ok(-1);
	return ok(result.value);
}

/** Resolve printf arguments, converting %s args to strings and others to numbers. */
function resolvePrintfArgs(fmtStr: string, args: CValue[], mem?: MemoryAccess): (number | string)[] {
	const tokens = parseFormatString(fmtStr);
	const resolved: (number | string)[] = [];
	let argIdx = 0;

	for (const token of tokens) {
		if (token.kind !== 'specifier') continue;
		if (argIdx >= args.length) break;

		if (token.specifier === 's') {
			const str = resolveStringArg(args[argIdx], mem);
			resolved.push(str ?? '(null)');
		} else {
			resolved.push(args[argIdx].data ?? 0);
		}
		argIdx++;
	}

	return resolved;
}

/** Resolve a CValue to a string (for format strings and string args).
 *  Handles string literals (via stringValue field) and char* pointers (via memory reads). */
function resolveStringArg(arg: CValue | undefined, mem?: MemoryAccess): string | null {
	if (!arg) return null;
	// String literals carry their value directly
	if (arg.stringValue !== undefined) return arg.stringValue;
	// Char pointers: read from memory until null terminator
	if (arg.data && mem) {
		let str = '';
		let addr = arg.data;
		const maxLen = 10000;
		for (let i = 0; i < maxLen; i++) {
			const byte = mem.read(addr + i);
			if (byte === undefined || byte === 0) break;
			str += String.fromCharCode(byte);
		}
		return str;
	}
	return null;
}

// === Math functions ===

function handleAbs(args: CValue[]): { value: CValue; error?: string } {
	const x = args[0]?.data ?? 0;
	const result = Math.abs(x) | 0; // toInt32
	return ok(result);
}

function handleSqrt(args: CValue[]): { value: CValue; error?: string } {
	const x = args[0]?.data ?? 0;
	return doubleVal(Math.sqrt(x));
}

function handlePow(args: CValue[]): { value: CValue; error?: string } {
	const x = args[0]?.data ?? 0;
	const y = args[1]?.data ?? 0;
	return doubleVal(Math.pow(x, y));
}

function ptrVal(addr: number): { value: CValue } {
	return { value: { type: { kind: 'pointer', pointsTo: primitiveType('char') }, data: addr, address: 0 } };
}

function doubleVal(data: number): { value: CValue } {
	return { value: { type: primitiveType('double'), data, address: 0 } };
}
