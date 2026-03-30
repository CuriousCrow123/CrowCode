// === Memory Entry Types ===

export type ScopeInfo = {
	caller?: string;
	returnAddr?: string;
	file?: string;
	line?: number;
};

export type HeapInfo = {
	size: number;
	status: 'allocated' | 'freed' | 'leaked' | 'use-after-free';
	allocator?: string;
	allocSite?: {
		file: string;
		line: number;
	};
	refCount?: number;
};

export type MemoryEntry = {
	id: string;
	name: string;
	type: string;
	value: string;
	address: string;
	children?: MemoryEntry[];
	kind?: 'scope' | 'heap' | 'io';
	scope?: ScopeInfo;
	heap?: HeapInfo;
};

// === I/O Types ===

export type IoEvent =
	| { kind: 'write'; target: 'stdout' | 'stderr'; text: string }
	| { kind: 'read'; source: 'stdin'; consumed: string; cursorPos: number; format?: string };

// === Program & Stepper Types ===

export type SourceLocation = {
	line: number;
	colStart?: number;
	colEnd?: number;
};

export type SnapshotOp =
	| { op: 'addEntry'; parentId: string | null; entry: MemoryEntry }
	| { op: 'removeEntry'; id: string }
	| { op: 'setValue'; id: string; value: string }
	| { op: 'setHeapStatus'; id: string; status: 'allocated' | 'freed' | 'leaked' | 'use-after-free' };

export type ProgramStep = {
	location: SourceLocation;
	description?: string;
	evaluation?: string;
	ops: SnapshotOp[];
	subStep?: boolean;
	ioEvents?: IoEvent[];
};

export type Program = {
	name: string;
	source: string;
	steps: ProgramStep[];
};

// === Diff Types ===

export type SnapshotDiff = {
	added: string[];
	removed: string[];
	changed: { id: string; from: string; to: string }[];
};
