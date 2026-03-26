import type { MemoryEntry, ScopeInfo, HeapInfo, SnapshotOp } from '$lib/types';

// === Entry builders ===

export function scope(id: string, name: string, opts?: Partial<ScopeInfo>): MemoryEntry {
	return {
		id,
		name,
		kind: 'scope',
		type: '',
		value: '',
		address: '',
		scope: opts,
	};
}

export function heapContainer(id: string = 'heap'): MemoryEntry {
	return {
		id,
		name: 'Heap',
		kind: 'heap',
		type: '',
		value: '',
		address: '',
	};
}

export function variable(
	id: string,
	name: string,
	type: string,
	value: string,
	address: string,
	children?: MemoryEntry[],
): MemoryEntry {
	return { id, name, type, value, address, children };
}

export function heapBlock(
	id: string,
	type: string,
	address: string,
	heap: HeapInfo,
	children?: MemoryEntry[],
): MemoryEntry {
	return { id, name: '', type, value: '', address, heap, children };
}

// === Op builders ===

export function addScope(parentId: string | null, entry: MemoryEntry): SnapshotOp {
	return { op: 'addEntry', parentId, entry };
}

export function addVar(parentId: string, entry: MemoryEntry): SnapshotOp {
	return { op: 'addEntry', parentId, entry };
}

export function addChild(parentId: string, entry: MemoryEntry): SnapshotOp {
	return { op: 'addEntry', parentId, entry };
}

export function alloc(parentId: string, entry: MemoryEntry): SnapshotOp {
	return { op: 'addEntry', parentId, entry };
}

export function set(id: string, value: string): SnapshotOp {
	return { op: 'setValue', id, value };
}

export function free(id: string): SnapshotOp {
	return { op: 'setHeapStatus', id, status: 'freed' };
}

export function leak(id: string): SnapshotOp {
	return { op: 'setHeapStatus', id, status: 'leaked' };
}

export function remove(id: string): SnapshotOp {
	return { op: 'removeEntry', id };
}
