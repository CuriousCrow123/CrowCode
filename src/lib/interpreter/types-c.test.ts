import { describe, it, expect } from 'vitest';
import {
	sizeOf,
	alignOf,
	primitiveType,
	pointerType,
	arrayType,
	typeToString,
	TypeRegistry,
	POINTER_SIZE,
} from './types-c';
import type { CType } from './types';

describe('primitive sizes', () => {
	it('char is 1 byte', () => {
		expect(sizeOf(primitiveType('char'))).toBe(1);
	});

	it('short is 2 bytes', () => {
		expect(sizeOf(primitiveType('short'))).toBe(2);
	});

	it('int is 4 bytes', () => {
		expect(sizeOf(primitiveType('int'))).toBe(4);
	});

	it('long is 8 bytes', () => {
		expect(sizeOf(primitiveType('long'))).toBe(8);
	});

	it('float is 4 bytes', () => {
		expect(sizeOf(primitiveType('float'))).toBe(4);
	});

	it('double is 8 bytes', () => {
		expect(sizeOf(primitiveType('double'))).toBe(8);
	});

	it('void is 0 bytes', () => {
		expect(sizeOf(primitiveType('void'))).toBe(0);
	});
});

describe('pointer sizes', () => {
	it('pointer is 4 bytes (32-bit model)', () => {
		expect(sizeOf(pointerType(primitiveType('int')))).toBe(4);
		expect(POINTER_SIZE).toBe(4);
	});

	it('pointer to pointer is 4 bytes', () => {
		expect(sizeOf(pointerType(pointerType(primitiveType('char'))))).toBe(4);
	});
});

describe('array sizes', () => {
	it('int[4] is 16 bytes', () => {
		expect(sizeOf(arrayType(primitiveType('int'), 4))).toBe(16);
	});

	it('char[10] is 10 bytes', () => {
		expect(sizeOf(arrayType(primitiveType('char'), 10))).toBe(10);
	});

	it('double[3] is 24 bytes', () => {
		expect(sizeOf(arrayType(primitiveType('double'), 3))).toBe(24);
	});
});

describe('struct layout', () => {
	it('struct Point { int x; int y; } is 8 bytes', () => {
		const reg = new TypeRegistry();
		const pt = reg.defineStruct('Point', [
			{ name: 'x', typeSpec: { base: 'int', pointer: 0 } },
			{ name: 'y', typeSpec: { base: 'int', pointer: 0 } },
		]);
		expect(sizeOf(pt)).toBe(8);
		expect(pt.fields[0].offset).toBe(0);
		expect(pt.fields[1].offset).toBe(4);
	});

	it('struct with char + int has padding', () => {
		const reg = new TypeRegistry();
		const s = reg.defineStruct('Padded', [
			{ name: 'c', typeSpec: { base: 'char', pointer: 0 } },
			{ name: 'i', typeSpec: { base: 'int', pointer: 0 } },
		]);
		// char at 0, int at 4 (aligned to 4)
		expect(s.fields[0].offset).toBe(0);
		expect(s.fields[1].offset).toBe(4);
		expect(sizeOf(s)).toBe(8);
	});

	it('struct with nested struct', () => {
		const reg = new TypeRegistry();
		reg.defineStruct('Point', [
			{ name: 'x', typeSpec: { base: 'int', pointer: 0 } },
			{ name: 'y', typeSpec: { base: 'int', pointer: 0 } },
		]);
		const player = reg.defineStruct('Player', [
			{ name: 'id', typeSpec: { base: 'int', pointer: 0 } },
			{ name: 'pos', typeSpec: { base: 'struct', pointer: 0, structName: 'Point' } },
			{ name: 'scores', typeSpec: { base: 'int', pointer: 1 } },
		]);
		expect(player.fields[0].offset).toBe(0);   // id: int at 0
		expect(player.fields[1].offset).toBe(4);   // pos: struct Point at 4
		expect(player.fields[2].offset).toBe(12);  // scores: int* at 12
		expect(sizeOf(player)).toBe(16);
	});

	it('struct with double requires 8-byte alignment', () => {
		const reg = new TypeRegistry();
		const s = reg.defineStruct('Aligned', [
			{ name: 'c', typeSpec: { base: 'char', pointer: 0 } },
			{ name: 'd', typeSpec: { base: 'double', pointer: 0 } },
		]);
		expect(s.fields[0].offset).toBe(0);
		expect(s.fields[1].offset).toBe(8);
		expect(sizeOf(s)).toBe(16); // 8 + 8, aligned to 8
	});

	it('empty struct has size 0', () => {
		const reg = new TypeRegistry();
		const s = reg.defineStruct('Empty', []);
		expect(sizeOf(s)).toBe(0);
	});
});

describe('alignment', () => {
	it('char alignment is 1', () => {
		expect(alignOf(primitiveType('char'))).toBe(1);
	});

	it('int alignment is 4', () => {
		expect(alignOf(primitiveType('int'))).toBe(4);
	});

	it('pointer alignment is 4', () => {
		expect(alignOf(pointerType(primitiveType('int')))).toBe(4);
	});

	it('array alignment matches element', () => {
		expect(alignOf(arrayType(primitiveType('int'), 10))).toBe(4);
		expect(alignOf(arrayType(primitiveType('double'), 3))).toBe(8);
	});
});

describe('TypeRegistry.resolve', () => {
	it('resolves primitive types', () => {
		const reg = new TypeRegistry();
		const t = reg.resolve({ base: 'int', pointer: 0 });
		expect(t).toEqual({ kind: 'primitive', name: 'int' });
	});

	it('resolves pointer types', () => {
		const reg = new TypeRegistry();
		const t = reg.resolve({ base: 'int', pointer: 2 });
		expect(t.kind).toBe('pointer');
		expect((t as CType & { kind: 'pointer' }).pointsTo.kind).toBe('pointer');
	});

	it('resolves array types', () => {
		const reg = new TypeRegistry();
		const t = reg.resolve({ base: 'int', pointer: 0, array: 5 });
		expect(t.kind).toBe('array');
		expect(sizeOf(t)).toBe(20);
	});

	it('resolves struct types', () => {
		const reg = new TypeRegistry();
		reg.defineStruct('Point', [
			{ name: 'x', typeSpec: { base: 'int', pointer: 0 } },
			{ name: 'y', typeSpec: { base: 'int', pointer: 0 } },
		]);
		const t = reg.resolve({ base: 'struct', pointer: 0, structName: 'Point' });
		expect(t.kind).toBe('struct');
	});

	it('resolves struct pointer types', () => {
		const reg = new TypeRegistry();
		reg.defineStruct('Point', [
			{ name: 'x', typeSpec: { base: 'int', pointer: 0 } },
			{ name: 'y', typeSpec: { base: 'int', pointer: 0 } },
		]);
		const t = reg.resolve({ base: 'struct', pointer: 1, structName: 'Point' });
		expect(t.kind).toBe('pointer');
		expect(sizeOf(t)).toBe(4);
	});

	it('throws for unknown struct', () => {
		const reg = new TypeRegistry();
		expect(() => reg.resolve({ base: 'struct', pointer: 0, structName: 'Unknown' })).toThrow('Unknown struct');
	});

	it('throws for unknown type', () => {
		const reg = new TypeRegistry();
		expect(() => reg.resolve({ base: 'bogus', pointer: 0 })).toThrow('Unknown type');
	});
});

describe('typeToString', () => {
	it('formats primitive types', () => {
		expect(typeToString(primitiveType('int'))).toBe('int');
	});

	it('formats pointer types', () => {
		expect(typeToString(pointerType(primitiveType('int')))).toBe('int*');
	});

	it('formats array types', () => {
		expect(typeToString(arrayType(primitiveType('int'), 4))).toBe('int[4]');
	});

	it('formats struct types', () => {
		const reg = new TypeRegistry();
		const pt = reg.defineStruct('Point', [
			{ name: 'x', typeSpec: { base: 'int', pointer: 0 } },
			{ name: 'y', typeSpec: { base: 'int', pointer: 0 } },
		]);
		expect(typeToString(pt)).toBe('struct Point');
	});
});
