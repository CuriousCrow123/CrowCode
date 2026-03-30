# Research Strategy: Native C Compilation via WASM with Memory Introspection

> Status: **Spikes validated — approach confirmed feasible.** Ready for implementation planning.
> Last updated: 2026-03-29.
> Related docs: `xcc-feature-feasibility.md`, `c-wasm-browser-execution.md`, `c-stdio-terminal-behavior.md`
>
> **Spike results (2026-03-29):** 7 of 8 spikes executed and passed. WASM imports work. Memory reading works. scanf as JS import works (va_list indirection understood). Struct layouts match. Heap interposition works. GitHub Pages lacks COOP/COEP (progressive re-execution for interactive stdin). Only spike 1.3 (in-browser compilation via WASI) remains untested.

## Goal

Replace CrowCode's interpreter with a pipeline that **compiles C to WASM and executes it natively**, while producing the same `Program` output (steps + `SnapshotOp[]`) that the existing UI consumes. The engine, validation, navigation, diff, console, and UI layers remain unchanged.

**Hard constraint:** Everything must run on GitHub Pages — no backend, no compilation server, no external APIs.

The contract:

```
[new backend] --> Program { steps: ProgramStep[] } --> buildSnapshots() --> UI
```

## Strategy: Source Instrumentation + xcc + WASM Execution

The prior research (`c-wasm-browser-execution.md`) established that:
- Binary-level WASM instrumentation (Binaryen) loses C semantics (variable names, types, scopes)
- DWARF-in-WASM tooling is immature and fragile for mapping back to C source
- Source/interpreter-level instrumentation is the only approach that preserves the C semantics CrowCode's `MemoryEntry` model requires

The compiler research (below) established that **xcc is the only viable in-browser C-to-WASM compiler**.

The feasibility analysis (`xcc-feature-feasibility.md`) confirmed that **the approach is feasible with one blocker (scanf) that has a clean mitigation**.

This strategy combines three pieces:
1. **Source instrumentation** — transform the C source (using the existing tree-sitter parser) to inject reporting calls before compilation
2. **xcc compilation** — compile the instrumented C to WASM entirely in the browser (~144KB compiler payload)
3. **WASM execution** — run the compiled module with the injected calls implemented as JS-side WASM imports

The instrumented code looks like:

```c
// Original
int x = 5;
x = x + 1;

// Instrumented
int x = 5;
__crow_decl("x", &x, sizeof(x), "int", __LINE__);
x = x + 1;
__crow_set("x", &x, __LINE__);
```

The `__crow_*` functions are WASM imports implemented in JS. When called, JS reads values from WASM linear memory and accumulates `SnapshotOp[]` data.

### Why instrumentation via `&x` works

A critical finding from the feasibility analysis: xcc only places local primitive variables in WASM linear memory if their address is taken (`&x`). Otherwise they live as WASM register locals, invisible to memory reads.

The instrumentation strategy injects `__crow_decl("x", &x, ...)` which takes the address — this **automatically forces the variable into linear memory**. The `VS_REF_TAKEN` flag is set at parse time, and the codegen allocates the variable in the stack frame rather than a WASM local. No compiler modification needed.

Non-primitive types (structs, arrays, unions) are always in linear memory regardless.

## Compiler Landscape

### xcc — the only viable option

**xcc** (github.com/tyfkda/xcc) is a self-hosting C compiler written in C, with a WASM-targeting component called `wcc`. It compiles C directly to WASM binary (no intermediate assembly or IR). Live demo at tyfkda.github.io/xcc/.

| Property | Detail |
|----------|--------|
| Bundle size | **~144KB compressed** (compiler WASM + bundled libc + headers) |
| Pipeline | C source → preprocessor → AST → WASM codegen → WASM linker → `.wasm` binary |
| Stars / Commits | 457 stars, 2,915 commits, MIT license |
| Last activity | Active (commits within the last week) |
| Self-hosting | Yes — compiles itself to WASM |
| Browser runtime | Uses `@wasmer/wasi` + `@wasmer/wasmfs` for virtual filesystem |
| Integer model | ILP32 (`long`=4, `long long`=8, pointer=4) |
| WASM imports | `--allow-undefined` + configurable `--import-module-name` |

**Verified C feature coverage** (from source analysis + test suite):

- All integer types (char through long long), float, double, `_Bool`, `enum`, `union`
- **Unsigned semantics** — correct opcodes (SHR_U, DIV_U, REM_U, LT_U, etc.)
- **Structs** — nested, self-referential, designated initializers, anonymous unions, bitfields
- **Struct pass-by-value** — confirmed working (earlier reports of this being broken are outdated)
- **Pointers** — arithmetic (including pointer-pointer subtraction), casting, `void*`
- **Arrays** — multi-dimensional, VLAs, array-to-pointer decay
- **Function pointers** — via WASM `call_indirect` + funcref table
- **Variadic functions** — `va_list`, `va_arg`, structs in varargs
- **Full preprocessor** — `#include`, `#define`, `#ifdef`, `#elif`, function-like macros
- **malloc/calloc/realloc/free** — K&R allocator, 8-byte aligned, all in linear memory
- **typedef**, **inline functions**, **forward declarations**, **static locals**
- **goto** — restricted to forward/ancestor scope (WASM limitation)
- **setjmp/longjmp** — via WASM exception handling proposal

**Tested against:** Lua, SQLite, libpng, tinycc, CPython, git.

### What xcc is missing

| Gap | Severity | Mitigation |
|-----|----------|------------|
| **No scanf/sscanf/fscanf** | High | Implement as WASM import in JS, reusing CrowCode's `IoState` |
| No `abort()` | Low | Trivial WASM import that throws |
| No `%e` printf specifier | Low | Add to xcc's vfprintf or custom wrapper |
| No `clock()` | Low | Only `clock_gettime` available |
| Incomplete `libm` accuracy | Low | Math functions present but custom (not musl/fdlibm) |

### Why nothing else works

| Compiler | Problem |
|----------|---------|
| **Clang/Wasmer** | 30-100MB download — impractical for static site |
| **Emscripten** | CLI toolchain (LLVM + Python + filesystem) — cannot run in browser |
| **chibicc** | x86-64 only, no WASM backend. Adding one requires a relooper + months of work |
| **8cc/ELVM** | Extremely limited C (no structs, no floats). Switch-dispatch control flow — terrible output quality |
| **lcc** | Dormant (1995 textbook). C89 only, no WASM backend |
| **cproc/QBE** | No WASM backend. QBE author skeptical of WASM's structured control flow |
| **TCC** | Can't target WASM output — no relooper |
| **c4wa** | Written in Java — can't run in browser |
| **mini-c** | Experimental, very incomplete |

The core blocker for most small compilers is WASM's **structured control flow requirement**. WASM has no `goto` — only `block`, `loop`, `if/else`, `br`. Converting arbitrary C control flow requires a relooper or stackifier. xcc sidesteps this by restricting goto and emitting directly from the AST.

## Feasibility Summary

Full analysis in `xcc-feature-feasibility.md`. Key results:

### What we gain (24 features become free)

Enums, unions, typedefs, unsigned integer semantics, full preprocessor (`#define`, `#include`, `#ifdef`), variadic functions, VLAs, global variables, forward declarations, designated initializers, bitfields, compound literals, pointer-pointer subtraction, `_Bool`, `static`/`extern`/`const` enforcement, `realloc`, `memcpy`/`memset`/`memmove`, `strncpy`/`strchr`/`strstr`/`strtok`, `atoi`/`atof`/`strtol`, `rand`/`srand`, `qsort`/`bsearch`, math functions, `ctype.h`, `assert`, real single-precision `float`.

### What we lose (safety checks)

| Lost Feature | Why | Dual-mode answer |
|-------------|-----|-----------------|
| Array bounds checking | Real C has no bounds checking | Interpreter catches these; WASM shows real behavior |
| Use-after-free detection | Real free'd memory is reusable | Wrapper can track, but not for arbitrary pointer dereferences |
| Double-free detection | K&R allocator has no detection | Wrapper tracks freed addresses |
| Uninitialized variable display | WASM zero-initializes all memory | Source transformer tracks first assignment (cosmetic) |
| Null pointer dereference message | WASM traps (address 0 may be valid linear memory) | Catch trap, surface in error UI |

This reinforces the **dual-mode** recommendation: interpreter for safety-focused visualization (default), WASM for real-execution mode (opt-in).

### What needs work (workarounds)

| Issue | Mitigation |
|-------|------------|
| scanf missing from xcc libc | WASM import → JS (`IoState`). Cleanest option. |
| Function pointer display (table index vs hex address) | Map table indices to function names in `__crow_*` layer |
| Scope tracking | Source transformer injects `__crow_push_scope`/`__crow_pop_scope` at all entry/exit points |
| Heap safety (leak/double-free/invalid-free) | `__crow_malloc`/`__crow_free` wrappers track allocations |
| Sub-step generation | Start statement-level; expression-level is harder (must preserve evaluation order) |
| Division by zero | WASM traps instead of error string. Catch `RuntimeError`. |
| `long` size difference | xcc: 4 bytes (ILP32). Interpreter: 8 bytes. xcc is more standard for 32-bit. |

## Research Phases

Phases are ordered by risk. Each has a concrete spike (time-boxed throwaway experiment) and a decision point. Findings from the feasibility analysis have **de-risked several phases** — noted inline.

---

### Phase 1: xcc Validation

**Question:** Does xcc compile instrumented C programs correctly, and does the WASM import mechanism work for our use case?

**Risk level after feasibility analysis:** Low-Medium. We've confirmed from source analysis that `--allow-undefined` emits WASM imports and that the C features we need are supported. What remains is hands-on verification.

**Spikes:**

- [x] **1.1 Basic xcc build + import test** (~2 hours) — **PASSED 2026-03-29**
   - [x] Clone xcc, build it natively (requires `llvm-ar` in PATH)
   - [x] Write a trivial C program that calls an undefined function `__crow_step(int line)`
   - [x] Compile with `wcc -Wl,--allow-undefined` — produces 622-byte .wasm
   - [x] Instantiate the `.wasm` in JS with `__crow_step` provided as an import in `env`
   - [x] Confirm: JS receives callbacks with correct line numbers. WASM linear memory is readable during callbacks.
   - [x] Pass pointer arguments and read int (42→43), float (3.14 as real f32), struct fields ({a=10,b=20}) from linear memory
   - **Result**: All `__crow_*` functions received as WASM imports in `env` module. `&x` gives valid linear memory addresses. Types read correctly via `DataView`.

- [x] **1.2 Feature coverage test** (~2 hours) — **PASSED 2026-03-29**
   - [x] Compiled scalar ops, structs (nested + self-referential), malloc/calloc/free, pointer arithmetic, function calls
   - [x] Struct pass-by-value: **confirmed working** — `vec_add(v1, v2)` returns `{4,6}` correctly
   - [x] Function pointers: `apply(add, 10, 20)` returns 30 via `call_indirect`
   - [x] Pointer-pointer subtraction: works
   - [x] `scanf` as extern undefined: compiles and links with `--allow-undefined`
   - **Result**: All CrowCode-relevant C features compile and execute correctly. `printf` output verified: `add=7 fac=120 apply=30 vec=(4,6)`.

- [ ] **1.3 In-browser compilation test** (~2 hours)
   - [ ] Use xcc's live demo infrastructure (`@wasmer/wasi` + virtual FS) to compile a program in the browser
   - [ ] Measure: compilation latency, total download size, first-compile experience
   - [ ] Test: does `--allow-undefined` work in the browser-hosted compiler?
   - [ ] Test custom header injection — can we add a `__crow.h` to the virtual FS that declares all `__crow_*` functions?

- [ ] **1.4 WASI runtime alternatives** (~1 hour)
   - [ ] Survey: `browser_wasi_shim`, `@aspect-build/aspect-wasm-wasi`, custom minimal shim
   - [ ] Key question: can we run xcc's `cc.wasm` with a lighter/newer WASI runtime than `@wasmer/wasi` 0.12?

**Decision point:** If xcc can compile instrumented C with working WASM imports, proceed. If not, the entire approach fails — stay with the interpreter.

---

### Phase 2a: WASM Execution Control

**Question:** Can we run the compiled WASM module and receive callbacks at each C source line?

**Risk level after feasibility analysis:** Low. We've confirmed that `&x` forces variables into linear memory (via `VS_REF_TAKEN`), and that WASM imports give synchronous JS callbacks. The remaining question is whether batch execution is fast enough.

**Spikes:**

- [ ] **2a.1 Synchronous callback + memory read** (~1 hour)
   - [ ] Confirm JS callback fires at each `__crow_step` call
   - [ ] Confirm `instance.exports.memory.buffer` is readable via `DataView` during callback
   - [ ] Confirm variable addresses (via `&x`) are valid offsets into linear memory
   - [ ] Read typed values: `getInt32`, `getFloat32`, `getFloat64` at known offsets
   - Note: this spike likely merges with Phase 1 spike 1.1

- [ ] **2a.2 Batch execution timing** (~1 hour)
   - [ ] Run CrowCode's test programs to completion, collecting all ops in callbacks
   - [ ] Measure total execution time including callback overhead
   - [ ] Confirm <100ms for typical programs (batch mode sufficient)
   - Key metric: 500 steps × N microseconds per callback < 50ms

**Key insight:** CrowCode's current UI pre-computes all snapshots before display (`buildSnapshots()` processes all steps at once). For programs without stdin, batch execution is the simplest path. No Asyncify, no workers, no suspension complexity.

**Decision point:** Batch mode (strongly preferred) vs. suspension. Only proceed to Phase 2b if interactive stdin is a priority.

---

### Phase 2b: Interactive stdio

**Question:** Can we pause a running WASM binary when it needs stdin input, let the user type, and resume?

**Risk level after feasibility analysis:** Medium. scanf is missing from xcc's libc (confirmed), so we must provide it as a JS import. The question is whether the pause/resume mechanism works.

**What we know:**
- xcc's libc uses WASI `fd_read`/`fd_write` for I/O — we control these imports
- **scanf is completely absent** from xcc's libc — must be provided externally
- CrowCode's current interactive mode uses a JS generator that yields on stdin exhaustion
- GitHub Pages likely doesn't set COOP/COEP headers (needed for SharedArrayBuffer)

**Revised approach given scanf gap:** Since scanf doesn't exist in xcc's libc, we don't intercept an existing function — we **provide it entirely as a WASM import**. This gives us full control:

```
User C code calls scanf() → WASM import → JS implementation (IoState) → pause if no data
```

The JS scanf implementation reuses CrowCode's existing format parser and stdin buffering. It reads from WASM linear memory for the format string and writes results back to the pointer arguments.

**Spikes:**

- [x] **2b.1 COOP/COEP headers on github.io** (~30 minutes) — **CONFIRMED ABSENT 2026-03-29**
   - [x] `curl -sI` shows no `Cross-Origin-Opener-Policy` or `Cross-Origin-Embedder-Policy` headers
   - [ ] Test `coi-serviceworker` on github.io (deferred — not needed for v1 if using progressive re-execution)
   - **Result**: SharedArrayBuffer is NOT available on github.io. Worker + `Atomics.wait` requires `coi-serviceworker` workaround. Progressive re-execution is the recommended v1 approach.

- [x] **2b.2 scanf as WASM import** (~3 hours) — **PASSED 2026-03-29**
   - [x] Declare `extern int scanf(const char *fmt, ...);` — compiles and links with `--allow-undefined`
   - [x] JS receives the call as a WASM import in `env` module
   - [x] **Variadic calling convention discovered**: xcc passes varargs via a **va_list pointer on the stack**. The 2nd argument is NOT `&x` directly — it's a pointer to a stack area containing `&x`. Must dereference: `mem[vaListPtr]` → `&x`, then write to `&x`.
   - [x] Full round-trip confirmed: JS scanf reads format string, dereferences va_list, writes value to `&x`, program reads `x=42` correctly.
   - **Result**: scanf as WASM import works. The va_list indirection is a one-time implementation detail. No source-rewrite needed.

- [ ] **2b.3 Progressive re-execution fallback** (~1 hour)
   - [ ] When scanf is called with no data, JS import throws a special exception
   - [ ] Catch the WASM trap, display all steps collected so far
   - [ ] On user input, re-run entire program with input appended to stdin
   - [ ] Measure: is re-execution fast enough to feel instant?

- [ ] **2b.4 True suspension** (~2 hours, only if progressive re-execution is insufficient)
   - [ ] Web Worker + `Atomics.wait`: run WASM in worker, pause on `fd_read`/`scanf` import
   - [ ] Test JSPI (WebAssembly JS Promise Integration) — check browser support status

**Decision point:** Progressive re-execution (simplest) vs. true suspension. Progressive re-execution is recommended for v1. True suspension can be added later if UX demands it.

---

### Phase 3: Memory Introspection

**Question:** At a `__crow_step` callback, can we read WASM linear memory and map byte ranges to named C variables with types?

**Risk level after feasibility analysis:** Low. We've confirmed that:
- `&x` forces variables into linear memory (via `VS_REF_TAKEN`)
- xcc uses ILP32 with standard C alignment rules
- All heap allocations are in linear memory with 8-byte alignment
- Structs, arrays, and globals are always in linear memory

**Spikes:**

- [x] **3.1 Address-of locals in xcc's WASM output** (~1 hour) — **PASSED 2026-03-29** (merged with spike 1.1)
   - [x] `&x` on local int gives address `0x1ff0` — valid linear memory offset
   - [x] `&f` on local float gives address `0x1ff4` — f32 read correctly (3.14)
   - [x] `&p` on local struct gives address `0x1ff8` — field values readable at offsets
   - [x] ILP32 confirmed: pointer=4 bytes, int=4 bytes
   - **Result**: All locals with `&` taken are placed in linear memory via `VS_REF_TAKEN`. Addresses are stable and readable.

- [x] **3.2 Struct layout comparison** (~1 hour) — **PASSED 2026-03-29**
   - [x] `{char; int}` → sizeof=8, int at offset 4 (3 padding bytes) ✓
   - [x] `{int; char; short; double}` → sizeof=16, short at 6, double at 8 ✓
   - [x] `{char; char; int}` → sizeof=8, chars packed, int at 4 ✓
   - [x] `{int*; char}` → sizeof=8, pointer at 0, char at 4 ✓
   - **Result**: xcc struct layout follows standard C alignment rules. Matches CrowCode's `TypeRegistry` for all types except `long` (4 vs 8 bytes). No surprising divergence.

- [ ] **3.3 Source transformer prototype** (~4 hours)
   - [ ] At each declaration: inject `__crow_decl(name, &var, sizeof(var), type_string, line)`
   - [ ] At each assignment: inject `__crow_set(name, &var, line)`
   - [ ] At each scope entry: inject `__crow_push_scope(name, line)`
   - [ ] At each scope exit (return, function end, block end): inject `__crow_pop_scope()`
   - [ ] At each `malloc`/`calloc`/`realloc` call: rewrite to `__crow_malloc(size, line)` etc.
   - [ ] At each `free` call: rewrite to `__crow_free(ptr, line)`
   - [ ] At each `scanf` call: rewrite to `__crow_scanf_*` (see Phase 2b)
   - [ ] Handle multiple return paths (every `return` needs `__crow_pop_scope()` before it)
   - [ ] Test on 3-4 of the existing test programs

- [ ] **3.4 Op accumulation and Program generation** (~2 hours)
   - [ ] Implement JS-side `__crow_push_scope` → `addEntry` with `kind: 'scope'`
   - [ ] Implement `__crow_pop_scope` → `removeEntry` for scope + all its children
   - [ ] Implement `__crow_decl` → `addEntry` with name, type, value read from memory, address
   - [ ] Implement `__crow_set` → `setValue` with value read from memory
   - [ ] Implement `__crow_malloc` → `addEntry` under heap container
   - [ ] Implement `__crow_free` → `setHeapStatus: 'freed'`
   - [ ] Build a `Program`, feed to `buildSnapshots()` and `validateProgram()`
   - [ ] Compare output against the interpreter's output for the same program

**Decision point:** Does the source transformer + WASM memory reading approach produce valid, correct `Program` objects? If struct layouts diverge, assess whether the divergence is acceptable (different but correct) or broken.

---

### Phase 4: Heap Tracking

**Question:** Can we intercept malloc/free to track heap allocations with the same metadata the UI expects?

**Risk level after feasibility analysis:** Low. xcc uses a simple K&R allocator. All addresses are WASM linear memory offsets. Three interception approaches are available.

**Confirmed approach**: Source-level rewriting is simplest and avoids linker/import complications:

```c
// Original
int *p = malloc(sizeof(int) * 10);
free(p);

// Instrumented
int *p = __crow_malloc(sizeof(int) * 10, __LINE__);
__crow_free(p, __LINE__);
```

The `__crow_malloc` WASM import calls the real `malloc` (exported from the WASM module via `-e malloc`), records metadata, emits ops, and returns the pointer. Similarly for `free`, `calloc`, `realloc`.

**Spikes:**

- [x] **4.1 Malloc wrapper end-to-end** (~2 hours) — **PASSED 2026-03-29**
   - [x] Compile with `-e malloc,free` exports both functions from WASM module
   - [x] `__crow_malloc(12, line=8)` → calls real `malloc`, returns `0x3010`, records metadata
   - [x] `__crow_free(0x3010, line=12)` → validates pointer, calls real `free`, marks as freed
   - [x] Leak detection: scans tracking map after execution — "No leaks detected" when all freed
   - [x] Double-free and invalid-free detection implemented via tracking map
   - **Result**: Full heap interposition works. `-e malloc,free` exports coexist with wrapper imports. No circular dependency issues.

- [ ] **4.2 realloc handling** (~1 hour)
   - [ ] Handle same-address return: emit `setValue` to update size display
   - [ ] Handle different-address return: emit `removeEntry` for old block + `addEntry` for new block

**Decision point:** Low risk. Main verification: can the WASM module export `malloc`/`free` via `-e malloc,free` while the user's code calls the wrappers?

---

### Phase 5: Integration

**Question:** Does the full pipeline produce correct visualizations for CrowCode's existing test programs?

**Tasks:**

- [ ] **5.1 End-to-end pipeline**
   - [ ] Wire together: source transform → xcc compile (in-browser via WASI) → execute WASM → collect ops → build `Program` → existing UI
   - [ ] Run against all programs in `test-programs.ts`
   - [ ] Diff output against interpreter-generated `Program` objects
   - [ ] Document expected differences (different addresses, `long` size, float precision, etc.)

- [ ] **5.2 Feature coverage audit**
   - [ ] Document what the WASM pipeline gains vs. the interpreter (24 new features)
   - [ ] Document what it loses (safety checks: bounds, use-after-free, uninitialized)
   - [ ] Document behavioral differences (division-by-zero traps, `long` size, float precision)

- [ ] **5.3 Performance measurement**
   - [ ] Measure xcc compilation latency (in-browser, first run vs. cached WASI module)
   - [ ] Measure WASM execution + instrumentation callback overhead per step
   - [ ] Measure total time from "click Run" to "first step visible"
   - [ ] Compare against current interpreter path (~instant for small programs)
   - [ ] Target: <500ms total for typical student programs

- [ ] **5.4 Error handling**
   - [ ] xcc compilation errors → surface in CrowCode's error UI (red banner)
   - [ ] WASM traps (OOB memory, integer overflow, stack overflow) → catch `WebAssembly.RuntimeError`, map to user-friendly messages
   - [ ] Step limit → `__crow_step` callback increments counter, throws after MAX_STEPS

- [ ] **5.5 Dual mode UI**
   - [ ] Add a toggle: "Interpreter" (current, instant, safety checks) vs. "Compiled" (xcc, real execution)
   - [ ] Both produce a `Program` — the UI doesn't care which backend made it
   - [ ] Interpreter stays the default; compiled mode is opt-in
   - [ ] When compiled mode is selected and program uses scanf, show a note about interactive I/O behavior

## Deployment Considerations

- **github.io only**: No server, no external APIs. Everything ships as static assets. xcc's ~144KB compressed payload is acceptable alongside the existing tree-sitter WASM modules (~200KB).
- **SharedArrayBuffer**: GitHub Pages likely doesn't set COOP/COEP headers. `coi-serviceworker` is the workaround if Worker + Atomics is needed for interactive stdin. Spike 2b.1 validates this. Progressive re-execution doesn't need SharedArrayBuffer.
- **Dual mode**: The interpreter doesn't go away. Ship both backends — interpreter for instant feedback and safety checks (default), WASM for "real compilation" mode (opt-in). This de-risks the transition and lets users choose.
- **WASI runtime**: xcc's demo uses `@wasmer/wasi` 0.12. Options: swap for `browser_wasi_shim`, or write a minimal custom shim (xcc only needs `fd_write`, `fd_read`, `proc_exit`, `environ_sizes_get`, `environ_get`).

## Suggested Spike Order

| # | Spike | Time | Phase | Answers | Risk retired |
|---|-------|------|-------|---------|-------------|
| 1 | Build xcc, compile C with `__crow_step` import, read `&x` from JS | 2h | 1.1 + 3.1 | Do WASM imports work? Can we read local variables? | Highest-risk question (entire approach depends on this) |
| 2 | Compile CrowCode test programs with xcc | 2h | 1.2 | Feature coverage gaps? | Confirms feasibility analysis against real programs |
| 3 | Test scanf-as-undefined with `--allow-undefined` | 1h | 2b.2 | Can we provide scanf via WASM import? Variadic complication? | De-risks the only blocker |
| 4 | Run xcc in-browser (WASI), measure download + latency | 2h | 1.3 | In-browser UX acceptable? | First-load and compile-time experience |
| 5 | Check github.io COOP/COEP; test `coi-serviceworker` | 30m | 2b.1 | SharedArrayBuffer available? | Determines interactive stdin approach |
| 6 | Source-transform a program, compile, collect ops, produce `Program`, render in UI | 4h | 3.3 + 3.4 | Full pipeline end-to-end? | Validates entire architecture |
| 7 | Struct layout comparison (xcc vs TypeRegistry) | 1h | 3.2 | Field offsets match? | Alignment correctness |
| 8 | Malloc/free wrapper with leak/double-free detection | 2h | 4.1 | Heap tracking works? | Low risk, but confirms interposition |

**Go/no-go after spike 1:** ~~If xcc can't handle WASM imports...~~ **GO — PASSED.** WASM imports work. Memory is readable. All `__crow_*` callbacks fire correctly.

**Go/no-go after spike 3:** ~~If variadic WASM imports don't work for scanf...~~ **GO — PASSED.** Variadic scanf works as WASM import. va_list indirection understood and handled.

**Go/no-go after spike 6:** If the instrumented pipeline produces a valid `Program`, commit to building it out. This is the point of no return. **(Not yet tested — requires source transformer implementation.)**

## Risk Register

| Risk | Likelihood | Impact | Mitigation | Spike | Status |
|------|-----------|--------|------------|-------|--------|
| WASM imports don't work with xcc | Low | Fatal | Stay with interpreter | #1 | **RETIRED — works** |
| `&x` doesn't produce readable addresses | Low | Fatal | Patch xcc | #1 | **RETIRED — works** |
| scanf variadic import doesn't work | Medium | High | Source-rewrite to non-variadic wrappers | #3 | **RETIRED — works (va_list indirection)** |
| xcc compilation too slow in-browser | Low | Medium | Cache compiled WASM by source hash; show spinner | #4 | Open — spike 1.3 not yet run |
| `@wasmer/wasi` 0.12 breaks with modern browsers | Medium | Medium | Swap for `browser_wasi_shim` or custom minimal shim | #4 | Open — spike 1.3 not yet run |
| Struct layout mismatch (xcc vs interpreter) | Low | Low | Accept differences as "real compiler behavior" | #7 | **RETIRED — layouts match** |
| Callback overhead too high for batch mode | Low | Medium | Pre-allocate op buffer in WASM; reduce callback frequency | #6 | Open — not yet measured |
| GitHub Pages blocks SharedArrayBuffer | High | Low | Use progressive re-execution for interactive stdin | #5 | **RETIRED — confirmed absent, progressive re-execution recommended** |

## Sources

- [xcc GitHub](https://github.com/tyfkda/xcc) — 457 stars, 2,915 commits, MIT, actively maintained
- [xcc live demo](https://tyfkda.github.io/xcc/) — browser-based C-to-WASM compilation
- [xcc blog post](https://dev.to/tyfkda/running-a-c-compiler-in-a-browser-4g9h) — architecture overview
- [chibicc GitHub](https://github.com/rui314/chibicc) — 11,400 stars, educational C compiler, x86-64 only
- [8cc.wasi](https://github.com/sanemat/8cc.wasi) — 8cc compiled to WASI, extremely limited C coverage
- [lcc GitHub](https://github.com/drh/lcc) — retargetable but dormant, C89 only
- [cproc](https://sr.ht/~mcf/cproc/) — C11 compiler using QBE, no WASM backend
- [c4wa](https://github.com/kign/c4wa) — C-to-WASM, but written in Java (can't run in browser)
- [mini-c](https://github.com/maierfelix/mini-c) — experimental JS-based C-to-WASM compiler
- [Solving structured control flow (Cheerp)](https://medium.com/leaningtech/solving-the-structured-control-flow-problem-once-and-for-all-5123117b1ee2) — relooper/stackifier comparison
- [Why WASM is not my favorite target (eigenstate.org)](https://eigenstate.org/notes/wasm) — QBE author on WASM control flow
- CrowCode feasibility analysis: `xcc-feature-feasibility.md`
- Prior CrowCode research: `c-wasm-browser-execution.md`, `c-stdio-terminal-behavior.md`
