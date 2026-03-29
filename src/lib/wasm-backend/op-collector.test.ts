import { describe, it, expect } from 'vitest';
import { OpCollector, StepLimitExceeded, StdinExhausted } from './op-collector';
import { buildSnapshots } from '$lib/engine/snapshot';
import { validateProgram } from '$lib/engine/validate';

/**
 * Create a mock WASM memory with helper methods to write typed values and C strings.
 */
function createMockMemory(sizeBytes = 65536) {
	const buffer = new ArrayBuffer(sizeBytes);
	const memory = {
		buffer,
	} as WebAssembly.Memory;

	const view = new DataView(buffer);
	const bytes = new Uint8Array(buffer);

	function writeInt32(addr: number, val: number) {
		view.setInt32(addr, val, true);
	}

	function writeFloat32(addr: number, val: number) {
		view.setFloat32(addr, val, true);
	}

	function writeFloat64(addr: number, val: number) {
		view.setFloat64(addr, val, true);
	}

	function writeUint32(addr: number, val: number) {
		view.setUint32(addr, val, true);
	}

	function writeCString(addr: number, str: string): number {
		const encoded = new TextEncoder().encode(str);
		bytes.set(encoded, addr);
		bytes[addr + encoded.length] = 0;
		return addr;
	}

	return { memory, view, bytes, writeInt32, writeFloat32, writeFloat64, writeUint32, writeCString };
}

describe('OpCollector', () => {
	it('produces a basic program with push/pop scope', () => {
		const { memory, writeCString } = createMockMemory();
		const collector = new OpCollector(100);
		collector.setMemory(memory);

		const mainStr = writeCString(0x100, 'main');
		collector.onPushScope(mainStr, 1);
		collector.onStep(1);
		collector.onPopScope();
		collector.onStep(2);

		const program = collector.finish('test', 'int main() {}');
		expect(program.steps.length).toBe(2);
		expect(program.steps[0].ops[0]).toEqual(
			expect.objectContaining({ op: 'addEntry', parentId: null })
		);
	});

	it('tracks variable declarations and values', () => {
		const { memory, writeCString, writeInt32 } = createMockMemory();
		const collector = new OpCollector(100);
		collector.setMemory(memory);

		const mainStr = writeCString(0x100, 'main');
		const xStr = writeCString(0x110, 'x');
		const intStr = writeCString(0x120, 'int');

		// Set x = 42 in memory
		writeInt32(0x200, 42);

		collector.onPushScope(mainStr, 1);
		collector.onDecl(xStr, 0x200, 4, intStr, 1);
		collector.onStep(1);

		const program = collector.finish('test', 'int main() { int x = 42; }');
		expect(program.steps.length).toBe(1);

		// Find the addEntry op for x
		const addOps = program.steps[0].ops.filter(op => op.op === 'addEntry');
		const xEntry = addOps.find(op => op.op === 'addEntry' && op.entry.name === 'x');
		expect(xEntry).toBeDefined();
		if (xEntry && xEntry.op === 'addEntry') {
			expect(xEntry.entry.value).toBe('42');
			expect(xEntry.entry.type).toBe('int');
			expect(xEntry.entry.address).toBe('0x00000200');
		}
	});

	it('tracks value changes with setValue', () => {
		const { memory, writeCString, writeInt32 } = createMockMemory();
		const collector = new OpCollector(100);
		collector.setMemory(memory);

		const mainStr = writeCString(0x100, 'main');
		const xStr = writeCString(0x110, 'x');
		const intStr = writeCString(0x120, 'int');

		writeInt32(0x200, 5);
		collector.onPushScope(mainStr, 1);
		collector.onDecl(xStr, 0x200, 4, intStr, 1);
		collector.onStep(1);

		// Change x to 10
		writeInt32(0x200, 10);
		collector.onSet(xStr, 0x200, 2);
		collector.onStep(2);

		collector.onPopScope();
		collector.onStep(3);

		const program = collector.finish('test', 'int x = 5; x = 10;');
		expect(program.steps.length).toBe(3);

		// Second step should have a setValue op
		const setOps = program.steps[1].ops.filter(op => op.op === 'setValue');
		expect(setOps.length).toBe(1);
		if (setOps[0].op === 'setValue') {
			expect(setOps[0].value).toBe('10');
		}
	});

	it('reads different types correctly', () => {
		const { memory, writeCString, writeInt32, writeFloat32, writeFloat64 } = createMockMemory();
		const collector = new OpCollector(100);
		collector.setMemory(memory);

		// Test int
		writeInt32(0x200, -42);
		expect(collector.readValue(0x200, 4, 'int')).toBe('-42');

		// Test float
		writeFloat32(0x210, 3.14);
		const floatVal = parseFloat(collector.readValue(0x210, 4, 'float'));
		expect(floatVal).toBeCloseTo(3.14, 2);

		// Test double
		writeFloat64(0x220, 2.718281828);
		expect(collector.readValue(0x220, 8, 'double')).toBe('2.718281828');

		// Test char
		new Uint8Array(memory.buffer)[0x230] = 65; // 'A'
		expect(collector.readValue(0x230, 1, 'char')).toBe("'A'");

		// Test pointer
		new DataView(memory.buffer).setUint32(0x240, 0x00001000, true);
		expect(collector.readValue(0x240, 4, 'int*')).toBe('0x00001000');
	});

	it('handles array declarations with children', () => {
		const { memory, writeCString, writeInt32 } = createMockMemory();
		const collector = new OpCollector(100);
		collector.setMemory(memory);

		const mainStr = writeCString(0x100, 'main');
		const arrStr = writeCString(0x110, 'arr');
		const typeStr = writeCString(0x120, 'int[3]');

		// Write array values: [10, 20, 30]
		writeInt32(0x200, 10);
		writeInt32(0x204, 20);
		writeInt32(0x208, 30);

		collector.onPushScope(mainStr, 1);
		collector.onDecl(arrStr, 0x200, 12, typeStr, 1);
		collector.onStep(1);

		const program = collector.finish('test', 'int arr[3] = {10, 20, 30};');

		const addOps = program.steps[0].ops.filter(op => op.op === 'addEntry');
		const arrEntry = addOps.find(op => op.op === 'addEntry' && op.entry.name === 'arr');
		expect(arrEntry).toBeDefined();
		if (arrEntry && arrEntry.op === 'addEntry') {
			expect(arrEntry.entry.children).toBeDefined();
			expect(arrEntry.entry.children!.length).toBe(3);
			expect(arrEntry.entry.children![0].value).toBe('10');
			expect(arrEntry.entry.children![1].value).toBe('20');
			expect(arrEntry.entry.children![2].value).toBe('30');
		}
	});

	it('generates unique scope IDs', () => {
		const { memory, writeCString } = createMockMemory();
		const collector = new OpCollector(100);
		collector.setMemory(memory);

		const mainStr = writeCString(0x100, 'main');

		collector.onPushScope(mainStr, 1);
		collector.onStep(1);
		collector.onPopScope();
		collector.onStep(2);
		collector.onPushScope(mainStr, 3); // second invocation
		collector.onStep(3);
		collector.onPopScope();
		collector.onStep(4);

		const program = collector.finish('test', '');

		// First scope is 'main', second is 'main_1'
		const addOps = program.steps.flatMap(s => s.ops).filter(op => op.op === 'addEntry' && op.parentId === null);
		const scopeIds = addOps
			.filter(op => op.op === 'addEntry' && op.entry.kind === 'scope')
			.map(op => op.op === 'addEntry' ? op.entry.id : '');
		expect(scopeIds).toContain('main');
		expect(scopeIds).toContain('main_1');
	});

	it('throws StepLimitExceeded when limit reached', () => {
		const { memory, writeCString } = createMockMemory();
		const collector = new OpCollector(3);
		collector.setMemory(memory);

		const mainStr = writeCString(0x100, 'main');
		collector.onPushScope(mainStr, 1);

		collector.onStep(1);
		collector.onStep(2);
		collector.onStep(3);
		expect(() => collector.onStep(4)).toThrow(StepLimitExceeded);
	});

	it('handles heap allocation and freeing', () => {
		const { memory, writeCString, writeInt32 } = createMockMemory();
		const collector = new OpCollector(100);
		collector.setMemory(memory);

		let mallocAddr = 0x1000;
		const mockExports = {
			malloc: (size: number) => { const addr = mallocAddr; mallocAddr += size; return addr; },
			free: (_ptr: number) => {},
			memory,
		};
		collector.setWasmExports(mockExports as unknown as { malloc: (size: number) => number; free: (ptr: number) => void; memory: WebAssembly.Memory });

		const mainStr = writeCString(0x100, 'main');
		collector.onPushScope(mainStr, 1);

		const addr = collector.onMalloc(16, 1);
		expect(addr).toBe(0x1000);
		collector.onStep(1);

		collector.onFree(addr, 2);
		collector.onStep(2);

		const program = collector.finish('test', '');

		// Step 1 should have addEntry for heap block
		const heapAdd = program.steps[0].ops.find(
			op => op.op === 'addEntry' && op.parentId === 'heap'
		);
		expect(heapAdd).toBeDefined();

		// Step 2 should have setHeapStatus = 'freed'
		const freeOp = program.steps[1].ops.find(op => op.op === 'setHeapStatus');
		expect(freeOp).toBeDefined();
		if (freeOp && freeOp.op === 'setHeapStatus') {
			expect(freeOp.status).toBe('freed');
		}
	});

	it('detects memory leaks', () => {
		const { memory, writeCString } = createMockMemory();
		const collector = new OpCollector(100);
		collector.setMemory(memory);

		let mallocAddr = 0x1000;
		collector.setWasmExports({
			malloc: (size: number) => { const addr = mallocAddr; mallocAddr += size; return addr; },
			free: () => {},
			memory,
		} as unknown as { malloc: (size: number) => number; free: (ptr: number) => void; memory: WebAssembly.Memory });

		const mainStr = writeCString(0x100, 'main');
		collector.onPushScope(mainStr, 1);
		collector.onMalloc(32, 1);
		collector.onStep(1);
		collector.onPopScope();
		collector.onStep(2);

		const program = collector.finish('test', '');

		// Last step should have setHeapStatus = 'leaked'
		const lastStep = program.steps[program.steps.length - 1];
		const leakOp = lastStep.ops.find(
			op => op.op === 'setHeapStatus' && op.status === 'leaked'
		);
		expect(leakOp).toBeDefined();
	});

	it('handles scanf with stdin', () => {
		const { memory, writeCString, writeInt32 } = createMockMemory();
		const collector = new OpCollector(100);
		collector.setMemory(memory);
		collector.setStdin('42');

		const result = collector.onScanfInt(0x200, 1);
		expect(result).toBe(1);

		// Value should be written to memory
		const val = new DataView(memory.buffer).getInt32(0x200, true);
		expect(val).toBe(42);
	});

	it('throws StdinExhausted when no input', () => {
		const { memory } = createMockMemory();
		const collector = new OpCollector(100);
		collector.setMemory(memory);
		collector.setStdin('');

		expect(() => collector.onScanfInt(0x200, 1)).toThrow(StdinExhausted);
	});

	it('produces program that passes validateProgram', () => {
		const { memory, writeCString, writeInt32 } = createMockMemory();
		const collector = new OpCollector(100);
		collector.setMemory(memory);

		const mainStr = writeCString(0x100, 'main');
		const xStr = writeCString(0x110, 'x');
		const intStr = writeCString(0x120, 'int');

		writeInt32(0x200, 5);
		collector.onPushScope(mainStr, 1);
		collector.onDecl(xStr, 0x200, 4, intStr, 2);
		collector.onStep(2);

		writeInt32(0x200, 10);
		collector.onSet(xStr, 0x200, 3);
		collector.onStep(3);

		collector.onPopScope();
		collector.onStep(4);

		const source = 'int main() {\n\tint x = 5;\n\tx = 10;\n}';
		const program = collector.finish('test', source);

		const errors = validateProgram(program);
		expect(errors).toEqual([]);
	});

	it('produces snapshots via buildSnapshots', () => {
		const { memory, writeCString, writeInt32 } = createMockMemory();
		const collector = new OpCollector(100);
		collector.setMemory(memory);

		const mainStr = writeCString(0x100, 'main');
		const xStr = writeCString(0x110, 'x');
		const intStr = writeCString(0x120, 'int');

		writeInt32(0x200, 5);
		collector.onPushScope(mainStr, 1);
		collector.onDecl(xStr, 0x200, 4, intStr, 2);
		collector.onStep(2);

		writeInt32(0x200, 10);
		collector.onSet(xStr, 0x200, 3);
		collector.onStep(3);

		collector.onPopScope();
		collector.onStep(4);

		const program = collector.finish('test', 'int main() { int x = 5; x = 10; }');
		const snapshots = buildSnapshots(program);

		expect(snapshots.length).toBe(program.steps.length);

		// After step 0 (decl): should have main scope with x=5
		const snap0 = snapshots[0];
		const mainScope = snap0.find(e => e.name === 'main');
		expect(mainScope).toBeDefined();
		const xEntry = mainScope?.children?.find(e => e.name === 'x');
		expect(xEntry?.value).toBe('5');

		// After step 1 (set): x=10
		const snap1 = snapshots[1];
		const xEntry2 = snap1.find(e => e.name === 'main')?.children?.find(e => e.name === 'x');
		expect(xEntry2?.value).toBe('10');
	});

	it('records IoEvents for printf', () => {
		const { memory, writeCString } = createMockMemory();
		const collector = new OpCollector(100);
		collector.setMemory(memory);

		const mainStr = writeCString(0x100, 'main');
		collector.onPushScope(mainStr, 1);
		collector.onPrintf('hello world');
		collector.onStep(1);

		const program = collector.finish('test', '');
		expect(program.steps[0].ioEvents).toBeDefined();
		expect(program.steps[0].ioEvents![0]).toEqual({
			kind: 'write',
			target: 'stdout',
			text: 'hello world',
		});
	});

	it('free(NULL) is a no-op', () => {
		const { memory, writeCString } = createMockMemory();
		const collector = new OpCollector(100);
		collector.setMemory(memory);

		const mainStr = writeCString(0x100, 'main');
		collector.onPushScope(mainStr, 1);
		collector.onFree(0, 1); // free(NULL)
		collector.onStep(1);

		const program = collector.finish('test', '');
		// No setHeapStatus ops should exist
		const heapOps = program.steps[0].ops.filter(op => op.op === 'setHeapStatus');
		expect(heapOps.length).toBe(0);
	});
});
