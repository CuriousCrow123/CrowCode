---
title: Runtime Safety + Stdlib Functions
type: feat
status: completed
date: 2026-03-26
---

# Runtime Safety + Stdlib Functions

## Context

Three features that improve the interpreter's educational value:

1. **Use-after-free detection** — Currently, reading through a freed pointer silently returns the old value. Students won't learn that this is undefined behavior.
2. **String functions** (`strlen`, `strcpy`, `strcmp`) — Now that string literals allocate heap char arrays, these functions can operate on them.
3. **Math functions** (`abs`, `sqrt`, `pow`) — Now that float arithmetic works, these are useful.

## Design

### Use-after-free detection

**Approach:** In the interpreter's `memoryReader` callback (line 102), before returning a value, check if the address falls within any freed heap block. If so, push an error instead.

```typescript
// Current:
this.evaluator.setMemoryReader((address) => this.memoryValues.get(address));

// New:
this.evaluator.setMemoryReader((address) => {
  if (this.isFreedAddress(address)) {
    this.errors.push(`Use-after-free: reading from freed memory at ${formatAddress(address)}`);
    return undefined;
  }
  return this.memoryValues.get(address);
});
```

**`isFreedAddress(addr)`:** Iterate `env.getAllHeapBlocks()`, check if `block.status === 'freed'` and `addr >= block.address && addr < block.address + block.size`.

**Performance:** Called on every heap/array read. `getAllHeapBlocks()` is a Map — iterating freed blocks is O(n) where n = total allocations. For educational programs (< 100 allocations), this is fine.

**Also detect on write:** In `executeAssignment` dereference and subscript paths, check before storing in `memoryValues`.

### String functions

**Approach:** Add handlers in `createStdlib` switch. Each reads/writes char values from `memoryValues` at sequential addresses.

- `strlen(s)` — Walk from `s.data` (pointer address) counting non-zero bytes. Return count.
- `strcpy(dst, src)` — Copy bytes from src address to dst address in `memoryValues`, including null terminator. Return dst pointer.
- `strcmp(a, b)` — Compare bytes at a and b addresses. Return -1, 0, or 1.
- `strcat(dst, src)` — Find end of dst string, copy src bytes there.

**Return types:** `strlen` returns int. `strcpy`/`strcat` return `char*`. `strcmp` returns int.

### Math functions

**Approach:** Trivial stdlib handlers. Evaluate args and return `Math.*` results.

- `abs(x)` → `Math.abs(x)`, return int
- `sqrt(x)` → `Math.sqrt(x)`, return double
- `pow(x, y)` → `Math.pow(x, y)`, return double

## Files

### Modify
| File | What changes | Why |
|------|-------------|-----|
| `src/lib/interpreter/interpreter.ts` | `isFreedAddress()` helper; enhanced `memoryReader`; write-path freed checks | Use-after-free detection |
| `src/lib/interpreter/stdlib.ts` | Add `strlen`, `strcpy`, `strcmp`, `strcat`, `abs`, `sqrt`, `pow` handlers | New stdlib functions |
| `src/lib/interpreter/value-correctness.test.ts` | Tests for all three features | Verification |
| `src/lib/test-programs.ts` | Dropdown programs | UI testing |

## Steps

### Step 1: Use-after-free detection
- **What:**
  1. Add `isFreedAddress(addr: number): boolean` to Interpreter — iterates heap blocks looking for freed block containing the address
  2. Enhance `memoryReader` callback to check before returning value
  3. Add checks in `executeAssignment` dereference path (`*p = val`) and subscript path (`arr[i] = val`) — if target address is in a freed block, push error
- **Files:** `interpreter.ts`
- **Verification:** `npm test` + new tests

### Step 2: String functions
- **What:** Add cases to `createStdlib` switch:
  - `strlen`: Walk bytes from `args[0].data` using a local memReader, count until 0 or max 10000
  - `strcpy`: Copy bytes from src to dst, store in memoryValues via callback
  - `strcmp`: Compare bytes, return -1/0/1
  - `strcat`: Find end of dst, then copy src
- **Needs:** Access to `memoryValues` — pass it to `createStdlib` or add a callback parameter
- **Files:** `stdlib.ts`, `interpreter.ts` (pass memoryValues access)
- **Verification:** `npm test` + new tests

### Step 3: Math functions
- **What:** Add cases to `createStdlib` switch: `abs`, `sqrt`, `pow`. Return appropriate types (int for abs, double for sqrt/pow).
- **Files:** `stdlib.ts`
- **Verification:** `npm test` + new tests

### Step 4: Tests + dropdown programs
- **Files:** `value-correctness.test.ts`, `test-programs.ts`
- **Verification:** `npm test`

## Edge Cases

| Case | Expected behavior | How handled |
|------|-------------------|-------------|
| Read freed pointer in expression `int x = *p` | Error: "Use-after-free" | memReader check |
| Write to freed pointer `*p = 5` | Error: "Use-after-free" | Assignment dereference check |
| `arr[i]` where arr was freed | Error: "Use-after-free" | Assignment subscript check |
| `strlen(NULL)` | Error: "Null pointer" | Check `args[0].data === 0` |
| `strlen` on non-terminated string | Walk up to 10000 bytes | Cap at max length |
| `strcpy` overflow (dst too small) | Silently overflow (matches C) | No bounds check (educational: show the bug) |
| `sqrt(-1)` | Returns NaN | `Math.sqrt(-1)` = NaN, display as `NaN` |
| `pow(0, 0)` | Returns 1.0 | `Math.pow(0, 0)` = 1 |
| `abs(-2147483648)` | Returns -2147483648 (overflow) | `Math.abs` then toInt32 |

## Comprehensive Test Specification

### Use-after-free tests (value-correctness.test.ts)

**UAF-T1: Read after free produces error**
```typescript
it('use-after-free: read through freed pointer produces error', () => {
  const { errors } = run(`int main() {
    int *p = malloc(sizeof(int));
    *p = 42;
    free(p);
    int x = *p;
    return 0;
  }`);
  expect(errors.some(e => e.includes('Use-after-free') || e.includes('freed'))).toBe(true);
});
```

**UAF-T2: Write after free produces error**
```typescript
it('use-after-free: write through freed pointer produces error', () => {
  const { errors } = run(`int main() {
    int *p = malloc(sizeof(int));
    free(p);
    *p = 99;
    return 0;
  }`);
  expect(errors.some(e => e.includes('Use-after-free') || e.includes('freed'))).toBe(true);
});
```

**UAF-T3: Array access after free**
```typescript
it('use-after-free: array access after free produces error', () => {
  const { errors } = run(`int main() {
    int *arr = calloc(3, sizeof(int));
    arr[0] = 10;
    free(arr);
    int x = arr[0];
    return 0;
  }`);
  expect(errors.some(e => e.includes('Use-after-free') || e.includes('freed'))).toBe(true);
});
```

**UAF-T4: Non-freed pointer still works**
```typescript
it('reading through non-freed pointer works normally', () => {
  const { snapshots } = interpretAndBuild(`int main() {
    int *p = malloc(sizeof(int));
    *p = 42;
    int x = *p;
    free(p);
    return 0;
  }`);
  const last = snapshots[snapshots.length - 1];
  expect(findEntry(last, 'x')?.value).toBe('42');
});
```

### String function tests (value-correctness.test.ts)

**STR-T1: strlen basic**
```typescript
it('strlen returns correct length', () => {
  const { snapshots } = interpretAndBuild(`int main() {
    char *s = "hello";
    int len = strlen(s);
    return 0;
  }`);
  const last = snapshots[snapshots.length - 1];
  expect(findEntry(last, 'len')?.value).toBe('5');
});
```

**STR-T2: strlen empty string**
```typescript
it('strlen of empty string returns 0', () => {
  const { snapshots } = interpretAndBuild(`int main() {
    char *s = "";
    int len = strlen(s);
    return 0;
  }`);
  const last = snapshots[snapshots.length - 1];
  expect(findEntry(last, 'len')?.value).toBe('0');
});
```

**STR-T3: strcmp equal strings**
```typescript
it('strcmp returns 0 for equal strings', () => {
  const { snapshots } = interpretAndBuild(`int main() {
    char *a = "hello";
    char *b = "hello";
    int cmp = strcmp(a, b);
    return 0;
  }`);
  const last = snapshots[snapshots.length - 1];
  expect(findEntry(last, 'cmp')?.value).toBe('0');
});
```

**STR-T4: strcmp different strings**
```typescript
it('strcmp returns nonzero for different strings', () => {
  const { snapshots } = interpretAndBuild(`int main() {
    char *a = "abc";
    char *b = "abd";
    int cmp = strcmp(a, b);
    return 0;
  }`);
  const last = snapshots[snapshots.length - 1];
  // 'c' < 'd' → negative
  const val = parseInt(findEntry(last, 'cmp')?.value ?? '0');
  expect(val).toBeLessThan(0);
});
```

**STR-T5: strcpy copies string**
```typescript
it('strcpy copies string to destination', () => {
  const { snapshots } = interpretAndBuild(`int main() {
    char *src = "hi";
    char *dst = malloc(8);
    strcpy(dst, src);
    int len = strlen(dst);
    return 0;
  }`);
  const last = snapshots[snapshots.length - 1];
  expect(findEntry(last, 'len')?.value).toBe('2');
});
```

### Math function tests (value-correctness.test.ts)

**MATH-T1: abs positive and negative**
```typescript
it('abs returns absolute value', () => {
  const { snapshots } = interpretAndBuild(`int main() {
    int a = abs(-7);
    int b = abs(5);
    return 0;
  }`);
  const last = snapshots[snapshots.length - 1];
  expect(findEntry(last, 'a')?.value).toBe('7');
  expect(findEntry(last, 'b')?.value).toBe('5');
});
```

**MATH-T2: sqrt**
```typescript
it('sqrt returns correct value', () => {
  const { snapshots } = interpretAndBuild(`int main() {
    float x = sqrt(25.0);
    return 0;
  }`);
  const last = snapshots[snapshots.length - 1];
  expect(findEntry(last, 'x')?.value).toBe('5');
});
```

**MATH-T3: pow**
```typescript
it('pow returns correct value', () => {
  const { snapshots } = interpretAndBuild(`int main() {
    float x = pow(2.0, 10.0);
    return 0;
  }`);
  const last = snapshots[snapshots.length - 1];
  expect(findEntry(last, 'x')?.value).toBe('1024');
});
```

### Test count: 12 total

| Feature | Tests | IDs |
|---------|-------|-----|
| Use-after-free | 4 | UAF-T1 to UAF-T4 |
| String functions | 5 | STR-T1 to STR-T5 |
| Math functions | 3 | MATH-T1 to MATH-T3 |

## Verification
- [x] `npm test` passes
- [x] `npm run build` succeeds
- [x] `*p` after `free(p)` produces "Use-after-free" error
- [x] `strlen("hello")` returns 5
- [x] `strcmp("a", "b")` returns negative
- [x] `abs(-7)` returns 7
- [x] `sqrt(25.0)` returns 5.0
- [x] Existing tests unchanged (no false positives from freed-address check)
- [x] Dropdown programs work in Custom tab

## References
- [src/lib/interpreter/stdlib.ts](../../src/lib/interpreter/stdlib.ts) — Existing stdlib handlers
- [src/lib/interpreter/interpreter.ts:102](../../src/lib/interpreter/interpreter.ts) — memoryReader callback
- [src/lib/interpreter/environment.ts:132](../../src/lib/interpreter/environment.ts) — free() and heap block tracking
