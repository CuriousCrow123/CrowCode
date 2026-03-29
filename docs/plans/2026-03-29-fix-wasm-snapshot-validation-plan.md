---
title: WASM Backend Snapshot Validation
type: fix
status: active
date: 2026-03-29
---

# WASM Backend Snapshot Validation

## Context

The WASM compilation backend produces `Program` objects that may not look right in the UI. We need systematic tests that trace through every example program step-by-step, asserting exact snapshot contents at each step — not just final values.

## Design

### Approach: hand-traced ground truth

For each test program, an opus-level agent manually traces the C code and determines:
1. Exactly which steps should be generated
2. What ops each step should contain
3. What the snapshot should look like after each step

These hand-traced expectations become the test assertions. Neither the interpreter nor the WASM backend is trusted as a reference — the C semantics are the source of truth.

### Diagnostic findings

Running simple programs through the WASM backend pipeline (in Vitest, loading xcc from filesystem) confirmed the basic pipeline works:

```
int main() { int x = 5; x = 10; return 0; }
→ Step 0 (line 0): add(main), add(Heap)
→ Step 1 (line 1): add(x=5)
→ Step 2 (line 2): set(main::x=10)
→ Step 3 (line 3): rm(main)
```

Function calls also work correctly: `add(10, 20)` → scope push, params a=10/b=20, result=30, scope pop, x=30.

### What to assert per step

For each step in the expected trace:

| Field | Assertion |
|-------|-----------|
| `location.line` | Exact line number |
| `ops` | Exact list of ops — op type, target ID, value |
| Snapshot after step | Full entry tree — names, types, values, children |

### Test harness design

```typescript
type ExpectedStep = {
    line: number;
    ops: string[];  // Human-readable: "add(main::x=42)", "set(main::x=10)", "rm(main)"
    snapshot: Record<string, string>;  // name → value for all visible variables
};

function assertProgram(program: Program, expected: ExpectedStep[]) {
    // 1. validateProgram() passes
    // 2. buildSnapshots() produces no warnings
    // 3. For each step: line matches, ops match, snapshot values match
}
```

### Loading xcc in tests

Tests load xcc artifacts from the filesystem (not `fetch()`):
```typescript
const compilerBytes = readFileSync('static/xcc/cc.wasm');
const headers = readFileSync('static/xcc/include/stdio.h');
// etc.
```

The diagnostic test already proves this works in Vitest (tests complete in ~37ms per program after initial load).

## Hand-Traced Program Expectations

### p1.1 — Integer Lifecycle

```c
int main() {
    int a = 42;          // step: decl a=42
    int b = -7;          // step: decl b=-7
    int c = a + b;       // step: decl c=35
    c *= 2;              // step: set c=70
    c %= 9;              // step: set c=7
    int d = c << 3;      // step: decl d=56
    d = d >> 1;          // step: set d=28
    d = ~d;              // step: set d=-29
    return 0;            // step: pop scope
}
```

**Final values:** `a=42, b=-7, c=7, d=-29`

### p1.2 — Char and Casting

```c
int main() {
    char c = 'A';         // decl c='A' (or 65)
    int x = c + 1;        // decl x=66
    char d = (char)300;   // decl d=44 (300 % 256 = 44)
    int big = 100000;     // decl big=100000
    char narrow = (char)big; // decl narrow=-96 (100000 & 0xFF = 0xA0 = -96 signed)
    return 0;
}
```

**Final values:** `c='A'(65), x=66, d=44, big=100000, narrow=-96`

### p1.3 — All Compound Operators

```c
int main() {
    int x = 100;    // decl x=100
    x += 10;        // set x=110
    x -= 20;        // set x=90
    x *= 3;         // set x=270
    x /= 9;         // set x=30
    x %= 7;         // set x=2
    x &= 255;       // set x=2
    x |= 16;        // set x=18
    x ^= 18;        // set x=0
    x = 8;          // set x=8
    x <<= 2;        // set x=32
    x >>= 1;        // set x=16
    return 0;
}
```

**Final value:** `x=16`

### p1.4 — Increment / Decrement

```c
int main() {
    int a = 5;    // decl a=5
    a++;          // set a=6
    a++;          // set a=7
    ++a;          // set a=8
    a--;          // set a=7
    --a;          // set a=6
    int b = a;    // decl b=6
    a++;          // set a=7
    int c = a;    // decl c=7
    return 0;
}
```

**Final values:** `a=7, b=6, c=7`

### p2.1 — Simple Struct

```c
int main() {
    struct Point p = {10, 20};   // decl p with children x=10, y=20
    p.x = 30;                    // set p (x=30, y=20)
    p.y = p.x + 5;              // set p (x=30, y=35)
    return 0;
}
```

**Final values:** `p.x=30, p.y=35`

### p3.1 — Array Init and Loop

```c
int main() {
    int arr[5] = {10, 20, 30, 40, 50};  // decl arr with 5 children
    arr[0] = 99;                          // set arr ([0]=99)
    arr[4] = arr[0] + arr[1];            // set arr ([4]=119)
    int sum = 0;                          // decl sum=0
    for (int i = 0; i < 5; i++) {        // loop: i=0..4, sum accumulates
        sum += arr[i];
    }
    // sum = 99 + 20 + 30 + 40 + 119 = 308
    return 0;
}
```

**Final values:** `arr=[99,20,30,40,119], sum=308`

### p6.1 — Simple Function Call

```c
int add(int a, int b) {
    int result = a + b;     // scope "add": a=10, b=20, result=30
    return result;
}
int main() {
    int x = add(10, 20);   // scope "main": x=30
    int y = add(x, 5);     // scope "add" again: a=30, b=5, result=35; then y=35
    return 0;
}
```

**Final values in main:** `x=30, y=35`

### p6.4 — Recursive Factorial

```c
int factorial(int n) {
    if (n <= 1) return 1;
    return n * factorial(n - 1);
}
int main() {
    int result = factorial(5);  // 5*4*3*2*1 = 120
    return 0;
}
```

**Final value:** `result=120`

### p7.1 — If/Else Branching

```c
int main() {
    int x = 10;   // decl x=10
    int y = 0;    // decl y=0
    // x > 5 is true → y = 1
    // x < 5 is false → y = 20
    return 0;
}
```

**Final values:** `x=10, y=20`

### p7.2 — While Loop

```c
int main() {
    int n = 5;    // decl n=5
    int sum = 0;  // decl sum=0
    // loop: n=5→sum=5, n=4→sum=9, n=3→sum=12, n=2→sum=14, n=1→sum=15, n=0→exit
    return 0;
}
```

**Final values:** `n=0, sum=15`

### p7.3 — Nested Loops

```c
int main() {
    int total = 0;  // decl total=0
    // 3×3 = 9 iterations, each total += 1
    return 0;
}
```

**Final value:** `total=9`

### p7.4 — Break and Continue

```c
int main() {
    int sum = 0;
    // i=0: sum=0, i=1: sum=1, i=2: sum=3, i=3: continue, i=4: sum=7, i=5: sum=12, i=6: sum=18, i=7: break
    return 0;
}
```

**Final value:** `sum=18`

### p13.3 — Float Arithmetic

```c
int main() {
    float pi = 3.14159;       // ~3.14159 (f32 precision)
    float r = 5.0;
    float area = pi * r * r;  // ~78.53975
    int truncated = (int)area; // 78
    float half = 1.0 / 2.0;   // 0.5
    return 0;
}
```

**Final values:** `pi≈3.14159, r=5, area≈78.5398, truncated=78, half=0.5`

### p13.5 — Chained Assignment

```c
int main() {
    int a = 0, b = 0, c = 0;
    a = b = c = 42;    // c=42, b=42, a=42
    a = b = c + 8;     // c+8=50, b=50, a=50
    return 0;
}
```

**Final values:** `a=50, b=50, c=42`

### p4.1 — malloc/free Lifecycle

```c
int main() {
    int *p = malloc(sizeof(int));   // heap block appears
    *p = 42;                         // heap value = 42
    *p = *p + 8;                     // heap value = 50
    free(p);                         // heap status = freed
    return 0;
}
```

**Final state:** `p` is a pointer, heap block is freed

### p4.2 — calloc Zero-Init

```c
int main() {
    int *arr = calloc(4, sizeof(int));  // 4 elements all 0
    arr[0] = 10; arr[1] = 20; arr[2] = 30; arr[3] = 40;
    free(arr);    // freed
    return 0;
}
```

### p12.1 — Bubble Sort

```c
int main() {
    int arr[5] = {5, 3, 1, 4, 2};
    // After sort: {1, 2, 3, 4, 5}
    return 0;
}
```

**Final values:** `arr=[1,2,3,4,5]`

### p12.2 — Multi-Function Clamp

```c
int main() {
    int a = clamp(15, 0, 10);  // max(0, min(15,10)) = max(0,10) = 10
    int b = clamp(-5, 0, 10);  // max(0, min(-5,10)) = max(0,-5) = 0
    int c = clamp(5, 0, 10);   // max(0, min(5,10)) = max(0,5) = 5
    return 0;
}
```

**Final values:** `a=10, b=0, c=5`

### p12.5 — Recursive Fibonacci

```c
int main() {
    int a = fib(0);   // 0
    int b = fib(1);   // 1
    int c = fib(6);   // 8
    return 0;
}
```

**Final values:** `a=0, b=1, c=8`

## Files

### Create

| File | Purpose |
|------|---------|
| `src/lib/wasm-backend/integration.test.ts` | Step-by-step validation of every program |

### Modify

| File | What changes | Why |
|------|-------------|-----|
| `src/lib/wasm-backend/transformer.ts` | Bug fixes found during testing | Fix incorrect instrumentation |
| `src/lib/wasm-backend/op-collector.ts` | Bug fixes found during testing | Fix incorrect memory reading |

## Steps

### Step 1: Build the test harness with filesystem-based xcc loading

- **What:** Create `integration.test.ts` with a `runWasmPipeline(source)` helper that loads xcc from `static/xcc/` via `readFileSync`, transforms → compiles → executes, returns `{ program, snapshots, errors }`.
- **Files:** `integration.test.ts`
- **Depends on:** Nothing (diagnostic.test.ts already proves this works)
- **Substeps:**
  1. Copy the working pipeline from `diagnostic.test.ts` into a reusable helper
  2. Add `assertStep(snapshot, expected)` helper that checks variable names and values
  3. Add `assertFinalValues(snapshots, expected)` helper for quick final-state checks
  4. Add `dumpProgram(program, snapshots)` for readable failure output
- **Verification:** Helper compiles and runs one simple program

### Step 2: Tier 1 — scalar and control flow programs (14 programs)

- **What:** Add tests for p1.1–p1.4, p2.1, p3.1, p6.1, p6.4, p7.1–p7.4, p13.3, p13.5
- **Per test:**
  1. Call `runWasmPipeline(source)`
  2. Assert no errors
  3. Assert `validateProgram()` passes
  4. Assert step count is reasonable
  5. Assert final snapshot variable values match hand-traced expectations
  6. For key programs (p1.1, p6.1): assert step-by-step intermediate values
- **Depends on:** Step 1
- **Verification:** All 14 tests pass

### Step 3: Tier 2 — heap programs (4 programs)

- **What:** Add tests for p4.1, p4.2, p4.4, p5.1
- **Per test:** Same as Tier 1, plus:
  - Assert heap entries appear with correct status (allocated → freed)
  - Assert heap block sizes match
- **Depends on:** Step 2
- **Verification:** All 4 tests pass

### Step 4: Tier 3 — complex programs (10 programs)

- **What:** Add tests for p2.2, p8.2, p11.2, p11.5, p12.1, p12.2, p12.5, p13.1, p13.4, p13.7
- **Depends on:** Step 3
- **Verification:** All pass, `npm test` clean

### Step 5: Fix bugs found during testing

- **What:** For each failing test, diagnose the root cause:
  1. Print the instrumented source — is the transformer injecting correctly?
  2. Check compile errors — does xcc accept the instrumented code?
  3. Dump step/ops — are ops in the right order?
  4. Dump snapshots — are values being read correctly from WASM memory?
- **Fix pattern:**
  - Transformer bug → fix in `transformer.ts`, add regression test to `transformer.test.ts`
  - Op collector bug → fix in `op-collector.ts`, add unit test
  - WASI bug → fix in `wasi-shim.ts`

## Edge Cases

| Case | Expected behavior | How handled |
|------|-------------------|-------------|
| `#include <stdio.h>` but no printf | Compiles fine, just pulls in headers | No special handling |
| xcc float is f32, interpreter uses f64 | Values may differ slightly | Use `toBeCloseTo()` with tolerance |
| Struct children not populated | Op collector doesn't know struct layout from WASM alone | Mark as known limitation, fix in follow-up |
| `char` displayed as `'A'` vs `65` | Both are valid | Accept either format |
| Variable shadowing | Inner scope gets different ID | Test by name within innermost scope |
| Chained assignment `a = b = c = 42` | Transformer must emit __crow_set for all three | Test explicitly |

## Verification

- [ ] `npm test` passes (all existing + new integration tests)
- [ ] All Tier 1 programs (14): correct final values
- [ ] All Tier 2 programs (4): correct heap lifecycle
- [ ] All Tier 3 programs (10): correct final values
- [ ] Step-by-step validation for p1.1, p6.1 (intermediate snapshots)
- [ ] `validateProgram()` passes for every program
- [ ] `buildSnapshots()` produces no warnings for every program
- [ ] Diagnostic test file removed after validation complete

## References

- [Core types](../../src/lib/api/types.ts)
- [validateProgram](../../src/lib/engine/validate.ts)
- [buildSnapshots](../../src/lib/engine/snapshot.ts)
- [Diagnostic test](../../src/lib/wasm-backend/diagnostic.test.ts) — proves pipeline works in Vitest
- [WASM backend plan](./2026-03-29-feat-wasm-compilation-backend-plan.md)
