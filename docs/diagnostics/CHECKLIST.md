# WASM Diagnostic Checklist

| Program | Status | Bugs | Notes |
|---------|--------|------|-------|
| custom — Minimal Scalar | FIXED | BUG-custom-1 (fixed) | Lines off by 1 → fixed in onStep() |
| p1.1 — Integer Lifecycle | FIXED | BUG-p1.1-1 (fixed) | Lines off by 1 → fixed |
| p1.3 — All Compound Operators | FIXED | BUG-p1.3-1 (fixed) | Lines off by 1 → fixed |
| p1.4 — Increment / Decrement | FIXED | BUG-p1.4-1 (fixed) | Lines off by 1 → fixed |
| p7.1 — If / Else Branching | PASS | — | Condition lines have no step (empty) |
| p7.2 — While Loop | PASS | — | Condition line has no step (empty) |
| p7.3 — Nested Loops | PASS | — | Redundant setValue pairs in loop updates |
| p7.4 — Break and Continue | PASS | — | continue/break branches produce empty steps |
| p6.1 — Simple Function Call | PASS | — | Scope push/pop, params correct |
| p6.4 — Recursive Factorial | PASS | — | result=120 |
| p12.2 — Multi-Function Clamp | PASS | — | a=10, b=0, c=5 |
| p12.5 — Recursive Fibonacci | PASS | — | a=0, b=1, c=8 |
| p1.2 — Char and Casting | PASS | — | c='A', x=66, d=44, big=100000, narrow=-96 |
| p13.3 — Float Arithmetic | PASS | — | pi≈3.14, area≈78.54, truncated=78, half=0.5 |
| p13.4 — Uninitialized Variable | PASS | — | x=15, y=10, z=30 |
| p13.5 — Chained Assignment | FAIL (1 bug) | BUG-p13.5-1 | b,c not tracked (known limitation) |
| p3.1 — Array Init and Loop | PASS | — | arr=[99,20,30,40,119], sum=308 |
| p3.3 — Array Squared in Loop | PASS | — | data=[1,4,9,16], total=30 |
| p12.1 — Bubble Sort | PASS | — | arr=[1,2,3,4,5] |
| p13.7 — 2D Array | NOT STARTED | | |
| p2.1 — Simple Struct | FAIL (1 bug) | BUG-p2.1-1 | Struct has no children (no type registry) |
| p2.2 — Nested Structs | FAIL (1 bug) | BUG-p2.2-1 | Same: struct no children |
| p4.1 — malloc / free Lifecycle | PASS | — | Heap block allocated then freed |
| p4.2 — calloc Zero-Init | PASS | — | Heap block allocated then freed |
| p4.4 — Heap Array with Loop | PASS | — | n=5 |
| p10.3 — Memory Leak Detection | PASS | — | b leaked correctly |
| p5.1 — Heap Struct via Pointer | FAIL (2 bugs) | BUG-p5.1-1,2 | Arrow corrupts ptr, nested field skipped |
| p5.3 — Full Memory Basics | NOT STARTED | | |
| p8.2 — Variable Shadowing | FAIL (1 bug) | BUG-p8.2-1 | x shows 25 not 10 (inner shadow overwrites display) |
| p13.1 — Switch / Case | PASS | — | day=3, type=1 |
| p11.2 — Matrix Identity | NOT STARTED | | |
| p11.5 — Fibonacci Array | PASS | — | fib=[0,1,1,2,3,5,8,13,21,34] |
| p15.1 — Entity System | FAIL (5 bugs) | BUG-p15.1-1..5 | Arrow ptr corrupt, nested fields skip, no struct children, ptr param type |
| p16.1 — Basic printf | NOT STARTED | | |
| p16.2 — puts and putchar | NOT STARTED | | |
| p16.3 — getchar Loop | NOT STARTED | | |
| p16.4 — scanf + printf | NOT STARTED | | |
| p16.6 — printf Format Specifiers | NOT STARTED | | |
| p13.2 — String Literal | NOT STARTED | | |
| p13.6 — Function Pointer | NOT STARTED | | |
| p13.8 — Array-to-Pointer Decay | NOT STARTED | | |
| p14.1 — Use-After-Free | NOT STARTED | | |
| p14.2 — String Functions | NOT STARTED | | |
| p14.3 — Math Functions | NOT STARTED | | |
| p9.1 — sprintf Formats | NOT STARTED | | |
| p16.5 — scanf \n Residue | NOT STARTED | | |
| p16.7 — Grade Calculator | NOT STARTED | | |

## Bug Summary

| Bug ID | Description | Root Cause | Component | Status |
|--------|-------------|------------|-----------|--------|
| BUG-custom-1 | Line numbers off by 1 | onStep flushes ops at previous line | op-collector | **FIXED** |
| BUG-p13.5-1 | Chained assignment only tracks outermost | extractSetTarget only emits __crow_set for LHS | transformer | Known limitation |
| BUG-p2.1-1 | Struct has no children | buildChildren has no struct type registry | op-collector | Open |
| BUG-p5.1-1 | Arrow field corrupts pointer display | __crow_set("p", p, ...) reads heap not stack | transformer | Open |
| BUG-p5.1-2 | Nested field targets unregistered name | extractSetTarget doesn't walk to root var | transformer | Open |
| BUG-p15.1-5 | Pointer param type loses `*` | extractParamType ignores pointer_declarator | transformer | Open |
| BUG-p8.2-1 | Variable shadowing: inner x overwrites display | No push/pop scope for anonymous blocks | transformer | Open |
