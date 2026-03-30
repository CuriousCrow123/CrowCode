---
title: Fix WASM Backend Systemic Snapshot Bugs
type: fix
status: completed
date: 2026-03-29
---

# Fix WASM Backend Systemic Snapshot Bugs

## Context

The diagnostic audit of all 47 programs found 15 systemic bugs (SYS-1 through SYS-15). 4 bugs were already fixed (line attribution, arrow field, nested field, pointer param type). The remaining 11 cause struct fields, heap values, recursive call stacks, scanf results, and various control flow steps to be invisible or wrong in the visualization. Computed values are nearly always correct — it's the snapshot/visualization layer that's broken.

This plan addresses all open bugs with exact code changes, ordered by implementation dependency.

## Files Modified

| File | Changes |
|------|---------|
| `src/lib/wasm-backend/transformer.ts` | SYS-3/4 (return), SYS-5/7 (loop), SYS-8 (shadowing), SYS-9 (chained), SYS-13 (fn ptr), SYS-14 (2D array), SYS-1 (struct registry) |
| `src/lib/wasm-backend/op-collector.ts` | SYS-6 (empty steps), SYS-10 (calloc), SYS-11 (scanf), SYS-2 (heap deref), SYS-1 (struct children) |
| `src/lib/wasm-backend/runtime.ts` | Pass struct registry to OpCollector |
| `src/lib/wasm-backend/integration.test.ts` | Update pipeline helper, add struct/heap assertions |
| `src/lib/wasm-backend/diagnostic.test.ts` | Update pipeline helper |

---

## Step 1: Return visibility + condition steps (SYS-3, SYS-4, SYS-6)

### SYS-3 + SYS-4: Return line visible, scope pop after step

**File:** `transformer.ts` line 287–293

**Current:**
```typescript
function instrumentReturn(node: SyntaxNode, insertions: Insertion[]): void {
	insertions.push({
		offset: node.startIndex,
		text: '__crow_pop_scope();\n\t',
		priority: 5,
	});
}
```

**Change to:**
```typescript
function instrumentReturn(node: SyntaxNode, insertions: Insertion[]): void {
	const line = node.startPosition.row + 1;
	insertions.push({
		offset: node.startIndex,
		text: `__crow_step(${line});\n\t__crow_pop_scope();\n\t`,
		priority: 5,
	});
}
```

**Effect:** Every return statement gets a visible step at its correct line. The scope pop still happens before the return expression is evaluated, so for `return f(n-1)` the current frame is popped before the recursive call (inherent limitation of source-level instrumentation — document this).

**Also:** In `instrumentFunction` (line 168–179), the `!hasTrailingReturn` branch injects `__crow_pop_scope()` before `}` but no step. Add a step there too:

**Current (line 170–178):**
```typescript
if (!hasTrailingReturn) {
	const closeBrace = body.child(body.childCount - 1);
	if (closeBrace && closeBrace.text === '}') {
		insertions.push({
			offset: closeBrace.startIndex,
			text: '\t__crow_pop_scope();\n',
			priority: 0,
		});
	}
}
```

**Change to:**
```typescript
if (!hasTrailingReturn) {
	const closeBrace = body.child(body.childCount - 1);
	if (closeBrace && closeBrace.text === '}') {
		const closeLine = closeBrace.startPosition.row + 1;
		insertions.push({
			offset: closeBrace.startIndex,
			text: `\t__crow_step(${closeLine});\n\t__crow_pop_scope();\n`,
			priority: 0,
		});
	}
}
```

### SYS-6: Always emit steps (even empty)

**File:** `op-collector.ts` line 94–108

**Current:**
```typescript
onStep(line: number): void {
	if (++this.stepCount > this.maxSteps) {
		throw new StepLimitExceeded();
	}
	this.currentLine = line;
	if (this.currentOps.length > 0 || this.currentIoEvents.length > 0) {
		this.steps.push({
			location: { line: this.currentLine },
			ops: this.currentOps,
			ioEvents: this.currentIoEvents.length > 0 ? [...this.currentIoEvents] : undefined,
		});
		this.currentOps = [];
		this.currentIoEvents = [];
	}
}
```

**Change to:**
```typescript
onStep(line: number): void {
	if (++this.stepCount > this.maxSteps) {
		throw new StepLimitExceeded();
	}
	this.currentLine = line;
	// Always push a step — empty steps mark the current line for the UI
	this.steps.push({
		location: { line: this.currentLine },
		ops: this.currentOps,
		ioEvents: this.currentIoEvents.length > 0 ? [...this.currentIoEvents] : undefined,
	});
	this.currentOps = [];
	this.currentIoEvents = [];
}
```

**Risk:** More steps generated (every `if`, `while` condition now emits a step). Loop-heavy programs may approach `maxSteps=500`. Monitor and increase if needed.

**Verification:**
- p7.1: step appears at `if (x > 5)` line
- p7.2: step appears at `while (n > 0)` line
- All programs: return statement has its own step
- `npm test` passes

### Also fixes: SYS-12 (sprintf/strcpy steps now visible since empty steps aren't dropped)

---

## Step 2: Remove loop update tracking (SYS-5, SYS-7)

**File:** `transformer.ts` line 333–349

**Current:**
```typescript
// Add update tracking before closing brace
const update = node.childForFieldName('update');
if (update) {
	const closeBrace = body.child(body.childCount - 1);
	if (closeBrace && closeBrace.text === '}') {
		const updateVars = extractUpdateVars(update);
		let updateText = '';
		for (const v of updateVars) {
			updateText += `\t__crow_set("${v}", &${v}, ${line});\n`;
		}
		insertions.push({
			offset: closeBrace.startIndex,
			text: updateText,
			priority: 3,
		});
	}
}
```

**Change to:** Delete the entire block (lines 333–349). The `onDecl` re-declaration path (op-collector line 162–170) already captures loop var values at the start of each iteration.

**Why this is safe:**
- Iteration N: `__crow_decl("i", &i, ...)` fires → `onDecl` detects re-declaration → emits `setValue` with current `i` value (which is the POST-increment value from iteration N-1).
- Loop exit: `i` is scoped to the for loop (`for(int i = ...)`), so it goes out of scope anyway. Not showing the exit value is correct C99 semantics.

**Also delete:** The `extractUpdateVars` function (line 885–901) becomes unused — delete it.

**Verification:**
- p7.3: no duplicate setValue pairs for `j` and `i`
- p3.1: loop var `i` shows correct value at each iteration start
- `npm test` passes

---

## Step 3: Fix calloc label + scanf values (SYS-10, SYS-11)

### SYS-10: calloc entry label

**File:** `op-collector.ts` line 229–238

**Current:**
```typescript
onCalloc(count: number, size: number, line: number): number {
	const totalSize = count * size;
	const addr = this.onMalloc(totalSize, line);
	if (addr !== 0) {
		this.refreshMemory();
		this.memoryBuffer.fill(0, addr, addr + totalSize);
	}
	return addr;
}
```

**Change to:**
```typescript
onCalloc(count: number, size: number, line: number): number {
	const totalSize = count * size;
	const addr = this.onMalloc(totalSize, line);
	if (addr !== 0) {
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
```

### SYS-11: scanf emits setValue

**File:** `op-collector.ts` — Add helper after `consumeNextToken` (line 496):

```typescript
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
```

Then add `this.emitSetValueForAddr(ptr);` after each memory write in every `onScanf*` method:

**onScanfInt (line 288–296)** — add after `this.memory.setInt32(ptr, val, true);`:
```typescript
this.emitSetValueForAddr(ptr);
```

**onScanfFloat (line 299)** — add after `this.memory.setFloat32(ptr, val, true);`:
```typescript
this.emitSetValueForAddr(ptr);
```

**onScanfDouble (line 310)** — add after `this.memory.setFloat64(ptr, val, true);`:
```typescript
this.emitSetValueForAddr(ptr);
```

**onScanfChar (line 321)** — add after `this.memory.setInt8(ptr, ch.charCodeAt(0));`:
```typescript
this.emitSetValueForAddr(ptr);
```

**onScanfString (line 330)** — add after writing the string:
```typescript
this.emitSetValueForAddr(bufPtr);
```

**Verification:**
- p4.2: entry labeled `calloc(4, 4)` not `malloc(16)`
- p16.4: after scanf reads, x=10 and y=20 appear in snapshot
- p16.7: score shows correct value after each scanf

---

## Step 4: Struct type registry + children (SYS-1)

### Part A: Build struct registry in transformer

**File:** `transformer.ts`

**Add new type after `TransformResult` (line 11):**
```typescript
export type StructField = { name: string; type: string };
export type StructRegistry = Map<string, StructField[]>;
```

**Change `TransformResult` (line 11–14):**
```typescript
export type TransformResult = {
	instrumented: string;
	errors: string[];
	structRegistry: StructRegistry;
};
```

**Add a new function to extract struct definitions from the CST:**
```typescript
function extractStructDefinitions(rootNode: SyntaxNode): StructRegistry {
	const registry: StructRegistry = new Map();
	walkForStructs(rootNode, registry);
	return registry;
}

function walkForStructs(node: SyntaxNode, registry: StructRegistry): void {
	if (node.type === 'struct_specifier') {
		const nameNode = node.childForFieldName('name');
		const body = node.childForFieldName('body');
		if (nameNode && body) {
			const fields: StructField[] = [];
			for (let i = 0; i < body.childCount; i++) {
				const child = body.child(i)!;
				if (child.type === 'field_declaration') {
					const typeNode = child.childForFieldName('type');
					let typeStr = typeNode?.text ?? 'int';
					// Check for struct specifier in field type
					for (let j = 0; j < child.childCount; j++) {
						const fc = child.child(j)!;
						if (fc.type === 'struct_specifier') {
							typeStr = `struct ${fc.childForFieldName('name')?.text ?? ''}`;
							break;
						}
					}
					const declarator = child.childForFieldName('declarator');
					if (declarator) {
						const info = parseDeclName(declarator);
						fields.push({ name: info.name, type: escapeType(typeStr, info) });
					}
				}
			}
			registry.set(nameNode.text, fields);
		}
	}
	for (let i = 0; i < node.childCount; i++) {
		walkForStructs(node.child(i)!, registry);
	}
}
```

**In `transformSource` (line 34–61), call it before returning:**
```typescript
const structRegistry = extractStructDefinitions(tree.rootNode);
// ... existing code ...
return { instrumented: result, errors: [], structRegistry };
```

**Update error returns** to include `structRegistry: new Map()`.

### Part B: Pass registry to OpCollector

**File:** `op-collector.ts`

**Change constructor (line 74–76):**
```typescript
constructor(maxSteps: number, structRegistry?: StructRegistry) {
	this.maxSteps = maxSteps;
	this.structRegistry = structRegistry ?? new Map();
}
```

**Add field (after line 58):**
```typescript
private structRegistry: StructRegistry;
```

**Add import at top:**
```typescript
import type { StructRegistry } from './transformer';
```

### Part C: Implement struct children in buildChildren

**File:** `op-collector.ts` line 462–464

**Replace the comment with:**
```typescript
// Struct children
if (typeStr.startsWith('struct ')) {
	const structName = typeStr.slice(7).trim(); // "struct Point" → "Point"
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
```

**Add `sizeOfType` helper:**
```typescript
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
			// Pad to struct's alignment (largest field alignment)
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
```

### Part D: Update struct children on setValue

**File:** `op-collector.ts` — `updateChildValues` (line 467–481)

**Add struct handling after the array block:**
```typescript
if (info.type.startsWith('struct ')) {
	const structName = info.type.slice(7).trim();
	const fields = this.structRegistry.get(structName);
	if (fields) {
		let offset = 0;
		for (const field of fields) {
			const fieldSize = this.sizeOfType(field.type);
			const align = Math.min(fieldSize, 4);
			offset = Math.ceil(offset / align) * align;

			const fieldAddr = info.addr + offset;
			const childId = `${info.entryId}.${field.name}`;
			const value = this.readValue(fieldAddr, fieldSize, field.type);
			this.currentOps.push({ op: 'setValue', id: childId, value });
			offset += fieldSize;
		}
	}
}
```

### Part E: Plumb through runtime and tests

**File:** `runtime.ts` line 33 — pass registry:
```typescript
const collector = new OpCollector(maxSteps, structRegistry);
```

Add `structRegistry` parameter to `executeWasm`.

**File:** `integration.test.ts` and `diagnostic.test.ts` — update `runPipeline`:
```typescript
const { instrumented, errors: tErrors, structRegistry } = transformSource(parser, source);
// ...
const collector = new OpCollector(500, structRegistry);
```

**Verification:**
- p2.1: `p` shows children `x=30`, `y=35`
- p2.2: `r` shows nested children `pos.x`, `pos.y`, `size.x`, `size.y`
- p15.1: `dir` shows children `x=1`, `y=0`

---

## Step 5: Heap dereference values (SYS-2)

**File:** `op-collector.ts` — `onSet` (line 188–199)

**Current:**
```typescript
onSet(namePtr: number, addr: number, _line: number): void {
	this.refreshMemory();
	const name = this.readCString(namePtr);
	const info = this.varRegistry.get(name);
	if (!info) return;

	const value = this.readValue(addr, info.size, info.type);
	this.currentOps.push({ op: 'setValue', id: info.entryId, value });

	// Update children if struct or array
	this.updateChildValues(info);
}
```

**Change to:**
```typescript
onSet(namePtr: number, addr: number, _line: number): void {
	this.refreshMemory();
	const name = this.readCString(namePtr);
	const info = this.varRegistry.get(name);
	if (!info) return;

	const value = this.readValue(addr, info.size, info.type);
	this.currentOps.push({ op: 'setValue', id: info.entryId, value });
	this.updateChildValues(info);

	// If this is a pointer type, check if it points to a heap block
	// and update the heap entry's value too
	if (info.type.endsWith('*')) {
		const ptrValue = this.memory.getUint32(addr, true);
		const heapBlock = this.findHeapBlock(ptrValue);
		if (heapBlock && heapBlock.status === 'allocated') {
			const baseType = info.type.slice(0, -1).trim();
			const elemSize = this.sizeOfType(baseType);
			const heapValue = this.readValue(ptrValue, elemSize, baseType);
			this.currentOps.push({ op: 'setValue', id: heapBlock.entryId, value: heapValue });
		}
	}
}
```

**Add `findHeapBlock` helper:**
```typescript
private findHeapBlock(addr: number): HeapBlock | undefined {
	for (const [blockAddr, block] of this.heapBlocks) {
		if (addr >= blockAddr && addr < blockAddr + block.size) {
			return block;
		}
	}
	return undefined;
}
```

**Note:** `sizeOfType` is already added in Step 4.

**Verification:**
- p4.1: after `*p = 42`, heap entry shows `value=42`; after `*p = *p + 8`, shows `value=50`
- p4.4: heap shows individual squared values
- p14.1: heap shows `value=42` before free

---

## Step 6: Chained assignment (SYS-9)

**File:** `transformer.ts` — `instrumentExpressionStatement` (line 231–243)

**Current (assignment_expression branch):**
```typescript
if (expr.type === 'assignment_expression') {
	findAndRewriteCalls(expr, replacements);
	const lhs = expr.childForFieldName('left');
	const setName = extractSetTarget(lhs);
	if (setName) {
		let text = `\n\t__crow_set("${setName.name}", ${setName.addrExpr}, ${line});`;
		text += `\n\t__crow_step(${line});`;
		insertions.push({ offset: node.endIndex, text, priority: 5 });
		return;
	}
}
```

**Change to:**
```typescript
if (expr.type === 'assignment_expression') {
	findAndRewriteCalls(expr, replacements);
	const targets = collectChainedTargets(expr);
	if (targets.length > 0) {
		let text = '';
		// Emit __crow_set for each target (innermost first for correct eval order)
		for (const target of targets.reverse()) {
			text += `\n\t__crow_set("${target.name}", ${target.addrExpr}, ${line});`;
		}
		text += `\n\t__crow_step(${line});`;
		insertions.push({ offset: node.endIndex, text, priority: 5 });
		return;
	}
}
```

**Add helper function:**
```typescript
function collectChainedTargets(expr: SyntaxNode): { name: string; addrExpr: string }[] {
	const targets: { name: string; addrExpr: string }[] = [];
	const lhs = expr.childForFieldName('left');
	const target = extractSetTarget(lhs);
	if (target) targets.push(target);

	const rhs = expr.childForFieldName('right');
	if (rhs && rhs.type === 'assignment_expression') {
		targets.push(...collectChainedTargets(rhs));
	}
	return targets;
}
```

**Verification:**
- p13.5: `a = b = c = 42` → all three show 42; `a = b = c + 8` → a=50, b=50, c still 42

---

## Step 7: Variable shadowing (SYS-8)

**File:** `transformer.ts` — `walkNode` (line 76–127)

**Add case in the switch** (before default recurse, around line 120):
```typescript
case 'compound_statement':
	// Anonymous block inside a function body — add scope push/pop
	if (isInFunctionBody(node) && node.parent?.type === 'compound_statement') {
		const blockLine = node.startPosition.row + 1;
		const openBrace = node.child(0);
		const closeBrace = node.child(node.childCount - 1);
		if (openBrace?.text === '{' && closeBrace?.text === '}') {
			insertions.push({
				offset: openBrace.endIndex,
				text: `\n\t__crow_push_scope("block", ${blockLine});\n\t__crow_step(${blockLine});`,
				priority: 8,
			});
			insertions.push({
				offset: closeBrace.startIndex,
				text: `\t__crow_pop_scope();\n`,
				priority: 0,
			});
			// Recurse into body (skip braces)
			for (let i = 1; i < node.childCount - 1; i++) {
				walkNode(node.child(i)!, insertions, replacements);
			}
			return;
		}
	}
	break;
```

**Verification:**
- p8.2: inner block creates `block` scope with its own `x=20`, `x=25`; outer `x` stays 10; `y=x` reads outer x → y=10

---

## Step 8: Function pointer + 2D array (SYS-13, SYS-14)

### SYS-13: Function pointer declarator

**File:** `transformer.ts` — `parseDeclName` (line 808–836)

**Add a case for `function_declarator` in the while loop (after `array_declarator` case):**
```typescript
} else if (current.type === 'function_declarator') {
	// Function pointer: (*fp)(int, int) — the declarator wraps a parenthesized_declarator
	isPointer = true;
	const inner = current.childForFieldName('declarator');
	if (inner) {
		current = inner;
	} else {
		break;
	}
} else if (current.type === 'parenthesized_declarator') {
	// Unwrap: (*fp) → pointer_declarator → fp
	for (let i = 0; i < current.childCount; i++) {
		const child = current.child(i)!;
		if (child.type !== '(' && child.type !== ')') {
			current = child;
			break;
		}
	}
```

### SYS-14: 2D array dimensions

**File:** `transformer.ts` — `parseDeclName` (line 823–829)

**Current:**
```typescript
} else if (current.type === 'array_declarator') {
	const sizeNode = current.child(2);
	if (sizeNode && sizeNode.text !== ']') {
		arraySize = sizeNode.text;
	}
	current = current.child(0)!;
}
```

**Change to** (accumulate dimensions):
```typescript
} else if (current.type === 'array_declarator') {
	const sizeNode = current.child(2);
	if (sizeNode && sizeNode.text !== ']') {
		// Stack dimensions: int m[3][3] → first see [3] (outer), then [3] (inner)
		// Tree: array_declarator(array_declarator(m, 3), 3)
		// Outer iteration sees rightmost dim first → prepend to build "[3][3]"
		arraySize = arraySize ? `${arraySize}][${sizeNode.text}` : sizeNode.text;
	}
	current = current.child(0)!;
}
```

Wait — the tree-sitter parse of `int m[3][3]` produces:
- `array_declarator` (outer, size=3)
  - `array_declarator` (inner, size=3)
    - `identifier` "m"

Walking: first iteration sees outer size=3, second sees inner size=3. We want type `int[3][3]`. With `escapeType`, we get `int[3][3]` if `arraySize = "3][3"` (since escapeType wraps in `[...]`).

Actually let me reconsider. Tree-sitter for `int m[3][3]`:
- outer `array_declarator`: child(0) = inner `array_declarator`, child(2) = "3"
- inner `array_declarator`: child(0) = `identifier` "m", child(2) = "3"

So walking: first we see outer dim 3, then inner dim 3. `escapeType` produces `int[arraySize]`. We need `arraySize = "3][3"` so the result is `int[3][3]`.

First iteration (outer): `arraySize = null` → `arraySize = "3"`. Current = inner array_declarator.
Second iteration (inner): `arraySize = "3"` → we want `"3][3"`. So: `arraySize = arraySize + "][" + sizeNode.text` = `"3][3"`.

```typescript
arraySize = arraySize ? `${arraySize}][${sizeNode.text}` : sizeNode.text;
```

This gives `arraySize = "3][3"`, then `escapeType` wraps → `int[3][3]`. Correct!

**Op-collector `buildChildren`** already handles this via recursive regex matching:
- `int[3][3]` matches `(.+)\[(\d+)\]$` → elemType=`int[3]`, count=3
- Each child of type `int[3]` matches again → elemType=`int`, count=3
- Recursion creates nested children

No changes needed to `buildChildren` for this.

**Verification:**
- p13.6: compiles successfully, `fp` shown as pointer value, `a=13`, `b=7`
- p13.7: `m` shows 3 children, each with 3 int children; `trace=3`

---

## Step 9: Re-run full diagnostic suite

1. Run `npx vitest run src/lib/wasm-backend/diagnostic.test.ts` to regenerate all 47 dumps
2. Run `npm test` to verify all integration tests pass
3. Launch audit agents on affected programs to verify fixes
4. Update CHECKLIST.md with new status for each program

**Programs to re-audit (most affected):**
- p2.1, p2.2 (struct children)
- p4.1, p4.2, p4.4 (heap values, calloc label)
- p5.1, p5.3, p15.1 (struct + heap combined)
- p6.4, p12.5 (return visibility)
- p7.3, p7.4 (loop cleanup)
- p8.2 (variable shadowing)
- p13.5 (chained assignment)
- p13.6 (function pointer)
- p13.7 (2D array)
- p16.4, p16.7 (scanf values)

## Known Limitations (Not Fixed)

| Issue | Why | Status |
|-------|-----|--------|
| Recursive `return f(n-1)` pops frame before recursive call | Source-level instrumentation can't delay pop past return expression | Document |
| SYS-15: Use-after-free not detected | Would need runtime checking in onSet; interpreter doesn't do this either | Deferred |
| INFO-1: Uninitialized vars show 0 | WASM zero-initializes stack; correct at runtime level | Won't fix |

## Verification Checklist
- [ ] `npm test` passes
- [ ] `npm run build` succeeds
- [ ] All 47 diagnostic programs re-dumped
- [ ] Re-audit confirms: struct children visible (p2.1, p2.2)
- [ ] Re-audit confirms: heap values visible (p4.1, p4.4)
- [ ] Re-audit confirms: return lines shown (all programs)
- [ ] Re-audit confirms: condition steps shown (p7.1, p7.2)
- [ ] Re-audit confirms: scanf values shown (p16.4, p16.7)
- [ ] Re-audit confirms: no redundant loop ops (p7.3)
- [ ] Re-audit confirms: calloc labeled correctly (p4.2)
- [ ] Re-audit confirms: chained assignment works (p13.5)
- [ ] Re-audit confirms: variable shadowing works (p8.2)
- [ ] Re-audit confirms: function pointer compiles (p13.6)
- [ ] Re-audit confirms: 2D array has nested children (p13.7)
- [ ] CHECKLIST.md updated with fix status

## References
- [Diagnostic checklist](../diagnostics/CHECKLIST.md)
- [Diagnostic dumps](../diagnostics/)
- [Diagnostic audits](../diagnostics/audits/)
- [Transformer source](../../src/lib/wasm-backend/transformer.ts)
- [Op collector source](../../src/lib/wasm-backend/op-collector.ts)
- [Runtime source](../../src/lib/wasm-backend/runtime.ts)
- [Integration tests](../../src/lib/wasm-backend/integration.test.ts)
