import type { CType, CValue, ChildSpec } from './types';
import { Environment, formatAddress } from './environment';
import { TypeRegistry, sizeOf, primitiveType, isStructType, isArrayType, typeToString } from './types-c';
import type { DefaultEmitter } from './emitter';

export type StdlibHandler = (
	name: string,
	args: CValue[],
	line: number,
) => { value: CValue; error?: string };

export function createStdlib(
	env: Environment,
	typeReg: TypeRegistry,
	emitter: DefaultEmitter,
): StdlibHandler {
	return (name: string, args: CValue[], line: number) => {
		switch (name) {
			case 'malloc':
				return handleMalloc(env, typeReg, emitter, args, line);
			case 'calloc':
				return handleCalloc(env, typeReg, emitter, args, line);
			case 'free':
				return handleFree(env, emitter, args, line);
			case 'printf':
			case 'sprintf':
			case 'fprintf':
			case 'puts':
			case 'putchar':
				// I/O functions are no-ops
				return ok(0);
			case 'sizeof':
				return ok(args[0]?.data ?? 0);
			default:
				return { value: voidVal(), error: `Unknown stdlib function: ${name}` };
		}
	};
}

function handleMalloc(
	env: Environment,
	typeReg: TypeRegistry,
	emitter: DefaultEmitter,
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
	env: Environment,
	typeReg: TypeRegistry,
	emitter: DefaultEmitter,
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
	env: Environment,
	emitter: DefaultEmitter,
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
