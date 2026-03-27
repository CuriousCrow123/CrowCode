# C Interpreter — Feature Status

Last updated: 2026-03-27
Test suite: 599 passing, 0 skipped (599 total across 18 files)

---

## Data Types

| Type | Size (bytes) | Tested | Notes |
|------|-------------|--------|-------|
| `char` | 1 | Yes | Stored as numeric. Sign-extended on cast. `unsigned char` parsed but treated as signed. |
| `short` | 2 | Yes | Sign-extended on cast. `unsigned short` parsed but treated as signed. |
| `int` | 4 | Yes | 32-bit signed via `toInt32()`. `Math.imul` for multiplication. `unsigned int` parsed but treated as signed. |
| `long` | 8 | Partial | Parsed and sized correctly, but arithmetic uses 32-bit (`toInt32`), not 64-bit. |
| `float` | 4 | Yes | Stored as JS `number` (64-bit double internally). No single-precision truncation. Display uses `toFixed(6)` with trailing zero stripping. |
| `double` | 8 | Yes | Full JS `number` precision. |
| `void` | 0 | Yes | Used as pointer target type for `malloc` return. |
| Pointers (`int*`, `char*`, etc.) | 4 | Yes | 32-bit addresses. Hex display. Pointer arithmetic scales by `sizeof(*p)`. |
| Arrays (`int[N]`) | N × element | Yes | Stack-allocated. Indexed children. Bounds checking on read and write. |
| Multi-dimensional arrays (`int[M][N]`) | M × N × element | Yes | Flattened `[i][j]` children. Nested init_list parsing. |
| Structs | Computed with alignment | Yes | Fields with offsets/padding. Nested structs. Init lists. |
| String literals (`char *s = "hello"`) | Heap-allocated | Yes | Char array with null terminator. Individual char children. |
| Function pointers (`int (*fp)(int,int)`) | 4 (pointer-sized) | Yes | Declare, assign, reassign, call through pointer. Display shows `-> funcName`. |

**Integer model:** ILP32. All integer arithmetic is signed 32-bit (`n | 0`). Unsigned integer semantics are not implemented — `unsigned` qualifiers are parsed but normalized away.

**Alignment rules:** Each primitive aligns to its own size. Structs align to their largest field's alignment. Struct tail padding applied to reach alignment boundary. Arrays align to element type.

---

## Operators

### Arithmetic
| Operator | Behavior | Tested | Notes |
|----------|----------|--------|-------|
| `+` `-` `*` `/` `%` | Int: 32-bit truncated. Float: full precision. | Yes | Division by zero returns error. Float modulo not supported. |
| Pointer `+` `-` integer | Scales by `sizeof(*ptr)` | Yes | Pointer minus pointer not supported. |
| Unary `-` | `toInt32(-v)` | Yes | |
| Unary `+` | Identity | Implicit | |

### Comparison
| Operator | Behavior | Tested |
|----------|----------|--------|
| `<` `>` `<=` `>=` `==` `!=` | Returns 0 or 1 | Yes |

### Logical (short-circuit)
| Operator | Behavior | Tested |
|----------|----------|--------|
| `&&` | Returns 0 without evaluating right if left is 0 | Yes |
| `\|\|` | Returns 1 without evaluating right if left is nonzero | Yes |
| `!` | Returns 1 if 0, else 0 | Yes |

### Bitwise
| Operator | Tested | Notes |
|----------|--------|-------|
| `&` `\|` `^` `~` `<<` `>>` | Yes | 32-bit semantics. `>>` is arithmetic (sign-preserving). |

### Assignment
| Operator | Tested |
|----------|--------|
| `=` | Yes |
| `+=` `-=` `*=` `/=` `%=` | Yes |
| `&=` `\|=` `^=` `<<=` `>>=` | Yes |
| Chained: `a = b = c = 0` | Yes |

### Increment / Decrement
| Operator | Behavior | Tested |
|----------|----------|--------|
| `++` `--` (pre and post) | Works on variables, array elements, pointer scaling | Yes |

### Other Expressions
| Expression | Behavior | Tested |
|------------|----------|--------|
| Ternary `? :` | Lazy evaluation (only evaluates taken branch) | Yes |
| Comma `,` | Evaluates all, returns last | Yes |
| `sizeof(type)` | Returns size from type system | Yes |
| `sizeof(expr)` | Returns size of expression's type. Arrays return full size (not decayed pointer). | Yes |
| Cast `(type)expr` | Truncation: char→8-bit, short→16-bit, int→`\|0`. Float-to-int: `Math.trunc`. Int-to-float: preserves value. | Yes |
| Address-of `&` | Returns stack or heap address | Yes |
| Dereference `*` | Reads via memReader. Null pointer check. | Yes |
| Array-to-pointer decay | `int *p = arr` assigns base address. Works in assignment, function args, arithmetic. | Yes |

---

## Control Flow

| Construct | Sub-step generation | Tested | Notes |
|-----------|-------------------|--------|-------|
| `if` / `else` / `else if` | Condition shown as step with `→ true/false` result | Yes | Not a sub-step — condition is the main event on the if-line |
| `for` (init; cond; update) | Init, condition check (sub-step), body, update (sub-step) per iteration | Yes | Full column highlighting for condition and update expressions |
| `while` | Condition check (sub-step) per iteration | Yes | |
| `do-while` | Body first, then condition check (sub-step) | Yes | |
| `switch` / `case` / `default` | Expression evaluated, cases matched by value | Yes | Fall-through semantics. `break` exits switch only (not enclosing loop). |
| `break` | Exits innermost loop or switch | Yes | Nested loops: exits inner only |
| `continue` | Skips to next iteration of innermost loop | Yes | In switch-in-loop: skips to next loop iteration |
| `return` | From functions and loops, with scope cleanup | Yes | Early return from nested contexts works |
| Block `{ }` | Pushes scope if body has declarations | Yes | Variables destroyed on scope exit |

---

## Functions

| Feature | Tested | Notes |
|---------|--------|-------|
| User-defined functions | Yes | Must be defined before `main()`. No forward declarations. |
| Parameters (by value) | Yes | Scalars and structs (full field-by-field copy) |
| Parameters (pointers) | Yes | Pointer value passed. Heap block tracking propagated via `ptrTargetMap`. |
| Parameters (arrays) | Yes | Array-to-pointer decay applied |
| Return values | Yes | Single scalar return |
| Recursion | Yes | factorial(5), fib(6). Stack frame visualization. |
| Function pointers | Yes | `int (*fp)(int,int) = add; fp(3,4)` — declare, assign, reassign, call |
| Multiple return paths | Yes | Early return from loops, if/else branches |
| Stack frame visualization | Yes | Frame appears on call, removed on return. Caller info shown. |
| Column highlighting on calls | Yes | Call site highlighted in source |
| Stack overflow detection | Yes | Error at `maxFrames` (default 256) |

---

## Memory Management

| Feature | Tested | Notes |
|---------|--------|-------|
| `malloc(size)` | Yes | Infers array type when size > element size (cap 32 elements). 16-byte aligned. |
| `calloc(count, size)` | Yes | Zero-initialized. Array type inferred. |
| `free(ptr)` | Yes | Marks freed. Pointer shows `(dangling)`. `free(NULL)` is no-op. |
| Cross-function free | Yes | `ptrTargetMap` tracks parameter names across function calls |
| Leak detection | Yes | Unfreed blocks marked `leaked` at program end |
| Double-free detection | Yes | Error: `free(): double free of 0x...` |
| Invalid free detection | Yes | Error: `free(): invalid pointer 0x...` |
| Null pointer dereference | Yes | Error on `*NULL` and `ptr->field` when ptr is NULL |
| Stack array bounds (read) | Yes | Error if index < 0 or >= size |
| Stack array bounds (write) | Yes | Error if index < 0 or >= size |
| Heap array bounds (write) | Yes | `Heap buffer overflow` error |
| Use-after-free (read) | Yes | Error reported via memReader |
| Use-after-free (write) | Yes | Error reported in dereference assignment path |
| Uninitialized variable tracking | Yes | Shows `(uninit)` until first assignment |

---

## Standard Library

### Working
| Function | Notes |
|----------|-------|
| `malloc(size)` | Step emission with allocation description |
| `calloc(count, size)` | Zero-init children visible |
| `free(ptr)` | Status change + dangling pointer display |
| `sprintf(buf, fmt, ...)` | Supports `%d`, `%i`, `%x`, `%c`, `%s`, `%%`. Result shown as heap value. |
| `strlen(s)` | Walks char bytes from pointer address. Max 10,000 bytes. |
| `strcpy(dst, src)` | Copies bytes including null terminator. Updates heap display. |
| `strcmp(a, b)` | Returns -1, 0, or 1. |
| `strcat(dst, src)` | Appends src to end of dst. Updates heap display. |
| `abs(x)` | Returns absolute value as int |
| `sqrt(x)` | Returns double via `Math.sqrt` |
| `pow(x, y)` | Returns double via `Math.pow` |

### No-op (recognized, step emitted, no output)
| Function | Notes |
|----------|-------|
| `printf(fmt, ...)` | Step shown but no console output |
| `puts(str)` | Step shown but no console output |
| `putchar(c)` | Recognized but ignored |
| `fprintf(stream, fmt, ...)` | Recognized but ignored |

### Not Implemented
| Category | Functions |
|----------|-----------|
| Memory | `realloc`, `memcpy`, `memset`, `memmove` |
| String | `strncpy`, `strncat`, `strncmp`, `strstr`, `strchr`, `strrchr`, `strtok` |
| Conversion | `atoi`, `atof`, `strtol`, `strtoul`, `strtod` |
| Math | `sin`, `cos`, `tan`, `log`, `exp`, `ceil`, `floor`, `fabs`, `fmod`, `round` |
| Character | `isalpha`, `isdigit`, `isspace`, `toupper`, `tolower` |
| I/O | `scanf`, `getchar`, `fgets`, `fopen`, `fclose`, `fread`, `fwrite` |
| Process | `exit`, `abort`, `atexit`, `system` |
| Random | `rand`, `srand` |
| Search/Sort | `qsort`, `bsearch` |
| Other | `assert`, `time`, `clock` |

---

## Visualization

| Feature | Status | Notes |
|---------|--------|-------|
| Stack variables with addresses | Working | Hex addresses, type display |
| Struct children (fields) | Working | Nested display with dot-prefixed names |
| Array children (elements) | Working | Indexed display. Capped at 20 for display. |
| 2D array children | Working | Flattened `[i][j]` display names |
| Heap blocks with metadata | Working | Address, type, size, status (color-coded: green/orange/red), alloc site |
| String literal heap blocks | Working | Individual character children with null terminator |
| Pointer display | Working | Hex address, `NULL`, or `(dangling)` after free |
| Function pointer display | Working | Shows `-> funcName` |
| Uninitialized variable display | Working | Shows `(uninit)` |
| Scope entry/exit | Working | Block scopes `{ }`, for/while scopes |
| Variable shadowing | Working | Inner scope variable separate from outer |
| Step descriptions | Working | Computed values, operator text, condition results |
| Sub-steps (hidden in line mode) | Working | For/while/do-while condition checks and loop updates |
| Column highlighting | Working | Condition and update expressions in loops and if statements |
| Drilldown modal | Working | Navigate into nested structs/arrays via breadcrumb path |
| Changed-value highlighting | Working | `diffSnapshots()` marks values that changed between steps |

---

## Partially Working

| Feature | What works | What doesn't | Notes |
|---------|-----------|--------------|-------|
| `long` (64-bit) | Parsed and sized (8 bytes) | Arithmetic treated as 32-bit in evaluator | Would need BigInt or separate evaluation path |
| Preprocessor | `#include` ignored gracefully | `#define`, `#ifdef`, etc. ignored with warning | By design — not a real preprocessor |
| 3D+ arrays | Type system supports nesting | Only 2D write/init tested; 3D untested | Medium difficulty to fix |
| `sprintf` format specifiers | `%d`, `%i`, `%x`, `%c`, `%s`, `%%` | `%f`, `%g`, `%e`, `%p`, `%u`, `%o`, `%ld` not supported | |
| Empty loop bodies | Doesn't crash, loop variable advances | May produce interpreter errors internally | |

---

## Not Implemented

### Language Features
| Feature | Parser | Interpreter | Notes |
|---------|--------|------------|-------|
| `enum` | No | No | Not parsed |
| `union` | No | No | Not parsed |
| `typedef` | Warned | No | Parser warns "not supported" |
| `goto` / labels | No | No | Not parsed |
| `static` / `extern` / `const` | Parsed | Ignored | Qualifiers recognized but not enforced |
| `volatile` / `register` | Parsed | Ignored | Qualifiers recognized but not enforced |
| Variable-length arrays | No | No | Parser error: "Variable-length arrays are not supported" |
| Global variables | No | No | Only function and struct definitions at top level |
| Multiple declarators | No | No | `int a, b;` only declares `a` |
| Forward declarations | No | No | Functions must appear before `main()` |
| Bit-fields | No | No | `int x:4` not parsed |
| `#define` macros | Warned | No | Preprocessor directives ignored with warning |
| Designated initializers | No | No | `.field = val` syntax not supported |
| Variadic functions | No | No | `...` parameter not supported |
| Inline assembly | No | No | N/A for browser environment |
| `(*fp)(args)` dereference call | No | No | `fp(args)` works; explicit `(*fp)(args)` not parsed |
| Function pointers in structs | No | No | `struct { int (*cb)(int); }` not supported |
| Compound literals | Partial | Partial | `(struct Point){1, 2}` treated as init_list |
| Unsigned integer semantics | No | No | Qualifiers parsed but all arithmetic is signed |
| Pointer-pointer subtraction | No | No | Only pointer ± integer supported |

### Runtime Limitations
| Limitation | Notes |
|-----------|-------|
| No I/O output | `printf`/`puts`/`putchar` are no-ops — no console |
| No stdin | `scanf`, `getchar`, `fgets` not available |
| Single source file | No multi-file compilation or linking |
| No recursive struct pointer types | `struct Node { struct Node *next; }` — pointer fields work but self-referential layout depends on registry order |

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
| Max steps | 500 | Yes (`InterpreterOptions.maxSteps`) |
| Max stack frames | 256 | Yes (`InterpreterOptions.maxFrames`) |
| Max heap size | 1 MB (1,048,576 bytes) | Yes (`InterpreterOptions.maxHeapBytes`) |
| Max array children displayed | 20 | No (hardcoded in `stdlib.ts`) |
| Max malloc array inference | 32 elements | No (hardcoded in `interpreter.ts`) |
| String function max length | 10,000 bytes | No (hardcoded in `stdlib.ts`) |
| Number literal formats | Decimal, hex (`0x`), binary (`0b`), octal (leading `0`), float (`.` or `e`/`E`) | No |

---

## Test Programs

39 programs in the Custom tab dropdown across 13 categories:

| Category | Count | Programs |
|----------|-------|----------|
| Scalars | 4 | Integer Lifecycle, Char and Casting, All Compound Operators, Increment/Decrement |
| Structs | 2 | Simple Struct, Nested Structs |
| Arrays | 2 | Array Init and Loop, Array Squared in Loop |
| Heap | 3 | malloc/free Lifecycle, calloc Zero-Init, Heap Array with Loop |
| Struct+Pointer | 2 | Heap Struct via Pointer, Full Memory Basics |
| Functions | 2 | Simple Function Call, Recursive Factorial |
| Control Flow | 4 | If/Else Branching, While Loop, Nested Loops, Break and Continue |
| Scope | 1 | Variable Shadowing |
| Strings | 1 | sprintf Formats |
| Errors | 1 | Memory Leak Detection |
| New Features | 8 | Switch/Case, String Literal, Float Arithmetic, Uninitialized Variable, Chained Assignment, Function Pointer, 2D Array, Array-to-Pointer Decay |
| Runtime Safety | 3 | Use-After-Free, String Functions, Math Functions |
| Integration | 6 | Matrix Identity, Fibonacci Array, Bubble Sort, Multi-Function Clamp, Recursive Fibonacci, Entity System |

---

## Test Coverage

599 tests across 18 files:

### Engine tests (9 files, 98 tests)

| Test file | Tests | Focus |
|-----------|-------|-------|
| `snapshot.test.ts` | 14 | Core `applyOps` and `buildSnapshots`: add/remove/set, error reporting, immutability |
| `snapshot-edge-cases.test.ts` | 24 | `setHeapStatus`, deep nesting, multi-op interactions, empty/edge states |
| `diff.test.ts` | 6 | Added/removed/changed detection, nested entries, empty snapshots |
| `navigation.test.ts` | 9 | Visible indices filtering, nearest index mapping |
| `validate.test.ts` | 8 | Duplicate ids, missing addresses, subStep anchor rule |
| `substep.test.ts` | 14 | Sub-step snapshot correctness, navigation, diffing, scope lifecycle |
| `integration.test.ts` | 10 | Snapshot building, scope lifecycle, isolation, diffing, navigation with inline programs |
| `bugs.test.ts` | 4 | Regression tests (visiblePosition = -1, etc.) |
| `summary.test.ts` | 9 | Display summary computation for nested values |

Engine subtotal: **98 tests**

### Interpreter tests (9 files, 501 tests)

| Test file | Tests | Focus |
|-----------|-------|-------|
| `parser.test.ts` | 35 | AST conversion for all node types |
| `evaluator.test.ts` | 60 | Expression evaluation, operators, 32-bit wrapping, pointer scaling |
| `interpreter.test.ts` | 35 | Statement handling, stdlib, validation, integration pipelines |
| `memory.test.ts` | 41 | Unified Memory class: scopes, heap, op recording, ID generation |
| `types-c.test.ts` | 32 | Type sizes, alignment, struct layout, TypeRegistry |
| `snapshot-regression.test.ts` | 34 | Regression safety net: 7 programs captured before Memory refactor |
| `worker.test.ts` | 6 | Worker message contract |
| `value-correctness.test.ts` | 198 | Value assertions: scalars, structs, arrays, pointers, functions, control flow, sprintf, bounds checking, sub-steps, edge cases, BUG-1 through BUG-7 regressions |
| `manual-programs.test.ts` | 60 | 44 full C programs through complete pipeline (parse → interpret → validate → buildSnapshots → verify values) |

Interpreter subtotal: **501 tests**
