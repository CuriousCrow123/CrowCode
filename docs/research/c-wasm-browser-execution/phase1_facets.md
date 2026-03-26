# Phase 1: Facet Decomposition

**Topic:** Client-side C interpretation/compilation via WebAssembly for running C code in the browser on a static site

## Facets

### 1. C_IN_BROWSER_TOOLS
**Question:** What projects exist for compiling/interpreting C code client-side in the browser via WASM?
**Search seeds:** `"C compiler WebAssembly browser"`, `"TCC WASM browser" OR "picoc WASM"`, `"JSCPP" OR "C interpreter javascript browser"`

### 2. MEMORY_INSTRUMENTATION
**Question:** How can these tools be instrumented to capture memory events (variable declarations, assignments, malloc/free, stack frames)?
**Search seeds:** `"C memory tracer WASM" instrumentation`, `"C memory visualization" client-side`, `"AddressSanitizer WASM" OR "C runtime instrumentation browser"`

### 3. EXISTING_VISUALIZERS
**Question:** What browser-based C visualizers/tutors already exist that execute C client-side?
**Search seeds:** `"C visualizer browser" memory`, `"C tutor online" memory visualization`, `"C playground browser" WASM`

### 4. WASM_SECURITY_AND_LIMITS
**Question:** What are the security properties and practical limits of running arbitrary user C code in a WASM sandbox?
**Search seeds:** `"WebAssembly sandbox security" user code`, `"WASM infinite loop" timeout memory limit`, `"WebAssembly security model" escape`

### 5. STDLIB_BUNDLE_FEASIBILITY
**Question:** What C stdlib support is available in WASM, and what are the bundle size/compilation speed/UX implications?
**Search seeds:** `"WASI libc" OR "emscripten libc" stdlib support`, `"C WASM bundle size" compilation speed`, `"emscripten file size" performance`

## Known Tensions
- Full compiler (TCC/Clang) vs. interpreter (picoc/JSCPP) — C coverage vs. simplicity
- WASM sandbox guarantees vs. practical risks (infinite loops, memory bombs)
- Emscripten (heavy, full stdlib) vs. minimal approaches (light, limited stdlib)

## Likely Gaps
- Memory instrumentation specifics for WASM C runtimes
- Bundle size benchmarks for different approaches

## Recency Sensitivity
Medium-high. WASM tooling evolves quickly; bias toward 2024-2026 sources.
