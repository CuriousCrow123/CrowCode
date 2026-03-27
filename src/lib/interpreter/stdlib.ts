import type { CType, CValue, ChildSpec } from './types';
import { sizeOf, primitiveType, isStructType, isArrayType } from './types-c';

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
			case 'sprintf':
			case 'fprintf':
			case 'puts':
			case 'putchar':
				// I/O functions are no-ops
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
