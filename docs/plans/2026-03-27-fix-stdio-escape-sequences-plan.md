---
title: "Fix stdio escape sequences, add console toggle, and interactive stdin"
type: fix
status: completed
date: 2026-03-27
deepened: 2026-03-27
---

# Fix stdio escape sequences, add console toggle, and interactive stdin

## Enhancement Summary

**Deepened on:** 2026-03-27
**Review agents used:** C semantics, snapshot contract, test adequacy, TypeScript, Svelte 5 races, architecture, performance, simplicity, spec flow, terminal UX, worker integration
**Research agents used:** JS generator patterns, browser terminal UX

### Key Improvements from Deepening
1. Reduced escape scope from 12+ to 7 common escapes — eliminates tricky hex/octal parsing
2. Identified full generator cascade depth — every handler and evaluator callback must become generators
3. Added Stop/Cancel mechanism and generator cleanup lifecycle
4. Fixed empty-input semantics (Enter = `"\n"`, Ctrl+D = EOF)
5. Kept ConsolePanel stateless — transcript computed as `$derived` in parent, no two-source-of-truth problem
6. Extracted interactive terminal to `TerminalPanel.svelte` to avoid tripling ConsolePanel complexity
7. Specified `getSteps()` as read-only snapshot (clone in-flight step without consuming)
8. Added race condition guards: state-flip-before-async, runGeneration on resume, double-submit prevention

### New Considerations Discovered
- Unknown C escapes: GCC drops the backslash (`\q` → `q` with warning), not pass-through
- `fflush(stdout)` must be a no-op in stdlib (common in interactive patterns)
- Partial programs must NOT run through `validateProgram()`
- `appendStdin('')` is a no-op on buffer length — need explicit `eofSignaled` flag
- Console visibility condition must change for interactive mode (show before any output)
- Generator `return()` must be called on all exit paths (Edit, tab switch, new run)

---

## Context

Three related stdio issues need addressing:

**Bug — No escape sequence processing in parser.** The C parser (`parser.ts`) does not process escape sequences in string or character literals. Tree-sitter gives raw source text — `node.text` for `"hello\nworld"` is literally the 14-char string with backslash + n, not a real newline. The parser just strips quotes without converting. This causes: literal `\n` in console output, `putchar('\n')` outputting `\`, and mixed behavior in scanf+printf examples.

**Bug — Confusing stdin echo.** `buildConsoleOutputs()` echoes consumed stdin to the console. The getchar loop example shows "Hello" in the console even though the program has no stdout code. With pre-supplied stdin this is confusing since the StdinInput component already shows consumed vs remaining.

**Feature — Console display toggle.** User wants a toggle to switch between rendered output (actual newlines) and literal display (visible `\n`, `\t`).

**Feature — Interactive stdin.** Currently all stdin must be pre-supplied before execution. The interpreter runs synchronously to completion. User wants programs to pause and wait for input when the stdin buffer is empty and an input function (scanf, getchar, fgets, gets) is called — like how a real terminal works. Input should happen inside a terminal-style console panel.

## Design

### Part A: Escape sequence processing (bug fix)

Add a `processEscapes(raw: string): string` function that converts C escape sequences to their byte values. Apply it in two places in `parser.ts`:
- `string_literal`: `processEscapes(node.text.slice(1, -1))`
- `char_literal`: `processCharLiteral(node.text)` — new helper that handles both simple (`'A'`) and escaped (`'\n'`) forms

#### Research Insights

**Scoped to 7 common escapes** (simplicity reviewer + C semantics reviewer):
- `\n` (newline, 10), `\t` (tab, 9), `\r` (carriage return, 13), `\0` (null, 0)
- `\\` (backslash, 92), `\'` (single quote, 39), `\"` (double quote, 34)

Hex (`\xHH`) and octal (`\ooo`) escapes are deferred — no educational C programs in the tool's target audience use them. They can be added later if requested. The tricky variable-length parsing (how many octal digits to consume? hex with ambiguous termination?) is avoided entirely.

**Unknown escape behavior** (C semantics reviewer — CRITICAL correction):
- GCC behavior: unknown escape `\q` **drops the backslash** and keeps `q`, with a warning
- The plan originally said "pass through" (keep `\q`) — this is WRONG vs. GCC
- Implementation: drop backslash, keep character, push warning to `errors[]`

**`\0` routing** (C semantics reviewer):
- `\0` is technically the octal escape `\000`. Since we're not implementing general octal, handle `\0` as a named special case (value 0). This is sufficient for educational use.

**Multi-character char literals** (C semantics reviewer):
- `'ab'` is implementation-defined in C. GCC produces `(97 << 8) | 98 = 24930`
- Plan: use first character with a warning pushed to `errors[]`
- Acceptable educational simplification — multi-char literals are almost always typos in intro C

**Tree-sitter confirmation** (C semantics reviewer):
- tree-sitter always gives raw source text via `node.text` — no escape processing
- The parser boundary is the correct architectural point to introduce `processEscapes()`

### Part B: Stdin echo — mode-dependent behavior

Stdin echo behavior depends on the I/O mode:

- **Pre-supplied mode:** No echo. Remove the `read` event echo from `buildConsoleOutputs()`. Input is visible in the StdinInput component.
- **Interactive mode:** Echo is natural. When the user types input in the terminal, their text appears inline. Echo is handled by the UI (appended to transcript `$derived`), NOT by `buildConsoleOutputs()`.

#### Research Insights

**`buildConsoleOutputs()` contract** (snapshot contract reviewer):
- The function should ONLY accumulate `write` events, unconditionally
- Interactive mode ConsolePanel/TerminalPanel must build its transcript independently from `ioEvents` — it cannot rely on `buildConsoleOutputs()` for echoed input
- This keeps the function pure and mode-independent

### Part C: Console display toggle

**DEFERRED to a separate PR** (simplicity reviewer recommendation).

The toggle is a pure feature request, orthogonal to the bug fixes and interactive stdin. It can be shipped as a trivial follow-up. Users can inspect string values in the Memory View for now. Removing this step saves ~40 LOC and one piece of UI state.

### Part D: Interactive stdin with terminal-style panel

#### User-facing mode selection

An explicit **"Pre-supplied / Interactive"** toggle near the stdin area, visible in editing mode. Stored per-tab.

- **Pre-supplied (default):** Current behavior. StdinInput textarea visible before Run. User provides all input upfront. Program runs to completion.
- **Interactive:** StdinInput textarea hidden. A `TerminalPanel` component replaces ConsolePanel — stdout appears as the program executes, and when the program needs input, an inline input field appears at the end of the terminal output.

#### Terminal-style TerminalPanel (interactive mode)

**Extracted as a separate component** (TypeScript reviewer + architecture reviewer recommendation):

`TerminalPanel.svelte` handles the interactive terminal experience. `ConsolePanel.svelte` remains simple (output-only display). The parent (`+page.svelte`) conditionally renders one or the other based on I/O mode.

```
┌─ Program Console ────────────┐
│ Enter two numbers:           │  ← stdout (white)
│ 10                           │  ← echoed user input (blue/distinct color)
│ 20                           │  ← echoed user input (blue)
│ Sum = 30                     │  ← stdout (white)
│ █                            │  ← inline input with blinking cursor
│                              │
│ ⏳ Waiting for input...      │  ← status indicator (only when waiting)
└──────────────────────────────┘
```

**TerminalPanel is stateless for display** (Svelte 5 races reviewer — CRITICAL):

The terminal transcript is NOT internal component state. It is computed as a `$derived` in `+page.svelte` that interleaves program stdout with echoed user inputs. The TerminalPanel receives the complete transcript as a prop, same pattern as ConsolePanel. The ONLY internal state is the current input field value (what the user is typing but hasn't submitted yet).

This avoids the two-sources-of-truth problem: the `$derived` chain is the single source, and the component is a pure renderer.

**Transcript data model:**

```typescript
type TranscriptEntry = { type: 'stdout'; text: string } | { type: 'stdin'; text: string };
// $derived in +page.svelte builds TranscriptEntry[] from ioEvents + user submissions
```

**Visual design** (terminal UX research):
- Blinking block cursor via CSS animation (`::after` pseudo-element with `step-end`)
- Inline `<input>` styled to blend with monospace output (transparent background, no border, inherit font)
- Status indicator: subtle text in terminal area ("Waiting for input...")
- Echoed input in distinct color (e.g., `text-blue-400`) to differentiate from stdout (`text-zinc-300`)

**Accessibility** (terminal UX research):
- `role="log"` + `aria-live="polite"` on transcript container
- `aria-label` on input field: "Program input — type a value and press Enter"
- Visible focus indicator on input field (WCAG 2.4.7)

**Keyboard shortcuts:**
- **Enter:** Submit current line (appends `"\n"` to input)
- **Ctrl+D:** Send EOF (on empty line only) — sets `eofSignaled` flag on IoState
- **Tab:** Trapped (prevent focus escape)

#### Architecture: Generator-based interpreter

**Chosen approach:** Convert the synchronous interpreter into a **sync generator** (`function*`, not `async function*`) that yields when stdin is exhausted and an input function is called.

**Why sync generator** (TypeScript reviewer):
- The interpreter is entirely synchronous — no `await` anywhere
- `async function*` would virally force every consumer to become async for zero benefit
- The generator pauses to return control to the UI, not to await a promise

**Explicit generator types** (TypeScript reviewer):

```typescript
type InterpreterYield = { type: 'need_input'; program: Program };
type InterpreterReturn = { type: 'complete'; program: Program; errors: string[] };
type InterpreterGenerator = Generator<InterpreterYield, InterpreterReturn, string>;
```

**First `.next()` constraint:** The initial call to `.next()` cannot pass a value (TypeScript enforces `TNext | undefined`). The implementation must handle `.next()` (no arg) for the initial kick, and `.next(text)` for subsequent resumes.

#### Generator cascade depth — CRITICAL architectural detail

**Every function in the call chain between `*interpretGen` and the yield point must be a generator** (architecture reviewer). You cannot `yield` from inside a regular function called by a generator.

The full call graph that must become generators:

```
*interpretGen()
  └─ yield* *executeStatements()        // main body
       └─ yield* *executeStatement()     // dispatch
            ├─ yield* *executeFor()      // loops
            │    └─ yield* ctx.dispatch() → *executeStatement()
            ├─ yield* *executeWhile()
            ├─ yield* *executeDoWhile()
            ├─ yield* *executeIf()
            ├─ yield* *executeSwitch()
            ├─ yield* *executeBlock()
            ├─ yield* *executeDeclaration()   // if initializer calls a function
            ├─ yield* *executeAssignment()    // if RHS calls a function
            ├─ yield* *executeExpressionStatement()
            │    └─ evaluator.eval() → function call callback → yield* *callFunction()
            │         └─ yield* *executeStatements()  // function body
            └─ yield* *executeReturn()
```

**The evaluator callback is the deepest concern** (architecture reviewer):
- The evaluator's function-call callback (interpreter.ts lines 87-115) currently returns `{ value, error }`
- If a called function contains scanf, this callback must yield
- This means either: (a) make the evaluator generator-aware, or (b) restrict interactive stdin to only work in direct calls (not inside user-defined functions)

**Recommendation for v1:** Option (a) — make it a generator. The `callFunction` handler already exists in the handler chain; it just needs to be converted like the others. The evaluator callback becomes a generator that `yield*` delegates to `callFunction`. This is ~15 function signature changes across 4 files.

**Prototype early** (architecture reviewer): Before building the UI, write a test with `scanf` inside a for-loop inside a user-defined function. If `yield` propagates correctly through the full chain, the architecture works.

#### `needsInput` flag semantics

**Where the flag is checked** (snapshot contract reviewer):
- Each `*executeStatements` generator checks `needsInput` after each `yield* executeStatement()` call
- If set, it yields up through the delegation chain (same pattern as `breakFlag`)

**Flag reset** (snapshot contract reviewer — CRITICAL):
- The generator MUST reset `needsInput = false` immediately after each yield, before calling `appendStdin` and resuming
- If the flag persists, the first check after resuming sees `needsInput = true` and yields again immediately → infinite pause loop

**Semantic difference from control flow flags** (TypeScript reviewer):
- `breakFlag`/`continueFlag`/`returnFlag` cause execution to stop permanently within that statement list
- `needsInput` causes execution to pause and resume
- Add a doc comment explaining this distinction

#### `appendStdin()` and EOF semantics

**EOF signal** (TypeScript reviewer + spec flow analyzer — CRITICAL):

`appendStdin('')` concatenating an empty string is a no-op on buffer length — `isExhausted()` remains true. This will be a bug unless handled explicitly.

**Design:**
- `appendStdin(text: string)` extends the buffer (concatenation)
- Add `private eofSignaled = false` flag to IoState
- `signalEof()` method sets the flag
- `isExhausted()` returns `true` if `eofSignaled || stdinPos >= stdinBuffer.length`
- When `eofSignaled`, input functions return EOF (-1) without pausing

**Empty input semantics** (spec flow analyzer — CRITICAL correction):
- In a real terminal, pressing Enter sends `"\n"`, not an empty string
- The TerminalPanel's Enter handler sends `text + "\n"` to `appendStdin`
- Ctrl+D on an empty line calls `signalEof()`
- This matches real terminal behavior and correctly handles `fgets` (which reads until newline)

**Mutation safety** (TypeScript reviewer):
- `stdinBuffer` is currently `private readonly`
- Change to `private stdinBuffer: string` (drop readonly)
- Document that `appendStdin` is only valid during generator pauses
- Consider runtime assertion: `if (this.generatorRunning) throw`

#### `getSteps()` — read-only partial snapshot

**Simplified API** (simplicity reviewer + snapshot contract reviewer):

Replace the proposed `getPartialProgram()` with a simple `getSteps(): ProgramStep[]` getter on Memory. The service layer wraps it into a `Program` object.

**Read-only implementation** (snapshot contract reviewer — CRITICAL):
- Clone the current in-flight step (if any) WITH ops accumulated so far
- Append the clone to a copy of `this.steps`
- Return the array WITHOUT mutating `this.currentStep` or `this.steps`
- If `getSteps()` called `flushStep()`, it would consume the in-flight step — the generator would lose it on resume

```typescript
getSteps(): ProgramStep[] {
    const steps = [...this.steps];
    if (this.currentStep) {
        steps.push({ ...this.currentStep, ops: [...this.currentStep.ops] });
    }
    return steps;
}
```

**Partial programs and validation** (snapshot contract reviewer):
- Partial programs are structurally identical to complete `Program` objects — no new type needed
- BUT: partial programs must NOT run through `validateProgram()` — the subStep anchor rule may fail for lines that only have sub-steps executed so far
- Callers must skip validation for partial results

#### Service layer API

**`InteractiveSession` type** (architecture reviewer):

```typescript
type InteractiveSession = {
    state: 'paused';
    program: Program;  // partial steps so far
    resume(input: string): Promise<InteractiveSession | RunResult>;
    cancel(): void;  // calls generator.return(), cleans up
};
```

The `resume` function is a one-shot (throws if called twice). `cancel()` cleans up the generator for lifecycle management.

**RAF yield on resume** (worker integration reviewer):

Each `resume()` call should yield to Svelte before blocking:
```typescript
async function resume(input: string) {
    await Promise.resolve(); // let Svelte flush DOM update
    // ... drive generator ...
}
```

#### State machine

```
editing → running → viewing                     (pre-supplied, or interactive with no input calls)
editing → running → waiting_for_input → running → ... → viewing   (interactive with input calls)
                         ↑                  ↓
                         └──────────────────┘    (multiple pause/resume cycles)
```

**Toolbar during `waiting_for_input`** (spec flow analyzer — CRITICAL gap):
- Show a **"Stop"** button that abandons the generator and returns to editing
- Run button disabled
- Edit button acts as Stop (abandons generator, transitions to editing)

**Race condition guards** (Svelte 5 races reviewer):

1. **Double-submit prevention:** `onSubmitInput` checks `mode.state === 'waiting_for_input'` and flips to `'running'` SYNCHRONOUSLY before any async work
2. **Stale generator guard:** `resume()` in `+page.svelte` must capture and check `runGeneration`:
   ```typescript
   function createResume(generation: number, sessionResume: Function) {
       return async (input: string) => {
           if (generation !== runGeneration) return;
           // ... call sessionResume, check generation again after await
       };
   }
   ```
3. **New Program references:** Each pause/resume produces a NEW `Program` object (via `JSON.parse(JSON.stringify(...))`) so `$derived` detects changes
4. **Generator in mode object:** Keep `resume`/`cancel` inside the `mode` state object, not in separate `$state` variables — when mode transitions to `editing`, references are dropped and generator is GC'd

**Generator cleanup on exit paths:**
- Edit button during `waiting_for_input` → call `cancel()`, transition to editing
- Tab switch during `waiting_for_input` → call `cancel()`, save nothing to `runCache`
- New Run while paused → `runGeneration++` naturally invalidates, but also call `cancel()` explicitly
- `runCache` only populated on complete runs, never partial

#### Console visibility

**Interactive mode visibility** (spec flow analyzer):
- Current guard: `mode.state === 'viewing' && hasConsoleOutput`
- Interactive mode: show TerminalPanel whenever `mode.state !== 'editing'` (including `running` and `waiting_for_input`, even before any output)

#### Additional stdlib support

**`fflush(stdout)` as no-op** (spec flow analyzer):
- Users writing interactive programs commonly include `fflush(stdout)` after `printf` prompts
- Since CrowCode has no output buffering (writes are immediate), `fflush` is a no-op
- Add to stdlib recognition list to prevent "unrecognized function" errors

#### Multi-specifier scanf with partial buffer

**Design decision** (spec flow analyzer):
- `scanf("%d %d", &a, &b)` with only one number available
- Treat like real C: scanf returns the count of items successfully matched
- Only pause BEFORE a scanf call when buffer is empty (check `io.isExhausted()` at entry)
- If buffer runs dry MID-call, return partial match count, don't pause
- This avoids the complexity of mid-function yields and matches C semantics

#### Backward compatibility

Pre-supplied mode works exactly as before — the generator runs to completion without yielding. Interactive mode is opt-in via the explicit toggle. `interpretSync()` wraps the generator to drive it to completion.

#### Unused worker.ts

**Recommendation** (worker integration reviewer): Delete `worker.ts` or add a comment explaining it's not wired. Leaving it while building a parallel interactive execution path in `service.ts` is confusing.

## Files

### Part A+B: Escape fixes & echo

#### Modify
| File | What changes | Why |
|------|-------------|-----|
| `src/lib/interpreter/parser.ts` | Apply escape processing to string_literal and char_literal | Root cause fix |
| `src/lib/engine/console.ts` | Remove stdin echo (`read` event) from `buildConsoleOutputs()` | Fix confusing echo |

#### Create
| File | Purpose |
|------|---------|
| `src/lib/interpreter/escapes.ts` | `processEscapes()` and `processCharLiteral()` functions |
| `src/lib/interpreter/escapes.test.ts` | Unit tests for escape processing |

### Part D: Interactive stdin

#### Modify
| File | What changes | Why |
|------|-------------|-----|
| `src/lib/interpreter/interpreter.ts` | Convert `interpretAST` + `executeStatements` + `executeStatement` to generators; existing `interpretAST()` wraps generator for backward compat | Core pause/resume |
| `src/lib/interpreter/handlers/types.ts` | Add `needsInput: boolean` to HandlerContext with doc comment | Signal from handlers |
| `src/lib/interpreter/handlers/statements.ts` | All handler functions become generators (`*executeDeclaration`, etc.); set `needsInput` in scanf handler | Generator cascade |
| `src/lib/interpreter/handlers/control-flow.ts` | All control flow handlers become generators (`*executeFor`, `*executeWhile`, etc.) | Generator cascade |
| `src/lib/interpreter/stdlib.ts` | Return `needsInput` signal from getchar/fgets/gets; add `fflush` as no-op | Input pause points + fflush |
| `src/lib/interpreter/io-state.ts` | Add `appendStdin(text)`, `signalEof()`, `eofSignaled` flag; change `stdinBuffer` from readonly to mutable | Interactive buffer management |
| `src/lib/interpreter/memory.ts` | Add `getSteps(): ProgramStep[]` — read-only snapshot of steps + in-flight step clone | Partial results during pause |
| `src/lib/interpreter/evaluator.ts` | Function-call callback returns generator; evaluator drives it with `yield*` | Generator cascade through function calls |
| `src/lib/interpreter/index.ts` | New `interpretInteractive()` generator entry point | Public API |
| `src/lib/interpreter/service.ts` | New `runProgramInteractive()` returning `InteractiveSession \| RunResult` | Service layer |
| `src/routes/+page.svelte` | I/O mode toggle, `waiting_for_input` state, transcript `$derived`, generation-guarded resume, Stop button, conditional TerminalPanel/ConsolePanel, per-tab mode storage | UI integration |
| `src/lib/components/ConsolePanel.svelte` | No changes (stays output-only) | Preserved simplicity |
| `src/lib/components/StdinInput.svelte` | No changes (hidden in interactive mode by parent) | — |

#### Create
| File | Purpose |
|------|---------|
| `src/lib/components/TerminalPanel.svelte` | Interactive terminal: displays transcript prop, inline input field, blinking cursor, submit handler |

#### Delete (optional)
| File | Reason |
|------|--------|
| `src/lib/interpreter/worker.ts` | Unused, confusing alongside new interactive execution path |

## UI Layout by Mode

### Pre-supplied mode (current + fixes)

```
┌─────────────────────────────────┐
│ Code Editor                     │
├─────────────────────────────────┤
│ [Pre-supplied ○ Interactive]    │  ← toggle in editing mode
│                                 │
│ ┌─ stdin Input ──────────────┐  │
│ │ 10\n20\n                   │  │  ← textarea before Run; consumed/remaining during viewing
│ └────────────────────────────┘  │
│                                 │
│ ┌─ Console Output ──────────┐  │
│ │ Enter two numbers:        │  │
│ │ Sum = 30                  │  │  ← no stdin echo
│ └────────────────────────────┘  │
├─────────────────────────────────┤
│ Memory View                     │
└─────────────────────────────────┘
```

### Interactive mode — waiting for input

```
┌─────────────────────────────────┐
│ Code Editor     [■ Stop]        │  ← Stop button visible during waiting_for_input
├─────────────────────────────────┤
│ [○ Pre-supplied  Interactive]   │  ← toggle disabled during execution
│                                 │
│ ┌─ Program Console ─────────┐  │  ← TerminalPanel component
│ │ Enter two numbers:        │  │  ← stdout (text-zinc-300)
│ │ > █                       │  │  ← inline input with blinking cursor
│ │                           │  │
│ │ ⏳ Waiting for input...   │  │  ← status indicator
│ └────────────────────────────┘  │
│                                 │
│ (no StdinInput component)       │
├─────────────────────────────────┤
│ Memory View                     │
└─────────────────────────────────┘
```

### Interactive mode — after input submitted

```
┌─ Program Console ────────────┐
│ Enter two numbers:           │  ← stdout (text-zinc-300)
│ 10                           │  ← echoed input (text-blue-400)
│ 20                           │  ← echoed input (text-blue-400)
│ Sum = 30                     │  ← stdout (text-zinc-300)
└──────────────────────────────┘
```

## Steps

### Step 1: Add escape sequence processing
- **What:** Create `escapes.ts` with `processEscapes(raw: string): string` and `processCharLiteral(text: string): number`. Support 7 escapes: `\n \t \r \0 \\ \' \"`. Unknown escapes: drop backslash, keep char, push warning. `\0` as named special case.
- **Tests (write BEFORE implementation):**
  - Named escapes: `\n` → 10, `\t` → 9, `\r` → 13, `\0` → 0, `\\` → 92, `\'` → 39, `\"` → 34
  - Unknown escape: `\q` → `q` (backslash dropped)
  - Mixed: `hello\nworld` → `hello` + newline + `world`
  - Adjacent: `\n\t` → two chars
  - No escapes: `hello` → `hello`
  - Escape at start/end: `\nhello`, `hello\n`
  - Char literals: `'A'` → 65, `'\n'` → 10, `'\0'` → 0, `'\\'` → 92
- **Files:** `src/lib/interpreter/escapes.ts`, `src/lib/interpreter/escapes.test.ts`
- **Depends on:** Nothing
- **Verification:** `npm test -- escapes` passes

### Step 2: Wire escape processing into parser
- **What:** Import and apply in `parser.ts` for string_literal and char_literal cases. Add regression tests:
  - `printf("a\\nb")` produces ioEvent text `"a\nb"` (real newline)
  - `char c = '\\n'` stores value 10 in memory entry
- **Files:** `src/lib/interpreter/parser.ts`, `src/lib/interpreter/interpreter.test.ts`
- **Depends on:** Step 1
- **Verification:** `npm test` — all tests pass

### Step 3: Remove stdin echo from buildConsoleOutputs
- **What:** Remove the `read` event echo. Update `console.test.ts` — the "echoes consumed stdin inline" test becomes "read events do not add text to console output":
  ```typescript
  expect(outputs[1]).toBe('Enter: ');      // was 'Enter: 42'
  expect(outputs[2]).toBe('Enter: Got it!'); // was 'Enter: 42Got it!'
  ```
- **Files:** `src/lib/engine/console.ts`, `src/lib/engine/console.test.ts`
- **Depends on:** Nothing (independent)
- **Verification:** `npm test -- console` passes

### Step 4: Fix all tests for Parts A-B and verify
- **What:** Run full test suite. Fix any tests that broke from escape processing changes. Run `npm run build` and `npm run check`.
- **Files:** Various test files
- **Depends on:** Steps 1-3
- **Verification:** `npm test` all green, `npm run build` + `npm run check` succeed

### Step 5: Add `needsInput` flag, `appendStdin`, `signalEof`, `fflush` no-op
- **What:**
  - Add `needsInput: boolean` to `HandlerContext` with doc comment explaining pause-resume semantics
  - In scanf handler: when `ctx.io.isExhausted()` at entry, set `ctx.needsInput = true` and return early
  - In getchar/fgets/gets stdlib: same pattern
  - Add `appendStdin(text: string)` and `signalEof()` to IoState with `eofSignaled` flag
  - Add `fflush` as recognized no-op in stdlib
  - Add `getSteps(): ProgramStep[]` to Memory (read-only clone of steps + in-flight step)
- **Tests:**
  - `needsInput` set when stdin exhausted at scanf/getchar entry
  - `appendStdin('42\n')` extends buffer, `isExhausted()` becomes false
  - `appendStdin` after existing unconsumed input
  - `signalEof()` makes `isExhausted()` true permanently
  - `getSteps()` returns steps + cloned in-flight step without mutating Memory
- **Files:** `handlers/types.ts`, `handlers/statements.ts`, `stdlib.ts`, `io-state.ts`, `memory.ts`
- **Depends on:** Nothing (parallel with Steps 1-4)
- **Verification:** Unit tests pass

### Step 6: Convert interpreter to generator — PROTOTYPE FIRST
- **What:**
  1. **Prototype test first:** Write a test with `scanf` inside a for-loop inside a user-defined function. This validates the full yield chain.
  2. Convert ALL handler functions to generators:
     - `interpreter.ts`: `*interpretGen()`, `*executeStatements()`, `*executeStatement()`
     - `handlers/statements.ts`: `*executeDeclaration`, `*executeAssignment`, `*executeExpressionStatement`, `*executeReturn`
     - `handlers/control-flow.ts`: `*executeFor`, `*executeWhile`, `*executeDoWhile`, `*executeIf`, `*executeSwitch`, `*executeBlock`
     - `handlers/index.ts`: `*callFunction`
     - `evaluator.ts`: function-call callback returns generator
  3. `ctx.dispatch()` and `ctx.dispatchStatements()` return generators; all call sites use `yield*`
  4. The outer `*interpretGen` checks `needsInput` after each delegation, yields `InterpreterYield`, receives input string via `.next(text)`, calls `io.appendStdin(text)`, resets `needsInput = false`, continues
  5. Existing `interpretAST()` wraps the generator: drives `.next()` in a loop until `done`
  6. Define explicit types: `InterpreterYield`, `InterpreterReturn`, `InterpreterGenerator`
- **Tests:**
  - Generator yields on exhausted stdin, resumes with new input, produces correct final program
  - Pre-supplied stdin runs to completion without yielding
  - Multiple sequential scanf calls → multiple yields
  - scanf inside for-loop inside function → yield propagates through full chain
  - `needsInput` reset after yield (no infinite pause loop)
  - Loop counter state preserved across yield (resume continues correct iteration)
  - `breakFlag`/`continueFlag` not corrupted by pause
- **Files:** `interpreter.ts`, `handlers/statements.ts`, `handlers/control-flow.ts`, `evaluator.ts`, `memory.ts`
- **Depends on:** Step 5
- **Verification:** Generator tests pass; ALL existing tests pass (backward compat via `interpretAST` wrapper)

### Step 7: Add interactive interpreter entry point
- **What:**
  - Add `interpretInteractive()` to `index.ts` returning `InterpreterGenerator`
  - Add `runProgramInteractive()` to `service.ts` returning `InteractiveSession | RunResult`
  - `InteractiveSession` has `resume(input)` (one-shot) and `cancel()` (calls `generator.return()`)
  - `resume` includes `await Promise.resolve()` before driving generator (let Svelte flush)
- **Files:** `index.ts`, `service.ts`
- **Depends on:** Step 6
- **Verification:** Integration test — interactive program pauses at scanf, resumes with input

### Step 8: Create TerminalPanel component
- **What:** New `TerminalPanel.svelte`:
  - Props: `transcript: TranscriptEntry[]`, `waitingForInput: boolean`, `onSubmitInput: (text: string) => void`, `onEof: () => void`
  - Renders transcript entries with color coding (stdout: `text-zinc-300`, stdin echo: `text-blue-400`)
  - When `waitingForInput`: shows inline `<input>` with blinking block cursor, auto-focused
  - Enter key: calls `onSubmitInput(inputValue + '\n')`, clears input
  - Ctrl+D on empty input: calls `onEof()`
  - Tab key: trapped (preventDefault)
  - "Waiting for input..." status indicator
  - `role="log"` + `aria-live="polite"` on transcript container
  - `aria-label` on input field
  - Use `<form onsubmit>` with `preventDefault` (not separate keydown + click handlers, avoids double-submit)
  - Auto-scroll to bottom on new transcript entries
- **Files:** `src/lib/components/TerminalPanel.svelte`
- **Depends on:** Nothing (can be built in parallel with Steps 5-7)
- **Verification:** Manual — component renders, input works, cursor blinks

### Step 9: UI integration — I/O mode toggle and state machine
- **What:**
  1. Add I/O mode state per tab (`'presupplied' | 'interactive'`), stored alongside `stdinInput`
  2. Add toggle UI in editing mode (disabled during execution)
  3. In pre-supplied mode: current behavior (StdinInput visible, ConsolePanel output-only)
  4. In interactive mode: hide StdinInput, show TerminalPanel
  5. Add `waiting_for_input` to mode state machine (includes `program`, `errors`, `warnings`, `resume`, `cancel`)
  6. Compute `transcript: TranscriptEntry[]` as `$derived` from partial program's ioEvents + accumulated user inputs
  7. `viewingProgram` derived includes `waiting_for_input` state
  8. Console/Terminal visibility: in interactive mode, show whenever `mode.state !== 'editing'`
  9. Stop button: visible during `waiting_for_input`, calls `cancel()`, transitions to editing
  10. **Race condition guards:**
      - `onSubmitInput`: check `mode.state === 'waiting_for_input'`, flip to `running` SYNCHRONOUSLY before async
      - `resume` wrapped with `runGeneration` check (captured at creation time)
      - Each pause/resume produces NEW `Program` reference
      - `resume`/`cancel` stored inside mode object (not separate $state)
  11. **Cleanup on exit:** Edit during pause → `cancel()`. Tab switch during pause → `cancel()`. New Run → `cancel()` old session.
  12. `runCache` only populated on complete runs
- **Files:** `src/routes/+page.svelte`
- **Depends on:** Steps 7, 8
- **Verification:** Manual — full interactive flow works

### Step 10: End-to-end testing and polish
- **What:** Test all stdio examples with both modes. Verify:
  - Step navigation during waiting_for_input
  - Multiple pause/resume cycles
  - Stop button abandons cleanly
  - Tab switch during pause cleans up
  - Edit during pause cleans up
  - Empty input → sends "\n" (not EOF)
  - Ctrl+D → sends EOF
  - fflush(stdout) no-op
  - `printf("Enter: "); scanf(...)` — stdout appears before pause
  - scanf("%d %d") with one value → partial match, doesn't pause mid-call
  - Pre-supplied mode unchanged
- **Files:** Test files, minor UI polish
- **Depends on:** Step 9
- **Verification:** `npm test` passes, `npm run build` succeeds

## Edge Cases

| Case | Expected behavior | How handled |
|------|-------------------|-------------|
| **Escape sequences** | | |
| `"\\"` (escaped backslash) | Single backslash char (92) | Named escape |
| `'\''` (escaped single quote) | Char value 39 | Named escape |
| `"\0"` (null in string) | Null byte | Named special case |
| Unknown escape `"\q"` | `q` (drop backslash) + warning | GCC behavior |
| Multi-char char literal `'ab'` | First char (97) + warning | Educational simplification |
| **Pre-supplied mode** | | |
| No input functions | Runs normally, no pause | Generator never yields |
| Sufficient stdin | Runs to completion | Buffer never exhausted |
| Insufficient stdin | Input functions return EOF | Same as current |
| **Interactive mode** | | |
| No input functions | Runs to completion immediately | Generator never yields |
| Enter on empty line | Sends `"\n"` to appendStdin | Real terminal behavior |
| Ctrl+D on empty line | Calls signalEof() → EOF | Standard EOF mechanism |
| Multiple sequential scanf | Pause at each exhaustion | Multiple yields |
| scanf inside loop | Pause each iteration | Generator re-yields |
| scanf inside user function | Yield propagates through callFunction | Full generator cascade |
| scanf("%d %d") partial buffer | Return partial match count | Don't pause mid-call |
| `printf("Enter: "); scanf(...)` | printf output visible before pause | Separate statements, natural ordering |
| Step limit during interactive | Stop with truncation warning | maxSteps check applies |
| Stop button pressed | Generator cancelled, return to editing | `cancel()` calls `generator.return()` |
| Edit during pause | Same as Stop | `cancel()` + mode transition |
| Tab switch during pause | Cancel generator, save nothing | `cancel()`, no runCache entry |
| Double Enter press | Second ignored | State check before async |
| Stale generator after tab switch | Discarded | runGeneration guard on resume |
| `fflush(stdout)` call | No-op | Recognized in stdlib |

## Verification

### Parts A-B (escape fixes, echo removal)
- [ ] `npm test` passes (all 721+ tests)
- [ ] `npm run build` succeeds
- [ ] `npm run check` passes
- [ ] puts/putchar example: `putchar('\n')` produces actual newline
- [ ] printf examples: `\n` in format strings renders as newlines
- [ ] getchar loop (pre-supplied): no "Hello" in console output
- [ ] scanf+printf: clean output with real newlines

### Part D (interactive stdin)
- [ ] I/O mode toggle visible in editing mode, persists per tab
- [ ] Pre-supplied mode works identically to before
- [ ] Interactive mode: StdinInput hidden, TerminalPanel shown
- [ ] Interactive getchar loop: pauses → type in terminal → program resumes
- [ ] Interactive scanf+printf: stdout → pause → type "10" Enter → pause → type "20" Enter → "Sum = 30"
- [ ] Echoed input appears in distinct color (blue) in terminal
- [ ] Step navigation works during waiting_for_input
- [ ] Stop button cancels cleanly
- [ ] Tab switch during pause cleans up
- [ ] Multiple pause/resume cycles work
- [ ] Enter sends "\n", Ctrl+D sends EOF
- [ ] fflush(stdout) is no-op (no error)
- [ ] Blinking cursor + "Waiting for input..." indicator
- [ ] Accessibility: role="log", aria-live, aria-label on input

## References

- [parser.ts:560-564](src/lib/interpreter/parser.ts#L560-L564) — current naive escape handling
- [console.ts:13-15](src/lib/engine/console.ts#L13-L15) — stdin echo in buildConsoleOutputs
- [interpreter.ts:211-220](src/lib/interpreter/interpreter.ts#L211-L220) — synchronous execution loop
- [interpreter.ts:87-115](src/lib/interpreter/interpreter.ts#L87-L115) — evaluator function-call callback (must become generator)
- [interpreter.ts:166-207](src/lib/interpreter/interpreter.ts#L166-L207) — interpretAST entry point
- [io-state.ts](src/lib/interpreter/io-state.ts) — current stdin model (pre-supplied, immutable)
- [service.ts](src/lib/interpreter/service.ts) — current sync entry point
- [+page.svelte:41-86](src/routes/+page.svelte#L41-L86) — current run flow and mode state machine
- [handlers/types.ts](src/lib/interpreter/handlers/types.ts) — HandlerContext interface
- [ConsolePanel.svelte](src/lib/components/ConsolePanel.svelte) — current output-only console (stays simple)
- [StdinInput.svelte](src/lib/components/StdinInput.svelte) — current pre-supplied input component
- [Research: stdin handling patterns](docs/research/stdin-handling-browser-interpreters.md) — comparative analysis of 5 architectural patterns
- [C escape sequences (cppreference)](https://en.cppreference.com/w/c/language/escape)
- [JSCPP drain callback](https://github.com/felixhao28/JSCPP) — reference implementation of pull-based stdin
- [JS-Interpreter step/async pattern](https://neil.fraser.name/software/JS-Interpreter/docs.html) — pause/resume via createAsyncFunction
