import type { CType, CTypeSpec, ASTStructField } from './types';

// === Primitive sizes (32-bit model for readable hex addresses) ===

const PRIMITIVE_SIZES: Record<string, number> = {
	char: 1,
	short: 2,
	int: 4,
	long: 8,
	float: 4,
	double: 8,
	void: 0,
};

const POINTER_SIZE = 4;

// === Type Registry ===

export class TypeRegistry {
	private structs = new Map<string, CType & { kind: 'struct' }>();

	defineStruct(name: string, fields: ASTStructField[]): CType & { kind: 'struct' } {
		const resolvedFields: Array<{ name: string; type: CType; offset: number }> = [];
		let offset = 0;

		for (const field of fields) {
			const fieldType = this.resolve(field.typeSpec);
			const alignment = alignOf(fieldType);
			offset = alignUp(offset, alignment);
			resolvedFields.push({ name: field.name, type: fieldType, offset });
			offset += sizeOf(fieldType);
		}

		const structType: CType & { kind: 'struct' } = {
			kind: 'struct',
			name,
			fields: resolvedFields,
		};
		this.structs.set(name, structType);
		return structType;
	}

	getStruct(name: string): (CType & { kind: 'struct' }) | undefined {
		return this.structs.get(name);
	}

	resolve(spec: CTypeSpec): CType {
		let base: CType;

		if (spec.structName) {
			const s = this.structs.get(spec.structName);
			if (!s) {
				throw new Error(`Unknown struct: ${spec.structName}`);
			}
			base = s;
		} else if (spec.base in PRIMITIVE_SIZES) {
			base = { kind: 'primitive', name: spec.base as CType & { kind: 'primitive' } extends { name: infer N } ? N : never };
		} else {
			throw new Error(`Unknown type: ${spec.base}`);
		}

		if (spec.arrays !== undefined && spec.arrays.length > 0) {
			// Multi-dimensional: build from innermost to outermost
			// int arr[3][4] → arrays = [3, 4] → arrayType(arrayType(int, 4), 3)
			for (let i = spec.arrays.length - 1; i >= 0; i--) {
				base = { kind: 'array', elementType: base, size: spec.arrays[i] };
			}
		} else if (spec.array !== undefined) {
			base = { kind: 'array', elementType: base, size: spec.array };
		}

		for (let i = 0; i < spec.pointer; i++) {
			base = { kind: 'pointer', pointsTo: base };
		}

		return base;
	}
}

// === Size calculation ===

export function sizeOf(type: CType): number {
	switch (type.kind) {
		case 'primitive':
			return PRIMITIVE_SIZES[type.name] ?? 0;
		case 'pointer':
			return POINTER_SIZE;
		case 'array':
			return sizeOf(type.elementType) * type.size;
		case 'struct': {
			if (type.fields.length === 0) return 0;
			const last = type.fields[type.fields.length - 1];
			const rawSize = last.offset + sizeOf(last.type);
			const structAlign = alignOf(type);
			return alignUp(rawSize, structAlign);
		}
	}
}

// === Alignment ===

export function alignOf(type: CType): number {
	switch (type.kind) {
		case 'primitive':
			return PRIMITIVE_SIZES[type.name] ?? 1;
		case 'pointer':
			return POINTER_SIZE;
		case 'array':
			return alignOf(type.elementType);
		case 'struct': {
			if (type.fields.length === 0) return 1;
			return Math.max(...type.fields.map((f) => alignOf(f.type)));
		}
	}
}

function alignUp(value: number, alignment: number): number {
	if (alignment <= 0) return value;
	return Math.ceil(value / alignment) * alignment;
}

// === Helper constructors ===

export function primitiveType(name: string): CType & { kind: 'primitive' } {
	return { kind: 'primitive', name: name as 'int' | 'char' | 'short' | 'long' | 'float' | 'double' | 'void' };
}

export function pointerType(pointsTo: CType): CType & { kind: 'pointer' } {
	return { kind: 'pointer', pointsTo };
}

export function arrayType(elementType: CType, size: number): CType & { kind: 'array' } {
	return { kind: 'array', elementType, size };
}

// === Display helpers ===

export function typeToString(type: CType): string {
	switch (type.kind) {
		case 'primitive':
			return type.name;
		case 'pointer':
			return typeToString(type.pointsTo) + '*';
		case 'array':
			return `${typeToString(type.elementType)}[${type.size}]`;
		case 'struct':
			return `struct ${type.name}`;
	}
}

// === Default value ===

export function defaultValue(type: CType): number {
	return 0;
}

export function isPointerType(type: CType): type is CType & { kind: 'pointer' } {
	return type.kind === 'pointer';
}

export function isStructType(type: CType): type is CType & { kind: 'struct' } {
	return type.kind === 'struct';
}

export function isArrayType(type: CType): type is CType & { kind: 'array' } {
	return type.kind === 'array';
}

export { POINTER_SIZE };
