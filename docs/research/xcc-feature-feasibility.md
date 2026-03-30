# xcc + WASM Feature Feasibility Assessment

> Cross-references CrowCode's feature inventory (`docs/feature-inventory.md`) against xcc's verified capabilities. Each feature is assessed for: (1) does xcc compile it correctly, (2) can the source instrumentation strategy observe it, (3) any gaps or caveats.
>
> Last updated: 2026-03-29.
> Based on: xcc source analysis (2,915 commits, test suite with ~581 assertions), live demo testing, and issue tracker review.

## Legend

- **xcc**: Does xcc's WASM target compile this correctly?
- **Observe**: Can source instrumentation (`__crow_*` callbacks reading WASM linear memory) capture this for visualization?
- **Verdict**: `ready` (works as-is), `workaround` (needs adaptation), `gap` (significant issue), `blocker` (can't work)

---

## 1. Data Types

| Type | CrowCode Status | xcc Support | Observable | Verdict | Notes |
|------|----------------|-------------|------------|---------|-------|
| `char` (1 byte) | Implemented | Yes | Yes | ready | |
| `short` (2 bytes) | Implemented | Yes | Yes | ready | |
| `int` (4 bytes) | Implemented | Yes | Yes | ready | |
| `long` | Implemented (8 bytes) | Yes, but **4 bytes** (ILP32) | Yes | workaround | xcc uses ILP32: `sizeof(long) == 4`. CrowCode's interpreter treats long as 8 bytes. The WASM pipeline would show 4-byte longs — **more accurate** than the interpreter, but different. |
| `float` (4 bytes) | Implemented | Yes (WASM f32) | Yes | ready | xcc uses native WASM `f32` ops. Unlike interpreter (JS double), this gives true single-precision. |
| `double` (8 bytes) | Implemented | Yes (WASM f64) | Yes | ready | |
| `void` | Implemented | Yes | N/A | ready | |
| Pointers (4 bytes) | Implemented | Yes (ILP32) | Yes | ready | 32-bit addresses, same as interpreter. |
| Arrays (1D) | Implemented | Yes | Yes | ready | Always in linear memory. |
| Multi-dimensional arrays | Implemented | Yes | Yes | ready | Tested 2D; type system supports N-D. |
| Structs | Implemented | Yes | Yes | ready | Nested, self-referential via pointers, designated initializers, anonymous unions inside structs. Always in linear memory. |
| String literals | Implemented | Yes | Yes | ready | Stored in WASM data segments at fixed addresses. JS-readable. |
| Function pointers | Implemented | Yes | Partial | workaround | xcc uses WASM `call_indirect` + funcref table. The function pointer *value* is a table index (small integer), not a memory address. Displaying it as a hex address (like the interpreter does) would be misleading. Need to map table indices to function names. |
| `enum` | **Not implemented** | Yes | Yes | ready | **Free upgrade** — xcc supports enums natively (stored as 4-byte int). |
| `union` | **Not implemented** | Yes | Yes | ready | **Free upgrade** — xcc supports unions with designated initializers. |
| `typedef` | **Not implemented** | Yes | N/A | ready | **Free upgrade** — xcc supports typedef. The source transformer needs to track type aliases for display names. |
| `_Bool` | Not in inventory | Yes (1 byte) | Yes | ready | Bonus feature. |
| `unsigned` variants | **Not implemented** (signed only) | Yes (full semantics) | Yes | ready | **Free upgrade** — xcc generates correct unsigned opcodes (`SHR_U`, `DIV_U`, `REM_U`, `LT_U`, etc.). |

### Instrumentation caveat: `&x` and local variables

**Critical finding:** xcc only places local primitive variables in WASM linear memory if their address is taken (`&x`). Otherwise, they live as WASM register locals (invisible to memory reads).

The instrumentation strategy injects `__crow_decl("x", &x, ...)` which takes the address — this **automatically forces the variable into linear memory**. So the instrumentation itself solves this problem. No compiler modification needed.

Non-primitive types (structs, arrays, unions) are always in linear memory regardless.

---

## 2. Operators

| Operator | CrowCode Status | xcc Support | Observable | Verdict | Notes |
|----------|----------------|-------------|------------|---------|-------|
| `+` `-` `*` `/` `%` | Implemented | Yes | Yes (via `__crow_set`) | ready | Division by zero traps in WASM (unlike interpreter which returns error string). |
| Pointer `+`/`-` integer | Implemented | Yes (scales by sizeof) | Yes | ready | |
| Pointer `-` pointer | **Not implemented** | Yes | Yes | ready | **Free upgrade** — xcc implements `(lhs - rhs) / sizeof(*lhs)`. |
| Unary `-` `+` | Implemented | Yes | Yes | ready | |
| Comparisons (`<` `>` `<=` `>=` `==` `!=`) | Implemented | Yes | Yes | ready | Correctly dispatches signed vs unsigned variants. |
| Logical `&&` `\|\|` `!` | Implemented | Yes | Yes | ready | Short-circuit semantics preserved. |
| Bitwise `&` `\|` `^` `~` `<<` `>>` | Implemented | Yes | Yes | ready | `>>` correctly signed for signed types, unsigned for unsigned types. **Upgrade** over interpreter (which always uses arithmetic shift). |
| All compound assignments | Implemented | Yes | Yes | ready | `+=` `-=` `*=` `/=` `%=` `<<=` `>>=` `&=` `\|=` `^=` all tested. |
| `++` `--` (pre/post) | Implemented | Yes | Yes | ready | |
| Ternary `? :` | Implemented | Yes | Yes | ready | |
| Comma `,` | Implemented | Yes | Yes | ready | |
| `sizeof(type)` | Implemented | Yes | Yes | ready | |
| `sizeof(expr)` | Implemented | Yes | Yes | ready | Arrays return full size (not decayed). |
| Cast `(type)expr` | Implemented | Yes | Yes | ready | Full int-int, int-float, float-int, float-float. Widening and narrowing with correct signed/unsigned handling. |
| Address-of `&` | Implemented | Yes | Yes | ready | Forces variable to linear memory. See instrumentation caveat above. |
| Dereference `*` | Implemented | Yes | Yes | ready | |
| Array-to-pointer decay | Implemented | Yes | Yes | ready | |

### Division by zero behavior change

The interpreter returns an error string for division by zero. WASM **traps** — execution halts with a `RuntimeError: integer divide by zero`. The WASM pipeline would need to catch this trap and surface it in the error UI rather than displaying it as a step annotation.

---

## 3. Control Flow

| Construct | CrowCode Status | xcc Support | Observable | Verdict | Notes |
|-----------|----------------|-------------|------------|---------|-------|
| `if` / `else` / `else if` | Implemented | Yes | Yes | ready | |
| `for` | Implemented | Yes | Yes | ready | Including multiple init expressions, empty sections. |
| `while` | Implemented | Yes | Yes | ready | |
| `do-while` | Implemented | Yes | Yes | ready | |
| `switch`/`case`/`default` | Implemented | Yes | Yes | ready | Fall-through semantics work. One edge case skipped on WASM: `switch` with `if(0){default:}` — exotic pattern, irrelevant for educational use. |
| `break` | Implemented | Yes | Yes | ready | In loops and switch. |
| `continue` | Implemented | Yes | Yes | ready | |
| `return` | Implemented | Yes | Yes | ready | Early return, nested contexts. |
| Block `{ }` | Implemented | Yes | Yes | ready | |
| `goto` / labels | **Not implemented** | Partial | Yes | workaround | Forward/ancestor-scope only. No backward jumps. Sufficient for `goto cleanup` patterns but not general goto. CrowCode's feature inventory lists this as unimplemented anyway — xcc provides partial support as a bonus. |
| `setjmp`/`longjmp` | Not in inventory | Yes | Partial | workaround | Uses WASM exception handling proposal. Requires runtime support (available in modern browsers). Observing the "jump" in the step trace would need special handling. |

### Sub-step generation

The interpreter generates sub-steps for conditions, loop updates, etc. with column-level highlighting. With source instrumentation, sub-step granularity depends on where `__crow_step` calls are injected:

- **Statement-level** (easy): inject before each statement. Matches interpreter's anchor steps.
- **Expression-level** (harder): inject inside conditions, loop updates, ternary branches. Requires more sophisticated source transformation. The injected calls must not change evaluation order or short-circuit semantics.

Recommendation: start with statement-level instrumentation. Add expression-level sub-steps later if needed.

---

## 4. Functions

| Feature | CrowCode Status | xcc Support | Observable | Verdict | Notes |
|---------|----------------|-------------|------------|---------|-------|
| User-defined functions | Implemented | Yes | Yes | ready | |
| Parameters (scalars) | Implemented | Yes | Yes | ready | |
| Parameters (structs by value) | Implemented | Yes (via stack copy) | Yes | ready | Multi-member structs passed via linear memory stack. Earlier reports of this being broken are outdated — verified working in current xcc. |
| Parameters (pointers) | Implemented | Yes | Yes | ready | |
| Parameters (arrays) | Implemented | Yes (decay to pointer) | Yes | ready | |
| Return values (scalars) | Implemented | Yes | Yes | ready | |
| Return values (structs) | Not in inventory | Yes (via hidden pointer) | Yes | ready | Bonus — multi-member structs returned via caller-provided memory. |
| Recursion | Implemented | Yes | Yes | workaround | Two limits: xcc's software stack (default 8KB, configurable via `--stack-size`) and WASM runtime call stack (~1000-10000 frames). The interpreter's `maxFrames: 256` is a tighter limit. |
| Function pointers | Implemented | Yes (`call_indirect`) | Partial | workaround | Values are table indices, not memory addresses. See Data Types section. |
| Variadic functions | **Not implemented** | Yes (`va_list`/`va_arg`) | Yes | ready | **Free upgrade** — xcc has extensive variadic support including structs in varargs. |
| Forward declarations | **Not implemented** | Yes | N/A | ready | **Free upgrade** — xcc supports prototypes. |
| Multiple return paths | Implemented | Yes | Yes | ready | |
| Stack frame visualization | Implemented | N/A (see below) | workaround | See "Scope tracking" under instrumentation. |
| Column highlighting | Implemented | N/A | workaround | Requires `__crow_step` to pass column info. Achievable with tree-sitter source positions. |
| Stack overflow detection | Implemented | Partial | workaround | WASM traps on OOB memory access (if stack underflows into unmapped memory). The interpreter gives a clean error at `maxFrames`. The WASM pipeline would need to catch the trap. |
| Static local variables | Not in inventory | Yes | Yes | ready | Bonus — persist across function calls. |
| Inline functions | Not in inventory | Yes | Yes | ready | Bonus. |

### Scope tracking challenge

The interpreter tracks scope push/pop explicitly and emits `addEntry`/`removeEntry` ops for scope frames. With source instrumentation, the transformer must inject `__crow_push_scope("main")` at function entry and `__crow_pop_scope()` at every exit point (return statements, function end, early exits).

This is tractable but fiddly for functions with multiple return paths — every `return` needs a `__crow_pop_scope()` before it. The tree-sitter AST provides the structure needed to find all exit points.

---

## 5. Memory Management

| Feature | CrowCode Status | xcc Support | Observable | Verdict | Notes |
|---------|----------------|-------------|------------|---------|-------|
| `malloc(size)` | Implemented | Yes (K&R allocator) | Yes | ready | All addresses are WASM linear memory offsets, directly readable from JS. 8-byte alignment (vs interpreter's 16-byte). |
| `calloc(count, size)` | Implemented | Yes | Yes | ready | `malloc` + `memset(0)`. No overflow check on multiply. |
| `realloc(ptr, size)` | **Not implemented** | Yes | Yes | ready | **Free upgrade** — `malloc` + `memcpy` + `free`. |
| `free(ptr)` | Implemented | Yes | Yes | ready | |
| Cross-function free | Implemented | Yes | Yes | ready | Pointers are just memory addresses — works naturally. |
| Leak detection | Implemented | N/A (custom) | workaround | xcc's allocator has no leak detection. The `__crow_malloc`/`__crow_free` wrappers must track allocations and check at program exit. Same logic as interpreter's `detectLeaks()`. |
| Double-free detection | Implemented | No | workaround | K&R allocator has no double-free detection. The wrapper layer must track freed addresses and detect double-free before calling real `free`. |
| Invalid free detection | Implemented | No | workaround | Same as above — wrapper must validate pointer before calling real `free`. |
| Null pointer dereference | Implemented | WASM trap | workaround | WASM traps on OOB memory access (address 0 is typically valid linear memory in WASM but contains data segment headers). The behavior differs from the interpreter's clean error message. May need to guard address 0 or catch the trap. |
| Stack array bounds | Implemented | No detection | gap | xcc has no bounds checking. Out-of-bounds writes silently corrupt adjacent memory. The interpreter catches these. **This is a regression** — the WASM pipeline loses bounds checking unless the instrumentation adds it. |
| Heap array bounds | Implemented | No detection | gap | Same — no built-in bounds checking. Heap overflows corrupt adjacent allocations silently. |
| Use-after-free | Implemented | No detection | workaround | The wrapper layer can track freed blocks and detect reads/writes to freed memory — but only for accesses that go through instrumented paths, not arbitrary pointer dereferences. |
| Uninitialized variables | Implemented | No detection | workaround | WASM zero-initializes linear memory. Local primitives kept in WASM registers get `0` as default. There's no concept of "uninitialized" — **all memory appears initialized**. The source transformer could track which variables have been explicitly assigned and show `(uninit)` before the first assignment, but this is cosmetic, not based on actual memory state. |

### Key regression: Safety checks

The interpreter provides extensive safety checking (bounds, use-after-free, double-free, null dereference, uninitialized tracking). The WASM pipeline loses all of these by default. The `__crow_malloc`/`__crow_free` wrappers can recover heap-related checks, but **stack array bounds checking is lost entirely** unless the instrumentation inserts explicit bounds checks before each array access — significantly complicating the source transformer.

This is a strong argument for the **dual mode** approach: interpreter for safety-focused visualization, WASM for "real execution" mode where students see what actually happens (including silent corruption).

---

## 6. Standard Library

### Currently implemented in CrowCode — xcc coverage

| Function | CrowCode | xcc libc | Verdict | Notes |
|----------|----------|----------|---------|-------|
| `printf(fmt, ...)` | Yes | Yes | ready | xcc supports `%d %u %x %X %o %s %c %p %f %g %%` with width, precision, flags. Missing: `%e` (scientific), `%i`. |
| `scanf(fmt, ...)` | Yes | **MISSING** | blocker | **xcc has no scanf implementation at all.** No `scanf`, `sscanf`, or `fscanf`. This is the single biggest gap. |
| `puts(str)` | Yes | Yes | ready | |
| `putchar(c)` | Yes | Yes | ready | |
| `getchar()` | Yes | Yes | ready | Macro: `fgetc(stdin)`. |
| `fprintf(stream, fmt, ...)` | Yes | Yes | ready | |
| `fputs(str, stream)` | Yes | Yes | ready | |
| `fgets(buf, n, stdin)` | Yes | Yes | ready | |
| `gets(buf)` | Yes | **MISSING** | N/A | Deprecated in C11 anyway. Not a real loss. |
| `sprintf(buf, fmt, ...)` | Yes | Yes | ready | |
| `snprintf(buf, n, fmt, ...)` | Yes | Yes | ready | |
| `strlen(s)` | Yes | Yes | ready | |
| `strcpy(dst, src)` | Yes | Yes | ready | |
| `strcmp(a, b)` | Yes | Yes | ready | |
| `strcat(dst, src)` | Yes | Yes | ready | |
| `abs(x)` | Yes | Yes | ready | |
| `sqrt(x)` | Yes | Yes | ready | |
| `pow(x, y)` | Yes | Yes | ready | |
| `malloc` | Yes | Yes | ready | |
| `calloc` | Yes | Yes | ready | |
| `free` | Yes | Yes | ready | |

### Not implemented in CrowCode — free upgrades from xcc

| Function | CrowCode | xcc libc | Verdict | Notes |
|----------|----------|----------|---------|-------|
| `realloc` | No | Yes | ready | Free upgrade. |
| `memcpy` | No | Yes | ready | Free upgrade. |
| `memset` | No | Yes | ready | Free upgrade. |
| `memmove` | No | Yes | ready | Free upgrade. |
| `strncpy` | No | Yes | ready | |
| `strncmp` | No | Yes | ready | |
| `strncat` | No | Yes | ready | |
| `strchr` | No | Yes | ready | |
| `strrchr` | No | Yes | ready | |
| `strstr` | No | Yes | ready | |
| `strtok` | No | Yes | ready | |
| `atoi` | No | Yes | ready | |
| `atof` | No | Yes | ready | |
| `strtol`/`strtoul`/`strtod` | No | Yes | ready | |
| `rand`/`srand` | No | Yes | ready | |
| `exit` | No | Yes | ready | |
| `atexit` | No | Yes | ready | |
| `qsort` | No | Yes | ready | Needs function pointer support — xcc has it. |
| `bsearch` | No | Yes | ready | |
| `sin`/`cos`/`tan` | No | Yes | ready | Custom libm — accuracy may vary. |
| `log`/`exp` | No | Yes | ready | |
| `ceil`/`floor`/`round`/`fabs`/`fmod` | No | Yes | ready | |
| `isalpha`/`isdigit`/`isspace` | No | Yes | ready | |
| `toupper`/`tolower` | No | Yes | ready | |
| `assert` | No | Yes | ready | |
| `time` | No | Yes | ready | |
| `fopen`/`fclose`/`fread`/`fwrite` | No | Yes | workaround | Present but needs a virtual filesystem in the browser. |
| `abort` | No | **MISSING** | gap | Not in xcc's libc. |
| `clock` | No | **MISSING** | gap | Only `clock_gettime` is available. |
| `sscanf` | No | **MISSING** | blocker | Part of the scanf gap. |

### The scanf blocker

**xcc's libc has no scanf, sscanf, or fscanf.** This is the single biggest gap for CrowCode, since scanf is one of the most common functions in introductory C courses.

**Mitigation options:**

1. **Write a scanf implementation for xcc's libc.** scanf is complex (~500-1000 lines for reasonable coverage) but well-specified. Could be contributed upstream or bundled as CrowCode's addition to the virtual filesystem.

2. **Source-level replacement.** The source transformer could rewrite `scanf("%d", &x)` into calls to custom `__crow_scanf_int(&x, __LINE__)` etc. This gives CrowCode full control over scanf behavior and allows the interactive stdin pause mechanism. Downside: non-trivial to handle all format strings.

3. **Port a scanf from another libc.** musl's scanf is ~600 lines. It could be adapted for xcc's WASM libc with moderate effort.

4. **Hybrid approach.** Use xcc for compilation and execution of everything except scanf. When the program calls scanf, the WASM import mechanism routes it to a JS implementation (CrowCode's existing `IoState` logic). This is the most architecturally clean option — xcc compiles the code, JS handles I/O.

**Recommendation:** Option 4 (hybrid). Declare `scanf` as an undefined symbol (`--allow-undefined`). Implement it as a WASM import in JS, reusing CrowCode's existing `IoState` class for stdin buffering, format parsing, and interactive pause/resume. This also gives CrowCode control over the step visualization for scanf calls.

---

## 7. Partially Working Features — Reassessment

| Feature | Interpreter Issue | xcc Behavior | Verdict |
|---------|------------------|-------------|---------|
| `long` (64-bit) | Sized 8 bytes, arithmetic is 32-bit | 4 bytes (ILP32), arithmetic correct for 4 bytes. `long long` is 8 bytes with full 64-bit arithmetic via WASM i64 ops. | **Improvement** — arithmetic matches type size. Different model though (long=4 vs long=8). |
| Preprocessor | `#include` ignored, `#define` ignored | **Full preprocessor** — `#include`, `#define`, `#ifdef`, `#elif`, `#pragma`, function-like macros. | **Major upgrade** — real preprocessor support. |
| 3D+ arrays | Only 2D tested | Supported by type system, tested to 2D. | Same — needs testing. |
| `sprintf` format gaps | `%f %p %u` missing | `%f %p %u` all present in xcc's sprintf/printf. | **Fixed** — xcc's printf covers all common specifiers (except `%e`). |
| `scanf` format gaps | `%i` octal/hex missing, `%s` doesn't write bytes | No scanf at all. | **Regression** unless scanf is provided via JS import (see above). |
| printf/scanf length modifiers | Parsed and ignored | `%ld %lld %Lf %zd %zu` all correctly handled. | **Fixed** — real length modifier support. |
| Empty loop bodies | May produce errors | No issue — standard C semantics. | **Fixed**. |

---

## 8. Not Implemented Features — Free Upgrades

Features CrowCode's interpreter doesn't support but xcc handles natively:

| Feature | xcc Status | Observable | Notes |
|---------|-----------|------------|-------|
| `enum` | Full support | Yes | Stored as 4-byte int. Enum constant names available at compile time. |
| `union` | Full support | Yes | Overlapping fields at same address. |
| `typedef` | Full support | Source transformer tracks aliases | |
| `goto` (restricted) | Forward/ancestor only | Yes | Good enough for `goto cleanup` patterns. |
| `static` / `extern` / `const` | Enforced | Yes | Real semantics, not just parsed-and-ignored. |
| `volatile` / `register` | Parsed | N/A | WASM ignores these (no hardware registers to hint). |
| Variable-length arrays (VLA) | Supported | Yes | `alloca`-style stack allocation. |
| Global variables | Supported | Yes | In WASM data segments, always addressable. |
| Multiple declarators (`int a, b;`) | Supported | Yes | Standard C parsing. |
| Forward declarations | Supported | N/A | Prototypes work. |
| Bit-fields | Supported | Partial | Memory layout is compiler-determined. Instrumentation can read the containing int but individual bit-field display needs type info from the source transformer. |
| `#define` macros | **Full preprocessor** | N/A | Real macro expansion, conditional compilation, includes. |
| Designated initializers | Supported | Yes | `.field = val` and `[index] = val`. |
| Variadic functions | Supported | Yes | `va_list`, `va_arg`, structs in varargs. |
| `(*fp)(args)` call syntax | Supported | Yes | Both `fp(args)` and `(*fp)(args)`. |
| Function pointers in structs | Supported | Partial | `struct { int (*cb)(int); }` works. Observation via table index (see earlier caveat). |
| Compound literals | Supported | Yes | `(struct Point){1, 2}` etc. |
| Unsigned integer semantics | **Full support** | Yes | Correct unsigned opcodes for all operations. |
| Pointer-pointer subtraction | Supported | Yes | `p - q` returns element count. |
| `_Bool` | Supported | Yes | 1-byte, correct cast semantics. |
| `setjmp`/`longjmp` | Supported (via exceptions) | Partial | Requires WASM exception handling proposal in runtime. |

**Total: 24 features that become available for free** by switching to xcc, many of which are Priority 1-2 in the feature inventory.

---

## 9. Architecture Constraints — What Changes

| Constraint | Interpreter | xcc + WASM | Impact |
|-----------|------------|------------|--------|
| Integer model | ILP32 (`long`=8) | ILP32 (`long`=**4**, `long long`=8) | `long` size differs. xcc is standard for 32-bit. Student code using `long` for "bigger int" would see different sizes. |
| Pointer size | 4 bytes | 4 bytes | Same. |
| Stack base | `0x7FFC0000` | Depends on xcc layout (grows down from end of linear memory) | Different addresses. Stack addresses will look different in the UI. |
| Heap base | `0x55A00000` | `__heap_base` linker symbol (after data segments) | Different addresses. Heap addresses will be lower (closer to code/data). |
| Stack growth | Downward | Downward | Same. |
| Heap growth | Upward, 16-byte aligned | Upward, 8-byte aligned | Slightly different alignment. |
| Max steps | 500 | Configurable (via `__crow_step` counter) | Same concept, different mechanism. |
| Max stack frames | 256 | Software stack (8KB default) + WASM call stack | Different limit model — bytes rather than frame count. |
| Max heap size | 1 MB | WASM memory limit (configurable pages) | More flexible. |
| Alignment rules | Manual (CrowCode's `alignOf`) | Compiler-determined (C standard rules) | Should match — both follow C alignment conventions. Worth verifying in spike #7. |
| Float precision | JS double for both float/double | WASM f32 for float, f64 for double | **More accurate** — xcc gives real single-precision for `float`. |
| Division by zero | Error string, execution continues | WASM trap, execution halts | Behavioral difference — needs trap handling. |
| Array bounds | Checked | Unchecked | **Regression** — see Memory Management section. |
| Uninitialized memory | Tracked and displayed | Zero-initialized (WASM spec) | **Regression** — can't show `(uninit)` based on actual memory state. |

---

## 10. Summary

### What works well (ready or minor workaround)

- **All data types** the interpreter currently supports, plus enums, unions, typedefs, unsigned, _Bool
- **All operators**, with correct unsigned semantics as a bonus
- **All control flow** (goto restricted to forward/ancestor, which is fine)
- **All function features**, including struct pass-by-value (confirmed working), variadic functions, forward declarations
- **Memory allocation** (malloc/calloc/realloc/free) — all in linear memory, JS-readable
- **Most of the standard library** — 40+ functions available for free
- **Full preprocessor** — `#define`, `#include`, `#ifdef` all work
- **24 currently-unimplemented features become available** for free

### What needs work (workarounds)

| Issue | Severity | Mitigation |
|-------|----------|------------|
| Function pointer display (table index vs address) | Low | Map table indices to function names in the `__crow_*` layer |
| Scope tracking (push/pop at function boundaries) | Medium | Source transformer injects `__crow_push_scope`/`__crow_pop_scope` at all entry/exit points |
| Leak/double-free/invalid-free detection | Medium | `__crow_malloc`/`__crow_free` wrappers track allocations (same logic as interpreter) |
| Null pointer dereference display | Low | Catch WASM traps and surface in error UI |
| Uninitialized variable tracking | Low | Source transformer tracks first-assignment; cosmetic only |
| Stack overflow display | Low | Catch WASM OOB trap; optionally inject frame counter |
| Sub-step generation | Medium | Start with statement-level; expression-level requires more sophisticated source transform |
| `long` size difference (4 vs 8 bytes) | Low | Document the difference; xcc's behavior is more standard for 32-bit |

### What's a real gap

| Issue | Severity | Mitigation |
|-------|----------|------------|
| **No scanf** | High | Implement as WASM import (JS-side), reusing CrowCode's `IoState`. Recommended approach. |
| **No array bounds checking** | Medium | Accept as behavioral difference (real C has no bounds checking). Or: inject bounds checks in source transformer (complex). |
| **No `%e` printf specifier** | Low | Could be added to xcc's vfprintf or handled in a custom printf wrapper. |
| **No `abort()`** | Low | Trivially implementable as a WASM import that throws. |

### Blockers

**Only one: scanf.** But it has a clean mitigation (WASM import to JS). If the scanf-as-import approach works (testable in a spike), there are no true blockers.

### Net assessment

The xcc + WASM approach is **feasible**. The feature coverage is a strict superset of the interpreter's for compilation/execution, with regressions only in safety checking (bounds, use-after-free, uninitialized tracking) — which are inherent to moving from an interpreter to real compilation. The dual-mode recommendation stands: interpreter for safety-focused visualization, WASM for accurate execution.
