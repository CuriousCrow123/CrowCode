# Phase 1: Facet Decomposition

## Topic
Generator-based interpreters with pause/resume capability in JavaScript/TypeScript, for a C interpreter that pauses when stdin is empty.

## Prior Research
`docs/research/stdin-handling-browser-interpreters.md` covers high-level patterns (JSCPP drain callback, JS-Interpreter step(), SharedArrayBuffer, Emscripten Asyncify). This research goes deeper into implementation specifics.

## Facets

### F1: Generator Interpreter Implementations
**Question:** What real-world JavaScript/TypeScript interpreters use generators for pause/resume, and what are their concrete architectures?
**Search seeds:**
- "JavaScript generator interpreter pause resume implementation"
- "generator function* interpreter step yield AST"
- "TypeScript interpreter generator coroutine pause"

### F2: TypeScript Generator Type Safety
**Question:** How do you properly type `Generator<YieldType, ReturnType, NextType>` for an interpreter that yields different request types and receives different response types?
**Search seeds:**
- "TypeScript Generator type YieldType ReturnType NextType"
- "TypeScript generator function* type safety yield"
- "TypeScript discriminated union generator yield type"

### F3: JSCPP Architecture Deep Dive
**Question:** How does JSCPP's interpreter loop, debugger stepping, and stdin drain callback actually work at the code level?
**Search seeds:**
- "JSCPP interpreter architecture debugger"
- "felixhao28 JSCPP source code interpreter"
- site:github.com "felixhao28/JSCPP" interpreter

### F4: JS-Interpreter Step Architecture
**Question:** How does Neil Fraser's JS-Interpreter implement step(), createAsyncFunction(), and state serialization?
**Search seeds:**
- "JS-Interpreter Neil Fraser step function async"
- "JS-Interpreter createAsyncFunction pause resume"
- site:neil.fraser.name JS-Interpreter

### F5: Generator Performance
**Question:** What is the actual overhead of yield vs direct function calls in modern JS engines, and does it matter for 500 steps?
**Search seeds:**
- "JavaScript generator performance benchmark yield overhead"
- "V8 generator optimization performance"
- "generator vs callback performance JavaScript 2025"

### F6: Yield Delegation Depth Limits
**Question:** Are there practical limits on `yield*` delegation depth in V8/SpiderMonkey, and how does it interact with the call stack?
**Search seeds:**
- "yield* delegation depth limit V8"
- "JavaScript generator yield star nested depth"
- "generator recursion stack overflow JavaScript"

### F7: Svelte 5 Async State Management
**Question:** What patterns exist for managing async pause/resume operations in Svelte 5 with runes ($state, $derived, $effect)?
**Search seeds:**
- "Svelte 5 runes async state management"
- "Svelte 5 $state promise async pattern"
- "SvelteKit async generator state runes"

## Known Tensions
- Generator elegance vs performance overhead
- Type safety of heterogeneous yields vs simplicity of a single yield type
- Step-at-a-time (JS-Interpreter) vs generator-based (natural yield points)
- Pre-supplied input simplicity vs interactive input UX

## Likely Gaps
- Concrete performance numbers for generators in interpreter-like workloads (most benchmarks test tight loops)
- yield* depth limits are likely undocumented engine internals
- Svelte 5 + generators is a niche intersection with few examples

## Recency Sensitivity
- Svelte 5 runes: HIGH (Svelte 5 released late 2024, patterns still evolving)
- V8/SpiderMonkey generator optimizations: MEDIUM (engines improve regularly)
- Generator TypeScript types: LOW (stable since TS 3.6)
- JSCPP/JS-Interpreter: LOW (mature, infrequently updated)
