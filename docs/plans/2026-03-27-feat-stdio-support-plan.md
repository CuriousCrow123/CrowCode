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

### Phase 1: Foundation (DONE)

All foundation steps are complete and shipped on `feat/stdio-support`.

#### Step 0: Performance Prerequisite — Optimize `applyOps` ✅
- **Commit:** `9f85582` — Hoisted `indexById()` outside per-op loop. O(ops × entries) → O(ops + entries) per step. Added `addToIndex`/`removeFromIndex` helpers for incremental index maintenance.

#### Step 1: Define I/O Types and Events ✅
- **Commit:** `602f274` — `IoEvent` discriminated union (`write` | `read`), `MemoryEntry.kind: 'io'`, `ProgramStep.ioEvents?`, `InterpreterOptions.stdin?`, validator exemption for `kind: 'io'`.

#### Step 2: Build Format String Parser ✅
- **Commit:** `60368f7` — `format.ts` with regex tokenizer. `applyPrintfFormat()` for output, `parseScanfFormat()` for input tokenization. 47 tests covering all specifiers, width/precision, edge cases.

#### Step 3: Build IoState Class ✅
- **Commit:** `8ed6bd8` — Separate `IoState` class with `readInt/readChar/readFloat/readString/readLine/readUntilNewline/readHexInt`. Correct C whitespace semantics per specifier. `flushEvents()` lifecycle. 45 tests including the `\n` residue scenario.

#### Step 4+7: Wire printf/puts/putchar/fputs/fprintf + Service ✅
- **Commit:** `8aced11` — stdlib handlers with real formatting via IoState. `CValue.stringValue` for format string propagation. `Memory.setIoEventsFlusher()` callback for automatic ioEvent attachment. `service.ts` accepts stdin. `buildConsoleOutputs()` engine function. `statements.ts` routes I/O calls through stdlib. 8 integration tests.

#### Step 8: Build ConsolePanel and StdinInput ✅
- **Commit:** `d62e2da` — Svelte 5 components following project patterns. ConsolePanel with emerald highlighting. StdinInput with consumed/remaining strikethrough.

#### Step 9: Integrate UI ✅
- **Commit:** `293b0f7` — Left column layout (55vh editor + StdinInput + ConsolePanel). `needsStdin` regex detection. Pre-computed `consoleOutputs[]`. stdin consumption tracking via `stdinConsumed` derived.

#### Step 10: Add Test Programs ✅
- **Commit:** `d79e58c` — 4 stdio programs: Basic printf, puts/putchar, getchar loop, format specifiers. `TestProgram.stdin?` field. loadTestProgram wires stdin.

**Current state:** 704 tests across 21 files. `npm test`, `npm run check`, `npm run build` all pass.

---

### Phase 2: Remaining Work

#### Implementation learnings that affect the remaining steps

During Phase 1 implementation, several design discoveries change the approach for remaining work:

1. **String literals are AST-level, not CValue-level.** `CValue.stringValue` was added for string literals, but format strings for `scanf` must be extracted from the AST `string_literal` node since the evaluator returns 0 for string literal addresses. This means **scanf must be handled at the `executeCallStatement` level** (like `free` is handled), not in stdlib.

2. **Variable write-through uses `memory.setValue(name, value)`.** This method both updates runtime state AND emits `setValue` ops. The variable name comes from the AST argument (`&x` → unary `&` → identifier `x`). No address-to-ID reverse lookup is needed — just walk the AST.

3. **`evaluateSprintfResult` in `statements.ts` still works** for the existing sprintf behavior (writes quoted string to heap entry). It can be enhanced with the new format parser but the pattern is sound. Byte-by-byte writes to stack-allocated char arrays would require address-to-ID lookup which doesn't exist — defer this to v2.

4. **getchar already works end-to-end** via stdlib handler + IoState. It was implemented in Phase 1.

---

#### Step 5: Implement scanf write-through (CRITICAL)
- **What:** Handle `scanf` at the `executeCallStatement` level in `statements.ts`, following the pattern used for `free`. For each format specifier in the format string, consume from IoState and write to the target variable via `memory.setValue(name, value)`.
- **Approach:**
  1. Extract format string from AST: `call.args[0]` is a `string_literal` node → `.value` gives the format string
  2. Parse with `parseScanfFormat()` from `format.ts` to get tokens
  3. For each specifier token, resolve the target variable:
     - AST argument is `unary_expression` with `operator: '&'` and `operand.type === 'identifier'` → variable name is `operand.name`
     - If argument is NOT `&identifier`, emit error: "scanf argument must be a pointer (missing &?)"
  4. Consume from IoState based on specifier:
     - `%d`/`%i` → `io.readInt()`, `%c` → `io.readChar()`, `%s` → `io.readString()`, `%f` → `io.readFloat()`, `%x` → `io.readHexInt()`
  5. Write to variable: `ctx.memory.setValue(varName, value)` — emits `setValue` op automatically
  6. Handle `%*` (suppress): consume but don't assign, don't increment return count
  7. Return value: count of successfully assigned items, or -1 (EOF) if input exhaustion before first match
  8. Step description: `scanf("%d", &x) → read "42" from stdin, x = 42`
- **Files:** `src/lib/interpreter/handlers/statements.ts`, `src/lib/interpreter/io-state.ts` (may need accessor from HandlerContext)
- **Depends on:** Phase 1 (all done)
- **Key constraint:** IoState currently lives on the `Interpreter` class and is passed to stdlib via `createStdlib()`. For statement-level handlers, IoState must be accessible via `HandlerContext`. Add `io: IoState` to `HandlerContext` interface.
- **Verification:**
  - `scanf("%d", &x)` with stdin `"42\n"` → `x` value is `'42'` in final snapshot
  - `scanf("%d", &x); scanf("%c", &c)` with stdin `"42\nA"` → `c` value is `'10'` (newline residue!)
  - `scanf("%d", x)` (missing `&`) → interpreter error
  - `scanf("%d %d", &a, &b)` with stdin `"42"` → returns 1, `a` is `'42'`, `b` unchanged
  - Non-I/O steps still have no ioEvents

#### Step 6: Implement fgets/gets via statement handler
- **What:** Handle `fgets` and `gets` at the `executeCallStatement` level. Both consume from IoState and write to a destination buffer.
- **Approach (simplified for v1):**
  - `fgets(buf, n, stdin)`: Extract `buf` variable name from AST arg[0]. Call `io.readLine(n)`. For heap-allocated buffers, set the heap entry value to a quoted string (same pattern as existing sprintf). For stack-allocated char arrays, write byte-by-byte if address-to-ID lookup exists, otherwise show as description text.
  - `gets(buf)`: Call `io.readUntilNewline()`. Same write pattern as fgets but no bounds checking. Step description warns about overflow when consumed length exceeds buffer size.
  - **v1 simplification:** Both functions show the result as a quoted string on the destination entry (matching existing sprintf behavior) rather than individual byte setValue ops. This avoids the address-to-ID reverse lookup complexity.
- **Files:** `src/lib/interpreter/handlers/statements.ts`
- **Depends on:** Step 5 (IoState in HandlerContext)
- **Verification:**
  - `fgets(buf, 10, stdin)` with stdin `"Hello\n"` → buf entry shows `"Hello\n"`
  - `gets(buf)` with long stdin → step description warns about overflow
  - fgets EOF returns null indicator

#### Step 11: Step Description Enrichment
- **What:** After implementing Steps 5-6, enhance step descriptions for all I/O calls using IoEvent data. The description is set when `beginStep` is called; we enhance it by appending the I/O result after the stdlib call completes.
- **Approach:** In `executeCallStatement`, after the I/O call evaluates:
  1. Read back the IoEvents from IoState (peek, not flush — flushing happens in `flushStep`)
  2. For write events: append `→ wrote "text" to stdout`
  3. For read events: append `→ read "consumed" from stdin`
  4. For scanf: append variable assignments `→ x = 42`
  5. Update step description via `ctx.memory.setStepDescription(newDesc)` (new method needed on Memory)
- **Target descriptions:**
  - `printf("x = %d\n", x) → "x = 42\n"`
  - `scanf("%d", &x) → read "42", x = 42`
  - `getchar() → 'A' (65)`
  - `puts("hello") → "hello\n"`
  - `fgets(buf, 10, stdin) → "Hello\n" (7 chars)`
- **Files:** `src/lib/interpreter/handlers/statements.ts`, `src/lib/interpreter/memory.ts`
- **Depends on:** Steps 5, 6
- **Verification:** `npm test` — verify step descriptions contain expected output text

#### Step 12: Update interpreter-status.md
- **What:** Update the interpreter status document to reflect shipped stdio capabilities.
- **Changes:**
  - Move `printf`, `puts`, `putchar` from "No-op" to "Working" with notes about IoState/ConsolePanel
  - Move `getchar` from "Not Implemented" to "Working"
  - Add `scanf`, `fgets`, `gets` to "Working" once Steps 5-6 ship
  - Add `fprintf`, `fputs` to "Working"
  - Update test count from 599 → current
  - Update test program count with new stdio category
  - Remove "No I/O output" and "No stdin" from Runtime Limitations
- **Files:** `docs/interpreter-status.md`
- **Depends on:** Steps 5-6

---

### Deferred to v2

These items were in the original plan but are deferred based on implementation learnings:

- **sprintf/snprintf byte-by-byte writes to stack char arrays** — Requires an address-to-entry-ID reverse lookup that doesn't exist in Memory. The existing sprintf behavior (quoted string on heap entry) is adequate for v1. Byte-by-byte visualization is a v2 enhancement.
- **stdin buffer as `kind: 'io'` MemoryEntry in memory view** — The StdinInput component already shows consumed/remaining state during stepping. Adding a duplicate in the memory view adds complexity for marginal educational benefit. Revisit in v2.
- **gets/sprintf deliberate overflow visualization** — Writing past buffer bounds and showing clobbered adjacent variables requires the same address-to-ID reverse lookup. Deferred to v2.
- **`%s` format specifier with actual string resolution** — printf `%s` currently outputs `"(string)"` because char pointer values are numeric addresses. Resolving the string from memory requires reading bytes from the address, which needs the `MemoryAccess` interface wired through to the format application layer. Straightforward but scope-adds.
- **snprintf** — Not intercepted in statements.ts yet. Low priority since educational programs rarely use it.

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

### Phase 1 (DONE)
- [x] `npm test` passes — 704 tests, 21 files
- [x] `npm run check` passes — no new TypeScript errors
- [x] `npm run build` succeeds — static build works
- [x] printf programs produce correct console output with ioEvents
- [x] Stepping forward/backward updates console output correctly (O(1) via precomputation)
- [x] getchar reads from pre-supplied stdin, returns -1 on EOF
- [x] Test programs demonstrate key educational concepts (4 stdio programs)
- [x] Console highlights new output per step in emerald
- [x] StdinInput auto-detected from source code

### Phase 2 (remaining)
- [ ] scanf programs consume pre-supplied stdin and update variable values in memory view
- [ ] scanf `\n` residue scenario works end-to-end (the core educational demonstration)
- [ ] Missing `&` in scanf produces clear error message
- [ ] fgets/gets consume from stdin and show result on destination entry
- [ ] Step descriptions show I/O results (e.g., `printf(...) → "x = 42\n"`)
- [ ] interpreter-status.md updated to reflect new capabilities

### Deferred to v2
- ~~stdin buffer entry visible in memory view with cursor position~~
- ~~gets/sprintf overflow shows clobbered adjacent variable values~~
- ~~Per-tab stdin text persistence~~ (stdin resets on tab switch — acceptable for v1)

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

- **`applyOps` optimization (Step 0):** ✅ Done. Hoisted `indexById` outside per-op loop with incremental `addToIndex`/`removeFromIndex`. O(ops + entries) per step.
- **Console precomputation:** ✅ Done. `buildConsoleOutputs()` — O(steps) one-time, O(1) per step navigation.
- **IoEvent size:** `cursorPos` (integer) instead of full `remaining` string. Total IoEvent data for 500 steps with 100-char stdin: ~5KB vs ~50KB.
- **Format parsing:** ~microseconds per call. Not worth caching at 500 steps max.
- **MAX_STEPS:** A printf-in-a-for-loop(100) generates ~302 steps total. Within budget. Monitor and raise if needed.

---

## References

### Project files
- [docs/architecture.md](docs/architecture.md) — system architecture and principles
- [docs/research/op-generation-requirements.md](docs/research/op-generation-requirements.md) — op generation contract
- [src/lib/api/types.ts](src/lib/api/types.ts) — core type definitions (IoEvent, MemoryEntry.kind:'io')
- [src/lib/interpreter/format.ts](src/lib/interpreter/format.ts) — printf/scanf format string parser (new)
- [src/lib/interpreter/io-state.ts](src/lib/interpreter/io-state.ts) — IoState class for stdin/stdout management (new)
- [src/lib/interpreter/stdlib.ts](src/lib/interpreter/stdlib.ts) — stdlib with real printf/puts/putchar/getchar handlers
- [src/lib/interpreter/memory.ts](src/lib/interpreter/memory.ts) — Memory class with ioEventsFlusher callback
- [src/lib/interpreter/handlers/statements.ts](src/lib/interpreter/handlers/statements.ts) — I/O call routing; scanf handler target
- [src/lib/engine/console.ts](src/lib/engine/console.ts) — buildConsoleOutputs() precomputation (new)
- [src/lib/components/ConsolePanel.svelte](src/lib/components/ConsolePanel.svelte) — stdout display component (new)
- [src/lib/components/StdinInput.svelte](src/lib/components/StdinInput.svelte) — stdin input component (new)

### External
- [neatlibc scanf.c](https://github.com/aligrudi/neatlibc/blob/master/scanf.c) — simple scanf reference implementation (~220 lines) — guide for Step 5
- [cppreference scanf](https://en.cppreference.com/w/c/io/fscanf.html) — authoritative C spec for scanf behavior
- [Python Tutor stdin issue](https://github.com/pythontutor-dev/pythontutor/issues/21) — prior art showing this problem is unsolved for C
- [JavaWiz](https://javawiz.net/) — closest analog for input buffer visualization (Java)
