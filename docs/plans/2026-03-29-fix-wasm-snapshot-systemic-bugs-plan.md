---
title: Fix WASM Backend Systemic Snapshot Bugs
type: fix
status: active
date: 2026-03-29
---

# Fix WASM Backend Systemic Snapshot Bugs

## Context

The diagnostic audit of all 47 programs found 15 systemic bugs. 4 were already fixed. The remaining bugs cause struct fields, heap values, recursive call stacks, scanf results, and various control flow steps to be invisible or wrong in the visualization. Computed values are nearly always correct — it's the snapshot/visualization layer that's broken.

This plan addresses all open bugs in priority order. Each fix includes the exact code change, which programs it fixes, and how to verify.

## Bug Fixes

### Fix 1: Struct field children (SYS-1)

**Problem:** `buildChildren()` returns `[]` for struct types because there's no type registry.

**Root cause:** The op-collector has no knowledge of struct layouts. Only the tree-sitter parse (in the transformer) knows field names and types.

**Fix:** Build a struct type registry in the transformer and pass it through to the op-collector.

**transformer.ts changes:**
1. Walk the CST for `struct_specifier` nodes with a body (field declarations).
2. For each, extract: struct name, field list (name, type, order).
3. Export a `StructRegistry` type: `Map<string, { fields: { name: string; type: string }[] }>`.
4. Return it from `transformSource()` alongside `instrumented` and `errors`.
5. Emit the registry as a JSON string constant in the instrumented C: `const char *__crow_struct_registry = "{...}";` — or simpler: pass it out-of-band and inject into the op-collector directly.

**Out-of-band approach (simpler, no C changes):**
- `transformSource()` returns `{ instrumented, errors, structRegistry }`.
- `structRegistry` is passed to `OpCollector` constructor.
- `buildChildren()` looks up `struct Point` → fields `[{name: "x", type: "int"}, {name: "y", type: "int"}]`.
- For each field, compute offset (assume sequential layout, natural alignment for ILP32: int=4, short=2, char=1, pointer=4, float=4, double=8).
- Create child entries with correct IDs, names, types, and values read from memory.

**op-collector.ts changes:**
1. Add `structRegistry: Map<string, StructField[]>` to constructor.
2. In `buildChildren()`, if type starts with `struct `, look up fields.
3. Compute field offsets using ILP32 alignment rules.
4. Create child MemoryEntry for each field.
5. In `updateChildValues()`, handle struct types by re-reading fields.

**Files:** `transformer.ts`, `op-collector.ts`, `runtime.ts` (pass registry), `integration.test.ts` (update pipeline helper)

**Verification:** p2.1 shows `p.x=30, p.y=35` as children. p2.2 shows nested struct fields.

---

### Fix 2: Heap dereference values (SYS-2)

**Problem:** `*p = 42` emits `__crow_set("p", &p, ...)` which reads the pointer variable's slot, not the heap memory. The heap entry's `value` stays empty forever.

**Root cause:** The transformer treats `*p = ...` like a regular variable set. The op-collector's `onSet` reads from `&p` (the stack slot holding the pointer address) and re-displays the pointer value.

**Fix (two parts):**

**Part A — Transformer:** For `*p = expr`, emit a different call: `__crow_deref_set("p", p, sizeof(*p), ...)` that passes the pointer VALUE (heap address) and the size of the pointed-to type.

Add a new `__crow_deref_set` callback:
```c
void __crow_deref_set(const char *name, void *heap_addr, int size, int line);
```

**Part B — Op-collector:** New `onDerefSet(namePtr, heapAddr, size, line)` method:
1. Find which heap block contains `heapAddr`.
2. Read the value at `heapAddr` using the appropriate type (infer from size, or pass type info).
3. Emit `setValue` for the heap entry ID.

**Simpler alternative:** Instead of a new callback, modify `onSet` to detect when `addr` falls within a heap block range. If it does, emit setValue for the heap entry instead. This avoids transformer changes.

**Chosen approach:** The simpler alternative — modify `onSet` in op-collector:
```typescript
onSet(namePtr, addr, line) {
    const name = readCString(namePtr);
    const info = this.varRegistry.get(name);
    if (!info) return;

    // Check if addr points into a heap block
    const heapBlock = this.findHeapBlock(addr);
    if (heapBlock) {
        // Read value from heap memory and update heap entry
        const value = this.readValue(addr, /* size from context */, info.type);
        this.currentOps.push({ op: 'setValue', id: heapBlock.entryId, value });
    }

    // Always update the stack variable too
    const value = this.readValue(info.addr, info.size, info.type);
    this.currentOps.push({ op: 'setValue', id: info.entryId, value });
    this.updateChildValues(info);
}
```

Wait — the `addr` argument to `onSet` is the address of the VARIABLE (`&p`), not the heap address. We need both. For `*p = 42`, we actually need to read `p` to get the heap address, then read from that address.

**Revised approach:** After reading the pointer variable's value (which IS the heap address), check if that value falls in a heap block. If so, read the pointed-to value from heap memory.

```typescript
onSet(namePtr, addr, line) {
    const name = readCString(namePtr);
    const info = this.varRegistry.get(name);
    if (!info) return;

    const value = this.readValue(addr, info.size, info.type);
    this.currentOps.push({ op: 'setValue', id: info.entryId, value });
    this.updateChildValues(info);

    // If this is a pointer type, check if it points to a heap block
    if (info.type.endsWith('*')) {
        const ptrValue = this.memory.getUint32(addr, true);
        const heapBlock = this.findHeapBlock(ptrValue);
        if (heapBlock) {
            // Read the pointed-to value from heap
            // For now, read as the base type (strip the *)
            const baseType = info.type.slice(0, -1).trim();
            const elemSize = this.sizeOfType(baseType);
            const heapValue = this.readValue(ptrValue, elemSize, baseType);
            this.currentOps.push({ op: 'setValue', id: heapBlock.entryId, value: heapValue });
        }
    }
}
```

Add `findHeapBlock(addr)` that checks if addr falls within any allocated block's range.
Add `sizeOfType(type)` helper for common types.

**Files:** `op-collector.ts`

**Verification:** p4.1 heap entry shows `value=42` after `*p = 42`. p4.4 heap shows individual values.

---

### Fix 3: Recursive frames stacked (SYS-3)

**Problem:** `__crow_pop_scope()` is injected BEFORE `return expr`, so when `return factorial(n-1)` executes, the current scope is already gone before the recursive call happens.

**Root cause:** `instrumentReturn` (line 287) inserts pop_scope before the return statement text.

**Fix:** Move `__crow_pop_scope()` to AFTER the return statement executes. But in C, code after `return` is unreachable.

**Alternative approach:** Don't pop scope at the return site. Instead, pop scope in the CALLER after the function call returns. The transformer already handles this for `bodyHasTrailingReturn` — if there's a trailing return, it doesn't add pop_scope before the closing brace.

**Best approach:** Keep the current pattern but delay the pop. Change `instrumentReturn` to:
1. Don't inject `__crow_pop_scope()` before return.
2. Instead, have the calling site handle scope cleanup. When `int x = add(10, 20)` returns, the `add` scope is still on the stack. The next `__crow_step` or `__crow_decl` in the caller will naturally be in the caller's context.

Actually the real issue is simpler: when we call `__crow_pop_scope()` before `return factorial(n-1)`, the factorial frame is popped BEFORE the recursive call. The recursive call then pushes a new factorial frame. So the user never sees two factorial frames simultaneously.

**Fix:** Remove `__crow_pop_scope()` from before return. Add it to the call return path instead. This is complex.

**Simpler fix:** Move `__crow_pop_scope()` to fire AFTER the return value expression is evaluated but before control returns to the caller. In C this is impossible with source instrumentation alone.

**Practical fix:** Accept that source-level instrumentation can't perfectly model call stacks for `return f(x)` (tail-call-like patterns). Instead, inject pop AFTER the return statement but wrap it so it still executes:

Actually, the simplest approach: change `instrumentReturn` to emit a `__crow_step` for the return line, then pop:
```c
__crow_step(LINE);
__crow_pop_scope();
return expr;
```

This at least makes the return visible. The frame ordering issue for recursive `return f(n-1)` is an inherent limitation of source-level instrumentation — the pop must happen before the recursive call because C evaluates the argument before returning.

**For non-recursive returns** (the common case), this gives correct behavior: the user sees the function's scope get removed.

**Files:** `transformer.ts` (instrumentReturn)

**Verification:** p6.4 shows return line as a step. Recursive frames still won't stack for `return f(n-1)` (document as known limitation).

---

### Fix 4: Return line visible (SYS-4)

**Problem:** Return statement never gets its own step.

**Fix:** Combined with Fix 3. Change `instrumentReturn` to:
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

This makes every return produce a visible step at its correct line.

**Files:** `transformer.ts`

**Verification:** All programs show return statement as a step at the correct line.

---

### Fix 5: For-loop exit increment (SYS-5)

**Problem:** `__crow_set("i", &i, ...)` is injected before the closing brace of the for body. But the C `i++` update fires AFTER the body executes and the `__crow_set` reads the PRE-increment value. When the loop exits, the final increment is never captured.

**Root cause:** The `__crow_set` for the update variable fires at the end of the loop body, reading `i` before the C `i++` update expression runs.

**Fix:** The for-loop update expression (`i++`) is part of the for statement itself, not the body. Currently the transformer injects `__crow_set` before `}` (end of body). The C update fires after `}` closes.

To capture the post-update value, we need to inject AFTER the update runs. But the update is part of the `for(;;update)` syntax — we can't inject code there.

**Alternative:** Don't inject `__crow_set` for the update at all. Instead, the re-declaration path in `onDecl` already handles this: when `__crow_decl("i", ...)` fires at the top of the next iteration, it detects the re-declaration and emits `setValue`. This already works for capturing the updated value at the START of each iteration.

The only gap is the FINAL exit value (when the condition fails and the loop body never re-enters). To capture this:

1. After the for loop's closing brace, inject: `__crow_set("i", &i, LINE); __crow_step(LINE);`
2. This fires once after the loop exits, capturing `i`'s final value.

But `i` is scoped to the for loop in C99+ — it doesn't exist after the loop. For `for(int i = ...)`, `i` is out of scope after `}`. So we can't reference `i` after the loop.

**Practical fix:** Remove the explicit `__crow_set` for update vars from the loop body entirely. The `onDecl` re-declaration path already captures `i`'s value at each iteration start. The exit value not being shown is acceptable since `i` goes out of scope when the loop ends (C99 semantics). This also fixes SYS-7 (redundant setValue).

**Files:** `transformer.ts` (instrumentFor — remove update tracking block)

**Verification:** p7.3 no longer has redundant setValue pairs. Loop var values are correct at each iteration start.

---

### Fix 6: Condition steps visible (SYS-6)

**Problem:** Empty steps (no ops between two `__crow_step` calls) are silently dropped.

**Fix:** Always emit steps, even if empty. An empty step just means "the program is at this line." This is important for condition lines (`if`, `while`) where no variables change but the user needs to see which line is being executed.

**op-collector.ts change:**
```typescript
onStep(line: number): void {
    if (++this.stepCount > this.maxSteps) {
        throw new StepLimitExceeded();
    }
    this.currentLine = line;
    // Always push a step — empty steps show the current line
    this.steps.push({
        location: { line: this.currentLine },
        ops: this.currentOps,
        ioEvents: this.currentIoEvents.length > 0 ? [...this.currentIoEvents] : undefined,
    });
    this.currentOps = [];
    this.currentIoEvents = [];
}
```

**Risk:** This increases step count significantly for loops (every iteration gets a condition step). Need to verify `maxSteps` limit is still reasonable.

**Mitigation:** Keep `maxSteps` at 500 but adjust if needed. Most programs have <100 steps even with empty steps.

**Files:** `op-collector.ts`

**Verification:** p7.1 shows step at `if (x > 5)` line. While loops show condition evaluation.

---

### Fix 7: Redundant loop increment setValue (SYS-7)

**Problem:** Explicit `__crow_set` + auto-detected re-decl both fire for loop vars.

**Fix:** Solved by Fix 5 — removing explicit `__crow_set` for update vars from the loop body. The re-decl path in `onDecl` is sufficient.

---

### Fix 8: Variable shadowing (SYS-8)

**Problem:** Anonymous blocks `{ int x = 20; }` don't get push/pop scope, so inner `x` overwrites the outer `x` entry via the re-declaration path.

**Fix:** Detect compound_statement nodes that are direct children of another compound_statement (anonymous blocks) and instrument them with push/pop scope.

**transformer.ts changes:**
1. In `walkNode`, add a case for `compound_statement` when `isInFunctionBody` and parent is also `compound_statement`.
2. Inject `__crow_push_scope("block", LINE)` after `{` and `__crow_pop_scope()` before `}`.
3. Use a generic scope name like `"block"` or `"_block_N"`.

**Files:** `transformer.ts`

**Verification:** p8.2 shows inner `x=25` in its own scope, outer `x` stays at 10.

---

### Fix 9: Chained assignment (SYS-9)

**Problem:** `a = b = c = 42` only tracks outermost `a`.

**Fix:** In `instrumentExpressionStatement`, when the RHS of an assignment is also an assignment_expression, recursively extract all targets.

**transformer.ts changes:**
1. In the `assignment_expression` branch, walk the RHS. If RHS is also an `assignment_expression`, emit `__crow_set` for its LHS too, recursively.
2. For `a = b = c = 42`: emit `__crow_set("c", &c, L)`, `__crow_set("b", &b, L)`, `__crow_set("a", &a, L)`, `__crow_step(L)`.

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

**Files:** `transformer.ts`

**Verification:** p13.5 shows a=50, b=50, c=42 (c set in first chain, b and a in second).

---

### Fix 10: calloc shown as malloc (SYS-10)

**Problem:** `onCalloc` delegates to `onMalloc`, which creates entry named `malloc(N)`.

**Fix:** After calling `onMalloc`, update the entry name and allocator field.

**op-collector.ts changes:**
```typescript
onCalloc(count: number, size: number, line: number): number {
    const totalSize = count * size;
    const addr = this.onMalloc(totalSize, line);
    if (addr !== 0) {
        this.refreshMemory();
        this.memoryBuffer.fill(0, addr, addr + totalSize);
        // Fix the entry to show calloc
        const block = this.heapBlocks.get(addr);
        if (block) {
            const lastOp = this.currentOps[this.currentOps.length - 1];
            if (lastOp && lastOp.op === 'addEntry') {
                lastOp.entry.name = `calloc(${count}, ${size})`;
                if (lastOp.entry.heap) {
                    lastOp.entry.heap.allocator = 'calloc';
                }
            }
        }
    }
    return addr;
}
```

**Files:** `op-collector.ts`

**Verification:** p4.2 shows `calloc(4, 4)` instead of `malloc(16)`.

---

### Fix 11: scanf values shown (SYS-11)

**Problem:** `__crow_scanf_int` writes to WASM memory but emits no `setValue` op.

**Fix:** After writing to memory, find the variable whose address matches `ptr` and emit a `setValue`.

**op-collector.ts changes:** Add a reverse lookup helper:
```typescript
private findVarByAddr(addr: number): VarInfo | undefined {
    for (const info of this.varRegistry.values()) {
        if (info.addr === addr) return info;
    }
    return undefined;
}
```

Then in each `onScanf*` method, after writing to memory:
```typescript
const varInfo = this.findVarByAddr(ptr);
if (varInfo) {
    const value = this.readValue(ptr, varInfo.size, varInfo.type);
    this.currentOps.push({ op: 'setValue', id: varInfo.entryId, value });
}
```

**Files:** `op-collector.ts`

**Verification:** p16.4 shows x=10, y=20 after scanf reads. p16.7 shows score values.

---

### Fix 12: sprintf/strcpy steps visible (SYS-12)

**Problem:** Calls like `sprintf(buf, ...)` produce no ops because they're just `call_expression` statements — no `__crow_set` is emitted. The step has zero ops and gets dropped.

**Fix:** Already addressed by Fix 6 (always emit steps, even empty). The sprintf call will at least show the line being executed. The buffer contents won't be visible (would need heap dereference tracking from Fix 2).

---

### Fix 13: Function pointer declarator (SYS-13)

**Problem:** `int (*fp)(int, int) = add;` — the transformer tries to instrument `fp` as a regular variable but the declarator syntax `(*fp)(int, int)` confuses `parseDeclName`, producing invalid C like `&(*fp)(int, int)`.

**Fix:** In `parseDeclName` and `getDeclarators`, detect `function_declarator` wrappers around parenthesized pointer declarators.

**transformer.ts changes:**
1. In `parseDeclName`, when encountering a `function_declarator`, look inside for a `parenthesized_declarator` containing a `pointer_declarator`.
2. Extract the identifier from inside: `(*fp)` → `fp`, mark as pointer.
3. In `escapeType`, produce `int(*)(int, int)` or just `int*` for the type string.

```typescript
} else if (current.type === 'function_declarator') {
    // Function pointer: int (*fp)(int, int)
    const inner = current.childForFieldName('declarator');
    if (inner && inner.type === 'parenthesized_declarator') {
        current = inner;
        // Continue unwrapping
    } else {
        break;
    }
}
```

**Files:** `transformer.ts`

**Verification:** p13.6 compiles and runs; `fp` shows as a pointer value.

---

### Fix 14: 2D array type/children (SYS-14)

**Problem:** `int m[3][3]` gets type `int[3]` with only 3 flat children. The outer array dimension is lost.

**Root cause:** `parseDeclName` only extracts one array dimension. `buildChildren` matches `int[3]` and creates 3 int children.

**Fix:**
1. In `parseDeclName`, handle nested `array_declarator` to capture all dimensions: `int[3][3]`.
2. In `buildChildren`, detect nested array types and recursively build sub-arrays.

**transformer.ts changes:**
```typescript
} else if (current.type === 'array_declarator') {
    const sizeNode = current.child(2);
    if (sizeNode && sizeNode.text !== ']') {
        arraySize = arraySize ? `${sizeNode.text}][${arraySize}` : sizeNode.text;
    }
    current = current.child(0)!;
}
```

Wait, the array sizes need to be in the right order. `int m[3][3]` is parsed as `array_declarator(array_declarator(m, 3), 3)`. Walking: outer dim=3, inner dim=3. Type should be `int[3][3]`.

**op-collector.ts changes:** In `buildChildren`, handle `int[3][3]`:
```typescript
const arrayMatch = typeStr.match(/^(.+)\[(\d+)\]$/);
// For int[3][3], this matches elemType="int[3]", count=3
// Recursion handles the inner array
```

This should already work if the type string is correct — the regex peels off the rightmost `[N]` and recurses.

**Files:** `transformer.ts`, `op-collector.ts`

**Verification:** p13.7 shows `m` with 3 row children, each with 3 int children.

---

### Fix 15: Use-after-free detection (SYS-15)

**Problem:** Reading from freed memory is not flagged.

**Fix:** This is a nice-to-have, not critical. The existing interpreter doesn't detect this either. Document as a future enhancement.

**Status:** Deferred.

---

## Implementation Steps

### Step 1: Fix return visibility and condition steps (SYS-3, SYS-4, SYS-6)
- **What:** Change `instrumentReturn` to add `__crow_step(LINE)` before pop. Change `onStep` to always emit steps.
- **Files:** `transformer.ts`, `op-collector.ts`
- **Verification:** All programs show return lines. Condition lines visible.

### Step 2: Fix loop increment issues (SYS-5, SYS-7)
- **What:** Remove explicit `__crow_set` for loop update vars from `instrumentFor`.
- **Files:** `transformer.ts`
- **Verification:** p7.3 no redundant pairs. Loop vars correct at iteration start.

### Step 3: Fix calloc label and scanf values (SYS-10, SYS-11)
- **What:** Fix `onCalloc` entry name. Add `setValue` after scanf writes.
- **Files:** `op-collector.ts`
- **Verification:** p4.2 shows calloc. p16.4 shows scanf values.

### Step 4: Fix struct children (SYS-1)
- **What:** Build struct type registry in transformer, pass to op-collector, implement in `buildChildren`.
- **Files:** `transformer.ts`, `op-collector.ts`, `runtime.ts`, `integration.test.ts`
- **Verification:** p2.1 shows struct fields. p15.1 shows entity fields.

### Step 5: Fix heap dereference values (SYS-2)
- **What:** In `onSet`, detect pointer types pointing to heap blocks and emit setValue for heap entry.
- **Files:** `op-collector.ts`
- **Verification:** p4.1 heap shows `value=42`. p4.4 shows array values.

### Step 6: Fix chained assignment (SYS-9)
- **What:** Recursively collect all assignment targets in chains.
- **Files:** `transformer.ts`
- **Verification:** p13.5 shows all three variables updated.

### Step 7: Fix variable shadowing (SYS-8)
- **What:** Instrument anonymous blocks with push/pop scope.
- **Files:** `transformer.ts`
- **Verification:** p8.2 shows inner/outer x correctly.

### Step 8: Fix function pointer and 2D array (SYS-13, SYS-14)
- **What:** Handle function pointer declarators in `parseDeclName`. Handle nested array dimensions.
- **Files:** `transformer.ts`, `op-collector.ts`
- **Verification:** p13.6 compiles. p13.7 shows 2D structure.

### Step 9: Re-run full diagnostic suite
- **What:** Re-run all 47 programs, regenerate dumps, re-audit affected programs.
- **Verification:** All existing tests pass. Checklist updated.

## Verification
- [ ] `npm test` passes
- [ ] `npm run build` succeeds
- [ ] All 47 diagnostic programs re-audited
- [ ] CHECKLIST.md updated with fix status

## References
- [Diagnostic checklist](../diagnostics/CHECKLIST.md)
- [Diagnostic dumps](../diagnostics/)
- [Diagnostic audits](../diagnostics/audits/)
- [Transformer source](../../src/lib/wasm-backend/transformer.ts)
- [Op collector source](../../src/lib/wasm-backend/op-collector.ts)
- [Integration tests](../../src/lib/wasm-backend/integration.test.ts)
