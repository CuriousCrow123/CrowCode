# Phase 2: Consolidated Research Findings

> Total unique sources: 28+ | Per-facet confidence: medium-high | Blocked sources: Quora (403), Google Groups (rendered as JS app)

## Facet 1: Educational Visualizers (Python Tutor et al.)

**SUMMARY:** Python Tutor does not support interactive stdin for any language. It runs programs to completion in one pass, generating a full execution trace. For C/C++, it uses Valgrind on the backend. The stateless web session architecture fundamentally prevents interactive input.

**KEY FINDINGS:**
- Python Tutor runs the full program once on the backend, generating all trace entries before sending to frontend (GitHub: pythontutor-dev/pythontutor#21)
- The PGLogger class hooks into Python's bdb debugger, pausing at every function call/return/step to capture state (developer-overview.md)
- For C/C++, a contributor proposed pre-supplying input via valgrind_p.communicate(input=TESTCASE) but maintainer noted this requires "re-executing from scratch each time the user makes input" since web sessions aren't persistent
- stdin handling issue remains open and unresolved (GitHub issue #21)
- Architecture is fundamentally "run once, visualize trace" - not incremental

**CONFIDENCE:** High

## Facet 2: Online IDE Stdin Patterns

**SUMMARY:** Compiler Explorer uses pre-supplied stdin in its execution panel. Server-backed IDEs (OnlineGDB, Replit) use WebSocket connections to real backend processes, enabling true interactive stdin via PTY bridging. JDoodle/Ideone use API-based pre-supplied input.

**KEY FINDINGS:**
- Compiler Explorer: stdin available via "Add new -> Execution only" panel, pre-supplied text box (GitHub issue #2139, closed as completed)
- Compiler Explorer tools support monacoStdin for complex multi-line input (AddingATool.md)
- OnlineGDB/similar: WebSocket connects browser terminal to backend PTY process. ptyProcess.write() sends user input, ptyProcess.on('data') sends output back
- Replit: Uses custom @replit/ruspty library, xterm.js frontend, PTY over network. Created xterm-headless for scrollback buffer management
- JDoodle: API-based execution (api.jdoodle.com/execute), stdin passed as parameter alongside script
- Ideone: Pre-supplied stdin text box, batch execution model

**CONFIDENCE:** High

## Facet 3: Generator/Coroutine Interpreters

**SUMMARY:** JavaScript generators (function*) provide the most natural pattern for pausable interpreters. The interpreter yields at each statement/operation, and the caller controls advancement via next(). For stdin, the interpreter yields a special "need input" value, and the caller feeds input back via next(inputValue). This pattern is used by JSCPP and JS-Interpreter (Blockly).

**KEY FINDINGS:**
- JS generators pause at yield, preserve all state, and resume via next() with optional value injection
- JSCPP (C++ interpreter in JS) uses a "drain" callback invoked when stdin buffer is exhausted. Returns string concatenated to buffer. Pull-based model.
- JSCPP debugger uses next()/continue() stepping - suggests internal state machine rather than raw generators
- JS-Interpreter (Neil Fraser/Blockly) uses step() method returning boolean. Supports createAsyncFunction for I/O operations where callback resumes execution
- JS-Interpreter can serialize full interpreter state (loops, variables, closures) for pause/resume across sessions - 300kb overhead
- Blockly documentation shows step-based pattern for handling user input: stop stepping loop, wait for input, resume stepping
- "Throw and re-execute" pattern (React Suspense-like): throw error to pause, cache results, re-execute from start with cached intermediates

**CONFIDENCE:** High

## Facet 4: Web Worker + SharedArrayBuffer

**SUMMARY:** SharedArrayBuffer + Atomics.wait provides true synchronous blocking in Web Workers, enabling stdin that feels synchronous to the interpreter. The worker thread blocks on Atomics.wait(), the main thread collects input and signals via Atomics.notify(). Requires cross-origin isolation (COOP/COEP headers).

**KEY FINDINGS:**
- Atomics.wait() blocks the calling thread until Atomics.notify() is called or timeout expires. Returns "ok", "not-equal", or "timed-out"
- Can ONLY be used in Web Workers, never on main thread (would freeze UI)
- Atomics.waitAsync() available for main thread (non-blocking, returns promise)
- wasm-webterm implements this pattern: WASM runs in worker, stdin request triggers Comlink proxy to main thread, worker blocks via Atomics until input arrives
- @wasmer/wasm-terminal uses same pattern: SharedArrayBuffer + Atomics + Web Worker + Comlink
- Requires COOP/COEP headers: Cross-Origin-Opener-Policy: same-origin, Cross-Origin-Embedder-Policy: require-corp (or credentialless)
- GitHub Pages workaround: coi-serviceworker intercepts requests and adds headers client-side
- Fallback when SharedArrayBuffer unavailable: window.prompt() (blocks main thread, terrible UX)
- Post-Spectre, all major browsers now support SharedArrayBuffer with cross-origin isolation enabled

**CONFIDENCE:** High

## Facet 5: WASM Runtime Stdin

**SUMMARY:** Emscripten's default stdin uses window.prompt() which is unusable for real applications. Asyncify transforms enable pausing WASM execution for async JS operations but adds ~50% code size/perf overhead. Custom FS.init() callbacks and FS.createDevice() provide character-level input hooks. twr-wasm provides a cleaner abstraction with twrWasmModuleAsync for blocking input.

**KEY FINDINGS:**
- Emscripten default: window.prompt() for stdin in browser, synchronous and blocking
- FS.init(inputCallback): callback returns ASCII code when data available, null when not. Must be set in Module.preRun
- FS.createDevice('/dev', 'stdin', callback): creates custom input device
- Asyncify: instruments WASM code to unwind/rewind call stack for async operations. ~50% overhead. Compile with -O3 to mitigate
- Asyncify can wrap getc via linker --wrap option, redirecting to async JS function
- Issue #17800: "stdin will not wait for user input but continue" - core problem with default approach
- twr-wasm: twrWasmModuleAsync class required for keyboard input, provides blocking read semantics
- PicoC compiled to WASM via Emscripten (picoc-js npm package) - faces same stdin challenges

**CONFIDENCE:** Medium-High (Asyncify details well-documented, but practical stdin implementations are scattered)

## Facet 6: Pre-supplied vs Incremental Interpretation

**SUMMARY:** Two fundamental architectures exist: (1) pre-supply all input and run to completion (Python Tutor, Compiler Explorer, Ideone), which is simpler but prevents truly interactive programs; (2) incremental interpretation with pause-on-input (JSCPP, wasm-webterm, Replit), which provides interactive UX but requires complex pause/resume machinery.

**KEY FINDINGS:**
- Pre-supply: User provides all stdin before execution. Program runs to completion. Deterministic, reproducible, simpler implementation
- Incremental: Interpreter pauses when input needed, waits for user, resumes. More complex but supports interactive programs
- Rust WASM forum consensus: "You have to use async for this. No amount of condvars, mutexes or atomics will save you" (on main thread)
- Fundamental JS constraint: single-threaded event loop cannot block synchronously for input on main thread
- Worker thread CAN block synchronously via Atomics.wait, making it the only true "blocking stdin" option in browser
- Hybrid approach: some tools pre-buffer known inputs but fall back to interactive for unexpected reads
- For educational visualizers specifically: pre-supply is dominant because the goal is visualization, not interaction

**CONFIDENCE:** Medium-High
