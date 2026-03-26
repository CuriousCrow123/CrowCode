---
title: Fix All Known Interpreter Bugs
type: fix
status: completed
date: 2026-03-26
---

# Fix All Known Interpreter Bugs

## Context

The value-correctness test suite documented 16 bugs as `test.fails()` tests. After deduplication by root cause, there are **13 distinct fixes** needed (bugs 2/15 share a root cause, bugs 11/14 share a root cause, bug 16 actually passes). Each fix has a corresponding test that will flip from `test.fails()` to `it()` when resolved.

## Design

### Fix ordering strategy

Group fixes by **risk and dependency**, not by bug number. Fix foundational issues first (type system, evaluator) before higher-level issues (interpreter assignment paths, emitter resolution).

**Layer 1 — Evaluator/type fixes (no emitter changes):**
Pure expression evaluation fixes. Low risk, self-contained.

**Layer 2 — Interpreter assignment paths:**
Add missing branches in `executeAssignment` and `executeExpressionStatement`. Medium risk.

**Layer 3 — Emitter pointer resolution:**
Fix multi-level pointer chains and member-expression malloc. Higher risk, touches core path resolution.

**Layer 4 — Function call and lifecycle fixes:**
Struct-by-value params, leak detection. Higher complexity but isolated.

### Alternatives considered

- **Fix one bug at a time with individual PRs:** Too slow for 13 fixes, and many share code paths.
- **Rewrite the interpreter:** Overkill — most fixes are 5-20 line changes in existing functions.

## Files

### Modify
| File | What changes | Why |
|------|-------------|-----|
| `src/lib/interpreter/evaluator.ts` | Fix evalCast truncation, increment on non-identifier lvalues | Bugs 7, 10 |
| `src/lib/interpreter/interpreter.ts` | Fix applyCompoundOp, executeAssignment branches, executeMallocAssign, executeExpressionStatement, struct-by-value params, detectLeaks, executeFreeCall | Bugs 1, 6, 8, 9, 11, 13, 4, 5 |
| `src/lib/interpreter/emitter.ts` | Fix resolvePointerPath multi-level, freeHeap setValue | Bugs 2, 12 |
| `src/lib/interpreter/value-correctness.test.ts` | Promote `test.fails()` to `it()` as bugs are fixed | Verification |

## Steps

### Step 1: evalCast numeric truncation (Bug 7)
- **What:** Add narrowing logic to `evalCast` in evaluator.ts (~line 396). When casting to a smaller integer type, truncate the value.
- **Files:** `src/lib/interpreter/evaluator.ts`
- **Depends on:** Nothing
- **Verification:** `test.fails('cast truncation: (char)300 narrows to 8 bits')` passes as `it()`

**Current code (evaluator.ts:396-408):**
```typescript
private evalCast(node): EvalResult {
    const result = this.eval(node.value);
    const targetType = this.typeReg.resolve(node.targetType);
    return { value: { type: targetType, data: result.value.data, address: result.value.address } };
}
```

**Fix:** After resolving the target type, narrow the data value based on the target type's size:
```typescript
let data = result.value.data;
if (data !== null && targetType.kind === 'primitive') {
    const size = sizeOf(targetType);
    if (size === 1) data = (data << 24) >> 24;      // char: sign-extend 8-bit
    else if (size === 2) data = (data << 16) >> 16;  // short: sign-extend 16-bit
    else if (size <= 4) data = data | 0;              // int: toInt32
}
```

### Step 2: applyCompoundOp toInt32 wrapping (Bug 8)
- **What:** Wrap arithmetic results in `applyCompoundOp` with `toInt32()` to match `evalBinary` behavior.
- **Files:** `src/lib/interpreter/interpreter.ts`
- **Depends on:** Nothing
- **Verification:** `test.fails('compound assignment overflow: x += 1 wraps at INT_MAX')` passes as `it()`

**Current code (interpreter.ts:1076-1091):**
```typescript
case '+=': return oldVal + newVal;
case '-=': return oldVal - newVal;
case '*=': return oldVal * newVal;
```

**Fix:** Import `toInt32` and wrap:
```typescript
case '+=': return toInt32(oldVal + newVal);
case '-=': return toInt32(oldVal - newVal);
case '*=': return toInt32(Math.imul(oldVal, newVal));
```
Note: `*=` should use `Math.imul` to match evalBinary (line 171).

### Step 3: x++ as standalone statement emits setValue (Bug 13)
- **What:** In `executeExpressionStatement`, detect unary `++`/`--` on identifiers and emit a step with setValue.
- **Files:** `src/lib/interpreter/interpreter.ts`
- **Depends on:** Nothing
- **Verification:** All 4 `test.fails` increment/decrement tests pass as `it()`

**Current code (interpreter.ts:536-552):**
```typescript
// Evaluate for side effects
const result = this.evaluator.eval(expr);
if (result.error) this.errors.push(result.error);
```

**Fix:** Before the generic eval fallback, check for unary expressions:
```typescript
if (expr.type === 'unary_expression' && (expr.operator === '++' || expr.operator === '--')) {
    const result = this.evaluator.eval(expr);
    if (result.error) { this.errors.push(result.error); return; }
    if (!sharesStep) {
        this.emitter.beginStep({ line: node.line }, `${expr.operand.name}${expr.operator}`);
        this.stepCount++;
    }
    if (expr.operand.type === 'identifier') {
        const current = this.env.lookupVariable(expr.operand.name);
        if (current) {
            const displayVal = this.formatValue(current.type, current.data);
            this.emitter.assignVariable(expr.operand.name, displayVal);
        }
    }
    return;
}
```

### Step 4: `*p = 42` dereference assignment (Bug 6)
- **What:** Add `unary_expression` branch in `executeAssignment` for pointer dereference targets.
- **Files:** `src/lib/interpreter/interpreter.ts`
- **Depends on:** Nothing
- **Verification:** `test.fails('dereference assignment: *p = 42 sets heap value')` passes as `it()`

**Fix:** After the `subscript_expression` branch (~line 531), add:
```typescript
} else if (node.target.type === 'unary_expression' && node.target.operator === '*') {
    // Dereference assignment: *p = 42
    const ptrResult = this.evaluator.eval(node.target.operand);
    if (ptrResult.error) { this.errors.push(ptrResult.error); return; }
    const addr = ptrResult.value.data ?? 0;
    const newVal = rhs.value.data ?? 0;
    this.memoryValues.set(addr, newVal);
    // Resolve heap block and emit setValue
    const ptrName = node.target.operand.type === 'identifier' ? node.target.operand.name : undefined;
    if (ptrName) {
        const heapBlockId = this.emitter.getHeapBlockId(ptrName);
        if (heapBlockId) {
            this.emitter.directSetValue(heapBlockId, String(newVal));
        }
    }
}
```

### Step 5: Compound ops on member_expression targets (Bug 9)
- **What:** In the `member_expression` branch of `executeAssignment`, apply `applyCompoundOp` when operator is not `=`.
- **Files:** `src/lib/interpreter/interpreter.ts`
- **Depends on:** Step 2 (toInt32 fix)
- **Verification:** `test.fails('compound assignment on struct field: p->x += 5')` passes as `it()`

**Current code (interpreter.ts:486-501):**
```typescript
const newVal = rhs.value.data ?? 0;
const displayVal = String(newVal);
```

**Fix:**
```typescript
let newVal = rhs.value.data ?? 0;
if (node.operator !== '=') {
    const targetEval = this.evaluator.eval(node.target);
    const oldVal = targetEval.value.data ?? this.memoryValues.get(targetEval.value.address) ?? 0;
    newVal = this.applyCompoundOp(node.operator, oldVal, newVal);
}
const displayVal = String(newVal);
```
Note: move the `targetEval` up to before the compound op check so the address is available for both.

### Step 6: Increment on non-identifier lvalues (Bug 10)
- **What:** In the evaluator's `++`/`--` handling, update memory for member_expression and subscript_expression operands, not just identifiers.
- **Files:** `src/lib/interpreter/evaluator.ts`, `src/lib/interpreter/interpreter.ts`
- **Depends on:** Nothing
- **Verification:** `test.fails('post-increment on array element: arr[0]++')` passes as `it()`

**Current code (evaluator.ts:209-213):**
```typescript
if (operand.type === 'identifier') {
    this.env.setVariable(operand.name, newVal);
}
```

**Fix:** The evaluator should also write to memory for non-identifier operands. However, the evaluator doesn't have access to `memoryValues` or the emitter. Two options:
- **Option A:** Add a `memoryWriter` callback (like `memoryReader`) to the evaluator
- **Option B:** Handle this in the interpreter by intercepting unary expressions before they reach the evaluator

**Recommended: Option B** — handle in `executeExpressionStatement` (building on Step 3). For `arr[0]++`, the interpreter evaluates the subscript to get the address, reads the old value, computes the new value, writes it back via `memoryValues`, and emits a setValue op.

### Step 7: executeMallocAssign for member_expression targets (Bug 1)
- **What:** Remove the `if (node.target.type !== 'identifier') return` guard and add handling for member_expression targets like `p->scores = calloc(...)`.
- **Files:** `src/lib/interpreter/interpreter.ts`
- **Depends on:** Step 9 (multi-level pointer resolution helps but isn't strictly required)
- **Verification:** `test.fails('member-expression malloc: p->scores = calloc')` passes as `it()`

**Current code (interpreter.ts:374):**
```typescript
if (node.target.type !== 'identifier') return;
```

**Fix:** Replace with:
```typescript
if (node.target.type === 'identifier') {
    // existing identifier logic (lines 375-446)
} else if (node.target.type === 'member_expression') {
    // New: handle p->field = malloc/calloc
    const path = Evaluator.buildAccessPath(node.target);
    // ... evaluate args, compute totalSize, allocator, heapType
    // ... malloc, build heap children
    // ... emit allocHeapWithAddress for the new block
    // ... emit assignField to update the pointer field value to the new address
    // ... register in ptrTargetMap with a compound key
}
```

Key challenge: The `ptrTargetMap` currently only maps simple variable names to heap block IDs. For `p->scores`, we need to map the field path or the field's entry ID to the new heap block. This may require extending `ptrTargetMap` to support compound keys or adding a secondary map from heap addresses to block IDs.

### Step 8: Multi-level pointer chain resolution (Bugs 2, 15)
- **What:** Extend `resolvePointerPath` in emitter.ts to check intermediate fields for pointer targets, enabling `p->data->field` resolution.
- **Files:** `src/lib/interpreter/emitter.ts`
- **Depends on:** Step 7 (member-expression malloc registers pointer targets)
- **Verification:** `test.fails('double pointer indirection')` and `test.fails('multi-level pointer chain')` pass as `it()`

**Current code (emitter.ts:426-453):** Navigates heap block children but never checks if an intermediate child is itself a pointer to another heap block.

**Fix:** At each level of the path traversal, check if the current field has an entry in `ptrTargetMap`. If so, resolve through to that heap block:
```typescript
for (let i = 1; i < path.length; i++) {
    const field = path[i];
    // Check if current path segment is a pointer to another heap block
    const intermediateKey = /* construct key for this field */;
    const heapTarget = this.ptrTargetMap.get(intermediateKey);
    if (heapTarget) {
        currentId = heapTarget;
        continue;
    }
    // existing child/fallback resolution
}
```

This requires Step 7 to register compound pointer targets so that `p->data` maps to its heap block.

### Step 9: Struct-by-value function parameters (Bugs 11, 14)
- **What:** When passing a struct by value, copy the actual field values from the argument rather than defaulting to `'0'`.
- **Files:** `src/lib/interpreter/interpreter.ts`
- **Depends on:** Nothing
- **Verification:** `test.fails('struct-by-value params')` and `test.fails('distance() returns correct value')` pass as `it()`

**Current code (interpreter.ts:904-919):** Struct params get `buildStructChildSpecs(paramType)` which defaults all fields to `'0'`.

**Fix:** When the argument is a struct, read each field's value from `memoryValues` or the environment:
```typescript
if (isStructType(paramType)) {
    // Get the caller's struct variable
    const argNode = callArgs[i];
    const argValue = args[i]; // CValue with address
    const specs = buildStructChildSpecs(paramType);
    // Copy actual field values from the caller's struct
    for (const spec of specs) {
        const fieldAddr = (argValue?.address ?? 0) + spec.addressOffset;
        const fieldVal = this.memoryValues.get(fieldAddr) ?? this.env.readMemory?.(fieldAddr) ?? 0;
        spec.value = String(fieldVal);
    }
    // Use these populated specs for the parameter
}
```

The challenge is that stack struct fields may not be in `memoryValues` — they may be tracked only in the environment's scope chain. Need to check how struct field values are stored and read back.

### Step 10: free(p->scores) resolution (Bug 5)
- **What:** Improve free handling for member-expression arguments by resolving the heap block via address rather than string key.
- **Files:** `src/lib/interpreter/interpreter.ts`
- **Depends on:** Step 7 (member-expression malloc must work first to create the blocks being freed)
- **Verification:** `test.fails('free(p->scores)')` would need a new test or inclusion in the integration test

**Current code (interpreter.ts:580-622):** Uses string-based key lookup in `ptrTargetMap` which doesn't match compound paths.

**Fix:** Use the address-based approach:
```typescript
// For member-expression free targets
const ptrAddr = result.value.data ?? 0;
// Look up heap block ID by address (add heapBlockAddresses reverse lookup in emitter)
const blockId = this.emitter.getHeapBlockIdByAddress(ptrAddr);
if (blockId) {
    this.emitter.directSetHeapStatus(blockId, 'freed');
}
```

This requires adding a `getHeapBlockIdByAddress(addr: number)` method to the emitter that looks up the address in `heapBlockAddresses`.

### Step 11: freeHeap emitter setValue for pointer (Bug 12)
- **What:** After setting heap status to freed, also emit setValue on the pointer variable to show `(dangling)`.
- **Files:** `src/lib/interpreter/emitter.ts`
- **Depends on:** Nothing
- **Verification:** Verify that free tests show both `setHeapStatus` and `setValue` ops

**Current code (emitter.ts:315-322):** Only emits `setHeapStatus`.

**Fix:** This is actually already handled by the interpreter — after calling `emitter.freeHeap()`, the interpreter calls `emitter.assignVariable(varName, '(dangling)')` (line 608). The bug is that for member-expression free targets, the `assignVariable` call uses the wrong variable name. This is really the same fix as Step 10. The emitter's `freeHeap` itself is fine — it just needs the interpreter to correctly emit the dangling setValue.

**Resolution:** Mark as fixed-by-step-10. No separate emitter change needed.

### Step 12: Leak detection (Bug 4)
- **What:** Implement `detectLeaks()` to find allocated but unfreed heap blocks at program end.
- **Files:** `src/lib/interpreter/interpreter.ts`, `src/lib/interpreter/emitter.ts`
- **Depends on:** Nothing (but lowest priority)
- **Verification:** `it.todo('leak detection marks unfreed blocks as leaked')` gets a test body and passes

**Current code (interpreter.ts:979-988):** Empty loop body.

**Fix:**
```typescript
private detectLeaks(): void {
    const blocks = this.env.getAllHeapBlocks();
    for (const [addr, block] of blocks) {
        if (block.status === 'allocated') {
            // Find the emitter's heap block ID for this address
            const blockId = this.emitter.getHeapBlockIdByAddress(addr);
            if (blockId) {
                this.emitter.leakHeap(blockId);
            }
        }
    }
}
```

Requires the same `getHeapBlockIdByAddress` helper from Step 10.

### Step 13: Pointer displayed as decimal (Bug 3)
- **What:** Ensure all pointer display paths use `formatAddress()` consistently.
- **Files:** `src/lib/interpreter/interpreter.ts`
- **Depends on:** Step 7 (the decimal display happens specifically when member-expression malloc fails)
- **Verification:** After Step 7 is fixed, verify that `p->scores` shows hex, not decimal

**Analysis:** This bug is likely a *symptom* of Bug 1, not a separate root cause. When `p->scores = calloc(...)` silently fails, the evaluator stores the raw address as an integer in `memoryValues`, and the emitter never formats it as hex because no heap allocation op was emitted. Once Bug 1 is fixed (Step 7), the pointer value will be formatted correctly by `formatAddress()`.

**Resolution:** Likely fixed-by-step-7. If not, add explicit hex formatting in the member_expression assignment path's `displayVal` computation.

## Edge Cases

| Case | Expected behavior | How handled |
|------|-------------------|-------------|
| `(unsigned char)x` vs `(char)x` | Different truncation (zero-extend vs sign-extend) | Step 1: check for unsigned in type |
| `*NULL = 42` | Error, not crash | Step 4: check for null address |
| `p->scores = malloc(0)` | Valid allocation of 0 bytes | Step 7: handle zero-size allocation |
| Recursive struct `struct Node { struct Node *next; }` | Pointer field, not infinite recursion | Step 8: pointer fields resolve via ptrTargetMap |
| `free(NULL)` | No-op per C standard | Already handled by environment.ts |
| Struct with array field passed by value | All elements copied | Step 9: iterate all specs including nested |

## Verification

- [ ] `npm test` — all `test.fails()` promoted to `it()` pass
- [ ] `npm test` — no regressions in existing 423 tests
- [ ] `npm run check` — TypeScript compiles cleanly
- [ ] `npm run build` — static build succeeds
- [ ] Integration test: Memory Basics distance() returns 500

## References

- [src/lib/interpreter/value-correctness.test.ts](src/lib/interpreter/value-correctness.test.ts) — test suite with all bugs as `test.fails()`
- [docs/plans/2026-03-26-test-interpreter-value-correctness-plan.md](docs/plans/2026-03-26-test-interpreter-value-correctness-plan.md) — test plan with bug analysis
- [docs/research/op-generation-requirements.md](docs/research/op-generation-requirements.md) — op generation contract
