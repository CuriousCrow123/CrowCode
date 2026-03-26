import { describe, it, expect } from 'vitest';
import {
	scope,
	heapContainer,
	variable,
	heapBlock,
	addScope,
	addVar,
	addChild,
	alloc,
	set,
	free,
	leak,
	remove,
} from './builders';

describe('entry builders', () => {
	it('scope creates a scope entry', () => {
		const s = scope('main', 'main()', { caller: '_start', file: 'test.c', line: 10 });
		expect(s.id).toBe('main');
		expect(s.name).toBe('main()');
		expect(s.kind).toBe('scope');
		expect(s.scope?.caller).toBe('_start');
		expect(s.scope?.file).toBe('test.c');
		expect(s.scope?.line).toBe(10);
		expect(s.type).toBe('');
		expect(s.value).toBe('');
		expect(s.address).toBe('');
	});

	it('scope works without opts', () => {
		const s = scope('block', '{ }');
		expect(s.scope).toBeUndefined();
	});

	it('heapContainer creates a heap entry', () => {
		const h = heapContainer();
		expect(h.id).toBe('heap');
		expect(h.kind).toBe('heap');
		expect(h.name).toBe('Heap');
	});

	it('heapContainer accepts custom id', () => {
		const h = heapContainer('my-heap');
		expect(h.id).toBe('my-heap');
	});

	it('variable creates a plain entry', () => {
		const v = variable('x', 'x', 'int', '42', '0x7ffc0060');
		expect(v.id).toBe('x');
		expect(v.name).toBe('x');
		expect(v.type).toBe('int');
		expect(v.value).toBe('42');
		expect(v.address).toBe('0x7ffc0060');
		expect(v.kind).toBeUndefined();
		expect(v.children).toBeUndefined();
	});

	it('variable with children', () => {
		const v = variable('p', 'p', 'struct Point', '', '0x00', [
			variable('px', '.x', 'int', '0', '0x00'),
			variable('py', '.y', 'int', '0', '0x04'),
		]);
		expect(v.children).toHaveLength(2);
		expect(v.children![0].name).toBe('.x');
	});

	it('heapBlock creates a heap block entry', () => {
		const h = heapBlock('hb', 'int[10]', '0x55a0', {
			size: 40,
			status: 'allocated',
			allocator: 'malloc',
			allocSite: { file: 'test.c', line: 5 },
		});
		expect(h.id).toBe('hb');
		expect(h.name).toBe('');
		expect(h.type).toBe('int[10]');
		expect(h.address).toBe('0x55a0');
		expect(h.heap?.size).toBe(40);
		expect(h.heap?.status).toBe('allocated');
		expect(h.heap?.allocator).toBe('malloc');
	});

	it('heapBlock with children', () => {
		const h = heapBlock('hb', 'struct X', '0x55a0',
			{ size: 8, status: 'allocated' },
			[variable('f1', '.a', 'int', '1', '0x55a0')],
		);
		expect(h.children).toHaveLength(1);
	});
});

describe('op builders', () => {
	it('addScope produces addEntry with null parent', () => {
		const op = addScope(null, scope('main', 'main()'));
		expect(op.op).toBe('addEntry');
		expect(op).toHaveProperty('parentId', null);
	});

	it('addScope produces addEntry with parent', () => {
		const op = addScope('main', scope('block', '{ }'));
		expect(op.op).toBe('addEntry');
		expect(op).toHaveProperty('parentId', 'main');
	});

	it('addVar produces addEntry', () => {
		const op = addVar('main', variable('x', 'x', 'int', '0', '0x00'));
		expect(op.op).toBe('addEntry');
		expect(op).toHaveProperty('parentId', 'main');
	});

	it('addChild produces addEntry', () => {
		const op = addChild('arr', variable('el', '[0]', 'int', '0', '0x00'));
		expect(op.op).toBe('addEntry');
		expect(op).toHaveProperty('parentId', 'arr');
	});

	it('alloc produces addEntry', () => {
		const op = alloc('heap', heapBlock('hb', 'int', '0x55', { size: 4, status: 'allocated' }));
		expect(op.op).toBe('addEntry');
		expect(op).toHaveProperty('parentId', 'heap');
	});

	it('set produces setValue', () => {
		const op = set('x', '42');
		expect(op).toEqual({ op: 'setValue', id: 'x', value: '42' });
	});

	it('free produces setHeapStatus freed', () => {
		const op = free('hb');
		expect(op).toEqual({ op: 'setHeapStatus', id: 'hb', status: 'freed' });
	});

	it('leak produces setHeapStatus leaked', () => {
		const op = leak('hb');
		expect(op).toEqual({ op: 'setHeapStatus', id: 'hb', status: 'leaked' });
	});

	it('remove produces removeEntry', () => {
		const op = remove('x');
		expect(op).toEqual({ op: 'removeEntry', id: 'x' });
	});
});
