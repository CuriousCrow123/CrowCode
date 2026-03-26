# C Interpreter — Feature Status

Last updated: 2026-03-26
Test suite: 560 passing, 1 expected-fail, 1 skipped (562 total across 20 files)

## Fully Working

### Data Types
| Feature | Tested | Notes |
|---------|--------|-------|
| `int` (32-bit signed) | Yes | toInt32 wrapping, Math.imul for multiplication |
| `char` (8-bit signed) | Yes | Stored as numeric, sign-extended on cast |
| `short` (16-bit signed) | Yes | Sign-extended on cast |
| `long` (64-bit) | Partial | Parsed and sized (8 bytes) but treated as 32-bit in evaluator |
| `float` / `double` | No | Types exist in registry but no FP arithmetic or display |
| `void` | Yes | 0-byte size, used for void* pointers |
| Pointers (`int*`, `char*`, etc.) | Yes | 4-byte, hex display, pointer arithmetic scales by sizeof(*p) |
| Arrays (`int[N]`) | Yes | Stack-allocated, indexed children, bounds checking |
| Structs | Yes | Fields with offsets/padding, nested structs, init lists |

### Operators
| Feature | Tested | Notes |
|---------|--------|-------|
| Arithmetic: `+` `-` `*` `/` `%` | Yes | 32-bit, div-by-zero error, Math.imul |
| Comparison: `<` `>` `<=` `>=` `==` `!=` | Yes | Returns 0 or 1 |
| Logical: `&&` `\|\|` `!` | Yes | Short-circuit evaluated |
| Bitwise: `&` `\|` `^` `~` `<<` `>>` | Yes | 32-bit semantics |
| Assignment: `=` `+=` `-=` `*=` `/=` `%=` `&=` `\|=` `^=` `<<=` `>>=` | Yes | All compound ops |
| Increment/Decrement: `++` `--` (pre/post) | Yes | On variables, array elements, pointer scaling |
| Ternary: `? :` | Yes | Lazy evaluation |
| Comma: `,` | Yes | Evaluates all, returns last |
| sizeof | Yes | Types and expressions |
| Cast: `(type)expr` | Yes | Truncation to target size (char, short, int) |
| Address-of: `&` | Yes | Returns stack/heap address |
| Dereference: `*` | Yes | Reads via memReader, null-pointer check |

### Control Flow
| Feature | Tested | Sub-steps | Notes |
|---------|--------|-----------|-------|
| `if` / `else` / `else if` | Yes | Yes — `"if: <expr> → true/false"` | Condition step + branch |
| `for` (init; cond; update) | Yes | Yes — init, check, update sub-steps | Full column highlighting |
| `while` | Yes | Yes — `"while: check <expr> → true"` | Condition sub-steps per iteration |
| `do-while` | Yes | Yes — `"do-while: check <expr> → true"` | Condition after body |
| `break` | Yes | — | Nested loops: exits inner only |
| `continue` | Yes | — | Nested loops: skips inner only |
| `return` | Yes | — | From functions and loops, scope cleanup |

### Functions
| Feature | Tested | Notes |
|---------|--------|-------|
| User-defined functions | Yes | Definition, call, return value |
| Parameters (by value) | Yes | Scalars and struct-by-value copy |
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
| Leak detection | Yes | Unfreed blocks marked "leaked" at program end |
| Double-free detection | Yes | Error reported |
| Null pointer dereference | Yes | Error reported |
| Stack array bounds (read) | Yes | Error on index < 0 or >= size |
| Stack array bounds (write) | Yes | Error on index < 0 or >= size |
| Heap array bounds (write) | Yes | "Heap buffer overflow" error |
| Heap struct field access | Yes | Arrow operator, nested fields |

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
| Heap blocks with metadata | Working | Address, type, size, status, alloc site |
| Scope entry/exit | Working | Block scopes `{ }`, for/while scopes |
| Variable shadowing | Working | Inner scope variable separate from outer |
| Step descriptions | Working | Computed values, operator text, condition results |
| Sub-steps (hidden in line mode) | Working | For/while/do-while condition checks |

---

## Partially Working

| Feature | What works | What doesn't | Difficulty to fix |
|---------|-----------|--------------|-------------------|
| **Strings** | `sprintf(buf, "text")` displays as heap value | `char *s = "hello"` evaluates to 0; no string array representation | Medium |
| **Float/double** | Types parsed, sizeof correct | No arithmetic, no display formatting | Medium |
| **Empty loop bodies** | Doesn't crash, loop variable advances correctly | May produce interpreter errors internally but program completes | Low |
| **Cross-function free** | Doesn't crash | `free()` inside called function may not resolve heap block ID | Medium |
| **Preprocessor** | `#include` ignored gracefully | `#define`, `#ifdef`, etc. ignored with warning | N/A (by design) |

---

## Not Working (Known Bugs)

| Bug | Test status | Root cause | Difficulty |
|-----|-----------|-----------|-----------|
| **Chained assignment** `a = b = c = 0` | `test.fails` | Evaluator only processes outermost assignment; inner assignments treated as expressions returning value but not executing side effects through interpreter | Medium |
| **Struct-pointer-chain bounds check** `p->scores[10]` | `it.skip` | Can't resolve heap block through multi-level pointer to check array bounds | Hard |

---

## Not Implemented

### Language Features
| Feature | Parser | Interpreter | Evaluator | Notes |
|---------|--------|------------|-----------|-------|
| `switch` / `case` / `default` | No | No | No | Not in convertStatementNode |
| `enum` | No | No | No | Not in parser |
| `union` | No | No | No | Not in parser |
| `typedef` | Warned | No | No | Parser warns "not supported" |
| `goto` / labels | No | No | No | Not in parser |
| Function pointers | Partial | No | No | Parsed as pointers but not callable |
| `static` / `extern` / `const` | No | No | No | Qualifiers ignored |
| Variable-length arrays | No | No | No | `int arr[n]` not supported |
| Multi-dimensional arrays | No | No | No | `int arr[3][4]` not tested |
| Bit-fields | No | No | No | `int x:4` not parsed |
| `#define` macros | Warned | No | No | Preprocessor directives ignored |
| Array-to-pointer decay | No | No | No | `int *p = arr` doesn't work |
| Designated initializers | No | No | No | `.field = val` syntax |
| Variadic functions | No | No | No | `...` not supported |
| Inline assembly | No | No | No | N/A |

### Runtime Features
| Feature | Notes |
|---------|-------|
| Uninitialized read detection (MSan) | Variables default to 0 silently |
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
| `value-correctness.test.ts` | ~130 | Value assertions across all features (includes it.each expanding to 10) |
| `manual-programs.test.ts` | 60 | Full-program integration (38 programs) |
| `interpreter.test.ts` | 35 | Statement handling, stdlib, validation |
| `evaluator.test.ts` | 60 | Expression evaluation, operators |
| `parser.test.ts` | 35 | AST conversion, node types |
| `environment.test.ts` | 27 | Scope chain, stack/heap allocation |
| `types-c.test.ts` | 32 | Type sizes, alignment, struct layout |
| `emitter.test.ts` | 34 | Op emission, ID generation, path resolution |
| `worker.test.ts` | 6 | Worker message contract |
| Other (engine, programs, summary) | ~143 | Snapshot building, validation, programs |
| **Total** | **562** | 560 passed, 1 expected-fail, 1 skipped |
