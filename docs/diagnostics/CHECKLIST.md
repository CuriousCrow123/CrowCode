# WASM Diagnostic Checklist

## Program Status

| Program | Status | Notes |
|---------|--------|-------|
| custom — Minimal Scalar | PASS | Values correct. Return now has own step. |
| p1.1 — Integer Lifecycle | PASS | Values correct. Return visible. |
| p1.3 — All Compound Operators | PASS | Values correct. Return visible. |
| p1.4 — Increment / Decrement | PASS | Values correct. Return visible. |
| p7.1 — If / Else Branching | PASS | Condition steps now visible. Return visible. |
| p7.2 — While Loop | PASS | Condition steps visible. No redundant ops. |
| p7.3 — Nested Loops | PASS | No redundant setValue pairs. Loop vars correct. |
| p7.4 — Break and Continue | PASS | Condition steps visible. No redundant ops. |
| p6.1 — Simple Function Call | PASS | Scope push/pop correct, x=30, y=35. |
| p6.4 — Recursive Factorial | PARTIAL | Frames stack correctly. result=120. Return steps emit but share line with condition in compact if. |
| p12.2 — Multi-Function Clamp | PARTIAL | Frames stack correctly. a=10, b=0, c=5. Same return/condition line overlap. |
| p12.5 — Recursive Fibonacci | PARTIAL | Frames stack correctly. a=0, b=1, c=8. Same return/condition line overlap. |
| p1.2 — Char and Casting | PASS | c='A', x=66, d=44, big=100000, narrow=-96. |
| p13.3 — Float Arithmetic | PASS | pi≈3.14, area≈78.54, truncated=78, half=0.5. |
| p13.4 — Uninitialized Variable | NOTE | x=15, y=10, z=30 correct. Uninit `int x` shows 0 (WASM zero-init). |
| p13.5 — Chained Assignment | PASS | All targets tracked: a=b=c=42 all show 42. a=b=c+8 → a=50, b=50, c=42. |
| p3.1 — Array Init and Loop | PASS | arr=[99,20,30,40,119], sum=308. No redundant loop ops. |
| p3.3 — Array Squared in Loop | PASS | data=[1,4,9,16], total=30. Clean loop tracking. |
| p12.1 — Bubble Sort | PASS | arr=[1,2,3,4,5]. Clean nested loop tracking. |
| p13.7 — 2D Array | PASS | Type shows `int[3][3]`. Children nest correctly (3×3). trace=3. |
| p2.1 — Simple Struct | PASS | Struct children visible: x=30, y=35. |
| p2.2 — Nested Structs | BUGS | Children visible at declaration. Field updates after mutation stale (nested struct setValue doesn't recurse). |
| p4.1 — malloc / free Lifecycle | PASS | *p=42 visible in heap. *p=*p+8 → 50. Free works. |
| p4.2 — calloc Zero-Init | PASS | Entry labeled `calloc(4, 4)`. Heap value visible. |
| p4.4 — Heap Array with Loop | BUGS | Heap value shows 0 for array elements (pointer arithmetic indexing not tracked). |
| p10.3 — Memory Leak Detection | PASS | Leak correctly detected. Heap value may be visible for simple cases. |
| p5.1 — Heap Struct via Pointer | BUGS | Stack pointer correct. Heap struct has no children (heap + struct combined not supported). |
| p5.3 — Full Memory Basics | PARTIAL | Stack struct children work. Heap struct children missing. |
| p8.2 — Variable Shadowing | PASS | Inner block creates own scope. Inner x=25, outer x=10 preserved. y=10 correct. |
| p13.1 — Switch / Case | PASS | day=3, type=1. |
| p11.2 — Matrix Identity | PASS | Heap calloc/free lifecycle correct. sum=3. |
| p11.5 — Fibonacci Array | PASS | fib=[0,1,1,2,3,5,8,13,21,34]. |
| p15.1 — Entity System | PARTIAL | Stack struct children correct. Heap struct children missing. |
| p16.1 — Basic printf | PASS | printf output correct, values correct. |
| p16.2 — puts and putchar | PASS | Steps now visible. |
| p16.3 — getchar Loop | PASS | Steps visible. |
| p16.4 — scanf + printf | PASS | scanf values now appear: x=10, y=20. |
| p16.5 — scanf \n Residue | PASS | scanf values now visible. |
| p16.6 — printf Format Specifiers | PASS | All format specifiers correct. |
| p16.7 — Grade Calculator | PASS | scanf values tracked through loop: score=85,92,78,-1. avg=85. |
| p13.2 — String Literal | PASS | Pointer values correct. |
| p13.6 — Function Pointer | PASS | Compiles successfully. a=13, b=7. |
| p13.8 — Array-to-Pointer Decay | PASS | Pointer arithmetic correct. |
| p14.1 — Use-After-Free | PASS | *p=42 now visible in heap. Use-after-free detection still not implemented. |
| p14.2 — String Functions | BUGS | strcpy step visible but 0 ops (buffer write not tracked). |
| p14.3 — Math Functions | PASS | abs, sqrt, pow correct. |
| p9.1 — sprintf Formats | BUGS | Steps now visible (SYS-12 fixed) but 0 ops — buffer contents not tracked. |

## Bug Summary

### Fixed (this round)

| Bug ID | Description | Fix |
|--------|-------------|-----|
| SYS-1 | Struct fields invisible | Added struct type registry from tree-sitter; buildChildren + updateChildValues handle structs |
| SYS-2 | Heap dereference values invisible | onSet checks pointer type, finds heap block, emits setValue for heap entry |
| SYS-3 | Recursive frames not stacked | instrumentReturn adds __crow_step before pop_scope |
| SYS-4 | Return line not shown | instrumentReturn + instrumentFunction trailing return both emit step |
| SYS-5 | For-loop exit increment not captured | Removed explicit loop update tracking; re-declaration path handles it |
| SYS-6 | Condition/branch steps invisible | onStep always emits (removed empty-step filter) |
| SYS-7 | Redundant setValue on loop increment | Removed explicit loop update tracking |
| SYS-8 | Variable shadowing not modeled | compound_statement inside function body gets push/pop scope |
| SYS-9 | Chained assignment only tracks outermost | collectChainedTargets walks RHS recursively |
| SYS-10 | calloc shown as malloc | onCalloc patches last addEntry op with calloc label |
| SYS-11 | scanf values not shown in snapshots | emitSetValueForAddr after each scanf memory write |
| SYS-12 | sprintf/strcpy steps collapsed | Fixed by SYS-6 (always emit steps). Buffer content tracking is separate issue. |
| SYS-13 | Function pointer declarator not handled | parseDeclName handles function_declarator + parenthesized_declarator |
| SYS-14 | 2D array type/children wrong | parseDeclName accumulates array dimensions; buildChildren recurses |

### Fixed (prior round)

| Bug ID | Description |
|--------|-------------|
| BUG-custom-1 | Line numbers off by 1 |
| BUG-p5.1-1 | Arrow field corrupts pointer display |
| BUS-p5.1-2 | Nested field targets unregistered name |
| BUG-p15.1-5 | Pointer param type loses `*` |

### Open — Remaining

| Bug ID | Description | Root Cause | Programs |
|--------|-------------|------------|----------|
| REM-1 | Nested struct field updates stale | updateChildValues doesn't recurse into nested struct fields | p2.2 |
| REM-2 | Heap struct children missing | Heap entries have no type info to look up struct fields | p5.1, p5.3, p15.1 |
| REM-3 | Heap array element values not tracked | Pointer arithmetic indexing (p[i]) not resolved to heap block offset | p4.4 |
| REM-4 | sprintf/strcpy buffer content not tracked | Library calls don't emit ops for destination buffer | p9.1, p14.2 |
| REM-5 | Return/condition line overlap in compact if | `if (n<=1) { return 1; }` — return step shares line with condition | p6.4, p12.2, p12.5 |

### Informational (Won't Fix)

| Bug ID | Description | Reason |
|--------|-------------|--------|
| INFO-1 | Uninitialized vars show 0 | WASM zero-initializes stack — correct at runtime level |
| SYS-15 | Use-after-free not detected | Would need runtime checking; deferred |
