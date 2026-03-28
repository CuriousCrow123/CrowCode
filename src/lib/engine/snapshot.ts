import type { MemoryEntry, SnapshotOp, Program } from '$lib/types';

/** Build an id → entry map by walking the tree */
export function indexById(entries: MemoryEntry[]): Map<string, MemoryEntry> {
	const map = new Map<string, MemoryEntry>();

	function walk(list: MemoryEntry[]) {
		for (const entry of list) {
			map.set(entry.id, entry);
			if (entry.children) walk(entry.children);
		}
	}

	walk(entries);
	return map;
}

/** Find and remove an entry by id from a tree. Returns true if found. */
function removeById(entries: MemoryEntry[], id: string): boolean {
	for (let i = 0; i < entries.length; i++) {
		if (entries[i].id === id) {
			entries.splice(i, 1);
			return true;
		}
		if (entries[i].children && removeById(entries[i].children!, id)) {
			return true;
		}
	}
	return false;
}

/** Add all entries in a tree to an index map. */
function addToIndex(map: Map<string, MemoryEntry>, entries: MemoryEntry[]): void {
	for (const entry of entries) {
		map.set(entry.id, entry);
		if (entry.children) addToIndex(map, entry.children);
	}
}

/** Remove an entry and all its descendants from an index map. */
function removeFromIndex(map: Map<string, MemoryEntry>, entry: MemoryEntry): void {
	map.delete(entry.id);
	if (entry.children) {
		for (const child of entry.children) {
			removeFromIndex(map, child);
		}
	}
}

/** Apply a list of ops to a snapshot, returning a new snapshot and any errors. */
export function applyOps(
	snapshot: MemoryEntry[],
	ops: SnapshotOp[],
): { snapshot: MemoryEntry[]; errors: string[] } {
	const result = structuredClone(snapshot);
	const errors: string[] = [];
	const index = indexById(result);

	for (let i = 0; i < ops.length; i++) {
		const op = ops[i];

		switch (op.op) {
			case 'addEntry': {
				const cloned = structuredClone(op.entry);
				if (op.parentId === null) {
					result.push(cloned);
				} else {
					const parent = index.get(op.parentId);
					if (!parent) {
						errors.push(`Op ${i}: addEntry parentId '${op.parentId}' not found`);
						break;
					}
					if (!parent.children) parent.children = [];
					parent.children.push(cloned);
				}
				addToIndex(index, [cloned]);
				break;
			}

			case 'removeEntry': {
				const entry = index.get(op.id);
				if (!entry) {
					errors.push(`Op ${i}: removeEntry id '${op.id}' not found`);
					break;
				}
				removeFromIndex(index, entry);
				if (!removeById(result, op.id)) {
					errors.push(`Op ${i}: removeEntry id '${op.id}' not found in tree`);
				}
				break;
			}

			case 'setValue': {
				const entry = index.get(op.id);
				if (!entry) {
					errors.push(`Op ${i}: setValue id '${op.id}' not found`);
					break;
				}
				entry.value = op.value;
				break;
			}

			case 'setHeapStatus': {
				const entry = index.get(op.id);
				if (!entry) {
					errors.push(`Op ${i}: setHeapStatus id '${op.id}' not found`);
					break;
				}
				if (!entry.heap) {
					errors.push(`Op ${i}: setHeapStatus id '${op.id}' has no heap info`);
					break;
				}
				entry.heap.status = op.status;
				break;
			}
		}
	}

	return { snapshot: result, errors };
}

/** Pre-compute all snapshots from a program. Index 0 = after step 0's ops applied to []. */
export function buildSnapshots(program: Program): MemoryEntry[][] {
	const snapshots: MemoryEntry[][] = [];
	let current: MemoryEntry[] = [];

	for (const step of program.steps) {
		const { snapshot, errors } = applyOps(current, step.ops);
		if (errors.length > 0) {
			console.warn(`[CrowCode] Step ${snapshots.length}:`, errors);
		}
		snapshots.push(snapshot);
		current = snapshot;
	}

	return snapshots;
}
