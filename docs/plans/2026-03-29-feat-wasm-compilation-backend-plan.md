---
title: WASM Compilation Backend via xcc
type: feat
status: completed
date: 2026-03-29
---

# WASM Compilation Backend via xcc

## Context

CrowCode currently uses a TypeScript interpreter that walks the C AST and emits `SnapshotOp[]` as it executes. This works well but is not "real" compilation — students see interpreted behavior, not what a real compiler produces.

The research and spike validation (see `docs/research/wasm-native-compilation-strategy.md`) confirmed that **xcc** — a 144KB C-to-WASM compiler — can run in the browser and produce WASM binaries that call back into JS. All critical risks have been retired:

- WASM imports work (spike 1.1)
- `&x` gives readable linear memory addresses (spike 3.1)
- Struct layouts match standard C rules (spike 3.2)
- scanf works as a JS-implemented WASM import (spike 2b.2)
- malloc/free interposition works via `-e` exports (spike 4.1)
- GitHub Pages lacks SharedArrayBuffer — progressive re-execution for interactive stdin (spike 2b.1)

The UI only cares about `Program`. Both backends produce it. Users toggle between modes.

## Design

### Architecture

```
              ┌─────────────────────────────────────────────┐
              │            +page.svelte                      │
              │   ioMode toggle  ×  backendMode toggle       │
              └──────┬──────────────────┬───────────────────┘
                     │                  │
          ┌──────────▼──────┐  ┌────────▼──────────┐
          │  Interpreter    │  │  WASM Backend      │
          │  service.ts     │  │  service.ts        │
          │  (existing)     │  │  (new)             │
          └──────┬──────────┘  └────────┬───────────┘
                 │                      │
                 │     Program          │     Program
                 └──────────┬───────────┘
                            │
                 ┌──────────▼──────────┐
                 │  Engine (unchanged) │
                 │  buildSnapshots()   │
                 │  buildConsoleOutputs│
                 │  validateProgram()  │
                 └──────────┬──────────┘
                            │
                 ┌──────────▼──────────┐
                 │  UI (unchanged)     │
                 │  MemoryView         │
                 │  StepControls       │
                 │  ConsolePanel       │
                 └─────────────────────┘
```

### WASM backend pipeline (detailed)

```
User's C source
  │
  ▼
Source Transformer [transformer.ts]
  │  Parse with tree-sitter (reuse existing parser)
  │  Walk CST nodes, emit instrumented C text
  │  Inject: #include "__crow.h"
  │  Inject: __crow_push_scope / __crow_pop_scope at function boundaries
  │  Inject: __crow_decl after each declaration
  │  Inject: __crow_set after each assignment
  │  Inject: __crow_step at each statement boundary
  │  Rewrite: malloc → __crow_malloc, free → __crow_free
  │  Rewrite: scanf → __crow_scanf (non-variadic wrapper)
  │  Output: instrumented C source string
  │
  ▼
xcc Compiler [compiler.ts]
  │  Load cc.wasm via WASI shim (cached after first load)
  │  Write instrumented source to virtual FS
  │  Run: wcc -Wl,--allow-undefined -e malloc,free -o out.wasm input.c
  │  Read compiled .wasm from virtual FS
  │  Output: Uint8Array (WASM binary)
  │
  ▼
WASM Runtime [runtime.ts]
  │  WebAssembly.instantiate(binary, {
  │    env: { __crow_step, __crow_decl, __crow_set, __crow_push_scope,
  │           __crow_pop_scope, __crow_malloc, __crow_free, __crow_scanf,
  │           printf, getchar, puts, putchar, ... },
  │    wasi_snapshot_preview1: { fd_write, fd_read, proc_exit, ... }
  │  })
  │  Call instance.exports._start()
  │  Catch: StdinExhausted → partial Program
  │  Catch: RuntimeError → WASM trap → error message
  │  Catch: StepLimitExceeded → truncation warning
  │
  ▼
Op Collector [op-collector.ts]
  │  Each __crow_* call reads WASM linear memory via DataView
  │  Accumulates ProgramStep[] with SnapshotOp[]
  │  Tracks: scope stack, variable registry, heap allocation map
  │  Output: Program { name, source, steps }
  │
  ▼
Existing Engine + UI (unchanged)
```

### Key decisions

1. **Source instrumentation, not DWARF** — inject `__crow_decl`, `__crow_set`, `__crow_step`, `__crow_push_scope`, `__crow_pop_scope` calls. The `&x` in `__crow_decl` forces locals into linear memory via xcc's `VS_REF_TAKEN` mechanism.

2. **Batch execution for v1** — run the WASM binary to completion, collect all ops, build `Program`. No mid-execution suspension. Interactive stdin uses progressive re-execution (re-run with accumulated input).

3. **Dual mode** — interpreter is default (instant, safety checks). WASM mode is opt-in ("Compiled" toggle). Both produce `Program`.

4. **scanf via non-variadic wrapper** — the source transformer rewrites `scanf("%d", &x)` to `__crow_scanf_int(&x, __LINE__)`. This avoids the va_list indirection complexity for common cases. For less common formats, a variadic import with va_list dereferencing is the fallback (proven in spike 2b.2).

5. **Heap tracking via source rewrite** — replace `malloc(n)` with `__crow_malloc(n, __LINE__)` in the source transformer. JS wrapper calls real `malloc` (exported from WASM module via `-e malloc,free`), records metadata.

6. **printf/puts/putchar via WASM import** — these are missing from or bypassed in xcc's libc for our use case. We provide them as JS imports that write to `IoState` and emit `IoEvent`s. This gives us I/O events per step.

## `__crow.h` Header

The source transformer prepends `#include "__crow.h"` to every program. This header lives in xcc's virtual filesystem and declares all instrumentation functions:

```c
#ifndef __CROW_H
#define __CROW_H

// Step and scope tracking
void __crow_step(int line);
void __crow_push_scope(const char *name, int line);
void __crow_pop_scope(void);

// Variable tracking
void __crow_decl(const char *name, void *addr, int size, const char *type, int line);
void __crow_set(const char *name, void *addr, int line);

// Heap tracking (replace malloc/calloc/realloc/free)
void *__crow_malloc(int size, int line);
void *__crow_calloc(int count, int size, int line);
void *__crow_realloc(void *ptr, int size, int line);
void __crow_free(void *ptr, int line);

// I/O (replace scanf, provide printf)
int __crow_scanf_int(int *ptr, int line);
int __crow_scanf_float(float *ptr, int line);
int __crow_scanf_double(double *ptr, int line);
int __crow_scanf_char(char *ptr, int line);
int __crow_scanf_string(char *buf, int bufsize, int line);

// stdio provided as imports (not in this header — xcc's stdio.h covers printf/puts/etc.)

#endif
```

## Source Transformer: Detailed Rules

The transformer walks tree-sitter's CST (concrete syntax tree) and applies text-level transformations. It does NOT modify the AST — it inserts text around/after existing statements.

### Injection rules by construct

**Function definitions:**
```c
// Input
int add(int a, int b) {
    return a + b;
}

// Output
int add(int a, int b) {
    __crow_push_scope("add", 1);
    __crow_decl("a", &a, sizeof(a), "int", 1);
    __crow_decl("b", &b, sizeof(b), "int", 1);
    __crow_step(2);
    __crow_pop_scope();
    return a + b;
}
```

Every `return` statement gets `__crow_pop_scope()` before it. The closing `}` of a non-void function that falls through (no explicit return) also gets `__crow_pop_scope()`.

**Declarations:**
```c
// Input
int x = 5;

// Output
int x = 5;
__crow_decl("x", &x, sizeof(x), "int", __LINE__);
__crow_step(__LINE__);
```

For declarations with no initializer (`int x;`), the decl call still fires — the value read from memory will be whatever xcc zero-initialized it to.

**Assignments:**
```c
// Input
x = x + 1;

// Output
x = x + 1;
__crow_set("x", &x, __LINE__);
__crow_step(__LINE__);
```

Compound assignments (`x += 5`, `x++`, `++x`) are treated identically — insert `__crow_set` after.

**Struct declarations:**
```c
// Input
struct Point p = {10, 20};

// Output
struct Point p = {10, 20};
__crow_decl("p", &p, sizeof(p), "struct Point", __LINE__);
__crow_step(__LINE__);
```

The op collector reads struct fields by computing offsets. It needs type info from the `__crow_decl` type string to know the layout. For this, the type string encodes enough: `"struct Point"` → the collector looks up the struct definition in a type registry built from the tree-sitter parse.

**Array declarations:**
```c
// Input
int arr[5] = {1, 2, 3, 4, 5};

// Output
int arr[5] = {1, 2, 3, 4, 5};
__crow_decl("arr", &arr, sizeof(arr), "int[5]", __LINE__);
__crow_step(__LINE__);
```

The type string `"int[5]"` tells the collector to emit children for each element.

**For loops:**
```c
// Input
for (int i = 0; i < 10; i++) {
    arr[i] = i * 2;
}

// Output
for (int i = 0; i < 10; i++) {
    __crow_decl("i", &i, sizeof(i), "int", __LINE__);  // only on first iteration (guarded)
    __crow_step(__LINE__);  // condition check
    arr[i] = i * 2;
    __crow_set("arr", &arr, __LINE__);  // array was modified
    __crow_step(__LINE__);
    __crow_set("i", &i, __LINE__);  // update expression (i++)
}
```

The for-loop init's declaration needs `__crow_decl` injected. The condition and update are separate logical steps. This is where sub-step granularity gets tricky — v1 uses statement-level stepping only (one `__crow_step` per statement).

**malloc/free rewriting:**
```c
// Input
int *p = (int*)malloc(sizeof(int) * 10);
free(p);

// Output
int *p = (int*)__crow_malloc(sizeof(int) * 10, __LINE__);
__crow_decl("p", &p, sizeof(p), "int*", __LINE__);
__crow_step(__LINE__);
__crow_free(p, __LINE__);
__crow_step(__LINE__);
```

The transformer must find `malloc`, `calloc`, `realloc`, `free` call expressions and replace the callee name. This is a text substitution on identified call_expression nodes.

**scanf rewriting:**
```c
// Input
scanf("%d", &x);

// Output
__crow_scanf_int(&x, __LINE__);
__crow_set("x", &x, __LINE__);
__crow_step(__LINE__);
```

The transformer parses the format string to determine which `__crow_scanf_*` variant to call. For multi-specifier scanf (`scanf("%d %d", &x, &y)`), it emits multiple calls:
```c
__crow_scanf_int(&x, __LINE__);
__crow_set("x", &x, __LINE__);
__crow_scanf_int(&y, __LINE__);
__crow_set("y", &y, __LINE__);
__crow_step(__LINE__);
```

**What the transformer does NOT touch:**
- Preprocessor directives (`#include`, `#define`) — pass through unchanged
- Comments — pass through unchanged
- Expressions inside conditions (no sub-step instrumentation in v1)
- Struct field assignments (`p.x = 5`) — the `__crow_set` on the parent struct handles this

### Transformer implementation approach

The transformer uses tree-sitter's CST (which CrowCode already loads for the interpreter) and walks it with a cursor. For each node type it recognizes, it records insertion points (line + column offsets). After walking the full tree, it applies all insertions in reverse order (bottom-up) to avoid offset invalidation.

This is **text surgery**, not AST rewriting — the output is a valid C source string that xcc compiles directly.

## Op Collector: Detailed Specification

The op collector maintains state during WASM execution and produces `ProgramStep[]`.

### State

```typescript
class OpCollector {
    private memory: DataView;              // WASM linear memory
    private steps: ProgramStep[] = [];
    private currentOps: SnapshotOp[] = [];
    private currentLine = 0;

    // Scope tracking
    private scopeStack: string[] = [];     // Stack of scope IDs
    private scopeCounters = new Map<string, number>();

    // Variable tracking
    private varRegistry = new Map<string, {
        scopeId: string;
        entryId: string;
        addr: number;
        size: number;
        type: string;
    }>();

    // Heap tracking
    private heapBlocks = new Map<number, {
        entryId: string;
        size: number;
        line: number;
        status: 'allocated' | 'freed';
    }>();
    private heapContainerAdded = false;
    private heapCounter = 0;

    // I/O
    private ioEvents: IoEvent[] = [];

    // Limits
    private stepCount = 0;
    private maxSteps: number;
}
```

### Callback implementations

**`__crow_step(line)`** — flush the current step:
```typescript
onStep(line: number): void {
    if (++this.stepCount > this.maxSteps) {
        throw new StepLimitExceeded();
    }
    if (this.currentOps.length > 0 || this.ioEvents.length > 0) {
        this.steps.push({
            location: { line: this.currentLine },
            ops: this.currentOps,
            ioEvents: this.ioEvents.length > 0 ? this.ioEvents : undefined,
        });
        this.currentOps = [];
        this.ioEvents = [];
    }
    this.currentLine = line;
}
```

**`__crow_push_scope(namePtr, line)`** — enter a function/block scope:
```typescript
onPushScope(namePtr: number, line: number): void {
    const name = this.readCString(namePtr);
    const scopeId = this.generateScopeId(name);
    this.scopeStack.push(scopeId);

    const entry: MemoryEntry = {
        id: scopeId,
        name,
        kind: 'scope',
        type: '',
        value: '',
        address: '',
    };
    this.currentOps.push({ op: 'addEntry', parentId: null, entry });

    // Add heap container on first scope
    if (!this.heapContainerAdded) {
        this.currentOps.push({
            op: 'addEntry',
            parentId: null,
            entry: { id: 'heap', name: 'Heap', kind: 'heap',
                     type: '', value: '', address: '' },
        });
        this.heapContainerAdded = true;
    }
}
```

**`__crow_pop_scope()`** — exit scope, remove its entry:
```typescript
onPopScope(): void {
    const scopeId = this.scopeStack.pop();
    if (!scopeId) return;

    // Remove all variables registered to this scope
    for (const [name, info] of this.varRegistry) {
        if (info.scopeId === scopeId) {
            this.varRegistry.delete(name);
        }
    }

    this.currentOps.push({ op: 'removeEntry', id: scopeId });
}
```

**`__crow_decl(namePtr, addr, size, typePtr, line)`** — declare a variable:
```typescript
onDecl(namePtr: number, addr: number, size: number,
       typePtr: number, line: number): void {
    const name = this.readCString(namePtr);
    const typeStr = this.readCString(typePtr);
    const scopeId = this.currentScopeId();
    const entryId = `${scopeId}::${name}`;

    const value = this.readValue(addr, size, typeStr);
    const children = this.buildChildren(addr, typeStr);
    const hexAddr = '0x' + addr.toString(16).padStart(8, '0');

    const entry: MemoryEntry = {
        id: entryId,
        name,
        type: typeStr,
        value,
        address: hexAddr,
        children,
    };

    this.varRegistry.set(name, { scopeId, entryId, addr, size, type: typeStr });
    this.currentOps.push({ op: 'addEntry', parentId: scopeId, entry });
}
```

**`__crow_set(namePtr, addr, line)`** — variable value changed:
```typescript
onSet(namePtr: number, addr: number, line: number): void {
    const name = this.readCString(namePtr);
    const info = this.varRegistry.get(name);
    if (!info) return;

    const value = this.readValue(addr, info.size, info.type);
    this.currentOps.push({ op: 'setValue', id: info.entryId, value });

    // If this is a pointer, update its display (hex address of target)
    // If this is a struct/array, update children values
    this.updateChildValues(info);
}
```

**`__crow_malloc(size, line)`** — heap allocation:
```typescript
onMalloc(size: number, line: number): number {
    const realMalloc = this.wasmExports.malloc;
    const addr = realMalloc(size);
    if (addr === 0) return 0; // allocation failed

    const entryId = `heap_${this.heapCounter++}`;
    this.heapBlocks.set(addr, { entryId, size, line, status: 'allocated' });

    const hexAddr = '0x' + addr.toString(16).padStart(8, '0');
    const entry: MemoryEntry = {
        id: entryId,
        name: `malloc(${size})`,
        type: `${size} bytes`,
        value: '',
        address: hexAddr,
        heap: {
            size,
            status: 'allocated',
            allocator: 'malloc',
            allocSite: { file: '', line },
        },
        // Infer array children when size > element size
        children: this.inferHeapChildren(addr, size),
    };

    this.currentOps.push({ op: 'addEntry', parentId: 'heap', entry });
    return addr;
}
```

### Reading typed values from WASM memory

```typescript
readValue(addr: number, size: number, typeStr: string): string {
    const mem = this.memory;
    if (typeStr === 'int' || typeStr === 'long')
        return String(mem.getInt32(addr, true));
    if (typeStr === 'unsigned int' || typeStr === 'unsigned long')
        return String(mem.getUint32(addr, true));
    if (typeStr === 'char')
        return String(mem.getInt8(addr));
    if (typeStr === 'short')
        return String(mem.getInt16(addr, true));
    if (typeStr === 'float')
        return String(mem.getFloat32(addr, true));
    if (typeStr === 'double')
        return String(mem.getFloat64(addr, true));
    if (typeStr === 'long long')
        return String(mem.getBigInt64(addr, true));
    if (typeStr.endsWith('*'))
        return '0x' + mem.getUint32(addr, true).toString(16).padStart(8, '0');
    if (typeStr.startsWith('struct '))
        return '';  // structs have no scalar value — children carry values
    if (typeStr.includes('['))
        return '';  // arrays have no scalar value — children carry values
    return String(mem.getInt32(addr, true)); // fallback: treat as int
}
```

### ID generation

The op collector mirrors the interpreter's ID scheme:
- Scope IDs: `main`, `main_1`, `add`, `add_1` (counter per function name)
- Variable IDs: `main::x`, `main::p`, `add::a` (scope::name)
- Heap IDs: `heap_0`, `heap_1`, `heap_2` (monotonic counter)
- Block IDs: `main::for_0`, `main::while_0` (scope::construct_counter)

This ensures `validateProgram()` passes (no duplicate IDs, proper parent-child relationships).

## WASI Shim: Minimal Implementation

Two WASI contexts are needed:

### 1. Compiler WASI (runs xcc's `cc.wasm`)

xcc needs a virtual filesystem with headers + libc, plus basic syscalls:

| WASI Function | Implementation |
|---------------|---------------|
| `fd_write(fd, iovs, ...)` | fd=1 → capture stdout (compiler output); fd=2 → capture stderr (errors) |
| `fd_read(fd, ...)` | fd=0 → read source from virtual buffer |
| `fd_prestat_get` / `fd_prestat_dir_name` | Enumerate preopened directories (virtual FS root) |
| `path_open` | Open files in virtual FS (headers, source, output) |
| `fd_close` | No-op |
| `fd_seek` | Track position per FD |
| `fd_filestat_get` | Return size/type for virtual files |
| `proc_exit(code)` | Throw `CompilationComplete(code)` |
| `environ_sizes_get` / `environ_get` | Empty environment |
| `args_sizes_get` / `args_get` | Pass command-line args (source path, flags) |
| `clock_time_get` | `Date.now() * 1e6` |

Virtual filesystem structure:
```
/
├── usr/
│   ├── include/     ← xcc's headers (stdio.h, stdlib.h, string.h, ...)
│   │   └── __crow.h ← our instrumentation header
│   └── lib/
│       ├── wcrt0.a  ← xcc's CRT
│       └── wlibc.a  ← xcc's libc
├── input.c          ← instrumented user source (written before compilation)
└── output.wasm      ← compiler output (read after compilation)
```

### 2. User Program WASI (runs the compiled `.wasm`)

Much simpler — only needs I/O:

| WASI Function | Implementation |
|---------------|---------------|
| `fd_write(fd, iovs, ...)` | fd=1 → `ioEvents.push({ kind: 'write', target: 'stdout', text })` |
| `fd_read` | Not used (scanf handled via `__crow_scanf_*` imports) |
| `proc_exit(code)` | Throw `ProgramExit(code)` |
| `environ_*` / `args_*` | Empty |
| `clock_time_get` | `Date.now() * 1e6` |

All other WASI functions return `ENOSYS` (8).

## xcc Artifacts: Packaging

The xcc compiler artifacts are static files served alongside the app:

```
static/xcc/
├── cc.wasm            ← xcc compiler compiled to WASM (~300KB uncompressed)
├── include/           ← C headers
│   ├── stdio.h
│   ├── stdlib.h
│   ├── string.h
│   ├── math.h
│   ├── ctype.h
│   ├── assert.h
│   ├── stdarg.h
│   ├── stdint.h
│   ├── limits.h
│   ├── float.h
│   ├── stdbool.h
│   └── ...
├── lib/
│   ├── wcrt0.a        ← C runtime startup
│   └── wlibc.a        ← libc archive
└── __crow.h           ← instrumentation header
```

**Build process:** Clone xcc, run `make wcc && make wcc-libs`, copy artifacts to `static/xcc/`. This is a one-time setup step (can be scripted). The artifacts are committed to the repo or fetched during build.

**Loading strategy:** Fetch all artifacts on first "Compiled" mode run, cache in memory. Subsequent compilations reuse the cached compiler instance and virtual FS. Total download: ~144KB compressed (gzip).

## Files

### Create

| File | Purpose | Approximate size |
|------|---------|-----------------|
| `src/lib/wasm-backend/service.ts` | Public API: `runWasmProgram(source, stdin?)` → `RunResult` | ~80 lines |
| `src/lib/wasm-backend/compiler.ts` | xcc integration: load `cc.wasm`, compile C to `.wasm` | ~150 lines |
| `src/lib/wasm-backend/transformer.ts` | Source instrumentation: C source → instrumented C | ~300 lines |
| `src/lib/wasm-backend/runtime.ts` | WASM execution: instantiate + run with imports | ~120 lines |
| `src/lib/wasm-backend/op-collector.ts` | JS `__crow_*` implementations → `ProgramStep[]` | ~350 lines |
| `src/lib/wasm-backend/wasi-shim.ts` | Minimal WASI for compiler + user programs | ~200 lines |
| `src/lib/wasm-backend/index.ts` | Barrel export | ~10 lines |
| `src/lib/wasm-backend/transformer.test.ts` | Source transformer tests | ~200 lines |
| `src/lib/wasm-backend/op-collector.test.ts` | Op collector tests | ~250 lines |
| `src/lib/wasm-backend/integration.test.ts` | End-to-end pipeline tests | ~200 lines |
| `static/xcc/` | Compiler artifacts (cc.wasm, headers, libs) | ~300KB |

### Modify

| File | What changes | Why |
|------|-------------|-----|
| `src/routes/+page.svelte` | Add `backendMode` state, toggle UI, conditional import of `runWasmProgram` | Backend switching |
| `src/lib/components/StepControls.svelte` | Accept `compiled` prop, show badge | Visual indicator |

## Steps

### Step 1: xcc artifacts + WASI shim

- **What:** Download/build xcc artifacts, create the virtual filesystem structure, implement the WASI shim that can run `cc.wasm` to compile a trivial C program.
- **Files:** `wasi-shim.ts`, `compiler.ts`, `static/xcc/`
- **Depends on:** Nothing (foundational)
- **Substeps:**
  1. Build xcc from source: `make wcc AR=llvm-ar && PATH=...:$PATH make wcc-libs`
  2. Copy `wcc` artifacts (cc.wasm, include/, lib/) to `static/xcc/`
  3. Implement `WasiShim` class with virtual FS, fd management, and syscall dispatch
  4. Implement `XccCompiler` class that loads `cc.wasm`, sets up virtual FS, compiles source
  5. Write `__crow.h` and include it in the virtual FS
- **Verification:**
  - `compiler.compile('int main() { return 0; }')` returns valid WASM bytes
  - `compiler.compile('invalid C')` returns errors from xcc's stderr
  - `compiler.compile('#include <stdio.h>\nint main() { printf("hi"); return 0; }')` links against libc

### Step 2: Source transformer

- **What:** Parse C source with tree-sitter, walk the CST, emit instrumented C with `__crow_*` calls. Handle all C constructs CrowCode visualizes.
- **Files:** `transformer.ts`, `transformer.test.ts`
- **Depends on:** Step 1 (the `__crow.h` header defines the API the transformer targets)
- **Substeps:**
  1. Implement `transformSource(parser, source)` → `{ instrumented: string; errors: string[] }`
  2. Walk tree-sitter CST using cursor API (same parser CrowCode already loads)
  3. For each node type, compute text insertions (position + text to insert)
  4. Apply insertions in reverse order to preserve positions
  5. Handle: function_definition, declaration, assignment, expression_statement (for `x++` etc.), for/while/do-while, if/else, switch, return, compound_statement
  6. Rewrite call_expression nodes for malloc/calloc/realloc/free/scanf
  7. Prepend `#include "__crow.h"` to output
- **Verification (tests):**
  - Simple declaration: input `int x = 5;` → output contains `__crow_decl("x", &x, sizeof(x), "int",`
  - Assignment: input `x = 10;` → output contains `__crow_set("x", &x,`
  - Malloc rewrite: `malloc(16)` → `__crow_malloc(16, __LINE__)`
  - Function with return: both `return` and `}` get `__crow_pop_scope()`
  - For loop: init declaration gets `__crow_decl`, body statements get `__crow_step`
  - Full program: output compiles with `xcc -Wl,--allow-undefined`

### Step 3: Op collector

- **What:** Implement JS-side `__crow_*` callback functions that read WASM linear memory and accumulate `ProgramStep[]` with `SnapshotOp[]`. This is the heart of the visualization pipeline.
- **Files:** `op-collector.ts`, `op-collector.test.ts`
- **Depends on:** Types from `src/lib/api/types.ts`. No dependency on steps 1-2 (testable in isolation with mock memory).
- **Substeps:**
  1. Implement `OpCollector` class with all callback methods
  2. Implement `readValue(addr, size, type)` for all C types (int, float, double, char, short, pointer, long long)
  3. Implement `readCString(ptr)` helper
  4. Implement scope stack management (push/pop with ID generation)
  5. Implement variable registry (track name→{scopeId, entryId, addr, size, type})
  6. Implement heap tracking (malloc→addEntry, free→setHeapStatus, leak detection)
  7. Implement `buildChildren(addr, typeStr)` for structs and arrays
  8. Implement `finish()` → `Program`
- **Verification (tests):**
  - Create OpCollector with mock DataView (ArrayBuffer with preset values)
  - Simulate: pushScope → decl → step → set → step → popScope
  - Verify: resulting Program passes `validateProgram()`
  - Verify: `buildSnapshots(program)` produces snapshots with correct values
  - Verify: heap ops produce correct heap entries with status transitions

### Step 4: WASM runtime

- **What:** Instantiate a compiled `.wasm` module with the op collector's callbacks as WASM imports, execute it, handle traps and limits.
- **Files:** `runtime.ts`
- **Depends on:** Steps 1 (WASI shim for user program) and 3 (op collector)
- **Substeps:**
  1. Implement `executeWasm(binary, collector, stdin?)` → `{ program: Program; errors: string[] }`
  2. Build import object: `env` module with `__crow_*` callbacks + stdio functions, `wasi_snapshot_preview1` with minimal stubs
  3. Instantiate with `WebAssembly.instantiate(binary, imports)`
  4. Set collector's memory reference from `instance.exports.memory`
  5. Call `instance.exports._start()` inside try/catch
  6. Handle: `StepLimitExceeded` → return partial program + warning, `StdinExhausted` → return partial program + flag, `WebAssembly.RuntimeError` → map trap to error message, `ProgramExit` → normal completion
  7. Call `collector.finish()` to get final Program
  8. Run leak detection on collector's heap tracking map
- **Verification:** Tested via integration tests in step 5.

### Step 5: Service integration + integration tests

- **What:** Wire transformer → compiler → runtime → collector into `runWasmProgram(source, stdin?)`. Write end-to-end tests.
- **Files:** `service.ts`, `index.ts`, `integration.test.ts`
- **Depends on:** Steps 1-4
- **Substeps:**
  1. Implement `runWasmProgram(source, stdin?)` → `RunResult`:
     ```typescript
     async function runWasmProgram(source: string, stdin?: string): Promise<RunResult> {
         const parser = await getParser(); // reuse existing tree-sitter
         const { instrumented, errors: transformErrors } = transformSource(parser, source);
         if (transformErrors.length > 0) return { program: emptyProgram, errors: transformErrors, warnings: [] };

         const compiler = await getCompiler(); // lazy-load xcc
         const { wasm, errors: compileErrors } = await compiler.compile(instrumented);
         if (compileErrors.length > 0) return { program: emptyProgram, errors: compileErrors, warnings: [] };

         const collector = new OpCollector(MAX_STEPS);
         const { program, errors: runtimeErrors } = executeWasm(wasm, collector, stdin);

         const warnings = [];
         if (program.steps.length >= MAX_STEPS)
             warnings.push(`Program truncated at ${MAX_STEPS} steps.`);

         return { program, errors: runtimeErrors, warnings };
     }
     ```
  2. Barrel export in `index.ts`
  3. Integration tests:
     - Scalar program: `int x = 5; x = x + 1;` → snapshots show x=5 then x=6
     - Struct program: `struct Point p = {1,2};` → snapshot shows p with fields
     - Malloc program: `int *p = malloc(12); free(p);` → heap entry appears and is freed
     - Printf program: `printf("hello");` → IoEvents contain stdout write
     - Error program: `int x = 1/0;` → RuntimeError caught, error surfaced
     - Validate: all programs pass `validateProgram()`, no `buildSnapshots()` warnings
- **Verification:** `npm test` passes with new integration tests.

### Step 6: UI toggle

- **What:** Add backend mode toggle to the toolbar. Wire it to call `runWasmProgram` instead of `runProgram`.
- **Files:** `+page.svelte`, `StepControls.svelte`
- **Depends on:** Step 5
- **Substeps:**
  1. Add `backendMode` state: `'interpreter' | 'compiled'`
  2. Add toggle buttons next to the Run button (same style as I/O mode toggle)
  3. In `runPreSupplied()`: conditionally import and call `runWasmProgram` or `runProgram`
  4. Pass `compiled` prop to `StepControls` for badge display
  5. Cache invalidation: switching backend mode clears `runCache`
  6. Show "Compiled mode" indicator somewhere visible (e.g., small badge on step controls)
- **Verification:** Manual testing — toggle modes, run programs, verify both work.

### Step 7: Interactive stdin (progressive re-execution)

- **What:** When WASM mode encounters scanf with no input, return partial results. On user input, re-run with accumulated stdin.
- **Files:** `runtime.ts` (StdinExhausted handling), `service.ts` (re-run logic), `+page.svelte` (wire to existing input UI)
- **Depends on:** Steps 5-6
- **Substeps:**
  1. In runtime: when `__crow_scanf_*` is called and stdin is exhausted, throw `StdinExhausted`
  2. In service: catch `StdinExhausted`, return `{ state: 'paused', program: partialProgram }`
  3. Expose `runWasmProgramInteractive(source)` with same `InteractiveSession` type as interpreter
  4. `resume(input)` calls `runWasmProgram(source, accumulatedStdin + input)` — full re-execution
  5. Wire into `+page.svelte`'s existing `handleSubmitInput` / `handleEof` flow
- **Verification:** Test: `scanf("%d", &x); printf("%d\n", x);` → pauses → user enters "42" → re-run shows x=42 and stdout="42\n".

## Edge Cases

| Case | Expected behavior | How handled |
|------|-------------------|-------------|
| Division by zero | WASM traps with `RuntimeError` | Catch in runtime, map to user error: "Division by zero" |
| Stack overflow | WASM OOB trap or xcc stack exhaustion | Catch trap, show "Stack overflow — try reducing recursion depth" |
| Infinite loop | Exceeds MAX_STEPS in `__crow_step` counter | `StepLimitExceeded` exception, partial program returned with warning |
| Compilation error | xcc writes to stderr via WASI | Capture stderr text, return as `errors[]` |
| Program with no main() | xcc linker error: undefined symbol `_start` | Surface as compilation error |
| `#include <stdio.h>` | xcc's virtual FS has headers | Headers included in `static/xcc/include/` |
| `#include <nonexistent.h>` | xcc preprocessor error | Compilation error surfaced to user |
| Struct with `long` field | xcc uses 4 bytes (ILP32) | Correct for 32-bit; different from interpreter's 8-byte long |
| `float` precision | xcc uses WASM f32 (real single precision) | More accurate than interpreter's JS double |
| Empty program / no steps | `__crow_step` never called, steps=[] | Show "No steps generated" message |
| `free(NULL)` | No-op | `__crow_free` wrapper checks for NULL, skips |
| Double free | Detected by heap tracking map | Error added to step description, `free` still called (matches real C) |
| Nested structs | `struct A { struct B inner; }` | Transformer encodes `"struct A"`, collector builds nested children by reading type info |
| Array of structs | `struct Point arr[3]` | Transformer encodes `"struct Point[3]"`, collector builds children per element |
| Pointer display | `int *p = &x;` → shows hex address | `readValue` for pointer types reads 4-byte uint, formats as hex |
| Global variables | `int g = 10;` before main | Transformer injects `__crow_decl` in a global init section (or skip for v1) |
| `goto` (forward) | xcc compiles it, program runs | Steps recorded normally; scope cleanup may be imprecise |
| `setjmp`/`longjmp` | xcc compiles via WASM exceptions | Steps recorded; scope stack may get out of sync (known limitation for v1) |

## Verification

- [ ] `npm test` passes (new tests + existing tests unbroken)
- [ ] `npm run build` succeeds (new static assets bundled correctly)
- [ ] `npm run check` passes (TypeScript strict mode)
- [ ] Default editor program produces valid visualization in both modes
- [ ] 5+ test programs from `test-programs.ts` work in WASM mode
- [ ] Backend toggle switches cleanly without page reload
- [ ] Compilation errors displayed correctly (invalid C source)
- [ ] Interactive stdin works via progressive re-execution
- [ ] `validateProgram()` passes for all WASM-produced Programs
- [ ] No console warnings from `buildSnapshots()`
- [ ] xcc artifacts load and cache correctly (no redundant fetches)
- [ ] Memory view shows correct values for int, float, char, pointer, struct, array
- [ ] Heap entries appear on malloc, show 'freed' after free, 'leaked' at program end
- [ ] Step descriptions show meaningful text (not just line numbers)
- [ ] Printf output appears in ConsolePanel

## References

- [Research strategy + spike results](../research/wasm-native-compilation-strategy.md)
- [Feature feasibility assessment](../research/xcc-feature-feasibility.md)
- [xcc GitHub](https://github.com/tyfkda/xcc) — compiler we're integrating
- [Core types](../../src/lib/api/types.ts) — Program, ProgramStep, SnapshotOp contract
- [Interpreter service](../../src/lib/interpreter/service.ts) — pattern to replicate
- [Interpreter Memory class](../../src/lib/interpreter/memory.ts) — op emission patterns to mirror
- [Architecture overview](../architecture.md)
