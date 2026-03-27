---
title: "stdio Support: Interactive I/O with Buffer Visualization"
type: feat
status: active
date: 2026-03-27
---

# stdio Support: Interactive I/O with Buffer Visualization

## Context

CrowCode visualizes C memory layout as users step through programs. Currently, `printf`, `puts`, and `putchar` are recognized but produce no output — they're no-ops in the stdlib. There's no stdin support at all (`scanf`, `getchar`, `fgets` are unhandled).

Students learning C struggle deeply with stdio concepts that are invisible in normal debugging:
- **stdin buffer residue** — `scanf("%d")` leaves `\n` in the buffer, causing the next `scanf("%c")` to read it unexpectedly
- **stdout buffering** — `printf("Enter: ")` without `\n` may not flush to screen
- **Buffer overflows** — `gets()` or `sprintf()` writing past array bounds
- **Format string parsing** — how `%d`, `%s`, `%c` consume variadic arguments differently

This feature adds real I/O simulation: stdout text appears in a console panel, stdin input is prompted from the user, and the internal buffer state is visualized in the memory view.

## Design

### Approach: Simulated I/O with Pre-supplied Input

Rather than truly blocking for user input (which would require async interruption of the synchronous interpreter), **stdin input is pre-supplied before execution**. The user provides all input values upfront (like piping input to a program), and the interpreter consumes them from a buffer during `scanf`/`getchar`/`fgets` calls.

**Why pre-supplied input:**
- The interpreter runs synchronously (`interpretSync`) — blocking mid-execution for user input would require rewriting the execution model
- Pre-supplied input lets users see the full program execution with stepping, which is the core value proposition
- It matches how students test programs: `echo "42 hello" | ./program`
- Future enhancement: interactive mode via async interpreter (out of scope for v1)

### I/O Model

**stdout** — An append-only string buffer. `printf`, `puts`, `putchar`, `fputs` append to it. Each step that produces output records the new text. A `ConsolePanel` component displays the cumulative output, highlighting what was added in the current step.

**stdin** — A consumable string buffer initialized from user-provided input. `scanf`, `getchar`, `fgets` consume from the front. The memory view shows the buffer state: consumed vs. remaining bytes. When the buffer is exhausted, functions return EOF/0 (matching real C behavior).

**stderr** — Same model as stdout, separate buffer. `fprintf(stderr, ...)` writes to it.

### What Gets Visualized

1. **Console output** — New UI panel showing stdout/stderr text, growing as the user steps forward
2. **stdin buffer** — Shown in memory view as a byte array with a read cursor, so students see what's been consumed vs. what remains
3. **Format string effects** — Step descriptions like `scanf("%d", &x): read "42" from stdin, wrote 42 to x` make the invisible visible
4. **Buffer overflow** — When `gets`/`sprintf` write past buffer bounds, show the overwritten bytes in the memory view (educational, not a crash)

### Scope for v1

**In scope:**
- `printf` with format specifiers: `%d`, `%i`, `%u`, `%x`, `%X`, `%c`, `%s`, `%f`, `%p`, `%%`, field width, precision
- `sprintf`, `snprintf` writing to char arrays
- `scanf` with: `%d`, `%c`, `%s`, `%f`, `%x` (whitespace handling, return value)
- `getchar`, `putchar`
- `fgets`, `puts`, `fputs`
- `gets` (with deliberate buffer overflow visualization — educational)
- ConsolePanel UI component for stdout
- stdin input area (textarea for pre-supplying input)
- Step descriptions explaining what each I/O call did

**Out of scope (future):**
- `FILE*` as a visualized struct (fopen/fclose/file I/O)
- Interactive/async input mode
- Internal stdout buffering visualization (showing the FILE buffer filling) — v2
- `fprintf` to arbitrary streams (only stderr supported)
- `sscanf` / `fscanf`

## Files

### Modify

| File | What changes | Why |
|------|-------------|-----|
| `src/lib/api/types.ts` | Add `IoEvent` type and `ioEvents` field to `ProgramStep` | Steps need to record what I/O happened |
| `src/lib/interpreter/stdlib.ts` | Replace printf/puts/putchar no-ops with real formatting; add scanf/getchar/fgets/gets/sprintf/snprintf handlers | Core I/O implementation |
| `src/lib/interpreter/memory.ts` | Add `StdinBuffer` and `StdoutBuffer` to Memory; expose methods for I/O ops | I/O state tracking and op recording |
| `src/lib/interpreter/interpreter.ts` | Pass I/O context to stdlib; handle scanf's write-through-pointer | Interpreter needs to mediate I/O calls |
| `src/lib/interpreter/service.ts` | Accept `stdin` input string in options; pass to interpreter | Entry point needs to forward user input |
| `src/lib/interpreter/evaluator.ts` | Support `&variable` address-of expressions for scanf | scanf requires pointer arguments |
| `src/lib/interpreter/index.ts` | Export new I/O types | Barrel export update |
| `src/lib/interpreter/worker.ts` | Accept stdin in WorkerRequest | Worker path parity |
| `src/routes/+page.svelte` | Add stdin input area and ConsolePanel to layout | UI integration |
| `src/lib/test-programs.ts` | Add stdio test programs | Educational examples |

### Create

| File | Purpose |
|------|---------|
| `src/lib/components/ConsolePanel.svelte` | Displays stdout/stderr output with step-by-step highlighting |
| `src/lib/components/StdinInput.svelte` | Textarea for pre-supplying stdin input before execution |
| `src/lib/interpreter/stdio.ts` | `StdinBuffer` and `StdoutBuffer` classes; format string parser; I/O event recording |
| `src/lib/interpreter/stdio.test.ts` | Unit tests for format parsing, buffer consumption, edge cases |
| `src/lib/interpreter/format.ts` | printf/scanf format string parser (shared between printf and scanf) |
| `src/lib/interpreter/format.test.ts` | Format string parser tests |

## Steps

### Step 1: Define I/O Types and Events
- **What:** Add `IoEvent` type to `types.ts`, add `ioEvents?: IoEvent[]` to `ProgramStep`, add `stdin?: string` to interpreter options
- **Files:** `src/lib/api/types.ts`, `src/lib/interpreter/interpreter.ts`
- **Depends on:** nothing
- **Verification:** `npm run check` passes, existing tests still pass

```typescript
// New types in types.ts
type IoEvent =
  | { type: 'stdout'; text: string }
  | { type: 'stderr'; text: string }
  | { type: 'stdin-read'; consumed: string; remaining: string; format?: string };
```

### Step 2: Build Format String Parser
- **What:** Create `format.ts` with a printf-style format parser that handles `%d`, `%i`, `%u`, `%x`, `%X`, `%c`, `%s`, `%f`, `%p`, `%%`, field width, and precision. Also create scanf-style parser that handles `%d`, `%c`, `%s`, `%f`, `%x` with whitespace rules. Both return structured token arrays.
- **Files:** `src/lib/interpreter/format.ts`, `src/lib/interpreter/format.test.ts`
- **Depends on:** Step 1
- **Verification:** `npm test` — format parser tests cover all specifiers, edge cases (missing args, type mismatches, `%%` literal)

### Step 3: Build stdio Buffer Classes
- **What:** Create `stdio.ts` with `StdinBuffer` (consumable string buffer with cursor tracking) and `StdoutBuffer` (append-only buffer with per-step markers). StdinBuffer supports `readInt()`, `readChar()`, `readString()`, `readLine(maxLen)`, `readFormatted(fmt)`. StdoutBuffer supports `write(text)`, `getStepOutput()`, `getFullOutput()`.
- **Files:** `src/lib/interpreter/stdio.ts`, `src/lib/interpreter/stdio.test.ts`
- **Depends on:** Step 2 (format parser)
- **Verification:** `npm test` — buffer tests cover consumption, EOF, whitespace handling, cursor tracking

### Step 4: Implement printf/puts/putchar in stdlib
- **What:** Replace the no-op printf/puts/putchar handlers with real implementations that use the format parser and StdoutBuffer. `printf` formats the string using variadic args and writes to stdout buffer. `sprintf`/`snprintf` write to a char array in memory instead. Each call records an `IoEvent` on the current step.
- **Files:** `src/lib/interpreter/stdlib.ts`, `src/lib/interpreter/memory.ts`
- **Depends on:** Steps 2, 3
- **Verification:** `npm test` — existing tests still pass (printf was no-op, now produces output but doesn't break ops); new tests verify formatted output

### Step 5: Implement scanf/getchar/fgets/gets in stdlib
- **What:** Add stdin-consuming functions to stdlib. `scanf` uses the format parser to consume from StdinBuffer and writes values through pointers (requires evaluator support for `&`). `getchar` consumes one byte. `fgets` consumes up to n-1 chars or until newline. `gets` consumes until newline with no bounds checking (deliberately allows buffer overflow for educational visualization). Each call records an `IoEvent` with consumed/remaining state.
- **Files:** `src/lib/interpreter/stdlib.ts`, `src/lib/interpreter/evaluator.ts`, `src/lib/interpreter/memory.ts`
- **Depends on:** Steps 3, 4
- **Verification:** `npm test` — tests verify scanf return values, whitespace handling, buffer residue, EOF behavior, gets overflow

### Step 6: Wire I/O Through Interpreter and Service
- **What:** Update `interpretSync` to accept `stdin` string in options, create StdinBuffer/StdoutBuffer in Memory, pass I/O context to stdlib handler. Update `service.ts` `runProgram()` to accept and forward stdin. Update `worker.ts` for parity. Ensure `memory.flushStep()` attaches `ioEvents` to the step.
- **Files:** `src/lib/interpreter/interpreter.ts`, `src/lib/interpreter/service.ts`, `src/lib/interpreter/worker.ts`, `src/lib/interpreter/memory.ts`, `src/lib/interpreter/index.ts`
- **Depends on:** Steps 4, 5
- **Verification:** `npm test` — integration test: C source with printf/scanf → Program with correct ioEvents on steps; `npm run check` passes

### Step 7: Build ConsolePanel and StdinInput Components
- **What:** Create `ConsolePanel.svelte` — displays cumulative stdout/stderr from ioEvents up to current step. New output from current step is highlighted. Create `StdinInput.svelte` — textarea where user types input before clicking Run. Shows consumed/remaining state during stepping.
- **Files:** `src/lib/components/ConsolePanel.svelte`, `src/lib/components/StdinInput.svelte`
- **Depends on:** Step 6
- **Verification:** Manual — run dev server, load a printf program, verify output appears; load a scanf program, provide input, verify stepping shows consumption

### Step 8: Integrate UI into Page Layout
- **What:** Add ConsolePanel and StdinInput to `+page.svelte`. ConsolePanel appears below or beside the memory view. StdinInput appears near the code editor (only visible when the program contains scanf/getchar/fgets/gets). Wire up stdin string to `runProgram()` call.
- **Files:** `src/routes/+page.svelte`
- **Depends on:** Step 7
- **Verification:** Manual — full flow works: enter C code with I/O → provide stdin → run → step through → see console output and memory changes

### Step 9: Add stdio Test Programs
- **What:** Add curated test programs to `test-programs.ts` demonstrating key stdio concepts: basic printf, scanf with multiple reads, the stdin newline residue problem, gets buffer overflow, sprintf formatting, getchar loop.
- **Files:** `src/lib/test-programs.ts`
- **Depends on:** Step 8
- **Verification:** Each program runs without errors; programs appear in UI tabs

### Step 10: Step Description Enrichment
- **What:** Ensure step descriptions for I/O calls are educational. Examples: `printf("%d", x): wrote "42" to stdout`, `scanf("%d", &x): read "42" from stdin → x = 42`, `getchar(): read 'A' (0x41) from stdin`, `fgets(buf, 10, stdin): read "Hello\n" into buf (7 bytes + \0)`, `gets(buf): read "AAAAAAAAAAAAAAAA" — overflow! wrote 16 bytes into 8-byte buffer`
- **Files:** `src/lib/interpreter/stdlib.ts`
- **Depends on:** Steps 4, 5
- **Verification:** `npm test` — verify step descriptions contain expected text for representative programs

## Edge Cases

| Case | Expected behavior | How handled |
|------|------------------|-------------|
| stdin exhausted mid-scanf | scanf returns number of items read so far (< expected), getchar returns EOF (-1) | StdinBuffer.isExhausted flag; functions check before consuming |
| printf with wrong arg count | Missing args format as `(missing)`, extra args ignored | Format parser tracks expected vs. provided count |
| printf type mismatch (`%d` with string) | Show the raw value with a warning in step description | Type check in format application; warning appended |
| scanf with no `&` (missing pointer) | Interpreter error: "scanf requires pointer argument" | Evaluator validates argument is address expression |
| gets with small buffer | Deliberately write past buffer bounds, show overflow in memory view | Memory.writeBytes allows overrun; step description warns |
| sprintf overflow | Write past destination buffer, show overrun | Same as gets — educational overflow |
| snprintf respects limit | Truncates output, always null-terminates | Format output truncated to n-1 chars + `\0` |
| Empty stdin string | All reads return EOF/0 immediately | StdinBuffer starts exhausted |
| `\n` residue between scanf calls | Show `\n` remaining in stdin buffer visualization | StdinBuffer cursor shows exact position |
| printf `%%` literal | Outputs single `%` | Format parser handles `%%` as literal |
| scanf `%*d` (assignment suppression) | Consumes input but doesn't assign | Format parser handles `*` flag |
| Null format string | Interpreter error | Null check before format parsing |

## Verification

- [ ] `npm test` passes — all existing tests unaffected
- [ ] `npm run check` passes — no TypeScript errors
- [ ] `npm run build` succeeds — static build works
- [ ] printf programs produce correct console output
- [ ] scanf programs consume pre-supplied stdin correctly
- [ ] Stepping forward/backward updates console output correctly
- [ ] stdin buffer state visible in memory view during scanf calls
- [ ] gets overflow is visually apparent in memory view
- [ ] Step descriptions explain what each I/O call did
- [ ] Test programs demonstrate key educational concepts

## Alternatives Considered

### Interactive async input (rejected for v1)
Could pause the interpreter mid-execution and prompt the user for input. Rejected because it requires rewriting the synchronous interpreter into an async generator or coroutine model. The pre-supplied input approach covers the educational use case well and avoids architectural upheaval. Can revisit in v2.

### FILE* struct visualization (deferred)
Showing the internal FILE struct (fd, buffer, buf_pos, flags) would be deeply educational but adds significant complexity. The buffer concept can be taught through the stdin/stdout visualization without exposing the full struct. Deferred to v2.

### Separate I/O interpreter pass (rejected)
Could run the interpreter twice — once to determine I/O needs, once with input. Rejected as unnecessarily complex; pre-supplied input is simpler and more predictable.

## References

- [docs/architecture.md](docs/architecture.md) — system architecture and principles
- [docs/research/op-generation-requirements.md](docs/research/op-generation-requirements.md) — op generation contract
- [src/lib/interpreter/stdlib.ts](src/lib/interpreter/stdlib.ts) — existing stdlib with no-op printf
- [src/lib/interpreter/memory.ts](src/lib/interpreter/memory.ts) — Memory class (state + op recording)
- [src/lib/api/types.ts](src/lib/api/types.ts) — core type definitions
