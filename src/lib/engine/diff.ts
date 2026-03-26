import type { MemoryEntry, SnapshotDiff } from '$lib/types';

/** Flatten a snapshot tree into an id → value map */
function flattenValues(entries: MemoryEntry[]): Map<string, string> {
	const map = new Map<string, string>();

	function walk(list: MemoryEntry[]) {
		for (const entry of list) {
			map.set(entry.id, entry.value);
			if (entry.children) walk(entry.children);
		}
	}

	walk(entries);
	return map;
}

/** Diff two snapshots by comparing entry ids and values. */
export function diffSnapshots(prev: MemoryEntry[], next: MemoryEntry[]): SnapshotDiff {
	const prevMap = flattenValues(prev);
	const nextMap = flattenValues(next);

	const added: string[] = [];
	const removed: string[] = [];
	const changed: { id: string; from: string; to: string }[] = [];

	for (const [id, value] of nextMap) {
		if (!prevMap.has(id)) {
			added.push(id);
		} else if (prevMap.get(id) !== value) {
			changed.push({ id, from: prevMap.get(id)!, to: value });
		}
	}

	for (const id of prevMap.keys()) {
		if (!nextMap.has(id)) {
			removed.push(id);
		}
	}

	return { added, removed, changed };
}
