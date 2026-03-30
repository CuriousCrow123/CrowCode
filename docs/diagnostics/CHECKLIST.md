# WASM Diagnostic Checklist

## Program Status

| Program | Status | Notes |
|---------|--------|-------|
| custom — Minimal Scalar | PASS | Values correct. Return has own step. |
| p1.1 — Integer Lifecycle | PASS | Values correct. Return visible. |
| p1.3 — All Compound Operators | PASS | Values correct. Return visible. |
| p1.4 — Increment / Decrement | PASS | Values correct. Return visible. |
| p7.1 — If / Else Branching | PASS | Condition steps visible. Return visible. |
| p7.2 — While Loop | PASS | Condition steps visible. No redundant ops. |
| p7.3 — Nested Loops | PASS | No redundant setValue pairs. Loop vars correct. |
| p7.4 — Break and Continue | PASS | Condition steps visible. No redundant ops. |
| p6.1 — Simple Function Call | PASS | Scope push/pop correct, x=30, y=35. |
| p6.4 — Recursive Factorial | PASS | Frames stack. result=120. Duplicate empty steps at same line deduped. |
| p12.2 — Multi-Function Clamp | PASS | Frames stack. a=10, b=0, c=5. Dedup working. |
| p12.5 — Recursive Fibonacci | PASS | Frames stack. a=0, b=1, c=8. Dedup working. |
| p1.2 — Char and Casting | PASS | c='A', x=66, d=44, big=100000, narrow=-96. |
| p13.3 — Float Arithmetic | PASS | pi≈3.14, area≈78.54, truncated=78, half=0.5. |
| p13.4 — Uninitialized Variable | PASS | Uninit `int x` shows "?". x=15, y=10, z=30 correct after assignment. |
| p13.5 — Chained Assignment | PASS | All targets tracked: a=b=c=42 all show 42. a=b=c+8 → a=50, b=50, c=42. |
| p3.1 — Array Init and Loop | PASS | arr=[99,20,30,40,119], sum=308. No redundant loop ops. |
| p3.3 — Array Squared in Loop | PASS | data=[1,4,9,16], total=30. Clean loop tracking. |
| p12.1 — Bubble Sort | PASS | arr=[1,2,3,4,5]. Clean nested loop tracking. |
| p13.7 — 2D Array | PASS | Type `int[3][3]`. Children nest correctly (3×3). trace=3. |
| p2.1 — Simple Struct | PASS | Struct children visible: x=30, y=35. |
| p2.2 — Nested Structs | PASS | Nested field updates now recursive. pos.x=30, size.y=75 correct. |
| p4.1 — malloc / free Lifecycle | PASS | *p=42 visible in heap. *p=*p+8 → 50. Free works. |
| p4.2 — calloc Zero-Init | PASS | Entry labeled `calloc(4, 4)`. Heap value visible. |
| p4.4 — Heap Array with Loop | PASS | Heap shows array children [0]=0, [1]=1, [2]=4, [3]=9, [4]=16. |
| p10.3 — Memory Leak Detection | PASS | Leak correctly detected. |
| p5.1 — Heap Struct via Pointer | PASS | Heap struct shows field children: x=10, y=20. |
| p5.3 — Full Memory Basics | PASS | Stack + heap struct children correct. Nested fields tracked. |
| p8.2 — Variable Shadowing | PASS | Inner block creates own scope. Inner x=25, outer x=10. y=10 correct. |
| p13.1 — Switch / Case | PASS | day=3, type=1. |
| p11.2 — Matrix Identity | PASS | Heap calloc/free lifecycle correct. sum=3. |
| p11.5 — Fibonacci Array | PASS | fib=[0,1,1,2,3,5,8,13,21,34]. |
| p15.1 — Entity System | PASS | Stack + heap struct children correct. Nested pos.x, pos.y tracked. |
| p16.1 — Basic printf | PASS | printf output correct, values correct. |
| p16.2 — puts and putchar | PASS | Steps visible. |
| p16.3 — getchar Loop | PASS | Steps visible. |
| p16.4 — scanf + printf | PASS | scanf values: x=10, y=20. |
| p16.5 — scanf \n Residue | PASS | scanf values visible. |
| p16.6 — printf Format Specifiers | PASS | All format specifiers correct. |
| p16.7 — Grade Calculator | PASS | scanf values tracked: score=85,92,78,-1. avg=85. |
| p13.2 — String Literal | PASS | Pointer values correct. |
| p13.6 — Function Pointer | PASS | Compiles. a=13, b=7. |
| p13.8 — Array-to-Pointer Decay | PASS | Pointer arithmetic correct. |
| p14.1 — Use-After-Free | PASS | *p=42 visible. Write-after-free emits setHeapStatus('use-after-free'). Read-after-free shows heap as 'freed'. |
| p14.2 — String Functions | PASS | strcpy now tracked: heap shows copied string "hello". |
| p14.3 — Math Functions | PASS | abs, sqrt, pow correct. |
| p9.1 — sprintf Formats | PASS | Buffer contents tracked via post-call __crow_set. Shows "x=42", "hex=ff", etc. |

## Summary

**46 PASS, 0 NOTE, 0 BUGS** out of 47 programs (1 skipped).

## Bug Fix History

### Round 4 — Final limitations (sprintf, UAF, uninit)

| Bug ID | Description | Fix |
|--------|-------------|-----|
| FIN-1 | sprintf buffer contents invisible | Add post-call __crow_set for buffer arg; existing pipeline reads result |
| FIN-2 | Write-after-free not detected | Check heapBlock.status in onSet pointer path; emit setHeapStatus('use-after-free') |
| FIN-3 | Uninitialized vars show 0 | Track hasInitializer in DeclInfo; pass flags to __crow_decl; show "?" |

### Round 3 — Remaining fixes (REM-1 through REM-5)

| Bug ID | Description | Fix |
|--------|-------------|-----|
| REM-1 | Nested struct field updates stale | updateStructFieldValues recurses into nested struct fields |
| REM-2 | Heap struct children missing | typeHeapBlock infers type on first pointer dereference, builds children |
| REM-3 | Heap array element values not tracked | typeHeapBlock builds indexed array children for multi-element heap blocks |
| REM-4 | strcpy buffer content not tracked | Rewrite strcpy → __crow_strcpy; onStrcpy copies + emits setValue |
| REM-5 | Duplicate steps at same line | onStep merges consecutive empty steps at same line |

### Round 2 — Systemic fixes (SYS-1 through SYS-14)

| Bug ID | Description | Fix |
|--------|-------------|-----|
| SYS-1 | Struct fields invisible | Struct type registry from tree-sitter; buildChildren handles structs |
| SYS-2 | Heap dereference values invisible | onSet checks pointer type, finds heap block, emits setValue |
| SYS-3 | Recursive frames not stacked | instrumentReturn adds __crow_step before pop_scope |
| SYS-4 | Return line not shown | instrumentReturn + instrumentFunction trailing return both emit step |
| SYS-5 | For-loop exit increment not captured | Removed loop update tracking; re-declaration path handles it |
| SYS-6 | Condition/branch steps invisible | onStep always emits (removed empty-step filter) |
| SYS-7 | Redundant setValue on loop increment | Removed loop update tracking |
| SYS-8 | Variable shadowing not modeled | compound_statement gets push/pop scope |
| SYS-9 | Chained assignment only tracks outermost | collectChainedTargets walks RHS recursively |
| SYS-10 | calloc shown as malloc | onCalloc patches addEntry op with calloc label |
| SYS-11 | scanf values not shown | emitSetValueForAddr after each scanf write |
| SYS-12 | sprintf/strcpy steps collapsed | Fixed by SYS-6 (always emit steps) |
| SYS-13 | Function pointer declarator | parseDeclName handles function_declarator |
| SYS-14 | 2D array dimensions wrong | parseDeclName accumulates dimensions |

### Round 1 — Initial fixes

| Bug ID | Description |
|--------|-------------|
| BUG-custom-1 | Line numbers off by 1 |
| BUG-p5.1-1 | Arrow field corrupts pointer display |
| BUG-p5.1-2 | Nested field targets unregistered name |
| BUG-p15.1-5 | Pointer param type loses `*` |

### Known Limitations

| Issue | Reason | Status |
|-------|--------|--------|
| Read-after-free detection | Only write-through-freed-pointer is detected; reads show heap as 'freed' | Accepted |
| snprintf not tracked | Could be added similarly to sprintf | Low priority |
