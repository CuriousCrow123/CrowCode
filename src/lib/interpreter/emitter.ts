import type {
	MemoryEntry,
	SnapshotOp,
	ProgramStep,
	SourceLocation,
	ScopeInfo,
	HeapInfo,
} from '$lib/api/types';
import type { CType, ChildSpec, ParamSpec } from './types';
import { sizeOf, typeToString, isStructType, isArrayType } from './types-c';
import { formatAddress } from './environment';

// === OpEmitter Interface ===

export interface OpEmitter {
	beginStep(location: SourceLocation, description?: string, evaluation?: string): void;
	markSubStep(): void;

	enterFunction(name: string, params: ParamSpec[], callSite?: ScopeInfo): void;
	exitFunction(name: string, returnValue?: string): void;
	enterBlock(label: string): void;
	exitBlock(id: string): void;

	declareVariable(name: string, type: CType, value: string, children?: ChildSpec[]): void;
	assignVariable(name: string, value: string): void;

	assignField(path: string[], value: string): void;
	assignElement(path: string[], index: number, value: string): void;

	allocHeap(pointerVar: string, type: CType, size: number, allocator: string, allocSite: { line: number }, children?: ChildSpec[]): void;
	freeHeap(pointerVar: string): void;
	leakHeap(blockId: string): void;
	removeHeapBlock(blockId: string): void;

	finish(): { program: { name: string; source: string; steps: ProgramStep[] }; errors: string[] };
}

// === DefaultEmitter ===

export class DefaultEmitter implements OpEmitter {
	private steps: ProgramStep[] = [];
	private currentStep: ProgramStep | null = null;
	private errors: string[] = [];

	// Scope stack: tracks current scope IDs for variable ID generation
	private scopeStack: Array<{ id: string; name: string; vars: string[]; savedVars: Map<string, string> }> = [];
	// Variable name → entry ID mapping for path resolution
	private varMap = new Map<string, string>();
	// Entry ID → children entry IDs (for struct/array field lookups)
	private childMap = new Map<string, Map<string, string>>();
	// Pointer variable → heap block ID (for path resolution through pointers)
	private ptrTargetMap = new Map<string, string>();
	// Heap block ID → type info
	private heapBlockTypes = new Map<string, CType>();
	// Track heap container
	private heapContainerAdded = false;
	// Address tracking for heap blocks
	private heapBlockAddresses = new Map<string, number>();

	private programName: string;
	private programSource: string;

	constructor(name: string, source: string) {
		this.programName = name;
		this.programSource = source;
	}

	// === Step lifecycle ===

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

	private flushStep(): void {
		if (this.currentStep) {
			this.steps.push(this.currentStep);
		}
		this.currentStep = null;
	}

	private addOp(op: SnapshotOp): void {
		if (!this.currentStep) {
			this.errors.push('Op emitted without active step');
			return;
		}
		this.currentStep.ops.push(op);
	}

	// === Scope lifecycle ===

	enterFunction(name: string, params: ParamSpec[], callSite?: ScopeInfo): void {
		const scopeId = this.generateScopeId(name);
		this.scopeStack.push({ id: scopeId, name, vars: [], savedVars: new Map() });

		const scopeEntry: MemoryEntry = {
			id: scopeId,
			name: `${name}(${params.map((p) => p.name).join(', ')})`,
			kind: 'scope',
			type: '',
			value: '',
			address: '',
			scope: callSite,
		};

		this.addOp({ op: 'addEntry', parentId: null, entry: scopeEntry });

		// Add heap container on first function entry if not already added
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

		// Add parameter variables
		for (const param of params) {
			if (param.address !== undefined) {
				this.declareVariableWithAddress(param.name, param.type, param.value, param.address, param.children);
			} else {
				this.declareVariable(param.name, param.type, param.value, param.children);
			}
		}
	}

	exitFunction(name: string, _returnValue?: string): void {
		const scope = this.scopeStack.pop();
		if (scope) {
			this.addOp({ op: 'removeEntry', id: scope.id });
			this.cleanupScopeVars(scope);
		}
	}

	enterBlock(label: string): void {
		const currentScope = this.currentScopeId();
		const blockId = this.generateBlockId(label);
		this.scopeStack.push({ id: blockId, name: label, vars: [], savedVars: new Map() });

		const scopeEntry: MemoryEntry = {
			id: blockId,
			name: label === 'for' ? 'for' : label === 'while' ? 'while' : label === 'do-while' ? 'do-while' : '{ }',
			kind: 'scope',
			type: '',
			value: '',
			address: '',
			scope: {},
		};

		this.addOp({ op: 'addEntry', parentId: currentScope, entry: scopeEntry });
	}

	exitBlock(id: string): void {
		const scope = this.scopeStack.pop();
		if (scope) {
			this.addOp({ op: 'removeEntry', id: scope.id });
			this.cleanupScopeVars(scope);
		}
	}

	// === Variable lifecycle ===

	declareVariable(name: string, type: CType, value: string, children?: ChildSpec[]): void {
		const scopeId = this.currentScopeId();
		const entryId = `${scopeId}-${name}`;
		this.trackVarInScope(name);
		this.varMap.set(name, entryId);

		const typeStr = typeToString(type);
		const childEntries = children ? this.buildChildren(entryId, children) : undefined;

		const entry: MemoryEntry = {
			id: entryId,
			name,
			type: typeStr,
			value,
			address: '', // filled in by caller via step description
			children: childEntries,
		};

		this.addOp({ op: 'addEntry', parentId: scopeId, entry });
	}

	declareVariableWithAddress(name: string, type: CType, value: string, address: number, children?: ChildSpec[]): void {
		const scopeId = this.currentScopeId();
		const entryId = `${scopeId}-${name}`;
		this.trackVarInScope(name);
		this.varMap.set(name, entryId);

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

	assignVariable(name: string, value: string): void {
		const entryId = this.resolveVarId(name);
		if (!entryId) {
			this.errors.push(`Cannot resolve variable '${name}' for assignment`);
			return;
		}
		this.addOp({ op: 'setValue', id: entryId, value });
	}

	// === Field/element targeting ===

	assignField(path: string[], value: string): void {
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

	// === Heap lifecycle ===

	allocHeap(pointerVar: string, type: CType, size: number, allocator: string, allocSite: { line: number }, children?: ChildSpec[]): void {
		const blockId = this.generateHeapId(type, pointerVar);
		this.heapBlockTypes.set(blockId, type);
		this.ptrTargetMap.set(pointerVar, blockId);

		const typeStr = typeToString(type);
		const childEntries = children ? this.buildChildren(blockId, children) : undefined;

		const heapInfo: HeapInfo = {
			size,
			status: 'allocated',
			allocator,
			allocSite: { file: '', line: allocSite.line },
		};

		const entry: MemoryEntry = {
			id: blockId,
			name: '',
			type: typeStr,
			value: '',
			address: '', // filled in by caller
			heap: heapInfo,
			children: childEntries,
		};

		this.addOp({ op: 'addEntry', parentId: 'heap', entry });
	}

	allocHeapWithAddress(pointerVar: string, type: CType, size: number, allocator: string, allocSite: { line: number }, address: number, children?: ChildSpec[]): void {
		const blockId = this.generateHeapId(type, pointerVar);
		this.heapBlockTypes.set(blockId, type);
		this.heapBlockAddresses.set(blockId, address);
		this.ptrTargetMap.set(pointerVar, blockId);

		const typeStr = typeToString(type);
		const addrStr = formatAddress(address);
		const childEntries = children ? this.buildChildrenWithAddress(blockId, children, address) : undefined;

		const heapInfo: HeapInfo = {
			size,
			status: 'allocated',
			allocator,
			allocSite: { file: '', line: allocSite.line },
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
	}

	freeHeap(pointerVar: string): void {
		const blockId = this.ptrTargetMap.get(pointerVar);
		if (!blockId) {
			this.errors.push(`Cannot find heap block for pointer '${pointerVar}'`);
			return;
		}
		this.addOp({ op: 'setHeapStatus', id: blockId, status: 'freed' });
	}

	leakHeap(blockId: string): void {
		this.addOp({ op: 'setHeapStatus', id: blockId, status: 'leaked' });
	}

	removeHeapBlock(blockId: string): void {
		this.addOp({ op: 'removeEntry', id: blockId });
	}

	// === Output ===

	finish(): { program: { name: string; source: string; steps: ProgramStep[] }; errors: string[] } {
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

	// === ID generation ===

	private scopeCounters = new Map<string, number>();

	private generateScopeId(name: string): string {
		// Use short, readable IDs
		const count = this.scopeCounters.get(name) ?? 0;
		this.scopeCounters.set(name, count + 1);
		return count === 0 ? name : `${name}${count + 1}`;
	}

	private blockCounters = new Map<string, number>();

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

	private heapCounters = new Map<string, number>();

	private generateHeapId(type: CType, pointerVar: string): string {
		// Use descriptive heap IDs like 'heap-player', 'heap-scores'
		const baseName = pointerVar.replace(/[^a-zA-Z0-9]/g, '');
		const key = baseName;
		const count = this.heapCounters.get(key) ?? 0;
		this.heapCounters.set(key, count + 1);
		return count === 0 ? `heap-${baseName}` : `heap-${baseName}${count + 1}`;
	}

	// === Path resolution ===

	private currentScopeId(): string {
		if (this.scopeStack.length === 0) return 'global';
		return this.scopeStack[this.scopeStack.length - 1].id;
	}

	private resolveVarId(name: string): string | undefined {
		return this.varMap.get(name);
	}

	resolvePathId(path: string[]): string | undefined {
		if (path.length === 0) return undefined;

		const rootVar = path[0];
		const rootId = this.varMap.get(rootVar);
		if (!rootId) return undefined;
		let currentId: string = rootId;

		for (let i = 1; i < path.length; i++) {
			const field = path[i];
			// Check if current points to a heap block
			const heapTarget = this.ptrTargetMap.get(path.slice(0, i).join('.') || rootVar);
			if (heapTarget && i === 1) {
				currentId = heapTarget;
			}

			// Try child map
			const children = this.childMap.get(currentId);
			if (children) {
				const childId = children.get(field);
				if (childId) {
					currentId = childId;
					continue;
				}
			}

			// Try direct ID construction
			currentId = `${currentId}-${field}`;
		}

		return currentId;
	}

	// For pointer variables, resolve through to the heap block
	resolvePointerPath(path: string[]): string | undefined {
		if (path.length === 0) return undefined;
		const rootVar = path[0];

		// Check if root var points to heap
		const heapBlockId = this.ptrTargetMap.get(rootVar);
		if (!heapBlockId) return this.resolvePathId(path);

		if (path.length === 1) return heapBlockId;

		// Navigate through the heap block's children
		let currentId = heapBlockId;
		for (let i = 1; i < path.length; i++) {
			const field = path[i];
			const children = this.childMap.get(currentId);
			if (children) {
				const childId = children.get(field);
				if (childId) {
					currentId = childId;
					continue;
				}
			}
			// Fallback: direct ID construction
			currentId = `${currentId}-${field}`;
		}

		return currentId;
	}

	// === ChildSpec → MemoryEntry conversion ===

	private buildChildren(parentId: string, specs: ChildSpec[]): MemoryEntry[] {
		return specs.map((spec) => {
			const childId = `${parentId}-${spec.name}`;
			this.registerChild(parentId, spec.name, childId);

			const entry: MemoryEntry = {
				id: childId,
				name: spec.displayName,
				type: typeToString(spec.type),
				value: spec.value,
				address: '',
			};

			if (spec.children) {
				entry.children = this.buildChildren(childId, spec.children);
			}

			return entry;
		});
	}

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
		if (!this.childMap.has(parentId)) {
			this.childMap.set(parentId, new Map());
		}
		this.childMap.get(parentId)!.set(fieldName, childId);
	}

	// === Scope tracking ===

	private trackVarInScope(name: string): void {
		const scope = this.scopeStack[this.scopeStack.length - 1];
		if (scope) {
			// Save previous mapping so we can restore on scope exit (handles shadowing)
			const prev = this.varMap.get(name);
			if (prev !== undefined) {
				scope.savedVars.set(name, prev);
			}
			scope.vars.push(name);
		}
	}

	private cleanupScopeVars(scope: { vars: string[]; savedVars: Map<string, string> }): void {
		for (const name of scope.vars) {
			const prev = scope.savedVars.get(name);
			if (prev !== undefined) {
				// Restore shadowed outer variable
				this.varMap.set(name, prev);
			} else {
				this.varMap.delete(name);
			}
		}
	}

	// === Public utilities ===

	getVarEntryId(name: string): string | undefined {
		return this.varMap.get(name);
	}

	getHeapBlockId(pointerVar: string): string | undefined {
		return this.ptrTargetMap.get(pointerVar);
	}

	setPointerTarget(varName: string, blockId: string): void {
		this.ptrTargetMap.set(varName, blockId);
	}
}
