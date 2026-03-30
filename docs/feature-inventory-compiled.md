# CrowCode C Language Support — Compiled (WASM) Backend

What C features does CrowCode's compiled backend support? This backend compiles C to real WASM via xcc in the browser, then executes the WASM with instrumentation callbacks to produce memory snapshots.

Last updated: 2026-03-30

---

## Data Types

| Type | Size (bytes) | Tested | Notes |
|------|-------------|--------|-------|
| `char` | 1 | Yes | Displayed as `'c'` for printable ASCII, numeric otherwise. |
| `unsigned char` | 1 | Yes | Displayed as numeric. |
| `short` | 2 | Yes | Signed 16-bit. |
| `unsigned short` | 2 | Yes | Unsigned 16-bit. |
| `int` | 4 | Yes | 32-bit signed. Native WASM i32. |
| `unsigned int` | 4 | Yes | 32-bit unsigned. Native WASM i32. |
| `long` | 4 | Yes | 4 bytes on WASM32 (ILP32). Same as int. |
| `unsigned long` | 4 | Yes | 4 bytes on WASM32 (ILP32). |
| `long long` | 8 | Partial | Parsed and sized. Read via BigInt64. Arithmetic relies on xcc codegen. |
| `float` | 4 | Yes | Native WASM f32. Display rounds to 6 decimal places. |
| `double` | 8 | Yes | Native WASM f64. Full precision. |
| `void` | 0 | Yes | Used as pointer target type. |
| Pointers (`int*`, `char*`, etc.) | 4 | Yes | 32-bit WASM addresses. Hex display. NULL shown for zero. |
| Arrays (`int[N]`) | N x element | Yes | Stack-allocated. Indexed children with addresses. |
| Multi-dimensional arrays (`int[M][N]`) | M x N x element | Partial | Depends on xcc support. Type system handles nesting. |
| Structs | Computed with alignment | Yes | Fields with ILP32 alignment. Nested structs. Struct registry from source. |
| String literals (`char *s = "hello"`) | Compiler-managed | Yes | Placed in WASM data section by xcc. |
| `enum` | 4 | Yes | Compiled natively by xcc. Values visible as integers. |
| `typedef` | Varies | Yes | Resolved by xcc at compile time. Transparent to instrumentation. |
| `union` | Largest member | Yes | Compiled natively by xcc. Displayed as raw bytes. |
| Function pointers | 4 | Partial | Compiled by xcc. Pointer value visible but no `-> funcName` display. |

**Integer model:** ILP32 (WASM32). `int` and `long` are both 32-bit. Pointers are 32-bit. Arithmetic is native WASM — unsigned semantics work correctly.

**Alignment rules:** ILP32 with 4-byte max alignment cap. Fields align to `min(sizeof(field), 4)`. Must match xcc's struct layout ABI.

---

## Operators

### Arithmetic
| Operator | Behavior | Tested | Notes |
|----------|----------|--------|-------|
| `+` `-` `*` `/` `%` | Native WASM arithmetic. Integer and float. | Yes | Division by zero: WASM trap surfaced as runtime error. |
| Pointer `+` `-` integer | Compiled by xcc with correct scaling | Yes | Pointer minus pointer compiled natively. |
| Unary `-` `+` | Native WASM | Yes | |

### Comparison
| Operator | Behavior | Tested |
|----------|----------|--------|
| `<` `>` `<=` `>=` `==` `!=` | Native WASM comparison | Yes |

### Logical (short-circuit)
| Operator | Behavior | Tested |
|----------|----------|--------|
| `&&` `\|\|` `!` | Compiled by xcc with short-circuit semantics | Yes |

### Bitwise
| Operator | Tested | Notes |
|----------|--------|-------|
| `&` `\|` `^` `~` `<<` `>>` | Yes | Native WASM 32-bit operations. `>>` is arithmetic shift. |

### Assignment
| Operator | Tested |
|----------|--------|
| `=` | Yes |
| `+=` `-=` `*=` `/=` `%=` | Yes |
| `&=` `\|=` `^=` `<<=` `>>=` | Yes |
| Chained: `a = b = c = 0` | Partial |

### Increment / Decrement
| Operator | Behavior | Tested | Notes |
|----------|----------|--------|-------|
| `++` `--` (pre and post) | Native WASM. Simple variables tracked. | Yes | Complex lvalues (`arr[i]++`, `p->x++`) compile correctly but mutation is not visualized. |

### Other Expressions
| Expression | Behavior | Tested |
|------------|----------|--------|
| Ternary `? :` | Compiled by xcc | Yes |
| Comma `,` | Compiled by xcc | Yes |
| `sizeof(type)` | Compile-time constant | Yes |
| `sizeof(expr)` | Compile-time constant | Yes |
| Cast `(type)expr` | Compiled by xcc with correct truncation | Yes |
| Address-of `&` | Returns WASM linear memory address | Yes |
| Dereference `*` | Native WASM memory load/store | Yes |
| Array-to-pointer decay | Compiled by xcc | Yes |

---

## Control Flow

| Construct | Sub-step generation | Tested | Notes |
|-----------|-------------------|--------|-------|
| `if` / `else` / `else if` | Condition evaluated with `→ true/false` display | Yes | |
| `for` (init; cond; update) | Init (anchor), condition check (sub-step with column highlight), body, update (sub-step) | Yes | |
| `while` | Condition check (sub-step with column highlight) per iteration | Yes | |
| `do-while` | Body first, then condition check (sub-step) | Partial | Transformer handles `do_statement` but untested. |
| `switch` / `case` / `default` | Compiled by xcc with WASM br_table | Yes | Native fall-through semantics. |
| `break` | Compiled by xcc | Yes | |
| `continue` | Compiled by xcc | Yes | |
| `return` | Scope cleanup via `__crow_pop_scope` before return | Yes | Multiple return paths handled. |
| `goto` / labels | Compiled by xcc | Partial | Compiles and executes but stepping may skip labels. |
| Block `{ }` | Pushes scope if inside function body | Yes | Variables destroyed on scope exit. |

---

## Functions

| Feature | Tested | Notes |
|---------|--------|-------|
| User-defined functions | Yes | Compiled by xcc. Forward declarations work. |
| Parameters (by value) | Yes | All types including structs. |
| Parameters (pointers) | Yes | Pointer value passed. Heap tracking via address matching. |
| Parameters (arrays) | Yes | Array-to-pointer decay by xcc. |
| Return values | Yes | All scalar types. |
| Recursion | Yes | Stack frames visualized. Limited by WASM stack size. |
| Function pointers | Partial | Compiled by xcc. Call works. No `-> funcName` display. |
| Multiple return paths | Yes | `__crow_pop_scope` injected before each return. |
| Stack frame visualization | Yes | Frame appears on call, removed on return. |
| Column highlighting on calls | Yes | `__crow_step_col` emitted for call sites. |
| Forward declarations | Yes | Compiled by xcc. Not supported in interpreter backend. |
| Variadic functions | No | `...` parameter — xcc may compile it but no instrumentation. |

---

## Memory Management

| Feature | Tested | Notes |
|---------|--------|-------|
| `malloc(size)` | Yes | Calls real WASM malloc, intercepted by `__crow_malloc`. Heap block with children. |
| `calloc(count, size)` | Yes | Zero-initialized. Calls malloc + manual zeroing. |
| `realloc(ptr, size)` | Partial | Wired but untested. Allocates new + copies + frees old. |
| `free(ptr)` | Yes | Marks freed via `setHeapStatus`. `free(NULL)` is no-op. |
| Leak detection | Yes | Unfreed blocks marked `leaked` at program end. |
| Double-free detection | Yes | Second free on same block is silently ignored. |
| Use-after-free detection | Partial | Detected when pointer is re-assigned after free. Status set to `use-after-free`. |
| Null pointer dereference | Yes | WASM trap: `out of bounds memory access` surfaced as runtime error. |
| Stack array bounds | No | No bounds checking — native WASM memory access. Out-of-bounds may corrupt silently. |
| Heap array bounds | No | No bounds checking — native WASM memory access. |
| Uninitialized variable tracking | Yes | `flags & 1` in `__crow_decl` shows `?` for uninitialized. |

---

## Standard Library

### Implemented (10 functions)
| Function | Notes |
|----------|-------|
| `malloc(size)` | Intercepted by `__crow_malloc`. Real WASM allocation. |
| `calloc(count, size)` | Intercepted by `__crow_calloc`. Zeroed memory. |
| `realloc(ptr, size)` | Intercepted by `__crow_realloc`. Untested. |
| `free(ptr)` | Intercepted by `__crow_free`. Status tracking. |
| `printf(fmt, ...)` | Routed through WASI `fd_write`. Full format support via xcc's libc. |
| `puts(str)` | Intercepted in env imports. String + newline to stdout. |
| `putchar(c)` | Intercepted in env imports. Single char to stdout. |
| `getchar()` | Intercepted in env imports. Reads from stdin buffer. |
| `scanf(fmt, ...)` | Rewritten to per-specifier `__crow_scanf_*` calls. Supports `%d`, `%i`, `%u`, `%x`, `%o`, `%f`, `%lf`, `%c`, `%s`. |
| `strcpy(dst, src)` | Intercepted by `__crow_strcpy`. Byte-by-byte copy with visualization. |

### Available via xcc libc (not instrumented)
| Category | Functions |
|----------|-----------|
| String | `strlen`, `strcmp`, `strcat`, `strncpy`, `strncat`, `strncmp`, `strstr`, `strchr`, `strrchr`, `memcpy`, `memset`, `memmove` |
| Conversion | `atoi`, `atof`, `strtol`, `strtoul`, `strtod` |
| Math | `sqrt`, `pow`, `sin`, `cos`, `tan`, `log`, `exp`, `ceil`, `floor`, `fabs`, `fmod`, `abs` |
| Character | `isalpha`, `isdigit`, `isspace`, `toupper`, `tolower` |
| I/O | `fprintf`, `sprintf`, `snprintf`, `fputs`, `fgets` |
| Process | `exit` |

### Not Available
| Category | Functions |
|----------|-----------|
| I/O (file) | `fopen`, `fclose`, `fread`, `fwrite`, `fscanf`, `sscanf` |
| Process | `abort`, `atexit`, `system` |
| Random | `rand`, `srand` |
| Search/Sort | `qsort`, `bsearch` |
| Other | `assert`, `time`, `clock` |

---

## Partially Working

| Feature | What works | What doesn't | Notes |
|---------|-----------|--------------|-------|
| `long long` (64-bit) | Parsed, sized (8 bytes), read via BigInt64 | Untested in integration | Depends on xcc i64 support |
| Chained assignment (`a = b = c = 0`) | Compiles correctly | Visualization may not track all intermediate assignments | Known limitation |
| Complex lvalue updates (`arr[i]++`) | Compiles and executes correctly | Mutation not visualized (op-collector can't track non-identifier lvalues) | Silent visualization gap |
| `%ld` scanf specifier | Format string parsed | Specifier silently dropped — variable stays uninitialized | Bug: `scanfVariant` missing `ld` case |
| Function pointers | Compiled and callable by xcc | No `-> funcName` display (only raw pointer address shown) | Would need WASM function table introspection |
| `goto` / labels | Compiled by xcc | Stepping visualization may skip label targets | No instrumentation injected at labels |
| Multi-dimensional arrays | Type system handles nesting | Display depends on xcc layout matching JS-side calculation | Untested |

---

## Advantages Over Interpreter Backend

| Feature | Compiled | Interpreter | Notes |
|---------|----------|-------------|-------|
| `enum` | Yes | No | Compiled natively by xcc |
| `typedef` | Yes | No | Resolved at compile time |
| `union` | Yes | No | Compiled natively |
| `goto` / labels | Partial | No | Compiled by xcc |
| Forward declarations | Yes | No | Standard C ordering |
| `static` / `extern` / `const` | Yes | Ignored | Enforced by xcc compiler |
| Global variables | Yes | No | Compiled by xcc (but not instrumented for visualization) |
| Unsigned integer semantics | Yes | No | Native WASM i32 operations |
| Preprocessor (`#define`, `#ifdef`) | Yes | No | Handled by xcc preprocessor |
| Pointer-pointer subtraction | Yes | No | Native WASM arithmetic |
| Full printf format support | Yes | Partial | xcc's libc handles all format specifiers |
| String library functions | Yes (via libc) | Partial (10 functions) | `strlen`, `strcmp`, `memcpy`, etc. work natively |
| Math library functions | Yes (via libc) | Partial (3 functions) | `sin`, `cos`, `tan`, `log`, `exp`, etc. available |

---

## Limitations Compared to Interpreter Backend

| Feature | Compiled | Interpreter | Notes |
|---------|----------|-------------|-------|
| Bounds checking | No | Yes | WASM has no bounds checking on stack/heap arrays |
| Dangling pointer display | Partial | Yes | Pointer keeps old address after free (should show `(dangling)`) |
| Double-free error message | Silent | Error message | Compiled backend silently ignores |
| Invalid free detection | No | Yes | No tracking of valid allocation addresses |
| `sprintf` visualization | No | Yes | Not intercepted in compiled backend |
| `fprintf`/`fputs` interception | No | Yes | Output works via libc but not tracked as IoEvents |
| `fgets`/`gets` interception | No | Yes | Input works via libc but not tracked |
| `strlen`/`strcmp`/`strcat` interception | No | Yes | Work via libc but mutations not visualized |
| Function pointer `-> funcName` display | No | Yes | Only raw address shown |
| Timeout protection | No | Yes | No watchdog; uninstrumented loops freeze browser tab |
| Variable shadowing | Broken | Working | `varRegistry` keyed by name only; inner scope overwrites outer |

---

## Not Implemented

### Language Features
| Feature | Compiler | Instrumented | Notes |
|---------|----------|-------------|-------|
| Global variable visualization | Compiled | No | Globals exist in WASM but no `__crow_decl` emitted for them |
| Multiple declarators (`int a, b;`) | Compiled | Partial | xcc compiles both but transformer may only instrument first |
| Bit-fields | Depends on xcc | No | No visualization support |
| Variable-length arrays | Depends on xcc | No | No visualization support |
| Inline assembly | No | No | N/A for WASM |
| Variadic user-defined functions | Depends on xcc | No | No visualization support |

### Visualization Gaps
| Gap | Notes |
|-----|-------|
| Global variables | Compiled but not tracked — no scope push for globals |
| Complex lvalue mutations | `arr[i]++`, `p->x++` execute correctly but mutation invisible |
| Library function side effects | `memcpy`, `strcpy` (libc version), `sprintf` — changes happen but aren't visualized |
| Struct field via pointer dereference | `p->field = val` may not update visualization depending on tracking |

### Runtime Limitations
| Limitation | Notes |
|-----------|-------|
| No timeout / watchdog | Uninstrumented infinite loops freeze the browser tab. Step limit only catches instrumented code. |
| Main-thread execution | No Web Worker — compilation and execution block the UI thread (mitigated by `requestAnimationFrame` yields between stages). |
| Progressive re-execution for stdin | Each `resume()` re-runs the entire program. O(n^2) for n input prompts. |
| Single source file | No multi-file compilation or linking. |
| WASM memory growth | If `malloc` triggers `memory.grow`, some operations may read stale buffers. |
| `EOF` / `NULL` macros | May or may not be available depending on xcc headers. |

---

## Architecture Constraints

| Constraint | Value | Configurable |
|-----------|-------|-------------|
| Integer model | ILP32 (WASM32) | No |
| Pointer size | 4 bytes | No |
| Stack/Heap addresses | Real WASM linear memory addresses | No |
| Max steps | 500 | Yes (`MAX_STEPS` in service.ts) |
| Compiler | xcc (cc.wasm) running in browser | No |
| WASI version | `wasi_snapshot_preview1` | No |
| Tree-sitter | Used for source transformation only | No |
| Struct alignment cap | 4 bytes (ILP32) | No |
