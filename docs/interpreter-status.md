# C Interpreter — Feature Status

Last updated: 2026-03-26
Test suite: 590 passing, 1 skipped (591 total across 20 files)

## Fully Working

### Data Types
| Feature | Tested | Notes |
|---------|--------|-------|
| `int` (32-bit signed) | Yes | toInt32 wrapping, Math.imul for multiplication |
| `char` (8-bit signed) | Yes | Stored as numeric, sign-extended on cast |
| `short` (16-bit signed) | Yes | Sign-extended on cast |
| `long` (64-bit) | Partial | Parsed and sized (8 bytes) but treated as 32-bit in evaluator |
| `float` / `double` | Yes | Arithmetic preserves decimal, type promotion (int+float→float), display with toFixed(6) |
| `void` | Yes | 0-byte size, used for void* pointers |
| Pointers (`int*`, `char*`, etc.) | Yes | 4-byte, hex display, pointer arithmetic scales by sizeof(*p) |
| Arrays (`int[N]`) | Yes | Stack-allocated, indexed children, bounds checking |
| Multi-dimensional arrays (`int[M][N]`) | Yes | Nested type, flattened [i][j] children, write via chained subscript, nested init_list |
| Structs | Yes | Fields with offsets/padding, nested structs, init lists |
| String literals (`char *s = "hello"`) | Yes | Heap-allocated char array with null terminator, individual char children |
| Function pointers (`int (*fp)(int,int)`) | Yes | Declare, assign, call through pointer, display shows `→ funcName` |

### Operators
| Feature | Tested | Notes |
|---------|--------|-------|
| Arithmetic: `+` `-` `*` `/` `%` | Yes | 32-bit int; float preserves decimal |
| Comparison: `<` `>` `<=` `>=` `==` `!=` | Yes | Returns 0 or 1 |
| Logical: `&&` `\|\|` `!` | Yes | Short-circuit evaluated |
| Bitwise: `&` `\|` `^` `~` `<<` `>>` | Yes | 32-bit semantics |
| Assignment: `=` `+=` `-=` `*=` `/=` `%=` `&=` `\|=` `^=` `<<=` `>>=` | Yes | All compound ops |
| Chained assignment: `a = b = c = 0` | Yes | Recursive executeAssignment emits ops for all variables |
| Increment/Decrement: `++` `--` (pre/post) | Yes | On variables, array elements, pointer scaling |
| Ternary: `? :` | Yes | Lazy evaluation |
| Comma: `,` | Yes | Evaluates all, returns last |
| sizeof | Yes | Types and expressions (sizeof(2D array) returns full size) |
| Cast: `(type)expr` | Yes | Truncation to target size; `(int)3.7` → 3, `(float)3` → 3.0 |
| Address-of: `&` | Yes | Returns stack/heap address |
| Dereference: `*` | Yes | Reads via memReader, null-pointer check |
| Array-to-pointer decay | Yes | `int *p = arr` assigns base address; works in assignment, function args, arithmetic |

### Control Flow
| Feature | Tested | Sub-steps | Notes |
|---------|--------|-----------|-------|
| `if` / `else` / `else if` | Yes | Yes — `"if: <expr> → true/false"` | Condition step + branch |
| `for` (init; cond; update) | Yes | Yes — init, check, update sub-steps | Full column highlighting |
| `while` | Yes | Yes — `"while: check <expr> → true"` | Condition sub-steps per iteration |
| `do-while` | Yes | Yes — `"do-while: check <expr> → true"` | Condition after body |
| `switch` / `case` / `default` | Yes | — | Fall-through semantics, break exits switch only (not enclosing loop) |
| `break` | Yes | — | Nested loops: exits inner only; in switch: exits switch only |
| `continue` | Yes | — | Nested loops: skips inner only; in switch-in-loop: skips to next iteration |
| `return` | Yes | — | From functions and loops, scope cleanup |

### Functions
| Feature | Tested | Notes |
|---------|--------|-------|
| User-defined functions | Yes | Definition, call, return value |
| Parameters (by value) | Yes | Scalars and struct-by-value copy |
| Function pointers | Yes | `int (*fp)(int,int) = add; fp(3,4)` — declare, assign, reassign, call |
| Recursion | Yes | factorial(5), fib(6), stack frame visualization |
| Multiple return paths | Yes | Early return from loops, if/else branches |
| Stack frame visualization | Yes | Frame appears on call, removed on return |
| Column highlighting on calls | Yes | Call site highlighted in source |
| Stack overflow detection | Yes | Configurable maxFrames (default 256) |

### Memory Management
| Feature | Tested | Notes |
|---------|--------|-------|
| `malloc(size)` | Yes | Infers array type when size > element (cap 32) |
| `calloc(count, size)` | Yes | Zero-initialized, array type inferred |
| `free(ptr)` | Yes | Marks freed, pointer shows "(dangling)" |
| Cross-function free | Yes | `ptrTargetMap` tracks parameter names across function calls |
| Leak detection | Yes | Unfreed blocks marked "leaked" at program end |
| Double-free detection | Yes | Error reported |
| Null pointer dereference | Yes | Error reported |
| Stack array bounds (read) | Yes | Error on index < 0 or >= size |
| Stack array bounds (write) | Yes | Error on index < 0 or >= size |
| Heap array bounds (write) | Yes | "Heap buffer overflow" error |
| Heap struct field access | Yes | Arrow operator, nested fields |
| Uninitialized variable tracking | Yes | Shows `(uninit)` until first assignment |

### Standard Library
| Function | Status | Notes |
|----------|--------|-------|
| `malloc(size)` | Working | Special step emission with allocation description |
| `calloc(count, size)` | Working | Zero-init children visible |
| `free(ptr)` | Working | Status change + dangling pointer display |
| `printf(fmt, ...)` | No-op | Step emitted, no output |
| `sprintf(buf, fmt, ...)` | Working | `%d`, `%x`, `%c`, `%%` — result shown as heap value |
| `puts(str)` | No-op | Step emitted |
| `putchar(c)` | No-op | Recognized but ignored |
| `fprintf(stream, fmt, ...)` | No-op | Recognized but ignored |

### Visualization
| Feature | Status | Notes |
|---------|--------|-------|
| Stack variables with addresses | Working | Hex addresses, type display |
| Struct children (fields) | Working | Nested display with dot-prefixed names |
| Array children (elements) | Working | Indexed display, capped at 20 for display |
| 2D array children | Working | Flattened `[i][j]` display names |
| Heap blocks with metadata | Working | Address, type, size, status, alloc site |
| String literal heap blocks | Working | Individual character children with null terminator |
| Function pointer display | Working | Shows `→ funcName` |
| Uninitialized variable display | Working | Shows `(uninit)` |
| Scope entry/exit | Working | Block scopes `{ }`, for/while scopes |
| Variable shadowing | Working | Inner scope variable separate from outer |
| Step descriptions | Working | Computed values, operator text, condition results |
| Sub-steps (hidden in line mode) | Working | For/while/do-while condition checks |

---

## Partially Working

| Feature | What works | What doesn't | Difficulty to fix |
|---------|-----------|--------------|-------------------|
| **Empty loop bodies** | Doesn't crash, loop variable advances correctly | May produce interpreter errors internally but program completes | Low |
| **Preprocessor** | `#include` ignored gracefully | `#define`, `#ifdef`, etc. ignored with warning | N/A (by design) |
| **3D+ arrays** | Type system supports nesting | Only 2D write/init tested; 3D untested | Medium |

---

## Not Working (Known Bugs)

| Bug | Test status | Root cause | Difficulty |
|-----|-----------|-----------|-----------|
| **Struct-pointer-chain bounds check** `p->scores[10]` | `it.skip` | Can't resolve heap block through multi-level pointer to check array bounds | Hard |

---

## Not Implemented

### Language Features
| Feature | Parser | Interpreter | Evaluator | Notes |
|---------|--------|------------|-----------|-------|
| `enum` | No | No | No | Not in parser |
| `union` | No | No | No | Not in parser |
| `typedef` | Warned | No | No | Parser warns "not supported" |
| `goto` / labels | No | No | No | Not in parser |
| `static` / `extern` / `const` | No | No | No | Qualifiers ignored |
| Variable-length arrays | No | No | No | `int arr[n]` not supported |
| Bit-fields | No | No | No | `int x:4` not parsed |
| `#define` macros | Warned | No | No | Preprocessor directives ignored |
| Designated initializers | No | No | No | `.field = val` syntax |
| Variadic functions | No | No | No | `...` not supported |
| Inline assembly | No | No | No | N/A |
| `(*fp)(args)` dereference call syntax | No | No | No | `fp(args)` works; explicit dereference not parsed |
| Function pointers in structs | No | No | No | `struct { int (*cb)(int); }` not supported |

### Runtime Features
| Feature | Notes |
|---------|-------|
| Use-after-free detection | Value still readable after free |
| String manipulation (`strlen`, `strcpy`, `strcmp`) | Not implemented |
| Math functions (`abs`, `sqrt`, `pow`) | Not implemented |
| File I/O (`fopen`, `fread`, `fwrite`) | Not applicable |

---

## Architecture Constraints

| Constraint | Value | Configurable |
|-----------|-------|-------------|
| Integer model | 32-bit signed (ILP32) | No |
| Pointer size | 4 bytes | No |
| Stack base | `0x7FFC0000` | No |
| Heap base | `0x55A00000` | No |
| Stack growth | Downward | No |
| Heap growth | Upward, 16-byte aligned | No |
| Max steps | 500 | Yes |
| Max frames | 256 | Yes |
| Max heap | 1 MB | Yes |
| Max array children displayed | 20 | No (hardcoded in stdlib.ts) |
| Max malloc array inference | 32 elements | No (hardcoded in interpreter.ts) |

---

## Test Coverage Summary

| Test file | Tests | Focus |
|-----------|-------|-------|
| `value-correctness.test.ts` | ~158 | Value assertions across all features |
| `manual-programs.test.ts` | 60 | Full-program integration (38 programs) |
| `interpreter.test.ts` | 35 | Statement handling, stdlib, validation |
| `evaluator.test.ts` | 60 | Expression evaluation, operators |
| `parser.test.ts` | 35 | AST conversion, node types |
| `environment.test.ts` | 27 | Scope chain, stack/heap allocation |
| `types-c.test.ts` | 32 | Type sizes, alignment, struct layout |
| `emitter.test.ts` | 34 | Op emission, ID generation, path resolution |
| `worker.test.ts` | 6 | Worker message contract |
| Other (engine, programs, summary) | ~143 | Snapshot building, validation, programs |
| **Total** | **591** | 590 passed, 1 skipped |
