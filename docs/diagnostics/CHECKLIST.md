# WASM Diagnostic Checklist

## Program Status

| Program | Status | Notes |
|---------|--------|-------|
| custom — Minimal Scalar | PASS | Values correct. Return line mismatch (systemic). |
| p1.1 — Integer Lifecycle | PASS | Values correct. Return line mismatch. |
| p1.3 — All Compound Operators | PASS | Values correct. Return line mismatch. |
| p1.4 — Increment / Decrement | PASS | Values correct. Return line mismatch. |
| p7.1 — If / Else Branching | PASS | Condition lines invisible (empty steps omitted). |
| p7.2 — While Loop | PASS | Condition lines invisible. |
| p7.3 — Nested Loops | BUGS | Redundant setValue pairs; loop exit var not captured. |
| p7.4 — Break and Continue | BUGS | continue/break invisible; redundant setValue. |
| p6.1 — Simple Function Call | PASS | Scope push/pop correct, x=30, y=35. |
| p6.4 — Recursive Factorial | BUGS | Recursive frames not stacked; base case invisible. result=120 correct. |
| p12.2 — Multi-Function Clamp | BUGS | Nested call frames not stacked; inner function body invisible. a=10, b=0, c=5 correct. |
| p12.5 — Recursive Fibonacci | BUGS | Recursive frames not stacked; base cases invisible. a=0, b=1, c=8 correct. |
| p1.2 — Char and Casting | PASS | c='A', x=66, d=44, big=100000, narrow=-96. |
| p13.3 — Float Arithmetic | PASS | pi≈3.14, area≈78.54, truncated=78, half=0.5. |
| p13.4 — Uninitialized Variable | NOTE | x=15, y=10, z=30 correct. Uninit `int x` shows 0 (WASM zero-init). |
| p13.5 — Chained Assignment | BUGS | b,c not tracked in chained assignment (known limitation). |
| p3.1 — Array Init and Loop | BUGS | arr=[99,20,30,40,119], sum=308 correct. Loop exit var not captured. |
| p3.3 — Array Squared in Loop | BUGS | data=[1,4,9,16], total=30 correct. Loop exit var not captured. |
| p12.1 — Bubble Sort | BUGS | arr=[1,2,3,4,5] correct. Loop exit vars not captured. |
| p13.7 — 2D Array | NOT STARTED | |
| p2.1 — Simple Struct | BUGS | Struct has no children (no type registry). |
| p2.2 — Nested Structs | BUGS | Same: struct no children. |
| p4.1 — malloc / free Lifecycle | BUGS | Heap entry stays val= empty; *p=42 not visible in heap. Free works. |
| p4.2 — calloc Zero-Init | BUGS | calloc shown as malloc. Heap value invisible. |
| p4.4 — Heap Array with Loop | BUGS | Heap values invisible. n=5 correct. |
| p10.3 — Memory Leak Detection | PASS | Leak correctly detected. Heap values invisible. |
| p5.1 — Heap Struct via Pointer | BUGS | Pointer value correct (fixed). Heap value invisible. Struct no children. |
| p5.3 — Full Memory Basics | NOT STARTED | |
| p8.2 — Variable Shadowing | BUGS | Inner x overwrites display of outer x. y=10 correct (runtime ok). |
| p13.1 — Switch / Case | PASS | day=3, type=1. |
| p11.2 — Matrix Identity | NOT STARTED | |
| p11.5 — Fibonacci Array | PASS | fib=[0,1,1,2,3,5,8,13,21,34]. |
| p15.1 — Entity System | BUGS | Arrow+nested+param fixed. Struct no children. Heap values invisible. |
| p16.1 — Basic printf | NOT STARTED | |
| p16.2 — puts and putchar | NOT STARTED | |
| p16.3 — getchar Loop | NOT STARTED | |
| p16.4 — scanf + printf | NOT STARTED | |
| p16.6 — printf Format Specifiers | NOT STARTED | |
| p13.2 — String Literal | NOT STARTED | |
| p13.6 — Function Pointer | NOT STARTED | |
| p13.8 — Array-to-Pointer Decay | NOT STARTED | |
| p14.1 — Use-After-Free | NOT STARTED | |
| p14.2 — String Functions | NOT STARTED | |
| p14.3 — Math Functions | NOT STARTED | |
| p9.1 — sprintf Formats | NOT STARTED | |
| p16.5 — scanf \n Residue | NOT STARTED | |
| p16.7 — Grade Calculator | NOT STARTED | |

## Bug Summary

### Fixed

| Bug ID | Description | Root Cause | Component |
|--------|-------------|------------|-----------|
| BUG-custom-1 | Line numbers off by 1 | onStep flushes ops at previous line | op-collector |
| BUG-p5.1-1 | Arrow field corrupts pointer display | `__crow_set("p", p, ...)` reads heap not stack | transformer |
| BUG-p5.1-2 | Nested field targets unregistered name | extractSetTarget doesn't walk to root var | transformer |
| BUG-p15.1-5 | Pointer param type loses `*` | extractParamType ignores pointer_declarator | transformer |

### Open — Systemic

| Bug ID | Description | Root Cause | Component | Programs Affected |
|--------|-------------|------------|-----------|-------------------|
| SYS-1 | Struct fields invisible | buildChildren has no struct type registry | op-collector | p2.1, p2.2, p5.1, p15.1 |
| SYS-2 | Heap dereference values invisible | `*p=42` records setValue on pointer, not heap entry | op-collector | p4.1, p4.2, p4.4, p5.1, p10.3, p15.1 |
| SYS-3 | Recursive frames not stacked | `__crow_pop_scope()` before `return` destroys caller frame before callee enters | transformer | p6.4, p12.2, p12.5 |
| SYS-4 | Return line not shown | pop_scope injected before return; no __crow_step for return line | transformer | All programs |
| SYS-5 | For-loop exit increment not captured | `__crow_set` fires before C i++; exit increment never recorded | transformer | p3.1, p3.3, p7.3, p12.1 |
| SYS-6 | Condition/branch steps invisible | Empty steps (no ops) silently omitted | op-collector | p7.1, p7.2, p7.4, p6.4, p12.2, p12.5 |
| SYS-7 | Redundant setValue on loop increment | Explicit `__crow_set` + auto-detected re-decl both fire | transformer | p7.3, p7.4 |
| SYS-8 | Variable shadowing not modeled | No push/pop scope for anonymous blocks | transformer | p8.2 |
| SYS-9 | Chained assignment only tracks outermost | extractSetTarget only emits `__crow_set` for LHS | transformer | p13.5 |
| SYS-10 | calloc shown as malloc | onCalloc delegates to onMalloc | op-collector | p4.2 |

### Open — Minor / Informational

| Bug ID | Description | Component | Programs |
|--------|-------------|-----------|----------|
| INFO-1 | Uninitialized vars show 0 (WASM zero-init) | Runtime | p13.4 |
| INFO-2 | Base case branch decisions invisible in recursive functions | transformer | p6.4, p12.5 |
