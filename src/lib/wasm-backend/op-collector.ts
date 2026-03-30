/**
 * Op Collector: implements JS-side __crow_* callbacks that read WASM linear memory
 * and accumulate ProgramStep[] with SnapshotOp[].
 *
 * This is the bridge between WASM execution and CrowCode's visualization pipeline.
 * Each __crow_* call from the running WASM module triggers a method here that reads
 * typed values from linear memory and emits the appropriate SnapshotOps.
 */

import type { MemoryEntry, SnapshotOp, ProgramStep, IoEvent, Program } from '$lib/types';
import type { StructRegistry } from './transformer';

export class StepLimitExceeded extends Error {
	constructor() {
		super('Step limit exceeded');
		this.name = 'StepLimitExceeded';
	}
}

export class StdinExhausted extends Error {
	constructor() {
		super('stdin exhausted');
		this.name = 'StdinExhausted';
	}
}

type VarInfo = {
	scopeId: string;
	entryId: string;
	addr: number;
	size: number;
	type: string;
};

type HeapBlock = {
	entryId: string;
	size: number;
	line: number;
	status: 'allocated' | 'freed';
	baseType?: string;
	childrenBuilt: boolean;
};

export class OpCollector {
	private memory!: DataView;
	private memoryBuffer!: Uint8Array;
	private steps: ProgramStep[] = [];
	private currentOps: SnapshotOp[] = [];
	private currentLine = 0;

	// Scope tracking
	private scopeStack: string[] = [];
	private scopeCounters = new Map<string, number>();

	// Variable tracking
	private varRegistry = new Map<string, VarInfo>();

	// Heap tracking
	private heapBlocks = new Map<number, HeapBlock>();
	private heapContainerAdded = false;
	private heapCounter = 0;

	// I/O
	private currentIoEvents: IoEvent[] = [];

	// Stdin
	private stdinBuffer = '';
	private stdinOffset = 0;

	// Limits
	private stepCount = 0;
	private maxSteps: number;

	// Struct type registry
	private structRegistry: StructRegistry;

	// WASM exports (set during execution)
	private wasmExports: { malloc: (size: number) => number; free: (ptr: number) => void; memory: WebAssembly.Memory } | null = null;

	constructor(maxSteps: number, structRegistry?: StructRegistry) {
		this.maxSteps = maxSteps;
		this.structRegistry = structRegistry ?? new Map();
	}

	setMemory(memory: WebAssembly.Memory): void {
		this.memory = new DataView(memory.buffer);
		this.memoryBuffer = new Uint8Array(memory.buffer);
	}

	setWasmExports(exports: { malloc: (size: number) => number; free: (ptr: number) => void; memory: WebAssembly.Memory }): void {
		this.wasmExports = exports;
	}

	setStdin(stdin: string): void {
		this.stdinBuffer = stdin;
		this.stdinOffset = 0;
	}

	// === Callback methods (called from WASM) ===

	onStep(line: number): void {
		if (++this.stepCount > this.maxSteps) {
			throw new StepLimitExceeded();
		}
		// Set currentLine FIRST so ops are attributed to the correct source line
		this.currentLine = line;

		// Merge consecutive empty steps at the same line (avoids duplicate
		// condition+return steps for compact `if (x) { return y; }`)
		const prev = this.steps[this.steps.length - 1];
		if (
			prev &&
			prev.location.line === line &&
			prev.ops.length === 0 &&
			!prev.ioEvents &&
			this.currentOps.length === 0 &&
			this.currentIoEvents.length === 0
		) {
			return;
		}

		// Always push a step — empty steps mark the current line for the UI
		this.steps.push({
			location: { line: this.currentLine },
			ops: this.currentOps,
			ioEvents: this.currentIoEvents.length > 0 ? [...this.currentIoEvents] : undefined,
		});
		this.currentOps = [];
		this.currentIoEvents = [];
	}

	onPushScope(namePtr: number, line: number): void {
		this.refreshMemory();
		const name = this.readCString(namePtr);
		const scopeId = this.generateScopeId(name);
		this.scopeStack.push(scopeId);

		const entry: MemoryEntry = {
			id: scopeId,
			name,
			kind: 'scope',
			type: '',
			value: '',
			address: '',
		};
		this.currentOps.push({ op: 'addEntry', parentId: null, entry });

		if (!this.heapContainerAdded) {
			this.currentOps.push({
				op: 'addEntry',
				parentId: null,
				entry: { id: 'heap', name: 'Heap', kind: 'heap', type: '', value: '', address: '' },
			});
			this.heapContainerAdded = true;
		}
	}

	onPopScope(): void {
		const scopeId = this.scopeStack.pop();
		if (!scopeId) return;

		// Remove all variables in this scope
		for (const [name, info] of this.varRegistry) {
			if (info.scopeId === scopeId) {
				this.varRegistry.delete(name);
			}
		}

		this.currentOps.push({ op: 'removeEntry', id: scopeId });
	}

	onDecl(namePtr: number, addr: number, size: number, typePtr: number, _line: number, flags: number = 0): void {
		this.refreshMemory();
		const name = this.readCString(namePtr);
		const typeStr = this.readCString(typePtr);
		const scopeId = this.currentScopeId();
		const entryId = `${scopeId}::${name}`;
		const hexAddr = '0x' + addr.toString(16).padStart(8, '0');

		const isUninitialized = (flags & 1) !== 0;
		const value = isUninitialized ? '?' : this.readValue(addr, size, typeStr);

		// If variable already exists in this scope (e.g., loop var re-declared each iteration),
		// emit a setValue instead of addEntry to avoid duplicate IDs.
		const existing = this.varRegistry.get(name);
		if (existing && existing.scopeId === scopeId) {
			existing.addr = addr;
			existing.size = size;
			existing.type = typeStr;
			this.currentOps.push({ op: 'setValue', id: entryId, value });
			this.updateChildValues(existing);
			return;
		}

		const children = this.buildChildren(addr, size, typeStr, entryId);

		const entry: MemoryEntry = {
			id: entryId,
			name,
			type: typeStr,
			value,
			address: hexAddr,
			children: children.length > 0 ? children : undefined,
		};

		this.varRegistry.set(name, { scopeId, entryId, addr, size, type: typeStr });
		this.currentOps.push({ op: 'addEntry', parentId: scopeId, entry });
	}

	onSet(namePtr: number, addr: number, _line: number): void {
		this.refreshMemory();
		const name = this.readCString(namePtr);
		const info = this.varRegistry.get(name);
		if (!info) return;

		const value = this.readValue(addr, info.size, info.type);
		this.currentOps.push({ op: 'setValue', id: info.entryId, value });

		// Update children if struct or array
		this.updateChildValues(info);

		// If this is a pointer type, check if it points to a heap block
		// and update the heap entry's value too
		if (info.type.endsWith('*')) {
			const ptrValue = this.memory.getUint32(addr, true);
			const heapBlock = this.findHeapBlock(ptrValue);
			if (heapBlock) {
				if (heapBlock.status === 'allocated') {
					const baseType = info.type.slice(0, -1).trim();
					const blockAddr = this.findHeapBlockAddr(heapBlock);

					// First dereference: infer type and build children
					this.typeHeapBlock(heapBlock, blockAddr, baseType);

					// Update all children values
					this.updateHeapBlockValues(heapBlock, blockAddr, baseType);
				} else if (heapBlock.status === 'freed') {
					// Use-after-free detected
					this.currentOps.push({
						op: 'setHeapStatus',
						id: heapBlock.entryId,
						status: 'use-after-free',
					});
				}
			}
		}
	}

	onMalloc(size: number, line: number): number {
		if (!this.wasmExports) return 0;
		const addr = this.wasmExports.malloc(size);
		if (addr === 0) return 0;

		this.refreshMemory();
		const entryId = `heap_${this.heapCounter++}`;
		this.heapBlocks.set(addr, { entryId, size, line, status: 'allocated', childrenBuilt: false });

		const hexAddr = '0x' + addr.toString(16).padStart(8, '0');
		const entry: MemoryEntry = {
			id: entryId,
			name: `malloc(${size})`,
			type: `${size} bytes`,
			value: '',
			address: hexAddr,
			heap: {
				size,
				status: 'allocated',
				allocator: 'malloc',
				allocSite: { file: '', line },
			},
		};

		this.currentOps.push({ op: 'addEntry', parentId: 'heap', entry });
		return addr;
	}

	onCalloc(count: number, size: number, line: number): number {
		const totalSize = count * size;
		const addr = this.onMalloc(totalSize, line);
		if (addr !== 0) {
			// Zero the memory (calloc semantics)
			this.refreshMemory();
			this.memoryBuffer.fill(0, addr, addr + totalSize);
			// Fix entry to show calloc instead of malloc
			const lastOp = this.currentOps[this.currentOps.length - 1];
			if (lastOp && lastOp.op === 'addEntry') {
				lastOp.entry.name = `calloc(${count}, ${size})`;
				if (lastOp.entry.heap) {
					lastOp.entry.heap.allocator = 'calloc';
				}
			}
		}
		return addr;
	}

	onRealloc(ptr: number, size: number, line: number): number {
		if (ptr === 0) return this.onMalloc(size, line);
		if (size === 0) {
			this.onFree(ptr, line);
			return 0;
		}

		// Track the old block
		const oldBlock = this.heapBlocks.get(ptr);
		const oldSize = oldBlock?.size ?? 0;

		// Allocate new block
		const newAddr = this.onMalloc(size, line);
		if (newAddr === 0) return 0;

		// Copy old data
		this.refreshMemory();
		const copySize = Math.min(oldSize, size);
		if (copySize > 0) {
			this.memoryBuffer.copyWithin(newAddr, ptr, ptr + copySize);
		}

		// Free old block
		this.onFree(ptr, line);
		return newAddr;
	}

	onFree(ptr: number, line: number): void {
		if (ptr === 0) return; // free(NULL) is a no-op

		const block = this.heapBlocks.get(ptr);
		if (!block) return;

		if (block.status === 'freed') {
			// Double free detected
			return;
		}

		block.status = 'freed';
		this.currentOps.push({ op: 'setHeapStatus', id: block.entryId, status: 'freed' });

		if (this.wasmExports) {
			this.wasmExports.free(ptr);
		}
	}

	// === scanf callbacks ===

	onScanfInt(ptr: number, _line: number): number {
		const input = this.consumeNextToken();
		if (input === null) throw new StdinExhausted();
		const val = parseInt(input, 10);
		if (isNaN(val)) return 0;
		this.refreshMemory();
		this.memory.setInt32(ptr, val, true);
		this.emitSetValueForAddr(ptr);
		this.currentIoEvents.push({ kind: 'read', source: 'stdin', consumed: input, cursorPos: this.stdinOffset });
		return 1;
	}

	onScanfFloat(ptr: number, _line: number): number {
		const input = this.consumeNextToken();
		if (input === null) throw new StdinExhausted();
		const val = parseFloat(input);
		if (isNaN(val)) return 0;
		this.refreshMemory();
		this.memory.setFloat32(ptr, val, true);
		this.emitSetValueForAddr(ptr);
		this.currentIoEvents.push({ kind: 'read', source: 'stdin', consumed: input, cursorPos: this.stdinOffset });
		return 1;
	}

	onScanfDouble(ptr: number, _line: number): number {
		const input = this.consumeNextToken();
		if (input === null) throw new StdinExhausted();
		const val = parseFloat(input);
		if (isNaN(val)) return 0;
		this.refreshMemory();
		this.memory.setFloat64(ptr, val, true);
		this.emitSetValueForAddr(ptr);
		this.currentIoEvents.push({ kind: 'read', source: 'stdin', consumed: input, cursorPos: this.stdinOffset });
		return 1;
	}

	onScanfChar(ptr: number, _line: number): number {
		if (this.stdinOffset >= this.stdinBuffer.length) throw new StdinExhausted();
		const ch = this.stdinBuffer[this.stdinOffset++];
		this.refreshMemory();
		this.memory.setInt8(ptr, ch.charCodeAt(0));
		this.emitSetValueForAddr(ptr);
		this.currentIoEvents.push({ kind: 'read', source: 'stdin', consumed: ch, cursorPos: this.stdinOffset });
		return 1;
	}

	onScanfString(bufPtr: number, _bufSize: number, _line: number): number {
		const input = this.consumeNextToken();
		if (input === null) throw new StdinExhausted();
		this.refreshMemory();
		const encoded = new TextEncoder().encode(input);
		this.memoryBuffer.set(encoded, bufPtr);
		this.memoryBuffer[bufPtr + encoded.length] = 0;
		this.emitSetValueForAddr(bufPtr);
		this.currentIoEvents.push({ kind: 'read', source: 'stdin', consumed: input, cursorPos: this.stdinOffset });
		return 1;
	}

	// === string function callbacks ===

	onStrcpy(destPtr: number, srcPtr: number, _line: number): number {
		this.refreshMemory();
		// Copy bytes from src to dest until null terminator
		let i = 0;
		while (this.memoryBuffer[srcPtr + i] !== 0 && srcPtr + i < this.memoryBuffer.length) {
			this.memoryBuffer[destPtr + i] = this.memoryBuffer[srcPtr + i];
			i++;
		}
		this.memoryBuffer[destPtr + i] = 0; // null terminate

		// Emit setValue for stack variable or heap block at destination
		this.emitSetValueForAddr(destPtr);
		const heapBlock = this.findHeapBlock(destPtr);
		if (heapBlock && heapBlock.status === 'allocated') {
			const str = this.readCString(destPtr);
			this.currentOps.push({ op: 'setValue', id: heapBlock.entryId, value: str });
		}
		return destPtr;
	}

	// === stdio callbacks ===

	onPrintf(text: string): void {
		this.currentIoEvents.push({ kind: 'write', target: 'stdout', text });
	}

	// === Finish ===

	finish(name: string, source: string): Program {
		// Flush any remaining ops
		if (this.currentOps.length > 0 || this.currentIoEvents.length > 0) {
			this.steps.push({
				location: { line: this.currentLine },
				ops: this.currentOps,
				ioEvents: this.currentIoEvents.length > 0 ? [...this.currentIoEvents] : undefined,
			});
		}

		// Leak detection
		for (const [_addr, block] of this.heapBlocks) {
			if (block.status === 'allocated') {
				this.steps[this.steps.length - 1]?.ops.push({
					op: 'setHeapStatus',
					id: block.entryId,
					status: 'leaked',
				});
			}
		}

		return { name, source, steps: this.steps };
	}

	// === Internal helpers ===

	private refreshMemory(): void {
		if (this.wasmExports) {
			this.memory = new DataView(this.wasmExports.memory.buffer);
			this.memoryBuffer = new Uint8Array(this.wasmExports.memory.buffer);
		}
	}

	private currentScopeId(): string {
		return this.scopeStack[this.scopeStack.length - 1] ?? 'global';
	}

	private generateScopeId(name: string): string {
		const count = this.scopeCounters.get(name) ?? 0;
		this.scopeCounters.set(name, count + 1);
		return count === 0 ? name : `${name}_${count}`;
	}

	readCString(ptr: number): string {
		const bytes: number[] = [];
		let i = ptr;
		while (i < this.memoryBuffer.length) {
			const byte = this.memoryBuffer[i];
			if (byte === 0) break;
			bytes.push(byte);
			i++;
		}
		return new TextDecoder().decode(new Uint8Array(bytes));
	}

	readValue(addr: number, size: number, typeStr: string): string {
		const mem = this.memory;
		if (typeStr === 'int' || typeStr === 'long')
			return String(mem.getInt32(addr, true));
		if (typeStr === 'unsigned int' || typeStr === 'unsigned long')
			return String(mem.getUint32(addr, true));
		if (typeStr === 'char') {
			const val = mem.getInt8(addr);
			if (val >= 32 && val < 127) return `'${String.fromCharCode(val)}'`;
			return String(val);
		}
		if (typeStr === 'unsigned char')
			return String(mem.getUint8(addr));
		if (typeStr === 'short')
			return String(mem.getInt16(addr, true));
		if (typeStr === 'unsigned short')
			return String(mem.getUint16(addr, true));
		if (typeStr === 'float')
			return String(Math.round(mem.getFloat32(addr, true) * 1000000) / 1000000);
		if (typeStr === 'double')
			return String(mem.getFloat64(addr, true));
		if (typeStr === 'long long')
			return String(mem.getBigInt64(addr, true));
		if (typeStr === 'unsigned long long')
			return String(mem.getBigUint64(addr, true));
		if (typeStr.endsWith('*'))
			return '0x' + mem.getUint32(addr, true).toString(16).padStart(8, '0');
		if (typeStr.startsWith('struct '))
			return '';  // structs show children
		if (typeStr.includes('['))
			return '';  // arrays show children
		return String(mem.getInt32(addr, true)); // fallback
	}

	private buildChildren(addr: number, size: number, typeStr: string, parentId: string): MemoryEntry[] {
		// Array children
		const arrayMatch = typeStr.match(/^(.+)\[(\d+)\]$/);
		if (arrayMatch) {
			const elemType = arrayMatch[1];
			const count = parseInt(arrayMatch[2], 10);
			const elemSize = size / count;
			const children: MemoryEntry[] = [];

			for (let i = 0; i < count; i++) {
				const elemAddr = addr + i * elemSize;
				const hexAddr = '0x' + elemAddr.toString(16).padStart(8, '0');
				const childId = `${parentId}[${i}]`;
				children.push({
					id: childId,
					name: `[${i}]`,
					type: elemType,
					value: this.readValue(elemAddr, elemSize, elemType),
					address: hexAddr,
				});
			}
			return children;
		}

		// Struct children
		if (typeStr.startsWith('struct ')) {
			const structName = typeStr.slice(7).trim();
			const fields = this.structRegistry.get(structName);
			if (fields) {
				const children: MemoryEntry[] = [];
				let offset = 0;
				for (const field of fields) {
					const fieldSize = this.sizeOfType(field.type);
					// Align offset to field's natural alignment
					const align = Math.min(fieldSize, 4); // ILP32: max 4-byte alignment
					offset = Math.ceil(offset / align) * align;

					const fieldAddr = addr + offset;
					const hexAddr = '0x' + fieldAddr.toString(16).padStart(8, '0');
					const childId = `${parentId}.${field.name}`;
					const value = this.readValue(fieldAddr, fieldSize, field.type);

					const nestedChildren = this.buildChildren(fieldAddr, fieldSize, field.type, childId);
					children.push({
						id: childId,
						name: field.name,
						type: field.type,
						value,
						address: hexAddr,
						children: nestedChildren.length > 0 ? nestedChildren : undefined,
					});
					offset += fieldSize;
				}
				return children;
			}
		}

		return [];
	}

	private updateChildValues(info: VarInfo): void {
		const arrayMatch = info.type.match(/^(.+)\[(\d+)\]$/);
		if (arrayMatch) {
			const elemType = arrayMatch[1];
			const count = parseInt(arrayMatch[2], 10);
			const elemSize = info.size / count;

			for (let i = 0; i < count; i++) {
				const elemAddr = info.addr + i * elemSize;
				const childId = `${info.entryId}[${i}]`;
				const value = this.readValue(elemAddr, elemSize, elemType);
				this.currentOps.push({ op: 'setValue', id: childId, value });
			}
		}

		if (info.type.startsWith('struct ')) {
			this.updateStructFieldValues(info.addr, info.type, info.entryId);
		}
	}

	private updateStructFieldValues(addr: number, typeStr: string, parentId: string): void {
		const structName = typeStr.slice(7).trim();
		const fields = this.structRegistry.get(structName);
		if (!fields) return;

		let offset = 0;
		for (const field of fields) {
			const fieldSize = this.sizeOfType(field.type);
			const align = Math.min(fieldSize, 4);
			offset = Math.ceil(offset / align) * align;

			const fieldAddr = addr + offset;
			const childId = `${parentId}.${field.name}`;
			const value = this.readValue(fieldAddr, fieldSize, field.type);
			this.currentOps.push({ op: 'setValue', id: childId, value });

			// Recurse into nested structs
			if (field.type.startsWith('struct ')) {
				this.updateStructFieldValues(fieldAddr, field.type, childId);
			}
			// Follow pointer fields into heap blocks (e.g., p->scores points to calloc'd array)
			if (field.type.endsWith('*')) {
				const ptrValue = this.memory.getUint32(fieldAddr, true);
				const heapBlock = this.findHeapBlock(ptrValue);
				if (heapBlock && heapBlock.status === 'allocated') {
					const baseType = field.type.slice(0, -1).trim();
					const blockAddr = this.findHeapBlockAddr(heapBlock);
					this.typeHeapBlock(heapBlock, blockAddr, baseType);
					this.updateHeapBlockValues(heapBlock, blockAddr, baseType);
				}
			}
			offset += fieldSize;
		}
	}

	private sizeOfType(typeStr: string): number {
		if (typeStr === 'char' || typeStr === 'unsigned char') return 1;
		if (typeStr === 'short' || typeStr === 'unsigned short') return 2;
		if (typeStr === 'int' || typeStr === 'unsigned int' || typeStr === 'long' || typeStr === 'float') return 4;
		if (typeStr === 'double' || typeStr === 'long long') return 8;
		if (typeStr.endsWith('*')) return 4; // ILP32 pointers
		if (typeStr.startsWith('struct ')) {
			const structName = typeStr.slice(7).trim();
			const fields = this.structRegistry.get(structName);
			if (fields) {
				let size = 0;
				for (const f of fields) {
					const fs = this.sizeOfType(f.type);
					const align = Math.min(fs, 4);
					size = Math.ceil(size / align) * align + fs;
				}
				const maxAlign = Math.min(4, Math.max(...fields.map(f => this.sizeOfType(f.type))));
				return Math.ceil(size / maxAlign) * maxAlign;
			}
		}
		if (typeStr.includes('[')) {
			const match = typeStr.match(/^(.+)\[(\d+)\]$/);
			if (match) return this.sizeOfType(match[1]) * parseInt(match[2], 10);
		}
		return 4; // fallback
	}

	private findHeapBlock(addr: number): HeapBlock | undefined {
		for (const [blockAddr, block] of this.heapBlocks) {
			if (addr >= blockAddr && addr < blockAddr + block.size) {
				return block;
			}
		}
		return undefined;
	}

	private findHeapBlockAddr(block: HeapBlock): number {
		for (const [addr, b] of this.heapBlocks) {
			if (b === block) return addr;
		}
		return 0;
	}

	private typeHeapBlock(block: HeapBlock, blockAddr: number, baseType: string): void {
		if (block.childrenBuilt) return;
		block.baseType = baseType;
		block.childrenBuilt = true;

		const elemSize = this.sizeOfType(baseType);
		const elemCount = Math.floor(block.size / elemSize);

		if (baseType.startsWith('struct ') && elemCount === 1) {
			// Single struct — build struct field children
			const children = this.buildChildren(blockAddr, block.size, baseType, block.entryId);
			for (const child of children) {
				this.currentOps.push({ op: 'addEntry', parentId: block.entryId, entry: child });
			}
		} else if (elemCount > 1) {
			// Array — build indexed children
			for (let i = 0; i < elemCount; i++) {
				const elemAddr = blockAddr + i * elemSize;
				const hexAddr = '0x' + elemAddr.toString(16).padStart(8, '0');
				const childId = `${block.entryId}[${i}]`;
				const value = this.readValue(elemAddr, elemSize, baseType);
				const nestedChildren = this.buildChildren(elemAddr, elemSize, baseType, childId);
				this.currentOps.push({
					op: 'addEntry',
					parentId: block.entryId,
					entry: {
						id: childId,
						name: `[${i}]`,
						type: baseType,
						value,
						address: hexAddr,
						children: nestedChildren.length > 0 ? nestedChildren : undefined,
					},
				});
			}
		} else {
			// Single scalar — just update the value
			const value = this.readValue(blockAddr, elemSize, baseType);
			this.currentOps.push({ op: 'setValue', id: block.entryId, value });
		}
	}

	private updateHeapBlockValues(block: HeapBlock, blockAddr: number, baseType: string): void {
		const elemSize = this.sizeOfType(baseType);
		const elemCount = Math.floor(block.size / elemSize);

		if (baseType.startsWith('struct ') && elemCount === 1) {
			this.updateStructFieldValues(blockAddr, baseType, block.entryId);
		} else if (elemCount > 1) {
			for (let i = 0; i < elemCount; i++) {
				const elemAddr = blockAddr + i * elemSize;
				const childId = `${block.entryId}[${i}]`;
				const value = this.readValue(elemAddr, elemSize, baseType);
				this.currentOps.push({ op: 'setValue', id: childId, value });
			}
		} else {
			const value = this.readValue(blockAddr, elemSize, baseType);
			this.currentOps.push({ op: 'setValue', id: block.entryId, value });
		}
	}

	private findVarByAddr(addr: number): VarInfo | undefined {
		for (const info of this.varRegistry.values()) {
			if (info.addr === addr) return info;
		}
		return undefined;
	}

	private emitSetValueForAddr(addr: number): void {
		const varInfo = this.findVarByAddr(addr);
		if (varInfo) {
			const value = this.readValue(addr, varInfo.size, varInfo.type);
			this.currentOps.push({ op: 'setValue', id: varInfo.entryId, value });
		}
	}

	private consumeNextToken(): string | null {
		// Skip whitespace
		while (this.stdinOffset < this.stdinBuffer.length && /\s/.test(this.stdinBuffer[this.stdinOffset])) {
			this.stdinOffset++;
		}
		if (this.stdinOffset >= this.stdinBuffer.length) return null;

		// Read until whitespace
		let token = '';
		while (this.stdinOffset < this.stdinBuffer.length && !/\s/.test(this.stdinBuffer[this.stdinOffset])) {
			token += this.stdinBuffer[this.stdinOffset++];
		}
		return token || null;
	}
}
