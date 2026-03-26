# Research: Client-Side C Execution via WebAssembly for Browser-Based Memory Visualization

> Researched 2026-03-25. Effort level: standard. ~45 unique sources consulted.

## Key Findings

1. **No existing tool combines real C compilation/execution via WASM with step-by-step memory visualization on a static site.** This is an unoccupied niche. Python Tutor (the gold standard) requires a server running GCC + Valgrind. PVC.js/PLIVET runs fully client-side but uses a JS-based C interpreter, not real compilation.

2. **Shipping a full C compiler (Clang) in the browser requires ~30-100MB download**, making it impractical for a lightweight static site. The compilation speed after caching (~1.3s) is acceptable, but first-load latency is a dealbreaker for casual visitors.

3. **A JS-based C interpreter (PLIVET) is the most viable path for CrowTools' use case.** PLIVET supports malloc/free, pointers, arrays, structs, and step-by-step execution — covering the C subset CrowTools visualizes. It runs fully client-side with zero download overhead beyond the interpreter itself. Students using PVC.js solved tasks 1.7x faster than those using alternative tools.

4. **WASM sandbox security is strong enough for an educational static site.** Real sandbox escapes exist (CVE-2024-2887, Pwn2Own 2024), but they exploit JIT-compiler bugs — the risk model for a static site where users can only harm their own tab is acceptable. Infinite loops are handled by running code in a Web Worker and calling `worker.terminate()` on a timer.

5. **Memory instrumentation at the C-semantic level (variable names, types, stack frames) requires source/interpreter-level hooks, not binary-level WASM instrumentation.** Binaryen's `--instrument-memory` captures raw loads/stores but loses C semantics. For CrowTools' `SnapshotOp` format, an interpreter that emits events per C statement is the right abstraction layer.

## Available Tools for Running C in the Browser

### Summary
The landscape divides into three tiers: full Clang-to-WASM toolchains (heavy, complete), TCC-based experiments (lighter, limited), and pure-JS interpreters (lightest, educational subset). For CrowTools, only the interpreter tier is practical without a server.

### Detail

**Clang-based (30-100MB download):**

| Project | Approach | Status | Download Size |
|---------|----------|--------|---------------|
| [Wasmer Clang](https://wasmer.io/posts/clang-in-browser) | Full Clang via WASIX | Active (Oct 2024) | ~100MB (~30MB compressed) |
| [binji/wasm-clang](https://github.com/binji/wasm-clang) | Clang+LLD in WASM+WASI | "Alpha demoware" (2019) | Large (undocumented) |
| [YoWASP](https://yowasp.org/) | Clang/LLD as npm WASM packages | Active | Large (undocumented) |
| [tbfleming/cib](https://tbfleming.github.io/cib/) | Emscripten-compiled Clang in Web Worker | Maintained | Large (undocumented) |

These produce real WASM binaries from C code. Compilation speed after caching is ~1.2-1.3s (Wasmer benchmark). The download size makes them unsuitable for a lightweight static site where users expect instant interaction.

**TCC-based (experimental):**

| Project | Approach | Status |
|---------|----------|--------|
| [webc86](https://github.com/pixeltris/webc86) | TCC inside JS x86 emulator | Archived (March 2026) |
| [tcc-riscv32-wasm](https://github.com/lupyuen/tcc-riscv32-wasm) | TCC compiled to WASM via Zig | Active, very limited |

TCC cannot trivially target WASM because WASM only supports reducible control flow — C's `goto` and complex `switch` require Relooper-style transforms that TCC doesn't implement. These projects work around this by emulating x86/RISC-V instead, adding complexity and overhead.

**Pure-JS interpreters (lightweight, educational):**

| Project | C Coverage | Malloc/Heap | Step Trace | Stars |
|---------|-----------|-------------|------------|-------|
| [PLIVET](https://github.com/RYOSKATE/PLIVET) | Good (structs, pointers, arrays) | Yes | Yes | Active (409 commits) |
| [JSCPP](https://github.com/felixhao28/JSCPP) | Limited (no structs, no malloc) | No | Yes (debugger API) | 878 |
| [xcc](https://github.com/tyfkda/xcc) | Good (self-hosting compiler) | N/A (compiler, not interpreter) | No | Active |

**PLIVET** is the standout for CrowTools' use case. It's the active successor to PVC.js, supports the C features CrowTools visualizes (variables, structs, pointers, malloc/free, arrays), and runs entirely client-side. Its supported C keywords: `break`, `case`, `char`, `const`, `continue`, `default`, `do`, `double`, `else`, `float`, `for`, `if`, `int`, `long`, `return`, `short`, `signed`, `sizeof`, `struct`, `switch`, `typedef`, `unsigned`, `void`, `while`, `_Bool`. Notable omissions: `enum`, `goto`, `union`, `static`, C11 keywords.

**JSCPP** has a useful debugger API (`debugger.next()`, `debugger.variable()`, AST node with source position) but lacks malloc and struct support — fatal gaps for memory visualization.

**xcc** is a real compiler (C to WASM) that runs in the browser, but it produces opaque binaries with no step-by-step introspection. Adding memory visualization would require a separate instrumentation layer.

### Open Questions
- PLIVET's automatic snapshot format is undocumented — direct source inspection is needed to understand whether its memory state can be mapped to CrowTools' `MemoryEntry[]` format.
- libclangjs (libClang compiled to WASM) could enable Codecast's architecture to work fully client-side, but its bundle size is unknown.

---

## Memory Instrumentation

### Summary
Three instrumentation layers exist for capturing memory events from C code running in WASM: binary-level (Binaryen), compiler-level (Emscripten), and source/interpreter-level. For CrowTools' need to produce `SnapshotOp[]` data (named variables, typed values, scoped stack frames), only source/interpreter-level instrumentation preserves the C semantics required.

### Detail

**Binary-level instrumentation (Binaryen):**
Binaryen's `wasm-opt` provides three passes:
- `--instrument-memory`: intercepts all memory reads/writes
- `--instrument-locals`: intercepts all local variable reads/writes
- `--log-execution`: logs function entry, loop headers, returns

These work on any compiled `.wasm` binary without source access. The problem: they operate at the WASM level, where C variable names, types, and scope boundaries are lost. WASM locals are numbered, not named. Mapping back to C semantics requires correlating with DWARF debug info — possible but complex and fragile.

Performance overhead with JS-callback-based instrumentation (Wasabi framework) ranges from 29.9x to 4721.5x slowdown. The Wizard framework reduces this to 1.0-2.8x but requires a specialized WASM runtime, not a standard browser.

**Compiler-level instrumentation (Emscripten):**
- `--tracing` flag: hooks dlmalloc so every `malloc`, `realloc`, `free` fires a callback (`emscripten_trace_record_allocation()`, etc.). Tracking data is stored off the Emscripten heap.
- `SAFE_HEAP=1`: Binaryen pass that instruments every load/store. `SAFE_HEAP_LOG` logs all operations.
- `-fsanitize=address` (ASan): LLVM IR-level instrumentation with redzones around allocations, call-stack traces with source file/line via `-gsource-map`.

These provide more semantic information than raw Binaryen passes but still don't directly expose C variable names or scope structure.

**Source/interpreter-level instrumentation:**
An interpreter that walks the C AST can emit events at each statement with full C semantics: variable name, type, value, scope, stack frame. This is how PVC.js/PLIVET works — the interpreter knows it's executing `int x = 5` in `main()`, not just "store 4 bytes at offset 16."

For CrowTools specifically, this maps directly to the `SnapshotOp` model: the interpreter can emit `addVar('main', variable('x', 'x', 'int', '5', '0x7ffc0060'))` because it has the AST context.

**Dylibso Observe SDK** provides automatic binary instrumentation for function/memory tracing with browser JS adapters — a potential middle ground, but still WASM-level semantics.

### Open Questions
- No documented approach exists for mapping Binaryen `--instrument-locals` events back to C variable names without DWARF correlation.
- Emscripten's `--tracing` and stack instrumentation have not been combined into a unified event stream suitable for step-by-step visualization.

---

## Existing C Visualizers

### Summary
The dominant C visualizers are server-dependent. Python Tutor uses GCC + Valgrind on a backend. Codecast uses server-side Clang for parsing. Only PVC.js/PLIVET runs fully client-side, using a JS interpreter — and it performs comparably to Python Tutor in student studies.

### Detail

**Python Tutor** (pythontutor.com/c.html): The gold standard. 25M+ users across 10,000+ universities. Server-side architecture: GCC (C11) compiles and runs the code, Valgrind Memcheck traces memory. Visualizes: globals, stack frames, heap allocations, pointers, uninitialized memory, out-of-bounds errors, nested structs/unions, bit-level representations. The accuracy comes precisely from running real compiled C with real memory inspection — impossible to replicate fully client-side.

**PVC.js / PLIVET**: The only fully client-side C memory visualizer found. TypeScript implementation using the UNICOEN framework to parse C into an intermediate representation, then interpret it with step execution and debug-info generation. Academic evaluation (Heliyon, 2020): students solved tasks 1.7x faster with 19% more correct answers compared to SeeC users. Performance rated equivalent to Python Tutor. Supports dynamic memory allocation (malloc/free), standard I/O, and file I/O.

**Codecast** (France-IOI / IMT): Three-component pipeline: (1) c-to-json runs server-side Clang to emit AST as JSON, (2) JSON sent to browser, (3) persistent-c interprets AST client-side via Redux-based stepper. Could theoretically go fully client-side by replacing c-to-json with libclangjs (libClang compiled to WASM), but no one has done this.

**Compiler Explorer** (godbolt.org): Server-side (AWS EC2 + nsjail), 92M compilations/year. Shows assembly output, not memory state.

**cplayground**: Server-side Docker containers with custom Linux kernel module. Visualizes OS-level constructs (file descriptors, processes, threads) for OS course education.

### Open Questions
- Codecast's persistent-c interpreter is tightly coupled to the Codecast monorepo — unclear if it can be extracted as a standalone library.
- No tool was found that combines compilation-level accuracy with static-site deployment.

---

## WASM Security and Practical Limits

### Summary
WebAssembly's sandbox is architecturally strong — modules cannot access host memory, filesystem, or network without explicit grants. Real sandbox escapes have occurred through JIT-compiler bugs (CVE-2024-2887 won Pwn2Own 2024), but the threat model for an educational static site is benign: users can only harm their own browser tab.

### Detail

**Sandbox guarantees (by spec):**
- Memory bounds checking at linear-memory-region granularity
- Protected call stacks isolated from linear memory
- Type-signature validation on indirect calls
- Zero-initialized memory
- No direct pointer operations across module boundaries

**Real sandbox escapes:**
- CVE-2024-2887 (Pwn2Own 2024, Chrome/Edge): Type confusion in WASM type-section parsing + integer underflow in SharedArrayBuffer handling. Achieved arbitrary read and full address-space access from within the renderer process.
- CVE-2023-2033 (V8, exploited in the wild): Corrupted WasmIndirectFunctionTable for arbitrary write.
- CVE-2024-30266 (Wasmtime): externref regression, host memory disclosure.

JIT-compiler bugs are described as "the primary sandbox escape vector." However, these exploits target the browser engine itself — they're no different in risk profile from any JavaScript the user runs. For a static educational site, this is an acceptable baseline.

**Intra-sandbox vulnerabilities:** Buffer overflows and use-after-free remain exploitable within WASM's linear memory. WASM lacks stack canaries, ASLR, and safe unlinking. An empirical study found 1,088 of 17,802 C programs behave differently when compiled to WASM vs x86-64. This matters for real applications but is irrelevant for CrowTools — the interpreted C code doesn't have attack surface within the WASM sandbox.

**Infinite loop mitigation:**
No standardized WASM timeout mechanism exists (WebAssembly design issues #712 and #1380 remain unresolved). The practical pattern:
1. Run WASM in a Web Worker
2. Set a timer on the main thread (e.g., 5 seconds)
3. Call `worker.terminate()` if the timer fires

This stops execution immediately regardless of what the worker is doing. For non-browser runtimes, Wasmtime provides fuel-based (deterministic, counts instructions) and epoch-based (~10% overhead, wall-time) interruption, but neither is available as a browser API.

**Memory limits:**
WASM linear memory is capped at 4GB (wasm32 hard limit). Emscripten's `MAXIMUM_MEMORY` flag sets an explicit ceiling (default 2GB). Browsers OOM-kill tabs before 4GB. For CrowTools, setting `MAXIMUM_MEMORY` to 64-256MB is more than sufficient.

### Open Questions
- Whether `worker.terminate()` guarantees immediate WASM halting across all browser engines is not formally documented.
- Safari's tab-killing threshold for WASM memory is undocumented.

---

## Standard Library Support and Bundle Feasibility

### Summary
Emscripten provides near-complete C stdlib (stdio, string, math, stdlib) via patched musl libc, with output sizes ranging from ~12KB (minimal hello world) to ~200KB (real programs). The bottleneck is not the compiled user program — it's the compiler itself. Shipping Clang in WASM requires ~30-100MB, making first-load latency the primary UX obstacle. A JS interpreter approach avoids this entirely.

### Detail

**Emscripten stdlib coverage:**
- Fully supported: stdio (printf, scanf, sprintf family), string.h, math.h, stdlib.h (malloc/free via dlmalloc), assert.h, ctype.h, limits.h, time.h (partial)
- Not supported: fork(), POSIX signals, raw sockets (TCP emulated via WebSocket proxy), synchronous network I/O, local filesystem (virtual FS only), inline assembly (unless targeting WASM)
- With `-sFILESYSTEM=0`: filesystem code stripped, only minimal stdout for printf retained

**Bundle size benchmarks:**
| Scenario | Size |
|----------|------|
| Bare C function, no stdlib | 207 bytes |
| Minimal hello world (Emscripten) | ~12KB (10KB JS + 2KB WASM) |
| With Closure Compiler | ~5KB (3KB JS + 2KB WASM) |
| WASI libc: sin() | +7.9KB |
| WASI libc: malloc() | +7.4KB |
| Real program (camaro, -Os) | 130KB |
| Real program (FastLED, optimized) | 287KB |
| No-stdlib WebGL2 demo | 6.2KB |

WASM binaries compress well under gzip (>50% reduction) and stream-compile in browsers ~20x faster per kilobyte than equivalent JavaScript can be parsed.

**Compiler download size (the real problem):**
| Tool | Uncompressed | Compressed | First compile (cached) |
|------|-------------|------------|----------------------|
| Wasmer Clang | ~100MB | ~30MB (target) | ~1.3s |
| binji/wasm-clang | Large (undoc.) | Unknown | Unknown |
| jslinux approach | Unknown | Unknown | ~4.7s |

For a static GitHub Pages site targeting students, a 30-100MB first-load download is a non-starter. This is the single strongest argument against the "real C compiler in the browser" approach for CrowTools.

**WASI browser polyfill situation:** Running WASI libc in the browser requires JS polyfills for syscalls: `fd_write`, `fd_read`, `environ_get`, `proc_exit`, etc. No standardized browser polyfill exists — existing third-party ones are poorly documented. WASI-SDK 23 accidentally increased output sizes by 1029% by enabling debug info by default, illustrating fragility of the toolchain.

### Open Questions
- No published benchmarks compare Emscripten vs WASI-SDK output size for equivalent programs.
- How long it takes to instantiate and JIT-compile the Clang WASM module across different browsers/hardware lacks systematic measurement.

---

## Tensions and Debates

**Real compiler vs. interpreter for educational memory visualization:**
The Clang-based approach (Wasmer, binji/wasm-clang) provides accurate C semantics — real compilation, real memory layout, real undefined behavior. Python Tutor's accuracy comes from this approach (GCC + Valgrind, server-side). Against this, PVC.js/PLIVET demonstrates that a JS interpreter covering a C subset is *sufficient* for education — students performed equivalently, and the zero-download, zero-server advantage is significant. For CrowTools specifically, which already uses a hand-authored step model (not real execution), an interpreter generating `SnapshotOp[]` is architecturally aligned.

**Binary instrumentation vs. source-level instrumentation:**
Binary instrumentation (Binaryen passes, Emscripten SAFE_HEAP) is general and requires no compiler modification, but it captures WASM-level semantics — numbered locals, byte offsets — not C-level semantics (named variables, typed values, scoped frames). Source/interpreter-level instrumentation preserves C semantics but requires building or modifying an interpreter. For CrowTools' `MemoryEntry` model (which has `name`, `type`, `value`, `address`, `kind`, `scope`), binary-level instrumentation would require a complex DWARF-correlation layer that likely exceeds the effort of just using an interpreter.

**Download size vs. capability:**
Wasmer frames ~30MB compressed as acceptable for an IDE-like experience. HN commenters flagged this as a dealbreaker for casual/static sites. The tension is real: cached return visits are fast (~1.3s compile), but first-visit bounce rates would be severe. A JS interpreter adds ~0 extra download for a fraction of the capability.

## Gaps and Limitations

- **PLIVET snapshot format**: How PLIVET represents memory state internally and whether it can be adapted to emit CrowTools' `SnapshotOp[]` format is undocumented. Direct source code inspection is needed.
- **libclangjs bundle size**: Unknown. This is the critical missing data point for evaluating whether Codecast's architecture could work fully client-side.
- **Worker.terminate() guarantees**: No formal documentation confirms immediate WASM halting across all browser engines.
- **Performance of JS interpreters**: No benchmarks found for PLIVET/JSCPP execution speed on programs of 50-200 lines — the typical CrowTools program size.
- **Blocked sources**: ~10 URLs were inaccessible (paywalls, reCAPTCHA, cert errors, binary PDFs), including the PVC.js full paper on PMC and a Stanford CS191 paper on a client-side C++ IDE.
- **Recency**: WASM tooling evolves rapidly. Some sources are from 2019-2022 and may not reflect current capabilities.

## Implications for CrowTools

Given CrowTools' architecture (pre-authored `Program` objects with `SnapshotOp[]` steps, static GitHub Pages deployment), the research points to three viable paths for user-authored programs, ordered by feasibility:

### Path A: Adapt PLIVET as a C interpreter (recommended)
Embed PLIVET (or its interpreter core) in CrowTools. Users write C in the browser. PLIVET interprets it step-by-step, and a translation layer converts PLIVET's execution trace into CrowTools' `Program` format (`SnapshotOp[]`). Zero additional download. Covers the C subset CrowTools already visualizes (variables, structs, pointers, malloc/free). Main risk: PLIVET's internals may not expose state cleanly enough for translation.

### Path B: Build a minimal C interpreter from scratch
Write a small C interpreter in TypeScript that directly emits `SnapshotOp[]` during execution. Parse C with tree-sitter-c (compiled to WASM, ~200KB) or a hand-rolled recursive descent parser for a C subset. The interpreter only needs to handle the constructs CrowTools visualizes — no need for full C compliance. More work upfront but perfect architectural fit.

### Path C: Hybrid with LLM generation
Let users write C, send it to an LLM API to generate the `Program` JSON, validate with `validateProgram()`, let users edit. No interpreter needed. Requires API key. Non-deterministic but leverages the existing engine with zero new runtime code.

## Sources

### Most Valuable
- [Wasmer: Running Clang in the browser](https://wasmer.io/posts/clang-in-browser) — Definitive reference for Clang-in-WASM feasibility, performance, and download size
- [PVC.js paper (Heliyon 2020)](https://www.sciencedirect.com/science/article/pii/S2405844020306514) — Academic evaluation of client-side C visualization; 1.7x task completion speedup
- [PLIVET GitHub](https://github.com/RYOSKATE/PLIVET) — Active client-side C interpreter with memory visualization; most relevant prior art
- [Emscripten trace.h documentation](https://emscripten.org/docs/api_reference/trace.h.html) — Malloc/free hook API for WASM memory instrumentation
- [WebAssembly security spec](https://webassembly.org/docs/security/) — Canonical sandbox guarantees
- [CVE-2024-2887 writeup (ZDI)](https://www.thezdi.com/blog/2024/5/2/cve-2024-2887-a-pwn2own-winning-bug-in-google-chrome) — Real WASM sandbox escape, grounds the security discussion
- [Binaryen instrumentation (node-wasm-trace)](https://github.com/wasm3/node-wasm-trace) — Binary-level memory/locals/execution instrumentation passes
- [JSCPP debugger API](https://github.com/felixhao28/JSCPP) — Step-trace API design reference, even though JSCPP's C coverage is insufficient

### Full Source List
| Source | Facet | Type | Date | Key contribution |
|--------|-------|------|------|-----------------|
| [Wasmer: Clang in browser](https://wasmer.io/posts/clang-in-browser) | Tools | Vendor blog | Oct 2024 | Full Clang via WASIX, ~100MB download, cross-browser |
| [binji/wasm-clang](https://github.com/binji/wasm-clang) | Tools | GitHub repo | 2019 | CppCon demo, Clang+LLD in WASM |
| [tbfleming/cib](https://tbfleming.github.io/cib/) | Tools | Live demo | Unknown | Emscripten Clang in Web Worker |
| [webc86](https://github.com/pixeltris/webc86) | Tools | GitHub repo | Archived 2026 | TCC + x86 emulation proof of concept |
| [tcc-riscv32-wasm](https://github.com/lupyuen/tcc-riscv32-wasm) | Tools | GitHub repo | Active | TCC to WASM via Zig |
| [JSCPP](https://github.com/felixhao28/JSCPP) | Tools, Interpreters | GitHub repo | ~2020 | JS C++ interpreter with debugger API |
| [YoWASP](https://yowasp.org/) | Tools | Project site | Current | Clang/LLD as npm WASM packages |
| [xcc](https://github.com/tyfkda/xcc) | Tools, Interpreters | GitHub repo | Active | Self-hosted C compiler targeting WASM |
| [twr-wasm](https://github.com/twiddlingbits/twr-wasm) | Tools | GitHub repo | Sept 2024 | Pre-compiled C WASM runtime library |
| [HN: Clang in browser](https://news.ycombinator.com/item?id=41767644) | Tools | Community | 2024 | Performance benchmarks, technical discussion |
| [Emscripten trace.h](https://emscripten.org/docs/api_reference/trace.h.html) | Instrumentation | Official docs | Current | Malloc/free hook API |
| [Emscripten Sanitizers](https://emscripten.org/docs/debugging/Sanitizers.html) | Instrumentation | Official docs | Current | ASan for WASM |
| [Emscripten Debugging](https://emscripten.org/docs/porting/Debugging.html) | Instrumentation | Official docs | Current | SAFE_HEAP, memory profiler |
| [node-wasm-trace](https://github.com/wasm3/node-wasm-trace) | Instrumentation | GitHub repo | Active | Binaryen instrumentation passes |
| [Wizard framework (arXiv)](https://arxiv.org/html/2403.07973v1) | Instrumentation | Academic | 2024 | Non-intrusive WASM instrumentation, 1-2.8x overhead |
| [Dylibso Observe SDK](https://dev.dylibso.com/docs/observe/overview/) | Instrumentation | Product docs | Current | Automatic binary instrumentation |
| [xcc blog post](https://dev.to/tyfkda/running-a-c-compiler-in-a-browser-4g9h) | Instrumentation | Developer blog | ~2022 | AST-level codegen with JS imports |
| [WASM Memory Visualizer (Observable)](https://observablehq.com/@ballingt/web-assembly-memory-visualizer) | Instrumentation | Community | ~2021 | Direct linear memory inspection |
| [web.dev WASM debugging](https://web.dev/articles/webassembly-memory-debugging) | Instrumentation | Google | ~2022 | LeakSanitizer integration |
| [Python Tutor C visualizer](https://pythontutor.com/articles/c-cpp-visualizer.html) | Visualizers | Product docs | Current | Gold standard: GCC + Valgrind, server-side |
| [PVC.js paper (Heliyon)](https://www.sciencedirect.com/science/article/pii/S2405844020306514) | Visualizers | Academic | 2020 | Client-side C interpreter evaluation |
| [PLIVET](https://github.com/RYOSKATE/PLIVET) | Visualizers, Interpreters | GitHub repo | Active | Active PVC.js successor, 409 commits |
| [PLIVET supported keywords](https://github.com/RYOSKATE/PLIVET/wiki/Support-C-Language-Keywords) | Interpreters | Wiki | Current | Definitive C coverage list |
| [Codecast](https://github.com/France-ioi/codecast) | Visualizers | GitHub repo | Active | Hybrid: server Clang parse, client JS interpret |
| [c-to-json](https://github.com/epixode/c-to-json) | Interpreters | GitHub repo | Active | Clang-based C-to-JSON AST extractor |
| [libclangjs](https://github.com/donalffons/libclangjs) | Interpreters | GitHub repo | Sept 2023 | libClang as WASM, AST traversal API |
| [Compiler Explorer internals](https://xania.org/202506/how-compiler-explorer-works) | Visualizers | Author blog | 2025 | Server-side architecture details |
| [cplayground](https://github.com/reberhardt7/cplayground) | Visualizers | GitHub repo | Active | Docker-based, OS construct visualization |
| [WebAssembly security spec](https://webassembly.org/docs/security/) | Security | Official spec | Current | Canonical sandbox model |
| [CVE-2024-2887 (ZDI)](https://www.thezdi.com/blog/2024/5/2/cve-2024-2887-a-pwn2own-winning-bug-in-google-chrome) | Security | Vuln research | May 2024 | Pwn2Own WASM sandbox escape |
| [WASM security survey (arXiv)](https://arxiv.org/html/2407.12297v1) | Security | Academic | July 2024 | 121-paper meta-analysis |
| [WASM Breach (Medium)](https://medium.com/@instatunnel/the-wasm-breach-escaping-backend-webassembly-sandboxes-05ad426051fc) | Security | Security blog | 2024 | CVE taxonomy for WASM escapes |
| [WASM design #712](https://github.com/WebAssembly/design/issues/712) | Security | Spec discussion | 2016 | No timeout standardization |
| [WASM design #1380](https://github.com/WebAssembly/design/issues/1380) | Security | Spec discussion | Open | Ongoing timeout debate |
| [LLM sandbox with WASM](https://medium.com/collaborne-engineering/building-a-secure-code-sandbox-for-llms-with-webassembly-bdd91a835f23) | Security | Practitioner | Feb 2026 | Real-world Web Worker + terminate pattern |
| [Wasmtime interrupting](https://docs.wasmtime.dev/examples-interrupting-wasm.html) | Security | Official docs | Current | Fuel and epoch interruption APIs |
| [Google Project Zero WASM](https://projectzero.google/2018/08/the-problems-and-promise-of-webassembly.html) | Security | Elite research | Aug 2018 | Early attack surface analysis |
| [V8 4GB WASM memory](https://v8.dev/blog/4gb-wasm-memory) | Feasibility | Engine blog | 2020 | Browser memory caps |
| [Emscripten FAQ](https://emscripten.org/docs/getting_started/FAQ.html) | Feasibility | Official docs | Current | Stdlib coverage and limitations |
| [Emscripten optimizing](https://emscripten.org/docs/optimizing/Optimizing-Code.html) | Feasibility | Official docs | Current | Size reduction techniques |
| [WASM and C stdlib](https://log.schemescape.com/posts/webassembly/c-standard-library-example.html) | Feasibility | Practitioner | Unknown | Per-function size measurements |
| [Minimal Emscripten](https://rongjiecomputer.github.io/minimal-emscripten/) | Feasibility | Experiment | Unknown | JS glue size: 8KB standard, 3KB Closure |
| [WASI polyfill for browsers](https://dev.to/ndesmic/building-a-minimal-wasi-polyfill-for-browsers-4nel) | Feasibility | Developer blog | Unknown | Required syscall stubs |
| [Bare C to WASM](https://aransentin.github.io/cwasm/) | Feasibility | Practitioner | Unknown | No-stdlib approach, 6.2KB WebGL2 demo |
| [Emscripten compile speed](https://github.com/emscripten-core/emscripten/issues/26455) | Feasibility | Issue tracker | 2024-2025 | 3.96s to 0.31s optimization guide |
