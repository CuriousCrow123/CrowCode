// === Memory Entry Types ===

export type ScopeInfo = {
	caller?: string;
	returnAddr?: string;
	file?: string;
	line?: number;
};

export type HeapInfo = {
	size: number;
	status: 'allocated' | 'freed' | 'leaked';
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
	kind?: 'scope' | 'heap';
	scope?: ScopeInfo;
	heap?: HeapInfo;
};

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
	| { op: 'setHeapStatus'; id: string; status: 'allocated' | 'freed' | 'leaked' };

export type ProgramStep = {
	location: SourceLocation;
	description?: string;
	evaluation?: string;
	ops: SnapshotOp[];
	subStep?: boolean;
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
