# CrowCode C Language Support

What C features does CrowCode's interpreter support? This document tracks data types, operators, control flow, functions, memory management, standard library coverage, and known gaps.

Last updated: 2026-03-28

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
| Arrays (`int[N]`) | N x element | Yes | Stack-allocated. Indexed children. Bounds checking on read and write. |
| Multi-dimensional arrays (`int[M][N]`) | M x N x element | Yes | Flattened `[i][j]` children. Nested init_list parsing. |
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
| Cast `(type)expr` | Truncation: char->8-bit, short->16-bit, int->`\|0`. Float-to-int: `Math.trunc`. Int-to-float: preserves value. | Yes |
| Address-of `&` | Returns stack or heap address | Yes |
| Dereference `*` | Reads via memReader. Null pointer check. | Yes |
| Array-to-pointer decay | `int *p = arr` assigns base address. Works in assignment, function args, arithmetic. | Yes |

---

## Control Flow

| Construct | Sub-step generation | Tested | Notes |
|-----------|-------------------|--------|-------|
| `if` / `else` / `else if` | Condition shown as step with `-> true/false` result | Yes | Not a sub-step — condition is the main event on the if-line |
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

### Implemented (26 functions)
| Function | Notes |
|----------|-------|
| `malloc(size)` | Step emission with allocation description |
| `calloc(count, size)` | Zero-init children visible |
| `free(ptr)` | Status change + dangling pointer display |
| `printf(fmt, ...)` | Real output via IoState -> ConsolePanel. Supports `%d`, `%i`, `%u`, `%x`, `%X`, `%c`, `%f`, `%p`, `%%`, field width, precision, flags. Step description shows output produced. |
| `scanf(fmt, ...)` | Reads from pre-supplied stdin via IoState. Writes through to variables with `setValue` ops. Supports `%d`, `%i`, `%c`, `%f`, `%x`, `%*` (suppression). Correct whitespace semantics per specifier. Missing `&` detected with error (bare array names accepted — arrays decay to pointers). Step description shows assigned values. Return value available as expression — `while (scanf(...) != EOF)` works. Returns item count on success, 0 on match failure, -1 on EOF. |
| `puts(str)` | Writes string + `\n` to stdout. |
| `putchar(c)` | Writes single character to stdout. |
| `getchar()` | Reads single character from stdin. Returns `int` (-1 on EOF). In interactive mode, pauses when stdin is exhausted. EOF signaled via Ctrl+D button or keyboard shortcut (sends `null` through generator protocol). |
| `fprintf(stream, fmt, ...)` | Routes to stdout or stderr based on first argument. |
| `fputs(str, stream)` | Writes string to stdout or stderr. |
| `fgets(buf, n, stdin)` | Reads up to n-1 chars from stdin (fgets semantics: includes `\n`, null-terminates). Result shown as quoted string on heap entry. |
| `gets(buf)` | Reads until newline (no bounds checking). Step description warns about unsafe usage. |
| `sprintf(buf, fmt, ...)` | Byte-by-byte writes to stack arrays and heap blocks. Supports `%d`, `%i`, `%x`, `%c`, `%s`, `%%`. Also sets parent entry to quoted string for summary. |
| `snprintf(buf, n, fmt, ...)` | Same as sprintf with size limit. Truncates to n-1 chars + null terminator. |
| `strlen(s)` | Walks char bytes from pointer address. Max 10,000 bytes. |
| `strcpy(dst, src)` | Copies bytes including null terminator. Updates heap display. |
| `strcmp(a, b)` | Returns -1, 0, or 1. |
| `strcat(dst, src)` | Appends src to end of dst. Updates heap display. |
| `abs(x)` | Returns absolute value as int |
| `sqrt(x)` | Returns double via `Math.sqrt` |
| `pow(x, y)` | Returns double via `Math.pow` |

### Not Implemented
| Category | Functions |
|----------|-----------|
| Memory | `realloc`, `memcpy`, `memset`, `memmove` |
| String | `strncpy`, `strncat`, `strncmp`, `strstr`, `strchr`, `strrchr`, `strtok` |
| Conversion | `atoi`, `atof`, `strtol`, `strtoul`, `strtod` |
| Math | `sin`, `cos`, `tan`, `log`, `exp`, `ceil`, `floor`, `fabs`, `fmod`, `round` |
| Character | `isalpha`, `isdigit`, `isspace`, `toupper`, `tolower` |
| I/O (advanced) | `sscanf`, `fscanf`, `fopen`, `fclose`, `fread`, `fwrite` |
| Process | `exit`, `abort`, `atexit`, `system` |
| Random | `rand`, `srand` |
| Search/Sort | `qsort`, `bsearch` |
| Other | `assert`, `time`, `clock` |

---

## Partially Working

| Feature | What works | What doesn't | Notes |
|---------|-----------|--------------|-------|
| `long` (64-bit) | Parsed and sized (8 bytes) | Arithmetic treated as 32-bit in evaluator | Would need BigInt or separate evaluation path |
| Preprocessor | `#include` ignored gracefully | `#define`, `#ifdef`, etc. ignored with warning | By design — not a real preprocessor |
| 3D+ arrays | Type system supports nesting | Only 2D write/init tested; 3D untested | Medium difficulty to fix |
| `sprintf` format specifiers | `%d`, `%i`, `%x`, `%c`, `%s`, `%%` with byte-by-byte writes | `%f`, `%p`, `%u` not yet supported in sprintf's internal formatter (they work in printf). | `evaluateSprintfResult` uses a simpler parser than `applyPrintfFormat` |
| `scanf` format specifiers | `%d`, `%i`, `%c`, `%f`, `%x`, `%*` (suppression) | `%i` octal/hex prefix not implemented (treated as `%d`). `%s` consumes but doesn't write to char array byte-by-byte. | |
| printf/scanf length modifiers | Length modifiers parsed and ignored | `%ld`, `%lf`, `%zu` not distinguished from `%d`, `%f` | `%lf` is common in student code with `double` |
| Empty loop bodies | Doesn't crash, loop variable advances | May produce interpreter errors internally | |

---

## Not Implemented

### Language Features
| Feature | Parser | Interpreter | Difficulty | Notes |
|---------|--------|------------|------------|-------|
| `enum` | No | No | Medium | Not parsed. Very common in student code. |
| `union` | No | No | Medium | Not parsed |
| `typedef` | Warned | No | Medium | Parser warns "not supported" |
| `goto` / labels | No | No | Medium | Not parsed |
| `static` / `extern` / `const` | Parsed | Ignored | Low-Medium | Qualifiers recognized but not enforced |
| `volatile` / `register` | Parsed | Ignored | Low | Qualifiers recognized but not enforced |
| Variable-length arrays | No | No | High | Parser error: "Variable-length arrays are not supported" |
| Global variables | No | No | Medium | Only function and struct definitions at top level |
| Multiple declarators | No | No | Low | `int a, b;` only declares `a` |
| Forward declarations | No | No | Medium | Functions must appear before `main()` |
| Bit-fields | No | No | High | `int x:4` not parsed |
| `#define` macros | Warned | No | High | Preprocessor directives ignored with warning |
| Designated initializers | No | No | Medium | `.field = val` syntax not supported |
| Variadic functions | No | No | High | `...` parameter not supported |
| Inline assembly | No | No | N/A | N/A for browser environment |
| `(*fp)(args)` dereference call | No | No | Low | `fp(args)` works; explicit `(*fp)(args)` not parsed |
| Function pointers in structs | No | No | Medium | `struct { int (*cb)(int); }` not supported |
| Compound literals | Partial | Partial | Medium | `(struct Point){1, 2}` treated as init_list |
| Unsigned integer semantics | No | No | High | Qualifiers parsed but all arithmetic is signed |
| Pointer-pointer subtraction | No | No | Low | Only pointer +/- integer supported |

### Format String Gaps
| Gap | Difficulty | Notes |
|-----|------------|-------|
| `%e`, `%E`, `%g`, `%G` in printf/scanf | Medium | Scientific notation |
| `%f`, `%p`, `%u` in sprintf | Low | Already work in printf, just need wiring to sprintf |
| `%s` byte-by-byte write in scanf | Medium | Currently consumes but doesn't write to char array |
| `%i` octal/hex prefix in scanf | Low | Currently treated as `%d` |
| `%ld`, `%lf`, `%zu` length modifiers | Low | Parsed and ignored; `%lf` common in student code |
| Float modulo (`%` operator) | Low | Not supported for float types |
| `%n` specifier | Low | Writes count of chars read so far |

### Runtime Limitations
| Limitation | Notes |
|-----------|-------|
| Interactive stdin limitations | Multi-specifier scanf (`"%d %d"`) may not pause correctly mid-call if buffer runs dry between specifiers. Separate scanf calls (one per value) work correctly. Type-mismatch input (e.g., letters for `%d`) returns 0 (match failure) — non-matching chars remain in buffer. Statement-level re-execution: when a while loop pauses at scanf, resume re-executes the entire while statement from the condition — scanf must be at the top of the loop body to avoid double-processing. |
| No FILE* operations | `fopen`/`fclose`/`fread`/`fwrite` not supported — only stdin/stdout/stderr |
| No `sscanf`/`fscanf` | Only `scanf` (reads from stdin). `sscanf` (from string) and `fscanf` (from file) not implemented. |
| No `%e`/`%g` format specifiers | Scientific notation (`%e`, `%E`, `%g`, `%G`) not supported in printf or scanf |
| Single source file | No multi-file compilation or linking |
| No recursive struct pointer types | `struct Node { struct Node *next; }` — pointer fields work but self-referential layout depends on registry order |
| Single-precision float truncation | `float` uses JS double, no `Math.fround` |
| Empty loop body errors | May produce internal interpreter errors |
| `EOF` / `NULL` macro definitions | Users must use `-1` and `0` literals |

---

## Prioritized Remaining Work

### Priority 1: High-Impact Language Features
Common in introductory C coursework; users will expect these to work.

| Feature | Difficulty | Notes |
|---------|------------|-------|
| Global variables | Medium | Only function/struct defs at top level currently |
| `enum` declarations | Medium | Very common in student code |
| Multiple declarators (`int a, b;`) | Low | Parser only declares first variable |
| `typedef` | Medium | Parser warns "not supported" |
| Forward declarations / prototypes | Medium | Functions must appear before `main()` |
| `const` enforcement | Low | Qualifier recognized but not enforced |
| Unsigned integer semantics | High | All arithmetic is signed; would need separate paths |

### Priority 2: High-Impact Standard Library
Functions that appear frequently in student programs.

| Function | Category | Difficulty | Notes |
|----------|----------|------------|-------|
| `atoi` | Conversion | Low | Parse string to int |
| `atof` | Conversion | Low | Parse string to float |
| `rand` / `srand` | Random | Low | Used in nearly every intro CS assignment |
| `exit(code)` | Process | Low | Early program termination |
| `isalpha/isdigit/isspace` | Character | Low | Character classification |
| `toupper/tolower` | Character | Low | Character conversion |
| `memcpy` | Memory | Medium | Byte-by-byte copy with visualization |
| `memset` | Memory | Medium | Fill memory region |
| `realloc` | Memory | Medium | Resize heap block (common dynamic array pattern) |
| `strncpy/strncmp` | String | Low | Bounded string operations |
| `strchr/strstr` | String | Low | String search |

### Priority 3: Medium-Impact Language Features

| Feature | Difficulty | Notes |
|---------|------------|-------|
| `union` types | Medium | |
| `long` 64-bit arithmetic | High | Would need BigInt or separate eval path |
| 3D+ arrays | Medium | Type system supports nesting but untested |
| `goto` / labels | Medium | Uncommon in modern code but taught |
| `static` local variables | Medium | Persist across function calls |
| Designated initializers (`.field = val`) | Medium | |
| Pointer-pointer subtraction | Low | Only pointer +/- integer supported |
| `(*fp)(args)` dereference call | Low | `fp(args)` works; explicit syntax doesn't |
| Function pointers in structs | Medium | `struct { int (*cb)(int); }` |
| Variable-length arrays | High | Parser error currently |
| Bit-fields | High | |
| Compound literals | Medium | Cast treated as init_list |
| Recursive struct pointer types | Medium | Self-referential layout depends on registry order |

### Priority 4: Medium-Impact Standard Library

| Function | Category | Difficulty | Notes |
|----------|----------|------------|-------|
| `strtol/strtoul/strtod` | Conversion | Medium | More robust than atoi |
| `strncat` | String | Low | Bounded concatenation |
| `strrchr/strtok` | String | Medium | String manipulation |
| `memmove` | Memory | Medium | Overlapping copy |
| `sin/cos/tan` | Math | Low | Direct `Math.*` mapping |
| `log/exp` | Math | Low | Direct `Math.*` mapping |
| `ceil/floor/round/fabs/fmod` | Math | Low | Direct `Math.*` mapping |
| `sscanf` | I/O | Medium | Parse from string instead of stdin |
| `qsort` | Sort | High | Needs function pointer callback support |
| `bsearch` | Search | Medium | Binary search with comparator |
| `assert` | Debug | Low | Condition check with abort |

### Priority 5: Low-Impact / Hard to Model
Rarely needed for educational use or fundamentally difficult in a browser.

| Feature | Difficulty | Notes |
|---------|------------|-------|
| `#define` macros | High | Would need preprocessor pass |
| `#ifdef` conditional compilation | High | Would need preprocessor pass |
| Multi-file compilation | Very High | No linker model |
| `fopen/fclose/fread/fwrite` | High | No real filesystem in browser |
| `fscanf` | High | Depends on FILE* |
| `abort/atexit/system` | Medium | Process control, limited browser model |
| `time/clock` | Low | Could stub with Date.now() |
| Variadic user-defined functions | High | `...` parameter |
| Inline assembly | N/A | Not applicable in browser |
| `volatile/register` enforcement | Low | Rarely meaningful |

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

