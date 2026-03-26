import type { MemoryEntry } from './types';

const PREVIEW_ITEMS = 3;

export function summarize(entry: MemoryEntry): string {
	if (!entry.children || entry.children.length === 0) return entry.value;

	const isArray = entry.type.includes('[') || entry.type.endsWith('*');
	const isStruct = entry.type.startsWith('struct');

	if (isStruct && !isArray) {
		return '{...}';
	}

	const children = entry.children;
	const preview = children.slice(0, PREVIEW_ITEMS).map((c) => summarize(c));
	const remaining = children.length - PREVIEW_ITEMS;

	if (remaining > 0) {
		return `{${preview.join(', ')}, ...${remaining} more}`;
	}
	return `{${preview.join(', ')}}`;
}
