import type {
	MemoryEntry,
	SnapshotOp,
	ProgramStep,
	SourceLocation,
	ScopeInfo,
	HeapInfo,
	Program,
	IoEvent,
} from '$lib/types';
import type { CType, CValue, ChildSpec, ParamSpec, ASTNode, HeapBlock } from './types';
import { sizeOf, alignOf, defaultValue, typeToString, isStructType, isArrayType } from './types-c';

// === Constants ===

const STACK_BASE = 0x7FFC0000;
const HEAP_BASE = 0x55A00000;

// === Alignment helpers ===

function alignDown(value: number, alignment: number): number {
	if (alignment <= 0) return value;
	return Math.floor(value / alignment) * alignment;
}

function alignUp(value: number, alignment: number): number {
	if (alignment <= 0) return value;
	return Math.ceil(value / alignment) * alignment;
}

export function formatAddress(address: number): string {
	return '0x' + address.toString(16).padStart(8, '0');
}

/** Format stdin buffer for display: consumed text, cursor marker, remaining text. */
function formatStdinDisplay(fullBuffer: string, cursorPos: number): string {
	const consumed = fullBuffer.slice(0, cursorPos).replace(/\n/g, '\\n').replace(/\t/g, '\\t');
	const remaining = fullBuffer.slice(cursorPos).replace(/\n/g, '\\n').replace(/\t/g, '\\t');
	if (cursorPos === 0) return remaining;
	if (cursorPos >= fullBuffer.length) return consumed + ' (exhausted)';
	return consumed + '|' + remaining;
}

// === ScopeFrame ===

type ScopeFrame = {
	id: string;
	name: string;
	vars: string[];
	savedVarIds: Map<string, string>;
	savedPointerTargets: Map<string, string>;
	savedStackPointer: number;
};

// === MemoryReader interface (for Evaluator) ===

export interface MemoryReader {
	lookupVariable(name: string): CValue | undefined;
	readMemory(address: number): number | undefined;
	setValue(name: string, value: number): void;
	scopeDepth(): number;
	getFunction(name: string): (ASTNode & { type: 'function_definition' }) | undefined;
	getFunctionIndex(name: string): number;
	getFunctionByIndex(index: number): { name: string; node: ASTNode & { type: 'function_definition' } } | undefined;
}

// === Memory class ===

export class Memory implements MemoryReader {
	// === Runtime state (replaces Environment) ===
	private scopes: Array<{ name: string; symbols: Map<string, CValue> }> = [];
	private scopeFrames: ScopeFrame[] = [];
	private addressValues = new Map<number, number>();
	private heapBlocks = new Map<number, HeapBlock>();
	private stackPointer: number = STACK_BASE;
	private heapPointer: number = HEAP_BASE;
	private heapUsed = 0;
	private maxHeapBytes: number;

	// === Function table ===
	private functions = new Map<string, ASTNode & { type: 'function_definition' }>();
	private functionIndices = new Map<string, number>();
	private indexToFunction = new Map<number, string>();
	private nextFunctionIndex = 1; // 0 = NULL

	// === ID/path tracking (replaces Emitter's maps) ===
	private entryIdByVar = new Map<string, string>();
	private heapEntryByPointer = new Map<string, string>();
	private childEntriesById = new Map<string, Map<string, string>>();

	// === ID generation counters ===
	private scopeCounters = new Map<string, number>();
	private blockCounters = new Map<string, number>();
	private heapCounters = new Map<string, number>();

	// === Heap container tracking ===
	private heapContainerAdded = false;
	private stdinEntryAdded = false;

	// === Heap block address → ID mapping ===
	private heapBlockAddresses = new Map<string, number>();
	private heapBlockTypes = new Map<string, CType>();

	// === Op recording ===
	private currentOps: SnapshotOp[] = [];
	private steps: ProgramStep[] = [];
	private currentStep: ProgramStep | null = null;
	private errors: string[] = [];
	private ioEventsFlusher: (() => IoEvent[] | undefined) | null = null;
	private ioEventsPeeker: (() => IoEvent[] | undefined) | null = null;

	// === Program metadata ===
	readonly programName: string;
	readonly programSource: string;

	constructor(name: string, source: string, maxHeapBytes = 1024 * 1024) {
		this.programName = name;
		this.programSource = source;
		this.maxHeapBytes = maxHeapBytes;
	}

	// ========================================
	// Step lifecycle
	// ========================================

	setIoEventsFlusher(flusher: () => IoEvent[] | undefined, peeker?: () => IoEvent[] | undefined): void {
		this.ioEventsFlusher = flusher;
		if (peeker) this.ioEventsPeeker = peeker;
	}

	beginStep(location: SourceLocation, description?: string, evaluation?: string): void {
		this.flushStep();
		this.currentStep = {
			location,
			description,
			evaluation,
			ops: [],
		};
	}

	markSubStep(): void {
		if (this.currentStep) {
			this.currentStep.subStep = true;
		}
	}

	updateStepDescription(description: string, evaluation?: string): void {
		if (this.currentStep) {
			this.currentStep.description = description;
			if (evaluation !== undefined) {
				this.currentStep.evaluation = evaluation;
			}
		}
	}

	flushStep(): void {
		if (this.currentStep) {
			if (this.ioEventsFlusher) {
				const events = this.ioEventsFlusher();
				if (events) {
					this.currentStep.ioEvents = events;
				}
			}
			this.steps.push(this.currentStep);
		}
		this.currentStep = null;
	}

	/**
	 * Read-only snapshot of steps accumulated so far, including the in-flight step.
	 * Does NOT mutate Memory state — safe to call during generator pause.
	 */
	getSteps(): ProgramStep[] {
		const steps = [...this.steps];
		if (this.currentStep) {
			// Clone the in-flight step with its ops so far — non-destructive
			const inflight: ProgramStep = {
				...this.currentStep,
				ops: [...this.currentStep.ops],
			};
			// Peek (not flush) io events for the inflight step snapshot
			if (this.ioEventsPeeker) {
				const events = this.ioEventsPeeker();
				if (events) inflight.ioEvents = events;
			}
			steps.push(inflight);
		}
		return steps;
	}

	finish(): { program: Program; errors: string[] } {
		this.flushStep();
		return {
			program: {
				name: this.programName,
				source: this.programSource,
				steps: this.steps,
			},
			errors: this.errors,
		};
	}

	private addOp(op: SnapshotOp): void {
		if (!this.currentStep) {
			this.errors.push('Op emitted without active step');
			return;
		}
		this.currentStep.ops.push(op);
	}

	// ========================================
	// Scope lifecycle
	// ========================================

	pushScope(name: string, params?: ParamSpec[], callSite?: ScopeInfo): string {
		const scopeId = this.generateScopeId(name);

		// Save current state for restore on pop
		const savedVarIds = new Map<string, string>();
		const savedPointerTargets = new Map<string, string>();

		const frame: ScopeFrame = {
			id: scopeId,
			name,
			vars: [],
			savedVarIds,
			savedPointerTargets,
			savedStackPointer: this.stackPointer,
		};
		this.scopeFrames.push(frame);

		// Push runtime scope
		this.scopes.push({ name, symbols: new Map() });

		// Emit scope entry
		const scopeEntry: MemoryEntry = {
			id: scopeId,
			name: params ? `${name}(${params.map((p) => p.name).join(', ')})` : name,
			kind: 'scope',
			type: '',
			value: '',
			address: '',
			scope: callSite,
		};
		this.addOp({ op: 'addEntry', parentId: null, entry: scopeEntry });

		// Add heap container on first scope entry
		if (!this.heapContainerAdded) {
			this.addOp({
				op: 'addEntry',
				parentId: null,
				entry: {
					id: 'heap',
					name: 'Heap',
					kind: 'heap',
					type: '',
					value: '',
					address: '',
				},
			});
			this.heapContainerAdded = true;
		}

		// Declare parameters
		if (params) {
			for (const param of params) {
				if (param.address !== undefined) {
					this.declareVariableWithAddress(param.name, param.type, param.value, param.address, param.children);
				} else {
					this.declareVariable(param.name, param.type, param.value, param.children);
				}
			}
		}

		return scopeId;
	}

	popScope(): void {
		const frame = this.scopeFrames.pop();
		if (!frame) return;

		// Emit removeEntry for the scope
		this.addOp({ op: 'removeEntry', id: frame.id });

		// Restore variable ID mappings
		for (const name of frame.vars) {
			const prev = frame.savedVarIds.get(name);
			if (prev !== undefined) {
				this.entryIdByVar.set(name, prev);
			} else {
				this.entryIdByVar.delete(name);
			}
		}

		// Restore pointer target mappings
		for (const [name, prev] of frame.savedPointerTargets) {
			this.heapEntryByPointer.set(name, prev);
		}
		// Remove pointer targets that were added in this scope and had no saved value
		for (const name of frame.vars) {
			if (!frame.savedPointerTargets.has(name) && this.heapEntryByPointer.has(name)) {
				// Only delete if it was set in this scope (i.e., the var was tracked in this frame)
				// Check if an outer frame still has a mapping — if savedPointerTargets had it, it was restored above
				this.heapEntryByPointer.delete(name);
			}
		}

		// Restore stack pointer
		this.stackPointer = frame.savedStackPointer;

		// Pop runtime scope
		this.scopes.pop();
	}

	pushBlock(label: string): string {
		const currentScope = this.currentScopeId();
		const blockId = this.generateBlockId(label);

		const frame: ScopeFrame = {
			id: blockId,
			name: label,
			vars: [],
			savedVarIds: new Map(),
			savedPointerTargets: new Map(),
			savedStackPointer: this.stackPointer,
		};
		this.scopeFrames.push(frame);

		// Push runtime scope
		this.scopes.push({ name: label, symbols: new Map() });

		// Emit block scope entry
		const displayName = label === 'for' ? 'for'
			: label === 'while' ? 'while'
			: label === 'do-while' ? 'do-while'
			: '{ }';
		const scopeEntry: MemoryEntry = {
			id: blockId,
			name: displayName,
			kind: 'scope',
			type: '',
			value: '',
			address: '',
			scope: {},
		};
		this.addOp({ op: 'addEntry', parentId: currentScope, entry: scopeEntry });

		return blockId;
	}

	popBlock(): void {
		// Same as popScope — restore frame state
		this.popScope();
	}

	// ========================================
	// Variable management
	// ========================================

	declareVariable(name: string, type: CType, value: string, children?: ChildSpec[]): CValue {
		const size = sizeOf(type);
		const alignment = alignOf(type);
		this.stackPointer = alignDown(this.stackPointer - size, alignment);
		const address = this.stackPointer;

		return this.declareVariableWithAddress(name, type, value, address, children);
	}

	declareVariableWithAddress(name: string, type: CType, value: string, address: number, children?: ChildSpec[]): CValue {
		// Store in runtime scope
		const scope = this.scopes[this.scopes.length - 1];
		if (!scope) {
			this.errors.push('No active scope for variable declaration');
			return { type, data: 0, address: 0 };
		}

		const numericValue = this.parseNumericValue(value, type);
		const cvalue: CValue = {
			type,
			data: numericValue,
			address,
			initialized: value !== '(uninit)',
		};
		scope.symbols.set(name, cvalue);

		// Track variable ID in current frame
		const scopeId = this.currentScopeId();
		const entryId = `${scopeId}-${name}`;
		this.trackVarInFrame(name, entryId);
		this.entryIdByVar.set(name, entryId);

		// Build entry
		const typeStr = typeToString(type);
		const addrStr = formatAddress(address);
		const childEntries = children ? this.buildChildrenWithAddress(entryId, children, address) : undefined;

		const entry: MemoryEntry = {
			id: entryId,
			name,
			type: typeStr,
			value,
			address: addrStr,
			children: childEntries,
		};

		this.addOp({ op: 'addEntry', parentId: scopeId, entry });

		return cvalue;
	}

	/** Emit addEntry op for a variable without modifying runtime scope.
	 *  Use when the variable was already declared via declareVariableRuntime(). */
	emitVariableEntry(name: string, type: CType, value: string, address: number, children?: ChildSpec[]): void {
		const scopeId = this.currentScopeId();
		const entryId = `${scopeId}-${name}`;
		this.trackVarInFrame(name, entryId);
		this.entryIdByVar.set(name, entryId);

		const typeStr = typeToString(type);
		const addrStr = formatAddress(address);
		const childEntries = children ? this.buildChildrenWithAddress(entryId, children, address) : undefined;

		const entry: MemoryEntry = {
			id: entryId,
			name,
			type: typeStr,
			value,
			address: addrStr,
			children: childEntries,
		};

		this.addOp({ op: 'addEntry', parentId: scopeId, entry });
	}

	/** Emit scope addEntry + heap container without pushing runtime scope.
	 *  Use when you need to manage runtime scope separately. */
	emitScopeEntry(name: string, params: ParamSpec[], callSite?: ScopeInfo): string {
		const scopeId = this.generateScopeId(name);

		// Emit scope entry op
		const scopeEntry: MemoryEntry = {
			id: scopeId,
			name: params.length > 0 ? `${name}(${params.map((p) => p.name).join(', ')})` : name,
			kind: 'scope',
			type: '',
			value: '',
			address: '',
			scope: callSite,
		};
		this.addOp({ op: 'addEntry', parentId: null, entry: scopeEntry });

		// Add heap container on first scope entry
		if (!this.heapContainerAdded) {
			this.addOp({
				op: 'addEntry',
				parentId: null,
				entry: {
					id: 'heap',
					name: 'Heap',
					kind: 'heap',
					type: '',
					value: '',
					address: '',
				},
			});
			this.heapContainerAdded = true;
		}

		// Push a scope frame for ID tracking (without runtime scope)
		const frame: ScopeFrame = {
			id: scopeId,
			name,
			vars: [],
			savedVarIds: new Map(),
			savedPointerTargets: new Map(),
			savedStackPointer: this.stackPointer,
		};
		this.scopeFrames.push(frame);

		return scopeId;
	}

	/** Emit removeEntry op and restore scope frame without popping runtime scope. */
	emitScopeExit(): void {
		const frame = this.scopeFrames.pop();
		if (!frame) return;

		this.addOp({ op: 'removeEntry', id: frame.id });

		// Restore variable ID mappings
		for (const name of frame.vars) {
			const prev = frame.savedVarIds.get(name);
			if (prev !== undefined) {
				this.entryIdByVar.set(name, prev);
			} else {
				this.entryIdByVar.delete(name);
			}
		}

		// Restore pointer target mappings
		for (const [name, prev] of frame.savedPointerTargets) {
			this.heapEntryByPointer.set(name, prev);
		}
		for (const name of frame.vars) {
			if (!frame.savedPointerTargets.has(name) && this.heapEntryByPointer.has(name)) {
				this.heapEntryByPointer.delete(name);
			}
		}
	}

	/** Emit a heap allocation op without allocating heap memory.
	 *  Use when env.malloc() was already called. */
	emitHeapEntry(pointer: string, type: CType, size: number, allocator: string, line: number, address: number, children?: ChildSpec[]): string {
		const blockId = this.generateHeapId(type, pointer);
		this.heapBlockTypes.set(blockId, type);
		this.heapBlockAddresses.set(blockId, address);
		this.savePointerTargetInFrame(pointer);
		this.heapEntryByPointer.set(pointer, blockId);

		const typeStr = typeToString(type);
		const addrStr = formatAddress(address);
		const childEntries = children ? this.buildChildrenWithAddress(blockId, children, address) : undefined;

		const heapInfo: HeapInfo = {
			size,
			status: 'allocated',
			allocator,
			allocSite: { file: '', line },
		};

		const entry: MemoryEntry = {
			id: blockId,
			name: '',
			type: typeStr,
			value: '',
			address: addrStr,
			heap: heapInfo,
			children: childEntries,
		};

		this.addOp({ op: 'addEntry', parentId: 'heap', entry });

		return blockId;
	}

	/** Push a runtime scope without emitting ops. */
	pushScopeRuntime(name: string): void {
		this.scopes.push({ name, symbols: new Map() });
	}

	/** Pop a runtime scope without emitting ops. */
	popScopeRuntime(): void {
		this.scopes.pop();
	}

	setValue(name: string, value: number): void {
		// Update runtime state
		const cvalue = this.lookupVariable(name);
		if (!cvalue) {
			this.errors.push(`Cannot resolve variable '${name}' for assignment`);
			return;
		}
		cvalue.data = value;
		cvalue.initialized = true;

		// Store in address values
		if (cvalue.address) {
			this.addressValues.set(cvalue.address, value);
		}

		// Emit op
		const entryId = this.entryIdByVar.get(name);
		if (!entryId) {
			this.errors.push(`Cannot resolve variable '${name}' for assignment`);
			return;
		}
		this.addOp({ op: 'setValue', id: entryId, value: String(value) });
	}

	assignVariable(name: string, displayValue: string): void {
		const entryId = this.entryIdByVar.get(name);
		if (!entryId) {
			this.errors.push(`Cannot resolve variable '${name}' for assignment`);
			return;
		}
		this.addOp({ op: 'setValue', id: entryId, value: displayValue });
	}

	setByPath(path: string[], value: string): void {
		const entryId = this.resolvePointerPath(path);
		if (!entryId) {
			this.errors.push(`Cannot resolve path [${path.join(', ')}] for assignment`);
			return;
		}
		this.addOp({ op: 'setValue', id: entryId, value });
	}

	assignField(path: string[], value: string): void {
		// Use resolvePathId (like the old emitter) — resolvePointerPath would
		// follow pointer targets for field names, which is wrong for struct field assignment
		const entryId = this.resolvePathId(path);
		if (!entryId) {
			this.errors.push(`Cannot resolve path [${path.join(', ')}] for field assignment`);
			return;
		}
		this.addOp({ op: 'setValue', id: entryId, value });
	}

	assignElement(path: string[], index: number, value: string): void {
		const parentId = this.resolvePathId(path);
		if (!parentId) {
			this.errors.push(`Cannot resolve path [${path.join(', ')}] for element assignment`);
			return;
		}
		const elementId = `${parentId}-${index}`;
		this.addOp({ op: 'setValue', id: elementId, value });
	}

	// ========================================
	// Heap management
	// ========================================

	malloc(size: number, pointer: string, type: CType, allocator: string, line: number, children?: ChildSpec[]): { address: number; error?: string } {
		if (this.heapUsed + size > this.maxHeapBytes) {
			return { address: 0, error: `Heap exhausted: requested ${size} bytes, ${this.maxHeapBytes - this.heapUsed} available` };
		}

		// Align to 16 bytes
		const alignment = 16;
		this.heapPointer = alignUp(this.heapPointer, alignment);
		const address = this.heapPointer;
		this.heapPointer += size;
		this.heapUsed += size;

		// Store heap block metadata
		const block: HeapBlock = {
			address,
			size,
			type,
			status: 'allocated',
			allocator,
			allocSite: { line },
		};
		this.heapBlocks.set(address, block);

		// Generate heap entry ID and track
		const blockId = this.generateHeapId(type, pointer);
		this.heapBlockTypes.set(blockId, type);
		this.heapBlockAddresses.set(blockId, address);
		// Save previous pointer target for scope restore
		this.savePointerTargetInFrame(pointer);
		this.heapEntryByPointer.set(pointer, blockId);

		// Build heap entry
		const typeStr = typeToString(type);
		const addrStr = formatAddress(address);
		const childEntries = children ? this.buildChildrenWithAddress(blockId, children, address) : undefined;

		const heapInfo: HeapInfo = {
			size,
			status: 'allocated',
			allocator,
			allocSite: { file: '', line },
		};

		const entry: MemoryEntry = {
			id: blockId,
			name: '',
			type: typeStr,
			value: '',
			address: addrStr,
			heap: heapInfo,
			children: childEntries,
		};

		this.addOp({ op: 'addEntry', parentId: 'heap', entry });

		return { address };
	}

	/** Allocate heap memory without emitting ops.
	 *  Use when the interpreter will emit the heap entry op separately via emitHeapEntry(). */
	mallocRuntime(size: number, allocator: string, line: number): { address: number; error?: string } {
		if (this.heapUsed + size > this.maxHeapBytes) {
			return { address: 0, error: `Heap exhausted: requested ${size} bytes, ${this.maxHeapBytes - this.heapUsed} available` };
		}

		const alignment = 16;
		this.heapPointer = alignUp(this.heapPointer, alignment);
		const address = this.heapPointer;
		this.heapPointer += size;
		this.heapUsed += size;

		const block: HeapBlock = {
			address,
			size,
			type: { kind: 'primitive', name: 'void' },
			status: 'allocated',
			allocator,
			allocSite: { line },
		};
		this.heapBlocks.set(address, block);

		return { address };
	}

	free(pointer: string): { error?: string } {
		const blockId = this.heapEntryByPointer.get(pointer);
		if (!blockId) {
			this.errors.push(`Cannot find heap block for pointer '${pointer}'`);
			return { error: `Cannot find heap block for pointer '${pointer}'` };
		}

		const address = this.heapBlockAddresses.get(blockId);
		if (address === undefined) {
			return { error: `Cannot find address for heap block '${blockId}'` };
		}

		const block = this.heapBlocks.get(address);
		if (!block) {
			return { error: `free(): invalid pointer 0x${address.toString(16)}` };
		}
		if (block.status === 'freed') {
			return { error: `free(): double free of 0x${address.toString(16)}` };
		}
		block.status = 'freed';

		this.addOp({ op: 'setHeapStatus', id: blockId, status: 'freed' });
		return {};
	}

	/** Free a heap block by address (runtime only, no op emission).
	 *  The interpreter emits the setHeapStatus op separately via freeHeapById(). */
	freeByAddress(address: number): { error?: string } {
		const block = this.heapBlocks.get(address);
		if (!block) {
			return { error: `free(): invalid pointer 0x${address.toString(16)}` };
		}
		if (block.status === 'freed') {
			return { error: `free(): double free of 0x${address.toString(16)}` };
		}
		block.status = 'freed';
		return {};
	}

	freeByBlockId(blockId: string): void {
		const address = this.heapBlockAddresses.get(blockId);
		if (address !== undefined) {
			const block = this.heapBlocks.get(address);
			if (block) {
				block.status = 'freed';
			}
		}
		this.addOp({ op: 'setHeapStatus', id: blockId, status: 'freed' });
	}

	detectLeaks(): void {
		for (const [addr, block] of this.heapBlocks) {
			if (block.status === 'allocated') {
				const blockId = this.getHeapBlockIdByAddress(addr);
				if (blockId) {
					this.addOp({ op: 'setHeapStatus', id: blockId, status: 'leaked' });
				}
			}
		}
	}

	// ========================================
	// Queries (MemoryReader interface)
	// ========================================

	lookupVariable(name: string): CValue | undefined {
		for (let i = this.scopes.length - 1; i >= 0; i--) {
			const value = this.scopes[i].symbols.get(name);
			if (value !== undefined) return value;
		}
		return undefined;
	}

	readMemory(address: number): number | undefined {
		return this.addressValues.get(address);
	}

	writeMemory(address: number, value: number): void {
		this.addressValues.set(address, value);
	}

	currentScopeId(): string {
		if (this.scopeFrames.length === 0) return 'global';
		return this.scopeFrames[this.scopeFrames.length - 1].id;
	}

	currentScopeName(): string | undefined {
		if (this.scopes.length === 0) return undefined;
		return this.scopes[this.scopes.length - 1].name;
	}

	scopeDepth(): number {
		return this.scopes.length;
	}

	isFreedAddress(address: number): boolean {
		for (const block of this.heapBlocks.values()) {
			if (block.status === 'freed' && address >= block.address && address < block.address + block.size) {
				return true;
			}
		}
		return false;
	}

	getHeapBlock(address: number): HeapBlock | undefined {
		return this.heapBlocks.get(address);
	}

	getAllHeapBlocks(): Map<number, HeapBlock> {
		return this.heapBlocks;
	}

	setHeapBlockType(address: number, type: CType): void {
		const block = this.heapBlocks.get(address);
		if (block) block.type = type;
		// Also update the type in our tracking map
		const blockId = this.getHeapBlockIdByAddress(address);
		if (blockId) this.heapBlockTypes.set(blockId, type);
	}

	// === Function table ===

	defineFunction(name: string, node: ASTNode & { type: 'function_definition' }): void {
		this.functions.set(name, node);
		const idx = this.nextFunctionIndex++;
		this.functionIndices.set(name, idx);
		this.indexToFunction.set(idx, name);
	}

	getFunction(name: string): (ASTNode & { type: 'function_definition' }) | undefined {
		return this.functions.get(name);
	}

	getFunctionIndex(name: string): number {
		return this.functionIndices.get(name) ?? 0;
	}

	getFunctionByIndex(index: number): { name: string; node: ASTNode & { type: 'function_definition' } } | undefined {
		const name = this.indexToFunction.get(index);
		if (!name) return undefined;
		const node = this.functions.get(name);
		if (!node) return undefined;
		return { name, node };
	}

	// === Stack/Heap base accessors ===

	getStackBase(): number {
		return STACK_BASE;
	}

	getHeapBase(): number {
		return HEAP_BASE;
	}

	saveStackPointer(): number {
		return this.stackPointer;
	}

	restoreStackPointer(sp: number): void {
		this.stackPointer = sp;
	}

	// === Environment-compatible variable set (mutates CValue directly) ===

	/** Set a variable's numeric value in the runtime scope (no op emission).
	 *  Equivalent to Environment.setVariable(). */
	setVariable(name: string, data: number | null): void {
		return this.setVariableData(name, data);
	}

	setVariableData(name: string, data: number | null): void {
		for (let i = this.scopes.length - 1; i >= 0; i--) {
			const value = this.scopes[i].symbols.get(name);
			if (value !== undefined) {
				value.data = data;
				value.initialized = true;
				return;
			}
		}
		throw new Error(`Variable '${name}' not found`);
	}

	// === Declare variable in runtime scope only (no op emission) ===

	declareVariableRuntime(name: string, type: CType, data: number | null = null): CValue {
		const scope = this.scopes[this.scopes.length - 1];
		if (!scope) throw new Error('No active scope');

		const size = sizeOf(type);
		const alignment = alignOf(type);
		this.stackPointer = alignDown(this.stackPointer - size, alignment);
		const address = this.stackPointer;

		const value: CValue = { type, data: data ?? defaultValue(type), address, initialized: data !== null };
		scope.symbols.set(name, value);
		return value;
	}

	// ========================================
	// Path resolution
	// ========================================

	resolveEntryId(name: string): string | undefined {
		return this.entryIdByVar.get(name);
	}

	resolvePathId(path: string[]): string | undefined {
		if (path.length === 0) return undefined;

		const rootVar = path[0];
		const rootId = this.entryIdByVar.get(rootVar);
		if (!rootId) return undefined;
		let currentId: string = rootId;

		for (let i = 1; i < path.length; i++) {
			const field = path[i];
			const heapTarget = this.heapEntryByPointer.get(path.slice(0, i).join('.') || rootVar);
			if (heapTarget && i === 1) {
				currentId = heapTarget;
			}

			const children = this.childEntriesById.get(currentId);
			if (children) {
				const childId = children.get(field);
				if (childId) {
					currentId = childId;
					continue;
				}
			}

			currentId = `${currentId}-${field}`;
		}

		return currentId;
	}

	resolvePointerPath(path: string[]): string | undefined {
		if (path.length === 0) return undefined;
		const rootVar = path[0];

		const heapBlockId = this.heapEntryByPointer.get(rootVar);

		if (!heapBlockId) {
			for (let i = 1; i < path.length; i++) {
				const fieldHeapBlock = this.heapEntryByPointer.get(path[i]);
				if (fieldHeapBlock) {
					const remaining = path.slice(i + 1);
					if (remaining.length === 0) return fieldHeapBlock;
					return this.resolvePointerPath([path[i], ...remaining]);
				}
			}
			return this.resolvePathId(path);
		}

		if (path.length === 1) return heapBlockId;

		let currentId = heapBlockId;
		for (let i = 1; i < path.length; i++) {
			const field = path[i];

			const fieldHeapBlock = this.heapEntryByPointer.get(field);
			if (fieldHeapBlock) {
				currentId = fieldHeapBlock;
				continue;
			}

			const children = this.childEntriesById.get(currentId);
			if (children) {
				const childId = children.get(field);
				if (childId) {
					currentId = childId;
					continue;
				}
			}
			currentId = `${currentId}-${field}`;
		}

		return currentId;
	}

	// === Public ID/pointer accessors (for interpreter migration) ===

	getVarEntryId(name: string): string | undefined {
		return this.entryIdByVar.get(name);
	}

	getHeapBlockId(pointerVar: string): string | undefined {
		return this.heapEntryByPointer.get(pointerVar);
	}

	setPointerTarget(varName: string, blockId: string): void {
		this.heapEntryByPointer.set(varName, blockId);
	}

	// === stdin buffer entry ===

	addStdinEntry(buffer: string): void {
		if (this.stdinEntryAdded || buffer.length === 0) return;
		this.stdinEntryAdded = true;
		const display = formatStdinDisplay(buffer, 0);
		this.addOp({
			op: 'addEntry',
			parentId: null,
			entry: {
				id: 'stdin',
				name: 'stdin',
				type: 'char[]',
				value: display,
				address: '',
				kind: 'io',
			},
		});
	}

	updateStdinCursor(cursorPos: number, fullBuffer: string): void {
		if (!this.stdinEntryAdded) return;
		const display = formatStdinDisplay(fullBuffer, cursorPos);
		this.addOp({ op: 'setValue', id: 'stdin', value: display });
	}

	/** Find which variable/entry owns a given memory address. For overflow visualization. */
	findEntryIdAtAddress(address: number): { varName: string; entryId: string; offset: number; elemSize: number } | undefined {
		// Search current scope's variables
		for (const scope of this.scopes) {
			for (const [name, cvalue] of scope.symbols) {
				const varSize = sizeOf(cvalue.type);
				if (varSize <= 0) continue;
				if (address >= cvalue.address && address < cvalue.address + varSize) {
					const offset = address - cvalue.address;
					const entryId = this.entryIdByVar.get(name);
					if (!entryId) continue;
					const elemSize = isArrayType(cvalue.type) ? sizeOf(cvalue.type.elementType) : varSize;
					return { varName: name, entryId, offset, elemSize };
				}
			}
		}
		return undefined;
	}

	hasChildEntries(parentId: string): boolean {
		const children = this.childEntriesById.get(parentId);
		return children !== undefined && children.size > 0;
	}

	getHeapBlockIdByAddress(address: number): string | undefined {
		for (const [id, addr] of this.heapBlockAddresses) {
			if (addr === address) return id;
		}
		return undefined;
	}

	// === Op emission by ID ===

	setValueById(id: string, value: string): void {
		this.addOp({ op: 'setValue', id, value });
	}

	freeHeapById(blockId: string): void {
		this.addOp({ op: 'setHeapStatus', id: blockId, status: 'freed' });
	}

	leakHeapById(blockId: string): void {
		this.addOp({ op: 'setHeapStatus', id: blockId, status: 'leaked' });
	}

	removeEntryById(blockId: string): void {
		this.addOp({ op: 'removeEntry', id: blockId });
	}

	// ========================================
	// ID generation (private)
	// ========================================

	private generateScopeId(name: string): string {
		const count = this.scopeCounters.get(name) ?? 0;
		this.scopeCounters.set(name, count + 1);
		return count === 0 ? name : `${name}${count + 1}`;
	}

	private generateBlockId(label: string): string {
		const count = this.blockCounters.get(label) ?? 0;
		this.blockCounters.set(label, count + 1);
		const num = count + 1;
		if (label === 'for') return `for${num}`;
		if (label === 'while') return `while${num}`;
		if (label === 'do-while') return `dowhile${num}`;
		const scopeId = this.currentScopeId();
		return `${scopeId}-block${num > 1 ? num : ''}`;
	}

	private generateHeapId(type: CType, pointerVar: string): string {
		const baseName = pointerVar.replace(/[^a-zA-Z0-9]/g, '');
		const key = baseName;
		const count = this.heapCounters.get(key) ?? 0;
		this.heapCounters.set(key, count + 1);
		return count === 0 ? `heap-${baseName}` : `heap-${baseName}${count + 1}`;
	}

	// ========================================
	// ChildSpec → MemoryEntry (private)
	// ========================================

	private buildChildrenWithAddress(parentId: string, specs: ChildSpec[], baseAddress: number): MemoryEntry[] {
		return specs.map((spec) => {
			const childId = `${parentId}-${spec.name}`;
			const childAddr = baseAddress + spec.addressOffset;
			this.registerChild(parentId, spec.name, childId);

			const entry: MemoryEntry = {
				id: childId,
				name: spec.displayName,
				type: typeToString(spec.type),
				value: spec.value,
				address: formatAddress(childAddr),
			};

			if (spec.children) {
				entry.children = this.buildChildrenWithAddress(childId, spec.children, childAddr);
			}

			return entry;
		});
	}

	private registerChild(parentId: string, fieldName: string, childId: string): void {
		if (!this.childEntriesById.has(parentId)) {
			this.childEntriesById.set(parentId, new Map());
		}
		this.childEntriesById.get(parentId)!.set(fieldName, childId);
	}

	// ========================================
	// Scope tracking (private)
	// ========================================

	private trackVarInFrame(name: string, _entryId: string): void {
		const frame = this.scopeFrames[this.scopeFrames.length - 1];
		if (frame) {
			// Save previous mapping for restore on scope exit (handles shadowing)
			const prev = this.entryIdByVar.get(name);
			if (prev !== undefined) {
				frame.savedVarIds.set(name, prev);
			}
			// Save previous pointer target if exists
			const prevPtr = this.heapEntryByPointer.get(name);
			if (prevPtr !== undefined && !frame.savedPointerTargets.has(name)) {
				frame.savedPointerTargets.set(name, prevPtr);
			}
			frame.vars.push(name);
		}
	}

	private savePointerTargetInFrame(name: string): void {
		const frame = this.scopeFrames[this.scopeFrames.length - 1];
		if (frame && !frame.savedPointerTargets.has(name)) {
			const prev = this.heapEntryByPointer.get(name);
			if (prev !== undefined) {
				frame.savedPointerTargets.set(name, prev);
			}
			// Track this name so popScope knows to clean it up
			if (!frame.vars.includes(name)) {
				frame.vars.push(name);
			}
		}
	}

	// ========================================
	// Value parsing (private)
	// ========================================

	private parseNumericValue(value: string, type: CType): number | null {
		if (value === '' || value === '(uninit)') return null;
		if (value === 'NULL') return 0;
		if (value.startsWith('0x')) return parseInt(value, 16);
		if (value.startsWith('→ ')) return null; // function pointer display
		if (value === '(dangling)') return 0;
		const num = Number(value);
		return isNaN(num) ? null : num;
	}
}
