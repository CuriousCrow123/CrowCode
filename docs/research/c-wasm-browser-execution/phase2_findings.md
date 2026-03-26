# Phase 2+3: Merged Research Findings

**Total unique sources:** ~45
**Per-facet confidence:** C_IN_BROWSER_TOOLS (high), MEMORY_INSTRUMENTATION (medium), EXISTING_VISUALIZERS (high), WASM_SECURITY_AND_LIMITS (high), STDLIB_BUNDLE_FEASIBILITY (medium), INTERPRETER_DEEP_DIVE (medium-high)
**Blocked sources:** ~10 URLs (paywalls, reCAPTCHA, cert errors, binary PDFs)

## C_IN_BROWSER_TOOLS

Several mature and experimental projects exist:
- **Wasmer Clang**: Full Clang in browser via WASIX, ~100MB uncompressed (~30MB compressed), works in all major browsers. 1.2-1.3s compile after caching.
- **binji/wasm-clang**: Clang+LLD in WASM with WASI + in-memory FS. CppCon 2019 demo, "alpha demoware."
- **YoWASP**: Clang/LLD as npm packages via WASM, works in browser + Node.js.
- **tbfleming/cib**: Emscripten-compiled Clang in Web Worker with Monaco editor.
- **webc86**: TCC inside JS x86 emulator. Proof of concept, archived March 2026.
- **tcc-riscv32-wasm**: TCC compiled to WASM via Zig, targets RISC-V ELF output.
- **JSCPP**: Pure JS C++ interpreter, 878 stars, educational focus, last updated ~2020.
- **xcc**: Self-hosted C compiler targeting WASM directly from AST. Browser demo exists.
- **twr-wasm**: Library for running pre-compiled C WASM in browser (not a compiler itself).

Key technical challenge: WASM only supports reducible control flow, requiring Relooper transforms for goto/complex switch.

## MEMORY_INSTRUMENTATION

Three instrumentation layers:
1. **Binary-level (Binaryen)**: `--instrument-memory` (all loads/stores), `--instrument-locals` (local reads/writes), `--log-execution` (function entry/exit). Works on compiled .wasm, no source access needed.
2. **Compiler-level (Emscripten)**: `--tracing` hooks dlmalloc for malloc/realloc/free callbacks. `SAFE_HEAP=1` instruments every load/store. ASan (`-fsanitize=address`) provides stack/heap tracking with source maps.
3. **Source/interpreter-level**: C interpreter emits events at each statement. PVC.js does this natively; xcc could add imported JS function calls at codegen time.

Key tension: Binary instrumentation captures WASM-level operations but loses C semantics (variable names, types). Source-level preserves C semantics but requires modifying the compiler/interpreter.

Wizard framework achieves 1.0-2.8x overhead vs Wasabi's 29.9-4721.5x, but requires specialized runtime.

## EXISTING_VISUALIZERS

- **Python Tutor** (pythontutor.com/c.html): 25M+ users, server-side GCC + Valgrind. Gold standard for accuracy.
- **PVC.js / PLIVET**: Fully client-side JS C interpreter using UNICOEN framework. Supports malloc/free, pointers, arrays. Students solved tasks 1.7x faster than SeeC. Active successor is PLIVET (409 commits).
- **Codecast**: Hybrid — Clang parses server-side to JSON, JS interprets client-side. Redux-based stepper.
- **cplayground**: Server-side Docker containers with custom Linux kernel module.
- **Compiler Explorer**: Server-side, shows assembly not memory state.

**Critical finding: No existing tool combines real C compilation via WASM with memory visualization on a static site.**

## WASM_SECURITY_AND_LIMITS

WASM sandbox enforces: memory bounds, protected call stacks, type-signature validation, zero-init memory. Strong by design.

**Real escapes exist**: CVE-2024-2887 (Pwn2Own 2024, Chrome), CVE-2023-2033 (V8, in-the-wild). JIT-compiler bugs are the primary escape vector.

**Infinite loops**: No WASM-level timeout mechanism. Practical solution: run in Web Worker, call `worker.terminate()` from main thread on timer.

**Memory limits**: WASM capped at 4GB (wasm32). Emscripten's `MAXIMUM_MEMORY` flag sets ceiling. Browsers OOM-kill tabs before 4GB.

For a static educational site: risk is low. Users can only harm their own browser tab. Web Worker + terminate is sufficient.

## STDLIB_BUNDLE_FEASIBILITY

- Emscripten: patched musl libc, stdio/string/math/stdlib work. No fork(), no signals, no raw sockets.
- Minimal hello world: ~10KB JS + ~2KB WASM. With Closure Compiler: ~3KB JS.
- Per-function WASI linking: sin = 7.9KB, malloc = 7.4KB. Bare function without stdlib = 207 bytes.
- Shipping Clang-WASM: ~100MB uncompressed (~30MB compressed). First-load is the primary UX bottleneck.
- WASI-SDK 23 accidentally increased sizes by 1029% (debug info default). Toolchain defaults matter.
- WASM binaries compress well (>50% gzip) and stream-compile 20x faster than JS parse.

## INTERPRETER_DEEP_DIVE (Gap Fill)

**PVC.js/PLIVET details:**
- TypeScript, uses UNICOEN framework (NOT ANTLR as originally claimed).
- PLIVET supports: break, case, char, const, continue, default, do, double, else, float, for, if, int, long, return, short, signed, sizeof, struct, switch, typedef, unsigned, void, while, _Bool.
- Does NOT support: enum, goto, union, static, register, auto, C11 keywords.
- Supports malloc/free, pointers, arrays, dynamic memory visualization.

**JSCPP details:**
- Has step-trace debugger API: `debugger.next()`, `debugger.variable()`, returns AST node with source position.
- Does NOT support: malloc/heap, structs, enums. Cannot visualize typical C data structure programs.

**Codecast/c-to-json:**
- c-to-json is a native Linux binary (C++, built on LLVM/Clang). No WASM build exists.
- Could theoretically be replaced by libclangjs (libClang compiled to WASM, 24 releases, last Sept 2023).
- libclangjs bundle size is unknown — critical gap for static site feasibility.

**xcc:**
- Self-hosted C compiler, targets WASM directly from AST. Browser demo exists.
- Is a compiler, not interpreter — no step-by-step execution or memory snapshots.

**Key gap:** No pure-JS C interpreter both supports malloc/heap AND exposes automatic per-step memory snapshots. PLIVET comes closest but snapshot format is undocumented.
