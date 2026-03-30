---
title: Fix Remaining WASM Snapshot Bugs (REM-1 through REM-5)
type: fix
status: completed
date: 2026-03-29
---

# Fix Remaining WASM Snapshot Bugs

## Context

After fixing 14 systemic bugs, 5 issues remain. Three are closely related (nested struct updates, heap struct children, heap array elements) — they all involve the op-collector not having enough type information to decompose heap allocations or recurse into nested struct fields. The other two are a cosmetic step dedup issue and missing library function tracking.

## Design

The core insight is that heap blocks currently store no type information — they're opaque `N bytes` blobs. When a typed pointer first dereferences a heap block, we can infer the block's element type and build children. This single mechanism fixes REM-2 (heap struct children) and REM-3 (heap array elements). REM-1 (nested struct updates) is a simple recursion fix in `updateChildValues`.

REM-5 (duplicate steps at same line) is a one-line dedup in `onStep`. REM-4 (sprintf/strcpy buffer tracking) is partially addressable — strcpy can be rewritten like scanf, but sprintf is variadic and deferred.

---

## Step 1: Recursive nested struct updates (REM-1)

**Problem:** `updateChildValues` emits `setValue` for struct fields but doesn't recurse into fields that are themselves structs. So `r.pos.x` never updates after `r.pos.x = 30`.

**File:** `op-collector.ts` — `updateChildValues` (line ~543)

**Current:**
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

**Change to:**
```typescript
if (info.type.startsWith('struct ')) {
    this.updateStructFieldValues(info.addr, info.type, info.entryId);
}
```

**Extract helper** (recursive):
```typescript
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
        offset += fieldSize;
    }
}
```

**Verification:** p2.2 — after `r.pos.x = 30`, snapshot shows `main::r.pos.x = 30` (not 10).

---

## Step 2: Heap block type inference + children (REM-2, REM-3)

**Problem:** Heap entries have no type info. `onMalloc` creates entries with type `"N bytes"` and no children. When `*p = 42` fires, the SYS-2 fix reads a single value from the heap base address, but:
- For struct pointers (`struct Point*`), `readValue` returns `""` (structs show children, not scalar values) — no children exist.
- For array pointers (`int*` pointing to `malloc(20)`), it reads only `p[0]`, not `p[i]`.

**Approach:** Add `baseType` to `HeapBlock`. When `onSet` first dereferences a pointer into a heap block, infer the type from the pointer's base type. Build children (struct fields or array elements) and emit `addEntry` ops. On subsequent dereferences, emit `setValue` ops for all children.

**File:** `op-collector.ts`

### Part A: Extend HeapBlock type

```typescript
type HeapBlock = {
    entryId: string;
    size: number;
    line: number;
    status: 'allocated' | 'freed';
    baseType?: string;    // inferred from first pointer dereference
    childrenBuilt: boolean;
};
```

Update `onMalloc` to set `childrenBuilt: false` in the initial HeapBlock.

### Part B: New helper — `typeHeapBlock`

When `onSet` finds a pointer dereference into a heap block that hasn't been typed yet:

```typescript
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
        // Update type label
        this.currentOps.push({ op: 'setValue', id: block.entryId, value: '' });
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
```

### Part C: Update the pointer dereference path in `onSet`

**Current (line ~204–215):**
```typescript
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
```

**Change to:**
```typescript
if (info.type.endsWith('*')) {
    const ptrValue = this.memory.getUint32(addr, true);
    const heapBlock = this.findHeapBlock(ptrValue);
    if (heapBlock && heapBlock.status === 'allocated') {
        const baseType = info.type.slice(0, -1).trim();
        const blockAddr = this.findHeapBlockAddr(heapBlock);

        // First dereference: infer type and build children
        this.typeHeapBlock(heapBlock, blockAddr, baseType);

        // Update all children values
        this.updateHeapBlockValues(heapBlock, blockAddr, baseType);
    }
}
```

### Part D: `updateHeapBlockValues` helper

Re-reads all children values from memory and emits `setValue` ops:

```typescript
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
```

### Part E: `findHeapBlockAddr` helper

```typescript
private findHeapBlockAddr(block: HeapBlock): number {
    for (const [addr, b] of this.heapBlocks) {
        if (b === block) return addr;
    }
    return 0;
}
```

**Verification:**
- p5.1: after `p->x = 10`, heap shows children `x=10`, `y=0`
- p5.3: heap struct shows `id`, `pos`, `score` fields
- p4.4: heap shows `[0]=0, [1]=1, [2]=4, [3]=9, [4]=16` after loop
- p15.1: heap entity shows `id`, `pos`, `score` fields

---

## Step 3: Deduplicate consecutive same-line steps (REM-5)

**Problem:** `if (n <= 1) { return 1; }` generates two `__crow_step(2)` calls — one from `instrumentBlock` (if-body entry) and one from `instrumentReturn`. Both are at line 2, the first empty. This creates duplicate debugger steps.

**File:** `op-collector.ts` — `onStep`

**Current:**
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

**Change to:**
```typescript
onStep(line: number): void {
    if (++this.stepCount > this.maxSteps) {
        throw new StepLimitExceeded();
    }
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
        // Skip — previous empty step at this line already represents it
        return;
    }

    this.steps.push({
        location: { line: this.currentLine },
        ops: this.currentOps,
        ioEvents: this.currentIoEvents.length > 0 ? [...this.currentIoEvents] : undefined,
    });
    this.currentOps = [];
    this.currentIoEvents = [];
}
```

**Verification:**
- p6.4: base case `if (n <= 1) { return 1; }` produces one step at line 2, not two
- p12.5: same — no duplicate empty steps at condition/return lines
- All other programs: step counts may decrease slightly but no steps with ops are lost

---

## Step 4: strcpy tracking (partial REM-4)

**Problem:** `strcpy(dst, src)` writes to `dst` but no ops are emitted. Steps are now visible (SYS-12 fix) but show 0 ops.

**Approach:** Rewrite `strcpy` calls to `__crow_strcpy(dst, src, line)` in the transformer, then implement `onStrcpy` in op-collector that performs the copy and emits a setValue.

**File:** `transformer.ts` — add `'strcpy'` to `rewriteCallIfNeeded`

```typescript
case 'strcpy':
    rewriteStrcpyCall(callNode, funcNode, replacements);
    break;
```

**New function:**
```typescript
function rewriteStrcpyCall(
    callNode: SyntaxNode,
    funcNode: SyntaxNode,
    replacements: Replacement[],
): void {
    const args = callNode.childForFieldName('arguments');
    if (!args) return;
    const line = callNode.startPosition.row + 1;
    const argText = args.text.slice(1, -1); // strip parens
    replacements.push({
        startOffset: funcNode.startIndex,
        endOffset: args.endIndex,
        text: `__crow_strcpy(${argText}, ${line})`,
    });
}
```

**File:** `op-collector.ts` — add `onStrcpy` method:

```typescript
onStrcpy(destPtr: number, srcPtr: number, _line: number): number {
    this.refreshMemory();
    // Copy bytes from src to dest until null terminator
    let i = 0;
    while (this.memoryBuffer[srcPtr + i] !== 0 && srcPtr + i < this.memoryBuffer.length) {
        this.memoryBuffer[destPtr + i] = this.memoryBuffer[srcPtr + i];
        i++;
    }
    this.memoryBuffer[destPtr + i] = 0; // null terminate

    // Emit setValue for destination variable if tracked
    this.emitSetValueForAddr(destPtr);
    return destPtr;
}
```

**File:** `runtime.ts` — add import binding:
```typescript
__crow_strcpy: (dest: number, src: number, line: number) => collector.onStrcpy(dest, src, line),
```

**File:** `__crow.h` — add declaration:
```c
char* __crow_strcpy(char* dest, const char* src, int line);
```

**Note:** `sprintf` is deferred — it's variadic and xcc's calling convention for varargs is unclear. The value is low (sprintf output is visible via printf tracking anyway).

**Verification:**
- p14.2: strcpy step now shows setValue op for destination buffer

---

## Step 5: Re-run diagnostics and update checklist

1. `npx vitest run src/lib/wasm-backend/diagnostic.test.ts` — regenerate all 47 dumps
2. `npm test` — verify no regressions
3. Audit affected programs: p2.2, p4.4, p5.1, p5.3, p6.4, p12.5, p14.2, p15.1
4. Update `docs/diagnostics/CHECKLIST.md`

---

## Edge Cases

| Case | Expected behavior | How handled |
|------|-------------------|-------------|
| Struct with pointer field (struct Node { int val; struct Node *next; }) | Pointer field shows hex value, no infinite recursion | `buildChildren` reads pointer as scalar, doesn't follow |
| malloc(0) | No children built | `typeHeapBlock` early return if size=0 |
| realloc changes heap block address | Old children removed (via free), new block starts fresh | `onRealloc` already frees old + mallocs new |
| Deeply nested structs (3+ levels) | All levels update recursively | `updateStructFieldValues` recurses naturally |
| Heap block accessed by two different pointer types | First dereference wins — type locked in | `childrenBuilt` flag prevents re-typing |
| Empty steps at different lines | Not merged | Dedup only merges consecutive empty steps at SAME line |

## Known Limitations (Not Fixed)

| Issue | Why | Status |
|-------|-----|--------|
| sprintf buffer tracking | Variadic function, xcc calling convention unclear | Deferred |
| SYS-15: Use-after-free detection | Would need runtime checking on every memory access | Deferred |
| INFO-1: Uninitialized vars show 0 | WASM zero-initializes stack | Won't fix |

## Verification Checklist

- [ ] `npm test` passes
- [ ] `npm run build` succeeds
- [ ] p2.2: nested struct fields update correctly after mutation
- [ ] p5.1: heap struct shows field children (x, y)
- [ ] p4.4: heap array shows element children [0]–[4] with correct values
- [ ] p6.4: no duplicate empty steps at base case line
- [ ] p14.2: strcpy step has setValue op
- [ ] CHECKLIST.md updated

## References

- [Diagnostic checklist](../diagnostics/CHECKLIST.md)
- [Prior bug fix plan](2026-03-29-fix-wasm-snapshot-systemic-bugs-plan.md)
- [Op-collector source](../../src/lib/wasm-backend/op-collector.ts)
- [Transformer source](../../src/lib/wasm-backend/transformer.ts)
