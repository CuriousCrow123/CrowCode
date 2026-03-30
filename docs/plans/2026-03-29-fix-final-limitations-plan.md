---
title: Fix Final Snapshot Limitations (sprintf, use-after-free, uninitialized vars)
type: fix
status: active
date: 2026-03-29
---

# Fix Final Snapshot Limitations

## Context

Three limitations remain after fixing all 19 bugs across two rounds:

1. **sprintf buffer tracking** — Steps visible but 0 ops; buffer contents invisible.
2. **Use-after-free detection** — `*p = 99` after `free(p)` is silently ignored.
3. **Uninitialized vars show 0** — `int x;` reads WASM zero-init, not marked as undefined.

All three are solvable with focused changes.

## Design

### sprintf (p9.1)

**Key insight:** Don't reimplement sprintf in JS. Let xcc's libc sprintf run normally, then read the result from WASM memory and emit a setValue.

The transformer already knows the first argument is the destination buffer. Instead of replacing the call (like scanf), just add a `__crow_set` call after it that tracks the buffer variable:

```c
// Before:
sprintf(buf, "x=%d", 42);

// After:
sprintf(buf, "x=%d", 42);
__crow_set("buf", &buf, 5);   // ← added by transformer
```

This reuses the existing `__crow_set` → `onSet` → `emitSetValueForAddr` pipeline. For heap-allocated buffers, `onSet`'s pointer dereference path already handles it.

**Why this works:** sprintf is synchronous in WASM. When `__crow_set` fires, the buffer already contains the formatted string. The existing `readCString` / `readValue` machinery reads it correctly.

### Use-after-free (p14.1)

**Key insight:** The pointer dereference path in `onSet` already finds the HeapBlock. It checks `status === 'allocated'` and skips freed blocks. Just add an `else if (status === 'freed')` branch that emits a `setHeapStatus` op with a new status `'use-after-free'`.

Extend the `HeapInfo.status` type to include `'use-after-free'` as a diagnostic state. The UI can render it as a warning (red highlight, warning icon, etc.).

### Uninitialized vars (p13.4)

**Key insight:** tree-sitter already distinguishes `int x;` (bare `identifier`) from `int x = 5;` (`init_declarator`). The transformer's `getDeclarators()` can detect this. Pass a flag to `__crow_decl` so the op-collector shows `"?"` instead of reading the WASM zero-initialized value.

---

## Files Modified

| File | Changes | Why |
|------|---------|-----|
| `src/lib/wasm-backend/transformer.ts` | sprintf tracking, uninit flag | Add post-call tracking, extend DeclInfo |
| `src/lib/wasm-backend/op-collector.ts` | UAF detection, uninit display | Check freed status, use flag for "?" |
| `src/lib/api/types.ts` | Extend HeapInfo status | Add 'use-after-free' status |
| `static/xcc/__crow.h` | Extend __crow_decl signature | Add flags parameter |
| `src/lib/wasm-backend/runtime.ts` | Update __crow_decl binding | Pass flags argument |
| `src/lib/wasm-backend/integration.test.ts` | Update binding, add test assertions | Verify all three fixes |
| `src/lib/wasm-backend/diagnostic.test.ts` | Update binding | Pass flags argument |

---

## Step 1: sprintf buffer tracking

### Part A: Transformer — add post-call tracking for sprintf

**File:** `transformer.ts` — `rewriteCallIfNeeded`

Add `'sprintf'` case to the switch. Unlike other rewrites, this does NOT replace the call — it adds tracking after it.

**However,** `rewriteCallIfNeeded` currently operates via `replacements` (replacing call text). For sprintf, we need an `insertion` after the call's expression statement, not a replacement. But `rewriteCallIfNeeded` only receives `replacements`.

**Better approach:** Handle sprintf in `instrumentExpressionStatement` directly. When the expression is a `call_expression` with function name `sprintf`, extract the first argument (the buffer) and add a `__crow_set` for it:

**In `instrumentExpressionStatement`, add before the default call_expression handler:**

```typescript
} else if (expr.type === 'call_expression') {
    const funcNode = expr.childForFieldName('function');
    if (funcNode?.text === 'sprintf' || funcNode?.text === 'snprintf') {
        // Track the destination buffer after sprintf completes
        const args = expr.childForFieldName('arguments');
        if (args) {
            const argList = extractArgList(args);
            const bufArg = argList[0]?.trim();
            if (bufArg) {
                let text = `\n\t__crow_set("${bufArg}", &${bufArg}, ${line});`;
                text += `\n\t__crow_step(${line});`;
                insertions.push({ offset: node.endIndex, text, priority: 5 });
                return;
            }
        }
    }
    rewriteCallIfNeeded(expr, replacements);
    // ... existing step insertion
```

**Note:** `extractArgList` already exists (used by scanf rewriting). The buffer argument name becomes both the `__crow_set` name and address expression. For `sprintf(buf, ...)`, this emits `__crow_set("buf", &buf, line)`.

**For heap buffers:** If `buf` is a `char*` pointer, `onSet` will read the pointer value, find the heap block, and emit a setValue with the string contents (already implemented in the heap dereference path).

**Verification:** p9.1 — each sprintf step now shows 1+ ops with buffer contents.

---

## Step 2: Use-after-free detection

### Part A: Extend HeapInfo status

**File:** `src/lib/api/types.ts`

**Current:**
```typescript
status: 'allocated' | 'freed' | 'leaked';
```

**Change to:**
```typescript
status: 'allocated' | 'freed' | 'leaked' | 'use-after-free';
```

### Part B: Detect in pointer dereference path

**File:** `op-collector.ts` — `onSet` pointer dereference path (line ~223)

**Current:**
```typescript
if (heapBlock && heapBlock.status === 'allocated') {
    // ... update heap block values
}
```

**Change to:**
```typescript
if (heapBlock) {
    if (heapBlock.status === 'allocated') {
        // ... existing: update heap block values
    } else if (heapBlock.status === 'freed') {
        // Use-after-free detected
        this.currentOps.push({
            op: 'setHeapStatus',
            id: heapBlock.entryId,
            status: 'use-after-free',
        });
    }
}
```

### Part C: Also detect in onDecl for reads

When `int x = *p;` executes where `p` points to a freed block, the value is read during `onDecl` (via `readValue`). The declaration still happens, but we should also flag it.

**File:** `op-collector.ts` — after `onDecl` emits `addEntry`, check if the initializer reads from a freed heap block:

This is harder to detect in `onDecl` since we don't know the source expression. The pointer dereference detection in `onSet` covers `*p = value` (writes through freed pointer). For reads (`x = *p`), the value itself is garbage, which is the correct C behavior — the visualization shows whatever WASM memory contains. The `setHeapStatus: 'use-after-free'` marker on the heap entry is enough to alert the user.

**Verification:**
- p14.1: after `free(p)`, the next `*p = 99` step shows `setHeapStatus(heap_0, 'use-after-free')`
- The heap entry visually shows use-after-free status

---

## Step 3: Uninitialized variable display

### Part A: Extend DeclInfo

**File:** `transformer.ts`

**Current:**
```typescript
type DeclInfo = { name: string; isPointer: boolean; arraySize: string | null };
```

**Change to:**
```typescript
type DeclInfo = { name: string; isPointer: boolean; arraySize: string | null; hasInitializer: boolean };
```

### Part B: Track initializer presence in getDeclarators

**File:** `transformer.ts` — `getDeclarators`

**Current logic:**
- `init_declarator` → has initializer
- bare `identifier`, `pointer_declarator`, `array_declarator` → no initializer

**Change:** Add `hasInitializer` to each returned DeclInfo:

```typescript
function getDeclarators(node: SyntaxNode): DeclInfo[] {
    const decls: DeclInfo[] = [];
    for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)!;
        if (child.type === 'init_declarator') {
            const declarator = child.childForFieldName('declarator');
            if (declarator) {
                decls.push({ ...parseDeclName(declarator), hasInitializer: true });
            }
        } else if (child.type === 'identifier') {
            decls.push({ name: child.text, isPointer: false, arraySize: null, hasInitializer: false });
        } else if (child.type === 'pointer_declarator' || child.type === 'array_declarator') {
            decls.push({ ...parseDeclName(child), hasInitializer: false });
        }
    }
    return decls;
}
```

### Part C: Pass flag to __crow_decl

**File:** `transformer.ts` — `instrumentDeclaration`

**Current:**
```typescript
text += `\n\t__crow_decl("${decl.name}", &${decl.name}, sizeof(${decl.name}), "${escapeType(typeStr, decl)}", ${line});`;
```

**Change to:**
```typescript
const flags = decl.hasInitializer ? 0 : 1;
text += `\n\t__crow_decl("${decl.name}", &${decl.name}, sizeof(${decl.name}), "${escapeType(typeStr, decl)}", ${line}, ${flags});`;
```

### Part D: Update __crow.h

**File:** `static/xcc/__crow.h`

**Current:**
```c
void __crow_decl(const char *name, void *addr, int size, const char *type, int line);
```

**Change to:**
```c
void __crow_decl(const char *name, void *addr, int size, const char *type, int line, int flags);
```

### Part E: Update runtime and test bindings

**File:** `runtime.ts` — update the env import:

```typescript
__crow_decl: (namePtr: number, addr: number, size: number, typePtr: number, line: number, flags: number) =>
    collector.onDecl(namePtr, addr, size, typePtr, line, flags),
```

Same change in `integration.test.ts` and `diagnostic.test.ts` env objects.

### Part F: Use flag in onDecl

**File:** `op-collector.ts` — `onDecl`

**Change signature:**
```typescript
onDecl(namePtr: number, addr: number, size: number, typePtr: number, _line: number, flags: number = 0): void {
```

**Change value reading:**
```typescript
// Current:
const value = this.readValue(addr, size, typeStr);

// Change to:
const isUninitialized = (flags & 1) !== 0;
const value = isUninitialized ? '?' : this.readValue(addr, size, typeStr);
```

Also when re-declaring a loop variable (the existing `setValue` path for re-declarations), the flag should be ignored since the variable has been assigned by the loop mechanics.

### Part G: Handle parameter declarations

Function parameters are always initialized (by the caller). The `instrumentFunction` parameter declarations should pass `flags=0`:

```typescript
pushText += `\n\t__crow_decl("${param.name}", &${param.name}, sizeof(${param.name}), "${param.type}", ${line}, 0);`;
```

**Verification:**
- p13.4: `int x;` shows `value="?"` instead of `value="0"`
- `int x = 5;` still shows `value="5"`
- Function parameters still show their passed values
- Loop variables (`for (int i = 0; ...)`) show initial value correctly

---

## Step 4: Re-run diagnostics and update checklist

1. `npm test` — all tests pass
2. `npx vitest run src/lib/wasm-backend/diagnostic.test.ts` — regenerate dumps
3. Audit p9.1 (sprintf), p14.1 (UAF), p13.4 (uninit)
4. Update `CHECKLIST.md`

---

## Edge Cases

| Case | Expected behavior | How handled |
|------|-------------------|-------------|
| `sprintf(buf+offset, ...)` | Buffer name extraction gets `buf+offset` | extractArgList returns the expression as-is; `__crow_set` uses it |
| `sprintf(ptr->buf, ...)` | Field expression as buffer | extractSetTarget handles field_expression → root var |
| Double free | Already handled by `onFree` | Status already 'freed', second free is no-op |
| Read through freed pointer (`x = *p`) | Garbage value visible | WASM memory may still hold old data; UAF flag on heap entry is the signal |
| `int x, y = 5;` | `x` uninitialized, `y` initialized | `getDeclarators` returns two DeclInfo with different `hasInitializer` |
| `int arr[5];` (uninit array) | Show `?` for array and children | Flag propagates through; children values also show `?` |
| `struct Point p;` (uninit struct) | Show `?` for struct and children | Same — flag applies to entire declaration |

## Verification Checklist

- [ ] `npm test` passes
- [ ] `npm run build` succeeds
- [ ] p9.1: sprintf steps show buffer contents (e.g., "x=42", "hex=ff")
- [ ] p14.1: use-after-free step shows `setHeapStatus(heap_0, 'use-after-free')`
- [ ] p13.4: `int x;` shows `value="?"`, `int y = 10;` shows `value="10"`
- [ ] Function parameters still show correct values
- [ ] Loop variables show correct values (not `?`)
- [ ] CHECKLIST.md updated to all PASS

## References

- [Diagnostic checklist](../diagnostics/CHECKLIST.md)
- [Prior plans](2026-03-29-fix-wasm-snapshot-systemic-bugs-plan.md)
- [Op-collector source](../../src/lib/wasm-backend/op-collector.ts)
- [Transformer source](../../src/lib/wasm-backend/transformer.ts)
- [Types](../../src/lib/api/types.ts)
