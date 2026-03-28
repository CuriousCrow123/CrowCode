# Research: Stdin Handling in Browser-Based Interpreters and Visualizers

> Researched 2026-03-27. Effort level: deep. 28+ unique sources consulted.

## Key Findings

1. **Five distinct architectural patterns exist** for handling stdin in browser-based interpreters, each with fundamentally different trade-offs: pre-supplied input buffers, generator/step-based interpreters, async/callback interpreters, Web Worker + SharedArrayBuffer blocking, and Emscripten Asyncify stack unwinding.

2. **Python Tutor does not support stdin at all.** Its "run once, generate full trace" architecture is fundamentally incompatible with interactive input. The maintainer stated that supporting it would require "re-executing from scratch each time the user makes input." This is the same architecture CrowCode currently uses.

3. **SharedArrayBuffer + Atomics.wait in a Web Worker is the only way to achieve true synchronous blocking** for stdin in a browser. This is the approach used by wasm-webterm and @wasmer/wasm-terminal. It requires COOP/COEP headers (achievable on GitHub Pages via coi-serviceworker).

4. **Generator/step-based interpreters offer the simplest pause-on-input pattern** for custom interpreters (not WASM). JSCPP's "drain" callback and JS-Interpreter's step()/createAsyncFunction() demonstrate this well. The interpreter yields control, the host collects input, and execution resumes.

5. **Server-backed IDEs (Replit, OnlineGDB) sidestep the problem entirely** by running real processes on backend servers with PTY connections over WebSockets. This is architecturally irrelevant for client-side-only tools like CrowCode.

---

## Educational Visualizers (Python Tutor, C Tutor)

### Summary
Python Tutor and its derivatives (C Tutor, Java Tutor) run programs to completion on a backend server, capture a full execution trace, then send the trace as JSON to the frontend for visualization. This architecture has no mechanism for interactive input.

### Detail
Python Tutor's backend uses Python's `bdb` debugger module. The `PGLogger` class subclasses `bdb.Bdb` and intercepts every function call, return, exception, and single-line step. At each pause, it captures the full stack and heap state into a `trace_entry` dict, appending it to `self.trace`. After execution completes, the entire trace (one entry per "step") is serialized as JSON and sent to the frontend.

For C/C++ support, Python Tutor uses Valgrind on the backend to instrument native execution. A GitHub contributor proposed passing pre-supplied input via `valgrind_p.communicate(input=TESTCASE)`, but the maintainer (Philip Guo) explained the fundamental obstacle:

> "To get it to work with Python Tutor, you need a way to re-execute from scratch each time the user makes an input, since the web session isn't persistent. This will involve a lot of hacking inside of valgrind itself." -- [GitHub issue #21](https://github.com/pythontutor-dev/pythontutor/issues/21)

The issue remains open and unresolved. Python Tutor's architecture is "run once, visualize trace" -- not incremental interpretation.

### Open Questions
- Could a "re-execute with accumulated input" approach work for simple programs? (Each time input is needed, re-run from scratch with all prior inputs pre-supplied, generating a new trace up to the next input point.)
- How does the C backend via Valgrind differ architecturally from the Python backend?

---

## Online IDEs (Compiler Explorer, OnlineGDB, Replit, JDoodle)

### Summary
These tools fall into two categories: pre-supplied stdin (Compiler Explorer, JDoodle, Ideone) and server-backed interactive terminals (OnlineGDB, Replit). The server-backed approach uses WebSocket connections to real PTY processes, which is architecturally irrelevant for client-side interpreters.

### Detail

**Compiler Explorer (Godbolt):** Supports stdin through its "Execution only" panel. Users provide input text before execution -- it is pre-supplied, not interactive. Tools can enable stdin via configuration flags (`allowStdin`, `monacoStdin` for complex multi-line input). The execution happens on backend servers. ([GitHub issue #2139](https://github.com/compiler-explorer/compiler-explorer/issues/2139))

**OnlineGDB and similar server-backed IDEs:** Use a WebSocket connection between a browser terminal (typically xterm.js) and a backend server running the compiled program in a PTY. User keystrokes are sent via `ws.send()`, and the backend writes them to the process via `ptyProcess.write()`. Output flows back the same way. The program truly blocks on `read()` system calls -- the OS handles the blocking, not the browser. ([eddymens.com tutorial](https://www.eddymens.com/blog/creating-a-browser-based-interactive-terminal-using-xtermjs-and-nodejs))

**Replit:** Built a custom PTY library (`@replit/ruspty`) and uses xterm.js on the frontend with PTY connections over the network. Created `xterm-headless` for server-side terminal state management. This is a full terminal emulation stack, not applicable to client-side interpreters. ([Replit Shell2 blog post](https://blog.replit.com/shell2))

**JDoodle / Ideone:** API-based execution. JDoodle's `/execute` endpoint accepts `stdin` as a string parameter alongside the script. All input must be provided upfront. Ideone similarly uses a "stdin" text box for batch input.

### Open Questions
- Could a lightweight WebSocket-to-subprocess bridge be an alternative for tools that already have a backend?
- What latency characteristics do WebSocket-based stdin approaches have?

---

## Generator/Step-Based Interpreter Pattern

### Summary
JavaScript generators (`function*`) and step-based interpreters provide the most natural pattern for pausing a custom interpreter when input is needed. The interpreter yields at each operation, and the host controls execution flow by deciding when to call `next()`. This is the most relevant pattern for CrowCode's architecture.

### Detail

**Core mechanism:** A generator function pauses at each `yield` expression. The caller advances execution by calling `next(value)`, optionally injecting a value back into the generator. State (variables, call stack, closures) is fully preserved between yields.

```
// Conceptual pattern for a pausable interpreter
function* interpret(program) {
    for (const stmt of program.statements) {
        if (stmt.type === 'scanf') {
            const input = yield { type: 'NEED_INPUT', prompt: stmt.format };
            // input is provided by the caller via next(userInput)
            applyInput(stmt, input);
        }
        // ... execute statement, yield snapshot ops
        yield { type: 'STEP', ops: [...] };
    }
}
```

**JSCPP** (C++ interpreter in JavaScript) implements a pull-based stdin model. It accepts a `drain` callback in its stdio configuration that is "executed whenever the standard input buffer needs new content. The returned string will be concatenated to the existing buffer." If `drain` is set, it is favored over the static `input` option. This allows input to be provided incrementally during interpretation. JSCPP also has a debugger mode where `next()` advances one operation at a time. ([GitHub: felixhao28/JSCPP](https://github.com/felixhao28/JSCPP))

**JS-Interpreter** (Neil Fraser, used by Blockly) uses a `step()` method that executes one semantic unit and returns a boolean indicating whether more steps remain. For async operations like user input, it provides `createAsyncFunction()` where an extra callback parameter is passed to the native function -- the interpreter pauses until that callback is invoked with a result. It can also serialize its entire state (loops, variables, closures) for later resumption, with ~300kb overhead from polyfills. ([JS-Interpreter docs](https://neil.fraser.name/software/JS-Interpreter/docs.html))

**Blockly's usage pattern** demonstrates the step-based approach for handling user input: the stepping loop is paused, the host collects input via UI, and then stepping resumes. The Blockly docs describe this as "a good example to use for other asynchronous behavior (e.g., speech or audio, user input)." ([Blockly integration guide](https://developers.google.com/blockly/guides/app-integration/running-javascript))

**Throw-and-re-execute pattern** (React Suspense-like): An alternative approach throws an error to "pause" execution, caches intermediate results, and re-executes the function from the start. On re-execution, cached results are returned instead of re-computing. Requires pure functions. This is less applicable to interpreters with mutable state but demonstrates another pause/resume primitive. ([lihautan.com](https://lihautan.com/pause-and-resume-a-javascript-function))

### Open Questions
- What is the performance overhead of generator-based interpreters vs. direct execution?
- Can the generator pattern handle deeply nested function calls in the interpreted program (C functions calling other C functions that call scanf)?
- How does JSCPP's drain callback interact with its debugger stepping -- are they the same mechanism or layered?

---

## Web Worker + SharedArrayBuffer + Atomics

### Summary
This pattern provides true synchronous blocking for stdin in a browser. The interpreter runs in a Web Worker and blocks via `Atomics.wait()` when input is needed. The main thread collects input from the user and signals the worker via `Atomics.notify()`, writing the input data into the SharedArrayBuffer. Requires COOP/COEP headers.

### Detail

**How it works:**

1. Main thread and worker share a `SharedArrayBuffer`
2. Interpreter runs in the worker thread
3. When stdin is needed, the worker calls `Atomics.wait(sharedArray, index, expectedValue)` -- this blocks the worker thread
4. Main thread detects the stdin request (via a flag in shared memory or a message)
5. Main thread collects user input via UI
6. Main thread writes input data to the SharedArrayBuffer
7. Main thread calls `Atomics.notify(sharedArray, index)` to wake the worker
8. Worker resumes, reads input from SharedArrayBuffer, continues execution

**`Atomics.wait()` constraints:**
- Only works with `Int32Array` or `BigInt64Array` viewing a SharedArrayBuffer
- Cannot be called on the main thread (throws `TypeError`) -- worker threads only
- Returns `"ok"` when notified, `"timed-out"` on timeout, `"not-equal"` if value already changed
- `Atomics.waitAsync()` is available for the main thread but returns a Promise (non-blocking)

**Real-world implementations:**
- **wasm-webterm** ([cryptool-org/wasm-webterm](https://github.com/cryptool-org/wasm-webterm)): WASM runs in worker, uses Comlink for cross-thread communication. When stdin is requested, the Comlink proxy `_stdinProxy` is called, pausing the worker via Atomics until the proxy completes.
- **@wasmer/wasm-terminal** ([npm](https://www.npmjs.com/package/@wasmer/wasm-terminal)): Same pattern. Falls back to `window.prompt()` when SharedArrayBuffer is unavailable.

**Cross-origin isolation requirement:**
SharedArrayBuffer requires the page to be cross-origin isolated via HTTP headers:
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`)

GitHub Pages does not allow setting custom HTTP headers, but the **coi-serviceworker** library works around this by intercepting requests via a service worker and injecting the required headers client-side. ([blog.tomayac.com](https://blog.tomayac.com/2025/03/08/setting-coop-coep-headers-on-static-hosting-like-github-pages/))

### Open Questions
- What is the latency overhead of the SharedArrayBuffer round-trip (worker -> main thread -> user input -> main thread -> worker)?
- Does coi-serviceworker work reliably on all browsers, including Safari?
- How does this interact with existing Web Worker usage in CrowCode (if any)?

---

## WASM Runtime Stdin (Emscripten, WASI)

### Summary
Emscripten's default stdin handler uses `window.prompt()`, which is universally considered unusable. Three alternatives exist: `FS.init()` callbacks (synchronous, character-level), Asyncify (stack unwind/rewind, ~50% overhead), and custom `FS.createDevice()`. Asyncify is the most powerful but adds significant code size and performance cost.

### Detail

**Default behavior:** Emscripten uses `window.prompt()` for stdin in browser environments. This triggers a modal dialog for every read operation, produces no visible prompt text, and can loop endlessly if the program reads repeatedly. ([GitHub issue #7740](https://github.com/emscripten-core/emscripten/issues/7740))

**FS.init(inputFn, outputFn, errorFn):** The input callback "will be called with no parameters whenever the program attempts to read from stdin. It should return an ASCII character code when data is available, or null when it isn't." Must be configured in `Module.preRun` before execution starts. This is synchronous -- returning `null` means "no data yet" but the C code typically busy-loops until data arrives. ([Emscripten FS API](https://emscripten.org/docs/api_reference/Filesystem-API.html))

**Asyncify:** Transforms compiled WASM code to support stack unwinding and rewinding. When an async JS operation is encountered, the WASM call stack is unwound (saved), JS runs its async operation, and when the Promise resolves, the stack is rewound (restored) and execution continues. Overhead is approximately 50% in both code size and execution speed. Can be mitigated with `-O3` and selective instrumentation (`ASYNCIFY_ONLY`, `ASYNCIFY_REMOVE`). One practical approach: use the linker `--wrap` option to wrap `getc` and redirect stdin reads to a custom async function. ([Emscripten Asyncify docs](https://emscripten.org/docs/porting/asyncify.html))

**twr-wasm:** A newer library providing `twrWasmModule` (sync, no input) and `twrWasmModuleAsync` (supports blocking keyboard input). "Reading from a console is blocking, and so `twrWasmModuleAsync` must be used to receive keys." Implementation details are not fully documented in the stdio page but likely use Web Workers internally. ([twr-wasm docs](https://twiddlingbits.dev/docsite/gettingstarted/stdio/))

### Open Questions
- Is Asyncify's 50% overhead acceptable for educational tools where execution speed is not critical?
- Can Asyncify be combined with the SharedArrayBuffer worker pattern?
- How does WASI's stdin handling differ from Emscripten's in browser contexts?

---

## Pre-Supplied vs. Incremental Interpretation

### Summary
Pre-supplying all input before execution is simpler, deterministic, and used by most visualization tools. Incremental interpretation with pause-on-input provides better UX for interactive programs but requires one of the complex pause mechanisms described above. A hybrid "re-execute with accumulated input" approach offers a middle ground.

### Detail

**Pre-supply pattern:**
- User provides all stdin in a text box before clicking "Run"
- Program executes to completion with input piped from the buffer
- Used by: Python Tutor (theoretically, if supported), Compiler Explorer, JDoodle, Ideone
- Advantages: simple implementation, deterministic replay, no pause/resume complexity
- Disadvantages: user must know all inputs in advance, no conditional input (where input depends on output), poor UX for interactive programs

**Incremental pattern:**
- Interpreter runs until input is needed, then pauses
- UI prompts user for input
- Interpreter resumes with provided input
- Used by: JSCPP (drain callback), wasm-webterm, server-backed IDEs
- Advantages: natural interactive experience, supports programs where input depends on output
- Disadvantages: requires complex pause/resume machinery, harder to implement deterministic replay

**Hybrid "re-execute" pattern:**
- First run: execute until input is needed, display output so far, prompt user
- Second run: re-execute from scratch with first input pre-supplied, continue until next input
- Repeat, accumulating inputs
- This is what Python Tutor's maintainer described as the approach needed for their architecture
- Advantages: works with stateless backends, each run is a fresh execution, no serialization needed
- Disadvantages: O(n) re-execution for n inputs, potentially slow for large programs, requires deterministic execution

**Fundamental browser constraint:** As stated in a Rust WASM forum discussion: "You have to use async for this. No amount of condvars, mutexes or atomics will save you" -- referring specifically to the main thread. The event loop cannot be blocked synchronously. Only Web Workers with Atomics.wait can achieve true blocking. ([Rust forum](https://users.rust-lang.org/t/dealing-with-blocking-input-in-wasm/42695))

### Open Questions
- For CrowCode specifically, is the re-execute pattern viable given that the interpreter already generates a full trace?
- What is the user experience impact of the re-execute approach for programs with many input calls?

---

## Tensions and Debates

### Pre-supplied vs. interactive: simplicity vs. UX
Pre-supplied input is overwhelmingly simpler to implement and is the dominant pattern in educational visualizers. Interactive input provides a better experience for programs that depend on I/O interplay. The strongest argument for pre-supplied: educational tools prioritize visualization over interaction, and students can be told to provide input upfront. The strongest argument for interactive: real C programs use interactive I/O, and students need to understand how scanf actually behaves. **For CrowCode**, the existing architecture (run interpreter -> generate full trace -> visualize) aligns with pre-supplied input.

### Generator-based vs. Worker-based: cooperative vs. preemptive
Generator/step-based interpreters use cooperative multitasking -- the interpreter must explicitly yield. Worker + Atomics uses preemptive-style blocking -- the worker truly blocks and the main thread remains responsive. For a custom interpreter (CrowCode's case), generators are simpler and more natural. For WASM-based execution, Workers + Atomics is the primary viable approach. **These are not competing patterns** -- they solve different architectural situations.

### Asyncify vs. SharedArrayBuffer for WASM
Asyncify works without cross-origin isolation but adds ~50% overhead. SharedArrayBuffer requires COOP/COEP headers but has minimal runtime overhead. For GitHub Pages hosting, coi-serviceworker makes SharedArrayBuffer feasible. **SharedArrayBuffer is generally preferred** when cross-origin isolation can be arranged.

---

## Gaps and Limitations

- **Internal architecture of commercial tools** (Replit, OnlineGDB, JDoodle) is not publicly documented in detail. The WebSocket/PTY pattern is inferred from open-source examples and Quora discussions.
- **Performance benchmarks** comparing the patterns (generator overhead, Atomics round-trip latency, Asyncify cost) were not found in a single comparative study.
- **JSCPP's internal mechanism** for pausing on drain callback is not fully documented -- it's unclear if it uses generators internally or a different state machine approach.
- **Google Groups page** for Emscripten's generator-based I/O discussion was inaccessible (rendered as JS app, no content extractable).
- **Safari-specific behavior** for SharedArrayBuffer + coi-serviceworker was not thoroughly covered in sources found.
- **WASI browser stdin** handling (distinct from Emscripten) was not covered in depth -- WASI is still evolving and browser implementations are experimental.

---

## Architectural Patterns Summary (for CrowCode)

| Pattern | Complexity | UX | Fits CrowCode? | Notes |
|---------|-----------|-----|----------------|-------|
| **Pre-supplied input buffer** | Low | Moderate | Yes (easiest) | User provides all input before run. No interpreter changes needed. |
| **Generator/step interpreter with yield-on-input** | Medium | Good | Yes (natural fit) | Interpreter yields when scanf encountered. Host collects input, feeds back via next(). Requires interpreter refactor to generator. |
| **Async callback (JS-Interpreter style)** | Medium | Good | Possible | Wrap scanf as async native function. Interpreter pauses until callback invoked. |
| **Re-execute with accumulated input** | Low-Medium | Moderate | Yes (hybrid) | Re-run interpreter from scratch with accumulated inputs. Works with current "run once" architecture. O(n) cost per input. |
| **Web Worker + SharedArrayBuffer** | High | Excellent | Overkill | True blocking stdin. Requires COOP/COEP, worker thread, shared memory protocol. Best for WASM, not custom interpreters. |
| **Emscripten Asyncify** | High | Good | N/A | Only for WASM. ~50% overhead. Not applicable to CrowCode's JS interpreter. |

---

## Sources

### Most Valuable
- [Python Tutor stdin issue #21](https://github.com/pythontutor-dev/pythontutor/issues/21) -- Confirms no stdin support, explains why re-execution would be needed
- [JSCPP README](https://github.com/felixhao28/JSCPP) -- Best example of drain callback pattern for browser C interpreter
- [JS-Interpreter docs](https://neil.fraser.name/software/JS-Interpreter/docs.html) -- step()/createAsyncFunction() pattern with state serialization
- [wasm-webterm](https://github.com/cryptool-org/wasm-webterm) -- Reference implementation of SharedArrayBuffer + Atomics stdin
- [Emscripten Asyncify docs](https://emscripten.org/docs/porting/asyncify.html) -- Stack unwind/rewind mechanism for WASM
- [Blockly JS integration guide](https://developers.google.com/blockly/guides/app-integration/running-javascript) -- Practical step-based interpreter with async input
- [Rust WASM forum: blocking input](https://users.rust-lang.org/t/dealing-with-blocking-input-in-wasm/42695) -- Clear discussion of fundamental browser constraints
- [coi-serviceworker for GitHub Pages](https://blog.tomayac.com/2025/03/08/setting-coop-coep-headers-on-static-hosting-like-github-pages/) -- Workaround for COOP/COEP on static hosting

### Full Source List

| Source | Facet | Type | Date | Key contribution |
|--------|-------|------|------|-----------------|
| [Python Tutor issue #21](https://github.com/pythontutor-dev/pythontutor/issues/21) | Visualizers | GitHub issue | Open | Confirms no stdin, explains architectural barrier |
| [Python Tutor developer overview](https://github.com/vekrio/visualization-online-python-tutor/blob/master/v3/docs/developer-overview.md) | Visualizers | Documentation | Legacy | Full trace generation architecture |
| [Compiler Explorer issue #2139](https://github.com/compiler-explorer/compiler-explorer/issues/2139) | Online IDEs | GitHub issue | 2020 | Pre-supplied stdin in execution panel |
| [Compiler Explorer AddingATool.md](https://github.com/compiler-explorer/compiler-explorer/blob/main/docs/AddingATool.md) | Online IDEs | Documentation | Current | monacoStdin configuration |
| [JSCPP](https://github.com/felixhao28/JSCPP) | Generators | GitHub repo | 2018 | drain callback, debugger stepping |
| [JS-Interpreter docs](https://neil.fraser.name/software/JS-Interpreter/docs.html) | Generators | Documentation | Current | step(), createAsyncFunction(), serialization |
| [Blockly running JS guide](https://developers.google.com/blockly/guides/app-integration/running-javascript) | Generators | Documentation | Current | Step-based execution with async input |
| [Pause/resume JS functions](https://lihautan.com/pause-and-resume-a-javascript-function) | Generators | Blog | 2020 | Throw-and-re-execute pattern |
| [wasm-webterm](https://github.com/cryptool-org/wasm-webterm) | Worker+SAB | GitHub repo | Current | SharedArrayBuffer + Atomics + Comlink stdin |
| [@wasmer/wasm-terminal](https://www.npmjs.com/package/@wasmer/wasm-terminal) | Worker+SAB | npm package | Current | SharedArrayBuffer stdin with prompt fallback |
| [Atomics.wait MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics/wait) | Worker+SAB | Documentation | Current | API reference for blocking wait |
| [SharedArrayBuffer MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer) | Worker+SAB | Documentation | Current | Shared memory API |
| [V8 Atomics features](https://v8.dev/features/atomics) | Worker+SAB | Documentation | Current | waitAsync for main thread |
| [COOP/COEP web.dev](https://web.dev/articles/coop-coep) | Worker+SAB | Article | 2022 | Cross-origin isolation guide |
| [coi-serviceworker blog](https://blog.tomayac.com/2025/03/08/setting-coop-coep-headers-on-static-hosting-like-github-pages/) | Worker+SAB | Blog | 2025 | GitHub Pages workaround |
| [Emscripten Asyncify](https://emscripten.org/docs/porting/asyncify.html) | WASM | Documentation | Current | Stack unwind/rewind, ~50% overhead |
| [Emscripten FS API](https://emscripten.org/docs/api_reference/Filesystem-API.html) | WASM | Documentation | Current | FS.init(), FS.createDevice() |
| [Emscripten issue #7740](https://github.com/emscripten-core/emscripten/issues/7740) | WASM | GitHub issue | 2019 | stdin problems, wontfix |
| [Emscripten issue #17800](https://github.com/emscripten-core/emscripten/issues/17800) | WASM | GitHub issue | 2022 | stdin not blocking |
| [Emscripten issue #4124](https://github.com/emscripten-core/emscripten/issues/4124) | WASM | GitHub issue | 2016 | Async stdin via Emterpreter |
| [twr-wasm stdio docs](https://twiddlingbits.dev/docsite/gettingstarted/stdio/) | WASM | Documentation | Current | twrWasmModuleAsync for blocking input |
| [Rust WASM blocking input](https://users.rust-lang.org/t/dealing-with-blocking-input-in-wasm/42695) | Pre vs Incremental | Forum | 2020 | Fundamental browser async constraint |
| [xterm.js terminal tutorial](https://www.eddymens.com/blog/creating-a-browser-based-interactive-terminal-using-xtermjs-and-nodejs) | Online IDEs | Tutorial | Current | WebSocket + PTY architecture |
| [Replit Shell2](https://blog.replit.com/shell2) | Online IDEs | Blog | 2023 | PTY architecture, ruspty, xterm-headless |
| [Wasmer COOP/COEP docs](https://docs.wasmer.io/sdk/wasmer-js/how-to/coop-coep-headers) | Worker+SAB | Documentation | Current | coi-serviceworker usage |
| [GitHub Pages COOP/COEP discussion](https://github.com/orgs/community/discussions/13309) | Worker+SAB | GitHub discussion | 2022 | No server-side header control |
| [picoc-js](https://github.com/KritR/picoc-js) | WASM | GitHub repo | 2018 | PicoC compiled to WASM |
| [Generators - javascript.info](https://javascript.info/generators) | Generators | Tutorial | Current | Generator fundamentals |
