---
title: "stdio Support: Interactive I/O with Buffer Visualization"
type: feat
status: in-progress
date: 2026-03-27
deepened: 2026-03-27
---

# stdio Support: Interactive I/O with Buffer Visualization

## Enhancement Summary

**Deepened on:** 2026-03-27
**Agents used:** snapshot-contract, c-semantics, test-adequacy, worker-integration, architecture-strategy, pattern-recognition, spec-flow-analysis, performance, svelte-component-patterns, c-stdio-best-practices

### Key Improvements
1. Resolved 4 critical architectural decisions (IoState separation, stdin buffer representation, scanf write-through mechanism, console state precomputation)
2. Added 28+ specific test cases across format, buffer, regression, and integration tests
3. Identified and resolved 2 critical C semantics gaps (scanf op emission, missing-`&` detection)
4. Added concrete Svelte 5 component templates following project conventions
5. Identified performance prerequisite: `indexById` optimization in `applyOps`

### Critical Decisions Made
1. **I/O state lives in a separate `IoState` class**, not inside `Memory` — keeps memory ops and I/O events separate
2. **Console output is pre-computed** as `string[]` alongside snapshots — O(1) backward stepping
3. **stdin buffer uses `kind: 'io'`** as a new MemoryEntry kind — clean validator exemption
4. **scanf writes through a `writeVariable` callback** from the interpreter — not raw memory writes
5. **Existing sprintf in `statements.ts` must be replaced** — no dual-path coexistence

---

## Context

CrowCode visualizes C memory layout as users step through programs. Currently, `printf`, `puts`, and `putchar` are recognized but produce no output — they're no-ops in the stdlib. There's no stdin support at all (`scanf`, `getchar`, `fgets` are unhandled).

Students learning C struggle deeply with stdio concepts that are invisible in normal debugging:
- **stdin buffer residue** — `scanf("%d")` leaves `\n` in the buffer, causing the next `scanf("%c")` to read it unexpectedly
- **stdout buffering** — `printf("Enter: ")` without `\n` may not flush to screen
- **Buffer overflows** — `gets()` or `sprintf()` writing past array bounds
- **Format string parsing** — how `%d`, `%s`, `%c` consume variadic arguments differently

This feature adds real I/O simulation: stdout text appears in a console panel, stdin input is prompted from the user, and the internal buffer state is visualized in the memory view.

### Research Insights

**Competitive landscape:** No existing C visualizer does step-through I/O visualization. Python Tutor explicitly does not support C stdin ([issue #21](https://github.com/pythontutor-dev/pythontutor/issues/21), open since 2017). Compiler Explorer supports stdin only for run-to-completion, not stepping. JavaWiz (Java) has the closest analog with its Input View showing consumed vs. unconsumed buffer state. CrowCode can be the first tool to make stdin buffer residue and format string parsing truly visible for C.

**Pre-supplied stdin is the dominant pattern:** JDoodle, Ideone, OneCompiler, and Judge0 all use textarea-based input provided before execution — the same approach this plan takes.

---

## Design

### Approach: Simulated I/O with Pre-supplied Input

Rather than truly blocking for user input (which would require async interruption of the synchronous interpreter), **stdin input is pre-supplied before execution**. The user provides all input values upfront (like piping input to a program), and the interpreter consumes them from a buffer during `scanf`/`getchar`/`fgets` calls.

**Why pre-supplied input:**
- The interpreter runs synchronously (`interpretSync`) — blocking mid-execution for user input would require rewriting the execution model
- Pre-supplied input lets users see the full program execution with stepping, which is the core value proposition
- It matches how students test programs: `echo "42 hello" | ./program`
- Future enhancement: interactive mode via async interpreter (out of scope for v1)

### I/O Model

**stdout** — An append-only string buffer. `printf`, `puts`, `putchar`, `fputs` append to it. Each step that produces output records the new text. Console output is **pre-computed** into a `string[]` (one cumulative string per step) alongside `buildSnapshots()`, giving O(1) access at any step and free backward stepping.

**stdin** — A consumable string buffer initialized from user-provided input. `scanf`, `getchar`, `fgets` consume from the front. The memory view shows the buffer state: consumed vs. remaining bytes. When the buffer is exhausted, functions return EOF(-1)/0 (matching real C behavior). Consumed stdin text is **echoed to the console display** to match real terminal behavior.

**stderr** — Same model as stdout, separate buffer. `fprintf(stderr, ...)` writes to it. `fprintf(stdout, ...)` routes to stdout.

**Buffering decision:** Simulated stdout is **unbuffered** (output appears immediately when the function executes, not on `\n`). This is the right choice for a step-through visualizer where students need to see output at the statement that produced it. The motivating example in Context ("stdout buffering") is documented as a real-world concept but deferred to v2 for simulation.

### Architecture: IoState Separation

**I/O state lives in a separate `IoState` class, NOT inside `Memory`.**

The `Memory` class has a specific dual role: runtime state + op recording for memory visualization. Its methods all record `SnapshotOp`s. Stdin/stdout buffers don't produce `SnapshotOp`s — they produce `IoEvent`s. Mixing them would bloat a 500+ line class with an orthogonal concern and create confusion about which methods record ops vs. I/O events.

```typescript
// src/lib/interpreter/io-state.ts
export class IoState {
    private stdinBuffer: string;
    private stdinPos = 0;
    private stdoutBuffer = '';
    private stderrBuffer = '';
    private stepEvents: IoEvent[] = [];

    constructor(stdin: string) { this.stdinBuffer = stdin; }

    // Output
    writeStdout(text: string): void { ... }
    writeStderr(text: string): void { ... }

    // Input (with C-correct whitespace rules per specifier)
    readInt(): { value: number; consumed: string } | null { ... }
    readChar(): { value: number; consumed: string } | null { ... }
    readString(): { value: string; consumed: string } | null { ... }
    readLine(maxLen: number): { value: string; consumed: string } | null { ... }

    // Step lifecycle (mirrors Memory.beginStep/flushStep pattern)
    flushEvents(): IoEvent[] { /* returns and clears stepEvents */ }
    getStdinPos(): number { ... }
    getStdinRemaining(): string { ... }
    isExhausted(): boolean { ... }
}
```

The interpreter creates `IoState` alongside `Memory`. When a step is flushed, `io.flushEvents()` populates the step's `ioEvents`. This mirrors how `Memory` flushes ops into `step.ops`.

### IoEvent Placement

`ioEvents` lives on `ProgramStep` alongside `description` and `evaluation` — NOT as new SnapshotOp types. I/O is interpreter metadata, not a memory tree mutation. The four-op model (addEntry/removeEntry/setValue/setHeapStatus) stays closed and clean.

```typescript
type IoEvent =
    | { kind: 'write'; target: 'stdout' | 'stderr'; text: string }
    | { kind: 'read'; source: 'stdin'; consumed: string; cursorPos: number; format?: string };
```

**Key decisions:**
- `ioEvents` attaches to the **existing step** for the statement — no new additional steps created per I/O call
- `stdin-read` stores `cursorPos` (integer) instead of full `remaining` string — avoids O(N × bufferSize) data duplication across steps
- Non-I/O steps have `ioEvents` as `undefined` (not empty array) to avoid bloating serialized Programs

### Console State Precomputation

Following the architecture principle "State is truth, UI reads snapshots," console output is pre-computed alongside snapshots:

```typescript
// src/lib/engine/console.ts
function buildConsoleOutputs(steps: ProgramStep[]): string[] {
    const outputs: string[] = [];
    let accumulated = '';
    for (const step of steps) {
        for (const event of step.ioEvents ?? []) {
            if (event.kind === 'write') accumulated += event.text;
            if (event.kind === 'read') accumulated += event.consumed; // echo stdin
        }
        outputs.push(accumulated);
    }
    return outputs;
}
```

`consoleOutputs[i]` gives the full console text at step `i`. Backward stepping is just `consoleOutputs[i - 1]`. No undo logic needed.

### stdin Buffer Visualization

**Decision: Add `kind: 'io'` as a new MemoryEntry kind.**

The stdin buffer is not a C variable — it has no natural C address. The existing validator requires non-scope, non-heap entries to have addresses. Options considered:
- ~~Option A: Synthetic address (e.g., `0xfffe0000`)~~ — introduces a fake address range
- ~~Option B: Misuse `kind: 'scope'`~~ — misuses scope semantics
- **Option C (chosen): New `kind: 'io'`** — one-line validator exemption, explicit and clean

The stdin buffer appears as a single MemoryEntry with a summary string value showing cursor position (e.g., `"[42|\\nA]"` where `|` marks the read cursor), NOT as individual byte children. This avoids adding 20+ nodes to every `structuredClone` and `indexById` cycle across 500 steps.

```typescript
// Added as root-level entry on first I/O step
{
    id: 'stdin',
    name: 'stdin buffer',
    type: 'char[]',
    value: '[42|\\nA]',  // cursor shown with |
    address: '',
    kind: 'io',
}
```

The `setValue` op updates the cursor display as bytes are consumed. No `removeEntry` — consumed bytes stay visible (grayed out in UI) for educational context.

### scanf Write-Through Mechanism

**Critical gap resolved:** The current `StdlibHandler` receives evaluated `CValue[]` — by the time scanf runs, lvalue information is lost. scanf needs to update the visualized stack variable after writing to its address, but raw `memory.writeMemory(addr, value)` only updates the byte store, not the `MemoryEntry` display.

**Solution:** The interpreter intercepts scanf calls and provides a `writeVariable` callback:

```typescript
// In interpreter.ts, before delegating to stdlib:
if (isScanfFamily(name)) {
    // Validate pointer args: check args[i].type.kind === 'pointer'
    // (catches missing & — can't detect inside stdlib since AST is lost)
    const writeVariable = (address: number, value: number, type: CType) => {
        memory.setValueByAddress(address, value); // raw write
        memory.emitSetValueByAddress(address, String(value)); // emit setValue op
    };
    return stdlib.handleScanf(name, args, line, { writeVariable, io });
}
```

This also resolves the missing-`&` detection: the interpreter checks `args[i].type.kind === 'pointer'` before calling the handler. This check cannot happen inside stdlib (which only sees evaluated numeric values).

### sprintf/snprintf Address-to-ID Lookup

sprintf writes to a char array via a pointer. The implementation must resolve the destination address back to entry IDs for `setValue` ops:

1. The first argument is a pointer to a char array — its `.data` field is the address
2. `Memory` has `entryIdByAddress` mapping (stack) and `heapEntryByPointer` (heap) for reverse lookup
3. Array children follow the ID pattern `scopeId-varname-INDEX` — the implementation emits `setValue` ops for each character written
4. `snprintf(buf, n, ...)` only emits ops for indices `0` through `n-2` plus null terminator at `n-1`

**The existing sprintf handler in `statements.ts:691-718` must be fully replaced**, not coexisted with. It writes a quoted string to a single heap entry display value rather than individual bytes.

### What Gets Visualized

1. **Console output** — New UI panel showing stdout/stderr text, growing as the user steps forward. Consumed stdin is echoed inline (so `printf("Enter: ")` followed by `scanf("%d")` shows `Enter: 42` in the console, matching real terminal behavior)
2. **stdin buffer** — Shown in memory view as a single `kind: 'io'` entry with cursor position, so students see what's been consumed vs. what remains
3. **Format string effects** — Step descriptions like `scanf("%d", &x): read "42" from stdin, wrote 42 to x` make the invisible visible
4. **Buffer overflow** — When `gets`/`sprintf` write past buffer bounds, adjacent variables' entries get `setValue` ops showing the clobbered values

### Scope for v1

**In scope:**
- `printf` with format specifiers: `%d`, `%i`, `%u`, `%x`, `%X`, `%c`, `%s`, `%f`, `%p`, `%%`, field width, precision
- `sprintf`, `snprintf` writing to char arrays
- `scanf` with: `%d`, `%i`, `%c`, `%s`, `%f`, `%x` (whitespace handling, return value, `%*` suppression)
- `getchar`, `putchar`
- `fgets`, `puts`, `fputs`
- `gets` (with deliberate buffer overflow visualization — educational)
- `fprintf(stdout, ...)` and `fprintf(stderr, ...)` — routed by first argument
- ConsolePanel UI component for stdout/stderr with stdin echo
- stdin input area (textarea for pre-supplying input)
- Pre-computed console state for O(1) backward stepping
- Step descriptions explaining what each I/O call did

**Out of scope (future):**
- `FILE*` as a visualized struct (fopen/fclose/file I/O)
- Interactive/async input mode
- Internal stdout buffering visualization (showing the FILE buffer filling) — v2
- `fprintf` to arbitrary streams (only stdout/stderr)
- `sscanf` / `fscanf`
- `%e`/`%E`/`%g`/`%G` format specifiers (scientific notation)
- Length modifiers (`%ld`, `%lf`, `%zu`) — document as limitation since `%lf` is common in student code

---

## Files

### Modify

| File | What changes | Why |
|------|-------------|-----|
| `src/lib/api/types.ts` | Add `IoEvent` type, `ioEvents` on `ProgramStep`, `kind: 'io'` to MemoryEntry | Steps record I/O; new entry kind for stdin buffer |
| `src/lib/interpreter/stdlib.ts` | Replace printf/puts/putchar no-ops with real formatting; add scanf/getchar/fgets/gets handlers; extend `StdlibEnv` with `IoState` | Core I/O implementation |
| `src/lib/interpreter/interpreter.ts` | Intercept scanf calls for write-through and missing-`&` validation; create `IoState`; pass to stdlib | Interpreter mediates I/O calls |
| `src/lib/interpreter/handlers/statements.ts` | Remove `evaluateSprintfResult` (lines 885-919) and the sprintf/printf interception (lines 691-718); delegate to stdlib | Consolidate I/O in stdlib, eliminate dual-path |
| `src/lib/interpreter/service.ts` | Add `stdin?: string` to `runProgram()` signature; forward to `interpretSync` options | Entry point forwards user input |
| `src/lib/interpreter/memory.ts` | Add `emitSetValueByAddress()` method for scanf write-through; add stdin buffer entry management | Op emission for pointer writes |
| `src/lib/interpreter/index.ts` | Export `IoEvent`, `IoState` types | Barrel export update |
| `src/lib/engine/validate.ts` | Add `kind: 'io'` exemption to address check (one-line change) | stdin buffer entry has no C address |
| `src/routes/+page.svelte` | Add `$state` for stdin text, `$derived` for `needsStdin`, integrate ConsolePanel and StdinInput, thread stdin into `runProgram()` | UI integration with data-flow wiring |
| `src/lib/test-programs.ts` | Add stdio test programs with `stdin` field | Educational examples |

### Create

| File | Purpose |
|------|---------|
| `src/lib/components/ConsolePanel.svelte` | Displays cumulative stdout/stderr with step highlighting |
| `src/lib/components/StdinInput.svelte` | Textarea for pre-supplying stdin; read-only during viewing with consumed/remaining indicator |
| `src/lib/interpreter/io-state.ts` | `IoState` class: StdinBuffer + StdoutBuffer + IoEvent recording |
| `src/lib/interpreter/io-state.test.ts` | Unit tests for buffer consumption, EOF, whitespace, cursor tracking |
| `src/lib/interpreter/format.ts` | Printf/scanf format string parser returning structured token arrays |
| `src/lib/interpreter/format.test.ts` | Format string parser tests (12+ cases per specifier category) |
| `src/lib/engine/console.ts` | `buildConsoleOutputs()` — pre-computes cumulative console text per step |
| `src/lib/engine/console.test.ts` | Tests for forward accumulation and backward shrink |

### Remove (from current location)

| Code | File | Why |
|------|------|-----|
| `evaluateSprintfResult()` | `handlers/statements.ts:885-919` | Replaced by format.ts parser |
| sprintf/printf/puts interception | `handlers/statements.ts:691-718` | Consolidated into stdlib handlers |
| `formatPrintfDesc()` | `handlers/statements.ts:850` | Replaced by step description logic in stdlib |

---

## Steps

### Step 0: Performance Prerequisite — Optimize `applyOps`
- **What:** Hoist `indexById()` call outside the per-op loop in `applyOps()`. Currently it rebuilds the full index on every op within a step. With byte-by-byte writes from sprintf/gets, this becomes O(ops × entries) per step. Hoisting makes it O(ops + entries).
- **Files:** `src/lib/engine/snapshot.ts`
- **Depends on:** nothing
- **Verification:** `npm test` — all snapshot tests pass; performance improvement measurable on existing programs with many ops per step

### Step 1: Define I/O Types and Events
- **What:** Add `IoEvent` type to `types.ts`, add `ioEvents?: IoEvent[]` to `ProgramStep`, add `kind: 'io'` to MemoryEntry's `kind` union, add `stdin?: string` to `InterpreterOptions` in interpreter types. Add one-line `kind: 'io'` exemption to `validate.ts` address check.
- **Files:** `src/lib/api/types.ts`, `src/lib/interpreter/types.ts` (or wherever InterpreterOptions lives), `src/lib/engine/validate.ts`
- **Depends on:** nothing
- **Verification:** `npm run check` passes, existing tests still pass

```typescript
// New types in types.ts
type IoEvent =
    | { kind: 'write'; target: 'stdout' | 'stderr'; text: string }
    | { kind: 'read'; source: 'stdin'; consumed: string; cursorPos: number; format?: string };

// Updated MemoryEntry.kind
kind?: 'scope' | 'heap' | 'io';
```

### Step 2: Build Format String Parser
- **What:** Create `format.ts` with a regex-based tokenizer that parses format strings into `LiteralToken | FormatToken` arrays. FormatToken carries: `flags`, `width`, `precision`, `specifier`, `rawText`, `suppress` (for scanf `%*`). Implement `applyPrintfFormat(tokens, args)` → formatted string and `parseScanfTokens(formatStr)` → token array. The scanf tokenizer must encode whitespace-skip rules per specifier (`%c` and `%[` do NOT skip, all others do).
- **Files:** `src/lib/interpreter/format.ts`, `src/lib/interpreter/format.test.ts`
- **Depends on:** Step 1
- **Verification:** `npm test` — 12+ test cases per category (see Test Specification below)

### Step 3: Build IoState Class
- **What:** Create `io-state.ts` with `IoState` class. StdinBuffer: consumable with cursor tracking, methods for `readInt()` (skips whitespace), `readChar()` (NO whitespace skip), `readString()` (skips leading, reads until whitespace), `readLine(maxLen)` (fgets semantics), `readUntilNewline()` (gets semantics). StdoutBuffer: append-only with per-step markers. IoEvent recording via `flushEvents()`.
- **Files:** `src/lib/interpreter/io-state.ts`, `src/lib/interpreter/io-state.test.ts`
- **Depends on:** Step 2 (format parser for readFormatted)
- **Verification:** `npm test` — 8+ buffer consumption tests including the `\n` residue scenario (see Test Specification below)

### Step 4: Implement printf/puts/putchar/fputs in stdlib
- **What:** Replace the no-op printf/puts/putchar handlers with real implementations using the format parser and `IoState`. `printf` formats using args and calls `io.writeStdout()`. `puts(str)` writes str + `\n`. `putchar(c)` writes single char. `fputs(str, stream)` writes to stdout or stderr based on stream arg. `fprintf` routes by first arg (stdout vs stderr). Each call records an IoEvent. Remove the sprintf/printf interception in `handlers/statements.ts` and consolidate all I/O in stdlib.
- **Files:** `src/lib/interpreter/stdlib.ts`, `src/lib/interpreter/handlers/statements.ts`
- **Depends on:** Steps 2, 3
- **Verification:** `npm test` — existing tests still pass; new tests verify formatted output matches expected strings

### Step 5: Implement scanf/getchar/fgets/gets in stdlib
- **What:** Add stdin-consuming functions. The **interpreter** intercepts scanf-family calls before stdlib to: (a) validate pointer args (`args[i].type.kind === 'pointer'`), catching missing `&`, and (b) provide a `writeVariable(address, value, type)` callback that emits `setValue` ops for the target variable's MemoryEntry. `getchar` returns `int` (not `char`). `fgets(buf, n, stdin)` reads up to n-1 chars, includes `\n`, always null-terminates. `gets(buf)` reads until `\n` with no bounds checking — deliberately overwrites adjacent entries for educational visualization. Each call records an IoEvent with cursor position.
- **Files:** `src/lib/interpreter/stdlib.ts`, `src/lib/interpreter/interpreter.ts`, `src/lib/interpreter/memory.ts`
- **Depends on:** Steps 3, 4
- **Verification:** `npm test` — tests verify scanf return values, whitespace handling, buffer residue, EOF behavior, gets overflow. Note: `&` operator already exists in evaluator.ts (lines 258-263) — no evaluator changes needed.

### Step 6: Implement sprintf/snprintf in stdlib
- **What:** `sprintf(buf, fmt, ...)` and `snprintf(buf, n, fmt, ...)` write formatted output to a char array in memory. The implementation resolves the destination pointer address to entry IDs using `Memory.entryIdByAddress`, then emits `setValue` ops for each character written. `snprintf` enforces bounds: only emits ops for indices 0 through n-2 plus null terminator at n-1. No stdout IoEvent emitted (output goes to buffer, not console).
- **Files:** `src/lib/interpreter/stdlib.ts`, `src/lib/interpreter/memory.ts`
- **Depends on:** Steps 2, 5 (needs writeVariable pattern)
- **Verification:** `npm test` — snapshot regression test verifies buffer array entries match formatted string; no stdout IoEvent present

### Step 7: Wire I/O Through Interpreter and Service
- **What:** Update `interpretSync` to create `IoState(stdin)` from options, pass to stdlib handler via extended `StdlibEnv`. Update `Memory.flushStep()` to call `io.flushEvents()` and attach to the step's `ioEvents`. Update `service.ts` `runProgram()` to accept and forward `stdin` parameter. Add `buildConsoleOutputs()` to engine. Worker.ts: stdin already flows through `InterpreterOptions` — no protocol change needed (worker passes options untouched).
- **Files:** `src/lib/interpreter/interpreter.ts`, `src/lib/interpreter/service.ts`, `src/lib/interpreter/memory.ts`, `src/lib/interpreter/index.ts`, `src/lib/engine/console.ts`, `src/lib/engine/console.test.ts`
- **Depends on:** Steps 4, 5, 6
- **Verification:** `npm test` — integration test: C source with printf/scanf → Program with correct ioEvents on steps; `buildConsoleOutputs` produces correct cumulative strings; `npm run check` passes

### Step 8: Build ConsolePanel and StdinInput Components
- **What:** Create Svelte 5 components following project conventions (`$props()`, `$state()`, `$derived()`, Tailwind 4 classes, `on`-prefixed callbacks).

  **ConsolePanel.svelte:** Receives `stdout: string` (cumulative), `newOutput: string` (current step only). Renders previous output in `text-zinc-300` and new output highlighted in `text-emerald-400 bg-emerald-400/10`. Auto-scrolls via `$effect()`. Shows "No output yet" placeholder when empty.

  **StdinInput.svelte:** Receives `value: string`, `onchange` callback, `disabled: boolean`, `consumed: number`. In editing mode: editable textarea with placeholder "Enter program input (e.g., 42\\nhello)...". In viewing mode: read-only display with consumed text shown as `text-zinc-600 line-through` and remaining as `text-zinc-300`.
- **Files:** `src/lib/components/ConsolePanel.svelte`, `src/lib/components/StdinInput.svelte`
- **Depends on:** Step 7
- **Verification:** Manual — run dev server, verify components render correctly

### Step 9: Integrate UI into Page Layout
- **What:** Wire components into `+page.svelte` with full data-flow:
  - Add `let stdinInput = $state('')` for stdin text
  - Add `const needsStdin = $derived(/\b(scanf|getchar|fgets|gets)\s*\(/.test(source))` for auto-detection
  - Store stdin text per-tab (in `CachedRun` or tab store)
  - Thread `stdinInput` into `runProgram(source, { stdin: stdinInput })`
  - Pre-compute `consoleOutputs = buildConsoleOutputs(program.steps)` alongside snapshots
  - Pass `consoleOutputs[currentIndex]` to ConsolePanel
  - Layout: left column (code editor + StdinInput + ConsolePanel), right column (memory view) — editor height shrinks from `h-[70vh]` to `h-[55vh]`
  - Show warning when `needsStdin` but `stdinInput` is empty on Run
- **Files:** `src/routes/+page.svelte`
- **Depends on:** Step 8
- **Verification:** Manual — full flow: write C code with I/O → provide stdin → run → step through → console output grows/shrinks → stdin shows consumption

### Step 10: Add stdio Test Programs
- **What:** Add curated programs to `test-programs.ts` with `stdin` field:
  1. **Basic printf** — format specifiers, field width, precision
  2. **scanf with residue** — the `\n` left in buffer between `scanf("%d")` and `scanf("%c")`
  3. **Mixed I/O** — `printf("Enter: ")` → `scanf("%d")` → `printf("Got %d\n")`
  4. **gets overflow** — 4-byte buffer with long input, showing adjacent variable corruption
  5. **sprintf formatting** — writing to local char array
  6. **getchar loop** — reading characters until EOF
- **Files:** `src/lib/test-programs.ts`
- **Depends on:** Step 9
- **Verification:** Each program runs without errors; programs appear in UI tabs

### Step 11: Step Description Enrichment
- **What:** Ensure step descriptions for I/O calls are educational:
  - `printf("%d", x) → wrote "42" to stdout`
  - `scanf("%d", &x) → read "42" from stdin, x = 42`
  - `scanf("%c", &c) → read '\n' (0x0a) from stdin, c = 10` (the residue case!)
  - `getchar() → read 'A' (0x41) from stdin`
  - `fgets(buf, 10, stdin) → read "Hello\n" into buf (7 bytes + \0)`
  - `gets(buf) → read "AAAAAAAAAA" — overflow! wrote 10 bytes into 4-byte buffer`
  - `scanf("%d", x) → error: argument must be a pointer (missing &?)`
  - `scanf("%d %d", &a, &b) with input "42 abc" → read 1 of 2 items: a = 42, 'a' not a digit`
- **Files:** `src/lib/interpreter/stdlib.ts`
- **Depends on:** Steps 4, 5
- **Verification:** `npm test` — verify step descriptions contain expected text

---

## Test Specification

### format.test.ts (minimum 24 cases)

**Basic specifier output:**
| Input | Expected |
|-------|----------|
| `"%d", [42]` | `"42"` |
| `"%d", [-1]` | `"-1"` |
| `"%u", [-1]` | `"4294967295"` (unsigned wrap) |
| `"%x", [255]` | `"ff"` |
| `"%X", [255]` | `"FF"` |
| `"%c", [65]` | `"A"` |
| `"%s", ["hello"]` | `"hello"` |
| `"%f", [3.14]` | `"3.140000"` (default 6 decimals) |
| `"%p", [0x55a0]` | `"0x55a0"` |
| `"%%"` | `"%"` |

**Field width and precision:**
| Input | Expected |
|-------|----------|
| `"%5d", [42]` | `"   42"` |
| `"%-5d", [42]` | `"42   "` |
| `"%05d", [42]` | `"00042"` |
| `"%.2f", [3.14159]` | `"3.14"` |
| `"%8.2f", [3.14]` | `"    3.14"` |
| `"%.3s", ["hello"]` | `"hel"` |

**Concatenation and edge cases:**
| Input | Expected |
|-------|----------|
| `"x=%d, y=%d", [1, 2]` | `"x=1, y=2"` |
| `"%d%%", [50]` | `"50%"` |
| `"%d %d", [1]` (missing) | `"1 (missing)"` + warning |
| `"%d", [1, 2]` (extra) | `"1"` (extra ignored) |

**scanf tokenization:**
| Format | Token property |
|--------|---------------|
| `"%d"` | `skipWhitespace: true` |
| `"%c"` | `skipWhitespace: false` (critical!) |
| `"%*d"` | `suppress: true` |
| `"%s"` | `skipWhitespace: true, stopsAtWhitespace: true` |

### io-state.test.ts (minimum 12 cases)

**The `\n` residue test (most important single test):**
```typescript
it('readInt then readChar reads the leftover newline', () => {
    const io = new IoState('42\nA');
    const r1 = io.readInt();   // consumes "42", leaves "\nA"
    const r2 = io.readChar();  // reads '\n' (10), NOT 'A'
    expect(r1!.value).toBe(42);
    expect(r2!.value).toBe(10);  // not 65 ('A')
    expect(io.getStdinRemaining()).toBe('A');
});
```

**Other critical cases:**
- `readInt("  42  ")` → skips leading whitespace, value 42
- `readChar("\nA")` → reads `\n` (value 10), NOT 'A'
- `readString("hello world")` → `"hello"`, remaining `" world"`
- `readLine("hello\nworld", 10)` → `"hello\n"` (includes `\n`)
- `readLine("hello\nworld", 4)` → `"hel"` (truncates, no `\n`)
- `readInt("")` → null/EOF
- `readChar("")` → null/EOF, value -1
- `readFormatted("%d %d", "1")` → partial: itemsRead 1
- StdoutBuffer step boundary: write "hello ", markStep, write "world", getStepOutput → "world"
- Full flow: readFormatted("%d %d %d", "1 2 3") → values [1, 2, 3], itemsRead 3
- `readInt("abc")` → matching failure, cursor does not advance past 'a'

### console.test.ts (minimum 4 cases)

```typescript
it('builds cumulative output from ioEvents', () => {
    const steps = [
        { ioEvents: [{ kind: 'write', target: 'stdout', text: 'hello ' }] },
        { ioEvents: [{ kind: 'write', target: 'stdout', text: 'world' }] },
        { ioEvents: undefined },
    ];
    const outputs = buildConsoleOutputs(steps);
    expect(outputs[0]).toBe('hello ');
    expect(outputs[1]).toBe('hello world');
    expect(outputs[2]).toBe('hello world');  // unchanged
});

it('backward stepping: outputs[1] does not include step 2 text', ...);
it('echoes consumed stdin inline', ...);
it('separates stdout and stderr', ...);
```

### Snapshot regression tests (4 programs)

Add to `snapshot-regression.test.ts` or new `stdio-regression.test.ts`:

1. **Basic printf:** `printf("x = %d\n", x)` → ioEvent text `"x = 42\n"`, no errors, passes validation
2. **scanf residue:** `scanf("%d"); scanf("%c")` with stdin `"42\nA"` → second scanf reads `\n`, `c` value is `'10'`
3. **gets overflow:** `char buf[4]; gets(buf)` with stdin `"AAAAAAA\n"` → step description contains "overflow", no interpreter error
4. **sprintf:** `sprintf(msg, "count: %d", n)` → no stdout IoEvent, buffer array entries spell out `"count: 7\0"`

### Integration tests (in interpreter.test.ts)

```typescript
it('printf step has ioEvent with stdout text', () => {
    const { program } = run('int main() { printf("hi %d", 3); return 0; }');
    const step = program.steps.find(s => s.ioEvents?.some(e => e.kind === 'write'));
    expect(step!.ioEvents![0].text).toBe('hi 3');
});

it('interpretSync with stdin option writes scanf result to variable', () => {
    const { program } = run('int main() { int x; scanf("%d", &x); return 0; }', { stdin: '99\n' });
    const snapshots = buildSnapshots(program);
    expect(findEntry(snapshots.at(-1)!, 'x')?.value).toBe('99');
});

it('non-I/O steps have no ioEvents', () => {
    const { program } = run('int main() { int x = 5; return 0; }');
    expect(program.steps.every(s => !s.ioEvents)).toBe(true);
});

it('cumulative stdout across multiple printf calls', () => {
    const { program } = run('int main() { printf("a"); printf("b"); printf("c"); return 0; }');
    const outputs = buildConsoleOutputs(program.steps);
    expect(outputs.at(-1)).toBe('abc');
});
```

---

## Edge Cases

| Case | Expected behavior | How handled |
|------|------------------|-------------|
| stdin exhausted before first read | `scanf` returns `EOF` (-1), not 0. `getchar` returns -1. | `IoState.isExhausted()` check; EOF return on first read attempt |
| stdin exhausted mid-scanf | `scanf("%d %d")` with input `"42"` returns 1 (items assigned before exhaustion) | Partial read tracking in readFormatted |
| scanf input doesn't match format | `scanf("%d")` with input `"abc"` → returns 0, cursor does NOT advance past 'a' | Matching failure leaves cursor unchanged |
| printf with wrong arg count | Missing args format as `(missing)`, extra args ignored | Format parser tracks expected vs. provided count |
| printf type mismatch (`%d` with string) | Show the raw value with a warning in step description | Type check in format application; warning appended |
| scanf with no `&` (missing pointer) | Interpreter error: "argument must be a pointer (missing &?)" | Interpreter validates `args[i].type.kind === 'pointer'` before stdlib call |
| gets with small buffer | Deliberately write past buffer bounds, emit `setValue` ops for adjacent entries | Memory.emitSetValueByAddress for overrun addresses; step description warns |
| sprintf overflow | Write past destination buffer, emit `setValue` ops for overrun | Same as gets — educational overflow |
| snprintf respects limit | Truncates output, always null-terminates | Ops only for indices 0..n-2 plus `\0` at n-1 |
| snprintf with n=0 | Writes nothing, returns would-be length | No ops emitted, return value is formatted length |
| snprintf with n=1 | Writes only `\0` | Single setValue op for null terminator |
| Empty stdin string | All reads return EOF/null immediately | StdinBuffer starts exhausted |
| `\n` residue between scanf calls | stdin buffer visualization shows `\n` at cursor position | IoState cursor tracking; setValue on stdin entry |
| printf `%%` literal | Outputs single `%` | Format parser handles `%%` as literal |
| scanf `%*d` (assignment suppression) | Consumes input, doesn't assign, doesn't increment return count | Format parser handles `*` flag; return count excludes suppressed |
| scanf `%i` with octal prefix | `"010"` reads as 8 (octal) in scanf, 10 in printf — document even if v1 simplifies to decimal-only | v1: treat `%i` as `%d` for scanf, document as limitation |
| Null format string | Interpreter error | Null check before format parsing |
| `printf` with no format argument | Interpreter error: "printf requires at least one argument" | Arg count check before format parsing |
| fgets with no `\n` before EOF | Returns partial line without `\n`, null-terminates | readLine handles exhaustion |
| fgets with n=1 | Writes only `\0` to buf[0], returns buf | Boundary check in readLine |
| puts auto-appends `\n` | `puts("hello")` outputs `"hello\n"` | Handler appends `\n` after string |
| `fprintf(stdout, ...)` vs `fprintf(stderr, ...)` | Routes by first argument value | Interpreter inspects first arg to determine target stream |
| `printf("%s", NULL)` | Outputs `"(null)"` rather than crashing | Null pointer check in `%s` handler |
| Two scanf calls that exactly exhaust stdin | Second call returns partial/EOF, no crash | Normal exhaustion handling |
| `scanf("%s")` into small array | Same overflow behavior as gets | Same writeVariable mechanism allows overrun |
| getchar called repeatedly after EOF | Returns -1 every time, no state change | Exhaustion flag stays set |

---

## Verification

- [ ] `npm test` passes — all existing tests unaffected
- [ ] `npm run check` passes — no TypeScript errors
- [ ] `npm run build` succeeds — static build works
- [ ] printf programs produce correct console output
- [ ] scanf programs consume pre-supplied stdin correctly
- [ ] Stepping forward/backward updates console output correctly (O(1) via precomputation)
- [ ] stdin buffer entry visible in memory view with cursor position
- [ ] gets/sprintf overflow shows clobbered adjacent variable values
- [ ] Step descriptions explain what each I/O call did
- [ ] Missing `&` in scanf produces clear error message
- [ ] Empty stdin with scanf shows EOF return value
- [ ] Test programs demonstrate key educational concepts
- [ ] scanf `\n` residue scenario works end-to-end
- [ ] Console echoes consumed stdin text inline
- [ ] Per-tab stdin text persistence works

---

## Alternatives Considered

### Interactive async input (rejected for v1)
Could pause the interpreter mid-execution and prompt the user for input. Rejected because it requires rewriting the synchronous interpreter into an async generator or coroutine model. The pre-supplied input approach covers the educational use case well and avoids architectural upheaval. Can revisit in v2.

### FILE* struct visualization (deferred)
Showing the internal FILE struct (fd, buffer, buf_pos, flags) would be deeply educational but adds significant complexity. The buffer concept can be taught through the stdin/stdout visualization without exposing the full struct. Deferred to v2.

### Separate I/O interpreter pass (rejected)
Could run the interpreter twice — once to determine I/O needs, once with input. Rejected as unnecessarily complex; pre-supplied input is simpler and more predictable.

### I/O buffers inside Memory class (rejected)
Adding StdinBuffer/StdoutBuffer as fields on the 500+ line Memory class would mix memory-op concerns with I/O-event concerns. Memory methods record SnapshotOps; I/O methods record IoEvents. A separate IoState class keeps these concerns cleanly separated, follows the same `flushEvents()` lifecycle pattern, and is independently testable.

### New SnapshotOp types for I/O (rejected)
Could add `ioWrite`/`ioRead` op types to route I/O through the snapshot pipeline. Rejected because I/O is interpreter metadata (like `description` and `evaluation`), not a memory tree mutation. The four-op model stays closed and clean. `applyOps` and `validateProgram` don't need to know about I/O.

### Individual byte entries for stdin buffer (rejected)
Could represent stdin as a MemoryEntry with one child per byte. Rejected because it adds 20+ nodes to every `structuredClone` and `indexById` cycle across 500 steps. A single summary entry with cursor position (e.g., `"[42|\nA]"`) is sufficient for education and much cheaper.

### I/O calls as sub-steps (considered, not adopted for v1)
Could mark printf/scanf as `subStep: true` to reduce step count impact on MAX_STEPS=500. This would make I/O calls invisible in line mode, hiding the educational value. For v1, each I/O call is a regular (non-sub) step. If step exhaustion becomes a real problem, this can be revisited — or MAX_STEPS can be raised.

---

## Performance Notes

- **`applyOps` optimization (Step 0):** Pre-existing issue amplified by byte-by-byte writes. Currently O(ops × entries) per step due to `indexById` rebuild inside the op loop. Hoisting to O(ops + entries) is a prerequisite.
- **Console precomputation:** O(steps) one-time cost, O(1) per step navigation. No jank on step scrubbing.
- **stdin buffer:** Single MemoryEntry, not per-byte children. Negligible snapshot overhead.
- **IoEvent size:** `cursorPos` (integer) instead of full `remaining` string. Total IoEvent data for 500 steps with 100-char stdin: ~5KB vs ~50KB.
- **Format parsing:** ~microseconds per call. Not worth caching at 500 steps max.
- **MAX_STEPS:** A printf-in-a-for-loop(100) generates ~302 steps total. Within budget. Monitor and raise if needed.

---

## References

- [docs/architecture.md](docs/architecture.md) — system architecture and principles
- [docs/research/op-generation-requirements.md](docs/research/op-generation-requirements.md) — op generation contract
- [src/lib/interpreter/stdlib.ts](src/lib/interpreter/stdlib.ts) — existing stdlib with no-op printf
- [src/lib/interpreter/memory.ts](src/lib/interpreter/memory.ts) — Memory class (state + op recording)
- [src/lib/interpreter/handlers/statements.ts](src/lib/interpreter/handlers/statements.ts) — existing sprintf handler to replace (lines 691-718, 885-919)
- [src/lib/api/types.ts](src/lib/api/types.ts) — core type definitions
- [sprintf-kit](https://github.com/medikoo/sprintf-kit) — reference for format parser token structure
- [neatlibc scanf.c](https://github.com/aligrudi/neatlibc/blob/master/scanf.c) — simple scanf reference implementation (~220 lines)
- [cppreference scanf](https://en.cppreference.com/w/c/io/fscanf.html) — authoritative C spec for scanf behavior
- [Python Tutor stdin issue](https://github.com/pythontutor-dev/pythontutor/issues/21) — prior art showing this problem is unsolved for C
- [JavaWiz](https://javawiz.net/) — closest analog for input buffer visualization (Java)
