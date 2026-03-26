import type { CType, CValue, Scope, HeapBlock, ASTNode } from './types';
import { sizeOf, alignOf, defaultValue, isStructType, isArrayType } from './types-c';

const STACK_BASE = 0x7FFC0000;
const HEAP_BASE = 0x55A00000;

export class Environment {
	private scopes: Scope[] = [];
	private functions = new Map<string, ASTNode & { type: 'function_definition' }>();
	private heapBlocks = new Map<number, HeapBlock>();
	private stackPointer = STACK_BASE;
	private heapPointer = HEAP_BASE;
	private heapUsed = 0;
	private maxHeapBytes: number;

	constructor(maxHeapBytes = 1024 * 1024) {
		this.maxHeapBytes = maxHeapBytes;
	}

	// === Scope management ===

	pushScope(name: string): Scope {
		const parent = this.scopes.length > 0 ? this.scopes[this.scopes.length - 1] : null;
		const scope: Scope = { name, symbols: new Map(), parent };
		this.scopes.push(scope);
		return scope;
	}

	popScope(): Scope | undefined {
		return this.scopes.pop();
	}

	currentScope(): Scope | undefined {
		return this.scopes[this.scopes.length - 1];
	}

	scopeDepth(): number {
		return this.scopes.length;
	}

	// === Variable management ===

	declareVariable(name: string, type: CType, data: number | null = null): CValue {
		const scope = this.currentScope();
		if (!scope) throw new Error('No active scope');

		const size = sizeOf(type);
		const alignment = alignOf(type);
		this.stackPointer = alignDown(this.stackPointer - size, alignment);
		const address = this.stackPointer;

		const value: CValue = { type, data: data ?? defaultValue(type), address };
		scope.symbols.set(name, value);
		return value;
	}

	lookupVariable(name: string): CValue | undefined {
		for (let i = this.scopes.length - 1; i >= 0; i--) {
			const value = this.scopes[i].symbols.get(name);
			if (value !== undefined) return value;
		}
		return undefined;
	}

	setVariable(name: string, data: number | null): void {
		for (let i = this.scopes.length - 1; i >= 0; i--) {
			const value = this.scopes[i].symbols.get(name);
			if (value !== undefined) {
				value.data = data;
				return;
			}
		}
		throw new Error(`Variable '${name}' not found`);
	}

	// === Function table ===

	defineFunction(name: string, node: ASTNode & { type: 'function_definition' }): void {
		this.functions.set(name, node);
	}

	getFunction(name: string): (ASTNode & { type: 'function_definition' }) | undefined {
		return this.functions.get(name);
	}

	// === Heap management ===

	malloc(size: number, allocator: string, line: number): { address: number; error?: string } {
		if (this.heapUsed + size > this.maxHeapBytes) {
			return { address: 0, error: `Heap exhausted: requested ${size} bytes, ${this.maxHeapBytes - this.heapUsed} available` };
		}

		// Align to 16 bytes for realistic heap allocation
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

	free(address: number): { error?: string } {
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

	getHeapBlock(address: number): HeapBlock | undefined {
		return this.heapBlocks.get(address);
	}

	setHeapBlockType(address: number, type: CType): void {
		const block = this.heapBlocks.get(address);
		if (block) block.type = type;
	}

	getAllHeapBlocks(): Map<number, HeapBlock> {
		return this.heapBlocks;
	}

	// === Address formatting ===

	getStackBase(): number {
		return STACK_BASE;
	}

	getHeapBase(): number {
		return HEAP_BASE;
	}

	// === Stack frame save/restore ===

	saveStackPointer(): number {
		return this.stackPointer;
	}

	restoreStackPointer(sp: number): void {
		this.stackPointer = sp;
	}
}

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
