# Phase 1: Facet Decomposition

## Topic
How do browser-based C/programming visualizers and online IDEs implement stdin/user input handling? Implementation patterns for pausing program execution when input is needed.

## Facets

### 1. EDUCATIONAL_VISUALIZERS_STDIN
**Question:** How do Python Tutor and similar educational visualizers (Java Visualizer, C Tutor) handle stdin? Do they support interactive input, pre-supply it, or skip it?
**Search seeds:**
- "Python Tutor stdin input handling implementation"
- "pythontutor.com user input scanf gets"
- "educational code visualizer interactive input architecture"

### 2. ONLINE_IDE_STDIN
**Question:** How do major online IDEs (Compiler Explorer/Godbolt, OnlineGDB, JDoodle, Replit) implement stdin? Is it pre-supplied, interactive with pausing, or something else?
**Search seeds:**
- "Compiler Explorer godbolt stdin input support"
- "OnlineGDB interactive input implementation"
- "Replit stdin handling architecture web IDE"

### 3. GENERATOR_COROUTINE_INTERPRETERS
**Question:** What are the technical patterns for implementing interpreters that can pause mid-execution using JavaScript generators, coroutines, or async/await? How do they yield on blocking calls like scanf?
**Search seeds:**
- "javascript generator interpreter pause execution yield"
- "coroutine based interpreter browser stdin pause"
- "async interpreter yield on input javascript"

### 4. WEB_WORKER_SHARED_MEMORY
**Question:** How can Web Workers, SharedArrayBuffer, and Atomics.wait be used to implement synchronous blocking I/O in browser interpreters? What are the cross-browser constraints?
**Search seeds:**
- "SharedArrayBuffer Atomics.wait stdin browser interpreter"
- "web worker synchronous blocking input SharedArrayBuffer"
- "emscripten stdin SharedArrayBuffer Atomics"

### 5. WASM_RUNTIME_STDIN
**Question:** How do WebAssembly-based C runtimes (Emscripten, WASI) handle stdin in the browser? What patterns exist for providing input to WASM programs?
**Search seeds:**
- "emscripten scanf stdin browser implementation"
- "WASI stdin browser WebAssembly input"
- "WebAssembly C program stdin handling browser"

### 6. PRE_VS_INCREMENTAL_INTERPRETATION
**Question:** What are the architectural trade-offs between pre-supplying all input before execution vs. incrementally interpreting and pausing for input? How do different tools make this choice?
**Search seeds:**
- "online IDE pre-supply stdin vs interactive input"
- "interpreter pause resume input browser architecture"
- "browser code execution stdin buffer vs interactive"

## Known Tensions
- Pre-supplied input (simpler, deterministic) vs. interactive input (better UX, harder to implement)
- Generator-based pause (single-threaded, cooperative) vs. Worker-based blocking (true blocking, more complex)
- Full WASM compilation (real C execution) vs. interpreter (easier to instrument/pause)

## Likely Gaps
- Internal architecture details of commercial tools (Replit, JDoodle) may not be publicly documented
- SharedArrayBuffer browser support constraints post-Spectre may be evolving
- Few sources may directly compare all architectural approaches

## Recency Sensitivity
Medium-high. SharedArrayBuffer/COOP/COEP requirements changed significantly 2020-2023. WASI is evolving. Bias toward sources from 2022+.
