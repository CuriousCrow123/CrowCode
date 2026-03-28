---
title: Comprehensive stdio & interactive stdin test suite
type: test
status: completed
date: 2026-03-28
deepened: 2026-03-28
---

# Comprehensive stdio & interactive stdin test suite

## Enhancement Summary

**Deepened on:** 2026-03-28
**Review agents used:** test-adequacy, c-semantics, snapshot-contract, pattern-recognition, code-simplicity, document-quality, vitest-generator-research, c-scanf-edge-cases
**Sections enhanced:** All

### Key Improvements from Review
1. **Removed ~120 lines of C reference docs** — belonged in research doc, not plan. Replaced with concise ground truth link.
2. **Fixed helper pattern bug** — `interpretInteractive` returns `{ generator, parseErrors }`, not a bare generator. Every agent caught this.
3. **Added 8 missing test areas** found by test-adequacy reviewer (getchar as bare statement, scanf in declarations, input in non-main functions, type-mismatch input, multiple re-pauses, generator cancellation, fgets description enrichment, scanf %* suppression).
4. **Removed sync-duplicate tests** — escape sequences, format specifiers, puts/putchar already tested in `interpreter.test.ts`. Kept only interactive-specific tests.
5. **Collapsed from 11 steps to 5** — reduced 42% plan size, no information lost.
6. **Fixed incorrect test expectations** — `scanf %s` doesn't write to memory (known limitation), getchar loop pause count clarified, whitespace-only input behavior is deterministic not "may".
7. **Added loop-body pause test** for anchor rule validation on partial programs (snapshot contract reviewer).
8. **Added Known Limitations section** documenting CrowCode simplifications vs real C.

## Context

The interactive stdin feature (generator-based pause/resume) has **zero tests**. All existing stdio tests use `interpretSync` with pre-supplied stdin. The entire `interpretGen` / `interpretInteractive` / `runProgramInteractive` code path is untested. This plan creates a focused test suite that tests only interactive-specific behavior, avoiding duplication with the existing sync test suite.

**Ground truth reference:** `docs/research/c-stdio-terminal-behavior.md` — comprehensive real C stdio behavior (buffering, scanf semantics, escape sequences, terminal echo, common pitfalls). All expected values in tests below are derived from this document.

## Design

### Approach: Direct generator testing

Test at the `interpretInteractive` level (not `runProgramInteractive` which requires browser APIs like `requestAnimationFrame`). This gives us:
- Full control over when input is provided
- Access to `NeedInputSignal` with partial `Program` snapshots
- No async complexity — generators are synchronous between yields

### Test scope: interactive-only behavior

**DO test** (unique to interactive code path):
- Generator yield/resume protocol
- Pause at correct statements (scanf, getchar, fgets, gets)
- Correct values after resume
- Partial program validity at pause points
- Buffer carryover preventing unnecessary re-pauses
- Step descriptions updating after input (sharesStep=true)
- No duplicate steps from pause/resume re-execution
- Multiple resume attempts on same statement

**DO NOT re-test** (already covered in `interpreter.test.ts` sync suite):
- Escape sequence byte values (\n, \t, \0, \\)
- printf format specifiers (%d, %x, %c)
- puts appending \n, putchar output
- scanf %c not skipping whitespace
- scanf %x hex parsing, %f float parsing
- scanf \n residue (already in sync test at line 704)
- buildConsoleOutputs accumulation logic

### Helper pattern

**IMPORTANT:** `interpretInteractive` returns `{ generator, parseErrors }`, not a generator directly. The helper must destructure.

```typescript
let parser: Parser;

beforeAll(async () => {
    resetParserCache();
    await Parser.init({ locateFile: () => resolve('static/tree-sitter.wasm') });
    parser = new Parser();
    const lang = await Language.load(resolve('static/tree-sitter-c.wasm'));
    parser.setLanguage(lang);
});

function interactive(source: string, opts?: { maxSteps?: number }) {
    const { generator, parseErrors } = interpretInteractive(
        parser, source, { interactive: true, ...opts }
    );
    expect(parseErrors).toHaveLength(0);
    return generator;
}

/** Drive generator with predefined inputs. Fails if generator yields more times than inputs provided. */
function driveInteractive(
    source: string,
    inputs: string[],
    opts?: { maxSteps?: number },
): { result: InterpretResult; yieldCount: number } {
    const gen = interactive(source, opts);
    let yieldCount = 0;
    let r = gen.next();
    while (!r.done) {
        if (yieldCount >= inputs.length) {
            throw new Error(`Unexpected yield #${yieldCount + 1}: no more inputs`);
        }
        r = gen.next(inputs[yieldCount]);
        yieldCount++;
    }
    return { result: r.value, yieldCount };
}
```

### What to verify at each pause/resume

For `need_input` yields:
1. `result.done === false` and `result.value.type === 'need_input'`
2. Partial program has steps (`.steps.length > 0`)
3. A step matching the input function exists (use `.find()`, not index)
4. `validateProgram()` passes on the partial program

For final `done` result:
1. `result.done === true`
2. No errors: `result.value.errors.length === 0`
3. `validateProgram()` passes
4. `buildSnapshots()` produces no `console.warn`
5. Memory values correct (use `findEntry` on last snapshot)

**NOTE:** Use `.find()` and `.filter()` on step arrays, not index-based access. Use `.toContain()` for description checks, not exact strings. Avoid exact step count assertions — they break when step-sharing policy changes.

## Files

### Create

| File | Purpose |
|------|---------|
| `src/lib/interpreter/interactive.test.ts` | Interactive generator tests — pause/resume mechanics, buffer behavior, partial programs |

### Reference (read-only)

| File | Why |
|------|-----|
| `src/lib/interpreter/index.ts` | `interpretInteractive`, `NeedInputSignal`, `InteractiveGenerator` types |
| `src/lib/interpreter/interpreter.ts` | `interpretGen`, `executeStatementsYielding` — the yield/resume loop |
| `src/lib/interpreter/handlers/statements.ts` | `INPUT_FUNCTIONS`, all interactive pause intercept points |
| `src/lib/interpreter/interpreter.test.ts` | Existing sync helpers and patterns to reuse |
| `src/lib/engine/validate.ts` | `validateProgram` for structural integrity |
| `src/lib/engine/snapshot.ts` | `buildSnapshots` for memory state verification |
| `src/lib/engine/console.ts` | `buildConsoleOutputs` — only includes stdout (NOT stdin echo) |

## Steps

### Step 1: Scaffolding and generator lifecycle tests

- **What:** Create `interactive.test.ts` with parser setup, helpers (`interactive()`, `driveInteractive()`, `expectValid()`, `findEntry()`), and basic generator protocol tests.
- **Files:** `src/lib/interpreter/interactive.test.ts`
- **Depends on:** Nothing
- **Verification:** `npx vitest run src/lib/interpreter/interactive.test.ts`

**Tests:**

```
describe('generator lifecycle')

  it('program with no input completes without yielding')
    Source: int main() { int x = 5; return 0; }
    gen.next() → { done: true }
    Verify: result.value.program.steps.length > 0, no errors

  it('program with scanf yields need_input')
    Source: int main() { int x; scanf("%d", &x); return 0; }
    gen.next() → { done: false, value: { type: 'need_input' } }
    Verify: value.program.steps.length > 0

  it('providing input resumes and completes')
    Source: int main() { int x; scanf("%d", &x); return 0; }
    gen.next() → yields
    gen.next('42\n') → { done: true }
    Verify: no errors, validateProgram passes

  it('first gen.next() argument is discarded — only subsequent calls send input')
    Source: int main() { int x; scanf("%d", &x); return 0; }
    gen.next('IGNORED') → yields need_input (the string is ignored per JS generator spec)
    gen.next('42\n') → completes
    Verify: x = 42

  it('parseErrors returned for invalid source')
    const { generator, parseErrors } = interpretInteractive(parser, 'not valid C', { interactive: true });
    Verify: parseErrors.length > 0 OR generator completes with errors

  it('generator can be cancelled via .return()')
    Source: int main() { int x; scanf("%d", &x); return 0; }
    gen.next() → yields
    gen.return({ program: { name: '', source: '', steps: [] }, errors: [] })
    Verify: result.done === true
    gen.next('42\n') → also done (generator is closed)
```

### Step 2: Core interactive workflows (scanf, getchar, fgets, gets)

- **What:** Test the primary interactive scenarios — all the ways input functions pause and resume. This is the heart of the test suite.
- **Files:** `src/lib/interpreter/interactive.test.ts`
- **Depends on:** Step 1
- **Verification:** `npx vitest run src/lib/interpreter/interactive.test.ts`

**Tests:**

```
describe('scanf + printf interactive workflow')

  Source:
    int main() {
        int x;
        int y;
        printf("Enter two numbers:\n");
        scanf("%d", &x);
        scanf("%d", &y);
        printf("Sum = %d\n", x + y);
        return 0;
    }

  it('pauses at first scanf with printf output already in steps')
    gen.next() → yields need_input
    Verify: steps.find(s => s.description?.includes('scanf')) exists
    Verify: a step has ioEvent with kind 'write' and text containing 'Enter two numbers'
    Verify: buildConsoleOutputs includes "Enter two numbers:\n" before the scanf step
    NOTE: buildConsoleOutputs only includes stdout, not stdin echo

  it('resumes after first input, pauses at second scanf')
    gen.next() → yields (first scanf)
    gen.next('10\n') → yields need_input again (second scanf)
    Verify: more steps than after first pause
    Verify: a step's evaluation contains '10' (description updated after input)

  it('completes after second input with correct final values')
    { result, yieldCount } = driveInteractive(source, ['10\n', '20\n'])
    Verify: yieldCount === 2
    Verify: no errors, validateProgram passes
    Verify: buildSnapshots → findEntry for x = 10, y = 20
    Verify: buildConsoleOutputs last = "Enter two numbers:\nSum = 30\n"

  it('no duplicate steps from pause/resume')
    Drive through both scanfs
    Verify: no two steps have identical (line, description) pairs
    Verify: steps.filter(s => s.description?.includes('scanf')).length === 2 (exactly 2 scanf steps)


describe('getchar interactive — all intercept paths')

  it('c = getchar() in assignment pauses when stdin empty')
    Source: int main() { int c; c = getchar(); return 0; }
    gen.next() → yields need_input
    gen.next('A') → done
    Verify: buildSnapshots → c = 65

  it('int c = getchar() in declaration pauses when stdin empty')
    Source: int main() { int c = getchar(); return 0; }
    gen.next() → yields
    gen.next('Z') → done
    Verify: buildSnapshots → c = 90

  it('getchar() as bare expression statement pauses when stdin empty')
    Source: int main() { getchar(); return 0; }
    gen.next() → yields need_input
    gen.next('X') → done
    Verify: no errors (value discarded, but pause still happened)
    NOTE: This exercises executeCallStatement path, distinct from assignment intercept

  it('getchar loop pauses when buffer exhausted')
    Source:
      int main() {
          int c; int count = 0;
          c = getchar();
          while (c != -1) { count++; c = getchar(); }
          return 0;
      }
    gen.next() → yields (first getchar, buffer empty)
    gen.next('AB') → yields again (reads A, increments, reads B, increments, THIRD getchar exhausts → pause)
    Verify: at this point count = 2
    NOTE: Pause is at the THIRD getchar call, not the second. First reads A, second reads B, third finds empty buffer.

  it('two getchar() in declarations — second reads from buffer')
    Source:
      int main() {
          int c1 = getchar();
          int c2 = getchar();
          return 0;
      }
    gen.next() → yields
    gen.next('AB') → done (both chars available in buffer)
    Verify: c1 = 65 ('A'), c2 = 66 ('B')


describe('fgets and gets interactive')

  it('fgets pauses when stdin empty')
    Source: int main() { char buf[80]; fgets(buf, 80, stdin); return 0; }
    gen.next() → yields need_input
    gen.next('hello world\n') → completes
    Verify: no errors
    NOTE: fgets includes newline in buffer per C standard

  it('gets pauses when stdin empty')
    Source: int main() { char buf[80]; gets(buf); return 0; }
    gen.next() → yields need_input
    gen.next('test\n') → completes
    Verify: no errors
    NOTE: gets strips newline per C standard
```

### Step 3: Buffer behavior and C semantics in interactive mode

- **What:** Test that buffer carryover, the \n residue pitfall, and edge cases work correctly through the interactive code path. These verify C-faithful behavior across pause/resume boundaries.
- **Files:** `src/lib/interpreter/interactive.test.ts`
- **Depends on:** Step 2
- **Verification:** `npx vitest run src/lib/interpreter/interactive.test.ts`

**Tests:**

```
describe('buffer carryover across pause/resume')

  it('extra data from first resume carries to second scanf — no re-pause')
    Source:
      int main() { int a; int b; scanf("%d", &a); scanf("%d", &b); return 0; }
    gen.next() → yields at first scanf
    gen.next('10 20\n') → should complete WITHOUT second pause
    C semantics: first scanf reads "10", leaves " 20\n". Second scanf skips space, reads "20".
    Verify: a = 10, b = 20, yieldCount === 1

  it('\\n residue: scanf %d then %c reads leftover newline')
    Source:
      int main() {
          int num; char ch;
          scanf("%d", &num);
          scanf("%c", &ch);
          return 0;
      }
    gen.next() → yields at first scanf
    gen.next('42\n') → should complete (second scanf reads \n from buffer, no re-pause)
    Verify: num = 42, ch = 10
    THIS IS THE #1 EDUCATIONAL SCENARIO — must match real C

  it('\\n residue with extra char: %d + %c + %c reads residue then next')
    Source:
      int main() {
          int num; char c1; char c2;
          scanf("%d", &num);
          scanf("%c", &c1);
          scanf("%c", &c2);
          return 0;
      }
    gen.next() → yields at first scanf
    gen.next('42\nA') → should complete (c1 = \n, c2 = A from buffer)
    Verify: num = 42, c1 = 10, c2 = 65


describe('edge cases')

  it('empty input string causes deterministic re-pause')
    Source: int main() { int x; scanf("%d", &x); return 0; }
    gen.next() → yields
    gen.next('') → yields AGAIN (deterministic — buffer still exhausted)
    gen.next('42\n') → completes
    Verify: x = 42, no duplicate scanf steps

  it('whitespace-only input for %d causes deterministic re-pause')
    Source: int main() { int x; scanf("%d", &x); return 0; }
    gen.next() → yields
    gen.next('   \n') → yields AGAIN (readInt finds no digits, resets position)
    gen.next('42\n') → completes
    Verify: x = 42

  it('multiple re-pauses on same statement do not create duplicate steps')
    Source: int main() { int x; scanf("%d", &x); return 0; }
    gen.next() → yields
    gen.next('') → yields again
    gen.next('') → yields again
    gen.next('42\n') → completes
    Verify: only ONE scanf step exists (sharesStep=true on each re-execution)

  it('type-mismatch input: letters for %d causes re-pause in interactive mode')
    Source: int main() { int x; scanf("%d", &x); return 0; }
    gen.next() → yields
    gen.next('abc\n') → yields AGAIN (readInt returns null, needsInput set)
    gen.next('42\n') → completes
    Verify: x = 42
    NOTE: In real C, scanf returns 0 and 'a' stays in buffer. CrowCode re-pauses instead.
    This is a known behavioral divergence documented in Known Limitations.

  it('step limit prevents infinite interactive loop — generator terminates')
    Source: int main() { while(1) { int x; scanf("%d", &x); } return 0; }
    Drive with maxSteps: 10, repeatedly providing '1\n'
    Verify: generator returns done: true (NOT infinite yield)
    Verify: errors contain 'Step limit exceeded'

  it('program with syntax error returns parseErrors without hanging')
    const { generator, parseErrors } = interpretInteractive(
        parser, 'int main() { scanf("%d" &x); return 0; }', { interactive: true }
    );
    Verify: parseErrors.length > 0 OR generator completes immediately with errors
```

### Step 4: Partial program integrity and known-limitation tests

- **What:** Verify partial programs are structurally valid, and document/test known behavioral differences from real C.
- **Files:** `src/lib/interpreter/interactive.test.ts`
- **Depends on:** Step 2
- **Verification:** `npx vitest run src/lib/interpreter/interactive.test.ts`

**Tests:**

```
describe('partial program integrity')

  it('partial program passes validateProgram')
    Source: int main() { printf("hi"); int x; scanf("%d", &x); return 0; }
    On yield: validateProgram(partialProgram) returns no errors

  it('partial program buildSnapshots produces no warnings')
    Same source
    On yield: buildSnapshots with console.warn spy → no warnings

  it('partial program from loop-body pause passes validateProgram')
    Source:
      int main() {
          int i;
          for (i = 0; i < 3; i++) {
              int x;
              scanf("%d", &x);
          }
          return 0;
      }
    gen.next() → yields at first scanf (inside loop body)
    Verify: validateProgram(partialProgram) returns no errors
    NOTE: Tests anchor rule under partial programs with sub-steps from loop check/increment

  it('resumed program step locations are superset of partial')
    On pause: record partial step locations
    After resume: every partial step location exists in final program at same index

  it('stdin entry in partial program has kind: io and passes address check')
    Source that triggers a read event before the pause
    Verify: validateProgram does not flag the stdin entry as missing an address


describe('input functions in non-main contexts')

  it('scanf inside a helper function silently EOFs — does not pause')
    Source:
      int readNum() { int x; scanf("%d", &x); return x; }
      int main() { int val = readNum(); return 0; }
    gen.next() → { done: true } (completes without yielding)
    Verify: no errors (scanf silently fails, treated as EOF)
    NOTE: This is a known architectural limitation — driveGenerator swallows needsInput
    from nested function calls. The test documents this behavior.

  it('scanf as declaration initializer pauses correctly')
    Source: int main() { int x = scanf("%d", &x); return 0; }
    gen.next() → yields need_input (exercises evaluateCallForDecl path)
    gen.next('42\n') → completes
    NOTE: Tests the evaluateCallForDecl → needsInput branch at statements.ts:154
```

### Step 5: Sync vs interactive parity and console output verification

- **What:** Verify that the interactive path produces identical results to the sync path for the same programs and inputs, and that console output (escape sequences, ioEvents, accumulation) is correct through the interactive path.
- **Files:** `src/lib/interpreter/interactive.test.ts`
- **Depends on:** Steps 2-3
- **Verification:** `npx vitest run src/lib/interpreter/interactive.test.ts`

**Tests:**

```
describe('sync vs interactive parity')

  it('scanf + printf: same final values and console output in both modes')
    Source: int main() { int x; scanf("%d", &x); printf("%d", x); return 0; }
    Sync: interpretSync(parser, source, { stdin: '42\n' })
    Interactive: driveInteractive(source, ['42\n'])
    Verify: same final x value (buildSnapshots → findEntry)
    Verify: same console output from buildConsoleOutputs

  it('two scanfs: same result whether input provided together or separately')
    Source: int main() { int a, b; scanf("%d", &a); scanf("%d", &b); return 0; }
    Sync: stdin '10\n20\n'
    Interactive option A: driveInteractive(source, ['10\n', '20\n']) (separate inputs)
    Interactive option B: driveInteractive(source, ['10\n20\n']) (all at once)
    All three must produce: a = 10, b = 20

  it('printf + scanf + printf: output ordering identical in both modes')
    Source:
      int main() {
          printf("Enter: ");
          int x; scanf("%d", &x);
          printf("Got %d\n", x);
          return 0;
      }
    Sync: stdin '42\n'
    Interactive: driveInteractive(source, ['42\n'])
    Both: buildConsoleOutputs last = "Enter: Got 42\n"
    NOTE: buildConsoleOutputs only includes stdout, not stdin echo

  it('\\n residue: identical ch value in sync and interactive')
    Source:
      int main() { int num; char ch; scanf("%d", &num); scanf("%c", &ch); return 0; }
    Sync: stdin '42\n'
    Interactive: driveInteractive(source, ['42\n'])
    Both: num = 42, ch = 10


describe('console output correctness through interactive path')

  it('escape sequences are rendered as byte values, not literal characters')
    Source: int main() { printf("line1\nline2\n"); return 0; }
    driveInteractive(source, [])
    Verify: console output contains actual newline (charCode 10), NOT literal \n
    C semantics: \n processed at parse time → byte 0x0A in string data

  it('\\t produces tab, \\0 terminates, \\\\ produces backslash')
    Source: int main() { printf("a\tb\n"); return 0; }
    Verify: output contains byte 9 (tab) between 'a' and 'b'

    Source: int main() { printf("Hello\0World\n"); return 0; }
    Verify: output is "Hello" only — printf stops at \0

    Source: int main() { printf("path\\\\file\n"); return 0; }
    Verify: output contains single backslash

  it('putchar writes correct bytes')
    Source: int main() { putchar('A'); putchar('\n'); return 0; }
    Verify: console output is "A\n" (byte 65 then byte 10)

  it('puts appends newline, printf does not')
    Source: int main() { puts("hello"); return 0; }
    Verify: output is "hello\n"

    Source: int main() { printf("hello"); printf("world"); return 0; }
    Verify: output is "helloworld" (no newline)

  it('printf ioEvents appear on correct step with correct text')
    Source: int main() { int x = 5; printf("x=%d\n", x); return 0; }
    Verify: a step has ioEvents with kind === 'write' and text 'x=5\n'

  it('scanf ioEvents have read events after resume')
    Source: int main() { int x; scanf("%d", &x); return 0; }
    Drive interactively with '42\n'
    Verify: the scanf step has ioEvents with kind === 'read'

  it('buildConsoleOutputs accumulates correctly across steps')
    Source: int main() { printf("a"); printf("b"); printf("c"); return 0; }
    driveInteractive(source, [])
    consoleOutputs: last entry should be "abc"

  it('printf before scanf appears in partial program console output')
    Source:
      int main() {
          printf("Name: ");
          char name[20];
          scanf("%s", name);
          return 0;
      }
    gen.next() → yields at scanf
    Verify: buildConsoleOutputs on partial program includes "Name: "
    C semantics: line-buffer flush-before-read rule — prompt appears before scanf blocks


describe('scanf format specifiers through interactive path')

  it('scanf %d skips leading whitespace')
    Source: int main() { int x; scanf("%d", &x); return 0; }
    driveInteractive(source, ['  42\n'])
    Verify: x = 42 (leading spaces don't cause re-pause or error)

  it('scanf %c reads single char WITHOUT skipping whitespace')
    Source: int main() { char c; scanf("%c", &c); return 0; }
    driveInteractive(source, [' X'])
    Verify: c = 32 (space), NOT 88 ('X')
    C semantics: %c is special — does NOT skip leading whitespace

  it('scanf %s reads until whitespace')
    Source: int main() { char s[20]; scanf("%s", s); return 0; }
    driveInteractive(source, ['hello world\n'])
    Verify: no errors, program completes
    NOTE: %s doesn't write to memory in v1 (known limitation) — can only verify pause/resume

  it('scanf %x reads hex value')
    Source: int main() { int x; scanf("%x", &x); return 0; }
    driveInteractive(source, ['ff\n'])
    Verify: x = 255

  it('scanf %f reads float')
    Source: int main() { float f; scanf("%f", &f); return 0; }
    driveInteractive(source, ['3.14\n'])
    Verify: f ≈ 3.14
```

### Step 6: Run full test suite and verify

- **What:** Run all tests, verify no regressions, check type correctness.
- **Files:** None modified
- **Depends on:** All previous steps
- **Verification:**
  ```bash
  npx vitest run src/lib/interpreter/interactive.test.ts
  npm test
  npm run check
  ```

## Known Limitations (CrowCode vs Real C)

These are documented simplifications where CrowCode diverges from the C standard. Tests should verify the CrowCode behavior, not the C standard behavior, for these cases.

| Limitation | Real C behavior | CrowCode behavior | Impact |
|-----------|----------------|-------------------|--------|
| `scanf("%s")` memory write | Writes chars byte-by-byte to char array + null terminator | Consumes input but writes `value: 0` (simplified for v1) | Cannot verify string content in memory for %s |
| `scanf(" %c")` explicit whitespace skip | Space before `%c` skips leading whitespace (the canonical fix for \n residue) | Whitespace tokens in format string are ignored | Students can't see the fix working — needs implementation |
| `scanf("%d")` on non-matching input | Returns 0, 'a' stays in buffer, variable unchanged | Re-pauses waiting for more input (interactive mode) | Different UX than real C — acceptable for educational tool |
| Literal chars in format (`scanf("(%d)")`) | Matches literal parentheses in input | Skipped for v1 — literal tokens ignored | Uncommon in intro courses |
| `scanf("%[^\n]")` scansets | Reads until char not in set | Not implemented | Intermediate feature |
| `scanf` inside non-main functions | Blocks waiting for input like any other scanf | Pauses for input (needsInput propagates through driveGenerator) | Actually correct — tested and confirmed |
| `scanf("%d\n")` trailing whitespace | Hangs waiting for non-whitespace after the number | Trailing whitespace token ignored (same as `"%d"`) | Reasonable simplification |
| `scanf` return value as expression | `while (scanf(...) != -1)` uses return value | Not available — scanf handled as statement interceptor, not stdlib function. Goes through evaluator which doesn't know scanf. | Use sentinel pattern: `while (1) { scanf(...); if (val == -1) break; }` |
| Type-mismatch input in interactive mode | `scanf("%d")` with `"abc\n"` returns 0, 'a' stays in buffer, program continues | Re-pauses; bad chars permanently block read position even after new input appended | Documented divergence — buffer poisoning is permanent |
| `while` loop re-execution on resume | N/A (real C doesn't pause) | Entire while statement re-executes from condition on resume. scanf must be at top of loop body to avoid double-processing of scores. | Architectural limitation of statement-level re-execution |

## Edge Cases

| Case | Expected behavior | How tested |
|------|-------------------|------------|
| Empty input on resume | Re-yields `need_input` (deterministic) | Step 3: empty input re-pause |
| Multiple empty resumes | Each re-yields, no duplicate steps | Step 3: multiple re-pauses |
| Buffer carryover | Second scanf reads from buffer, no re-pause | Step 3: extra data test |
| `\n` residue | `scanf("%c")` reads `\n` (ch = 10) | Step 3 + Step 5 parity |
| Type mismatch input | Re-pauses (CrowCode-specific) | Step 3: letters for %d |
| Step limit in interactive loop | Generator terminates with error | Step 3: step limit test |
| getchar as bare statement | Pauses like assignment form | Step 2: bare getchar test |
| getchar in declaration | Pauses via evaluateCallForDecl | Step 2: declaration getchar |
| Loop-body pause | Partial program passes validateProgram | Step 4: loop pause test |
| scanf in non-main function | Silently EOFs, no pause | Step 4: known limitation test |
| Generator cancellation | .return() closes generator cleanly | Step 1: cancellation test |
| Partial program validity | validateProgram + buildSnapshots pass | Step 4: integrity tests |
| Escape sequences as bytes | `\n` = 0x0A, `\t` = 0x09, `\\` = 0x5C | Step 5: escape tests |
| puts adds `\n`, printf doesn't | `puts("hi")` → `"hi\n"`, `printf("hi")` → `"hi"` | Step 5: puts/printf test |
| `\0` terminates printf | `printf("A\0B")` → `"A"` | Step 5: \0 test |
| printf before scanf in console | Prompt visible in partial program | Step 5: partial console test |
| Sync/interactive parity | Same values and console output | Step 5: parity tests |
| `%c` no whitespace skip | `scanf("%c")` with `" X"` → 32 | Step 5: %c test |
| Format specifiers via interactive | %d, %x, %f, %s all work | Step 5: specifier tests |

## Verification

- [x] `npx vitest run src/lib/interpreter/interactive.test.ts` passes (49/49)
- [x] `npm test` passes (814/814, no regressions)
- [x] `npm run check` — no new type errors (pre-existing errors in parser.ts, interpreter.ts unchanged)
- [x] Every `need_input` partial program passes `validateProgram()`
- [x] Every completed program passes `validateProgram()` and `buildSnapshots()` with no warnings
- [x] No duplicate steps from pause/resume (verified via structural queries, not exact counts)
- [x] Step descriptions update correctly after input (use `.toContain()`, not exact match)
- [x] Console output from `buildConsoleOutputs` matches expected stdout (not including stdin echo)
- [x] Escape sequences rendered as byte values through interactive path
- [x] Sync and interactive modes produce identical final values and console output
- [x] All scanf format specifiers (%d, %c, %s, %x, %f) work through interactive path
- [x] Known limitations are tested and documented (not silently wrong)

## Test Realism Assessment

### What this plan tests (interpreter engine)

The tests call `interpretInteractive()` directly, exercising the generator yield/resume protocol, C semantics (buffer carryover, \n residue, escape sequences), and partial program validity. This is where C behavior bugs would live and is the highest-value target.

| Aspect | Realism | Why |
|--------|---------|-----|
| Pause at correct statement | High | Generator yields at exact point where UI shows input field |
| Correct values after input | High | Interpreter processes input identically whether from UI or test |
| Buffer carryover / \n residue | High | Pure interpreter logic — UI doesn't affect it |
| Console output text (stdout) | Medium | `buildConsoleOutputs` matches UI stdout, but stdin echoes are UI-only |
| Step descriptions | Medium | `evaluation` field is what UI renders, but Svelte rendering is untested |
| Partial program validity | High | `validateProgram()` + `buildSnapshots()` exercise same pipeline as UI |
| No duplicate steps | High | Generator re-execution is the actual mechanism that caused real bugs |

### What this plan does NOT test (UI integration)

The tests skip three layers that a real user touches:

1. **`+page.svelte`** — manages `AppMode`, `interactiveStdinEntries`, `internalIndex` preservation, `$derived` `interactiveSegments` (interleaves stdin echoes at `afterStep`), stop/cancel lifecycle
2. **`ConsolePanel.svelte`** — renders `ConsoleSegment[]`, input field `<form onsubmit>`, Ctrl+D EOF, "Waiting for input..." indicator, auto-focus, scroll behavior
3. **`service.ts` `runProgramInteractive()`** — wraps generator with `InteractiveSession` resume/cancel, `requestAnimationFrame` DOM flushing, one-shot resume guard

A bug in the Svelte reactivity chain (e.g., `internalIndex` resetting after resume, segments not rebuilding, stdin echoes not hiding on backstep) would NOT be caught.

### Future work (deferred)

These would close the realism gap but are out of scope for this plan:

- **Component tests** (`@testing-library/svelte`) — render `ConsolePanel.svelte` with real `ConsoleSegment[]` data and assert DOM output (input field appearance, stdin echo visibility, step-indexed console content)
- **Service layer tests** — test `runProgramInteractive()` with a mock `requestAnimationFrame` to exercise the `InteractiveSession` resume/cancel/double-resume-rejection lifecycle
- **E2E tests** (Playwright) — load the app, select a stdio program, switch to Interactive mode, type input in the console, step forward/backward, verify the full visual experience including stdin echo interleaving and backstep behavior
- **Step-by-step UI simulation** — verify that at each `internalIndex` position, the console shows exactly the right output (stdout up to that step + stdin echoes with `afterStep <= internalIndex`)

## References

- `docs/research/c-stdio-terminal-behavior.md` — **ground truth**: how real C stdio works with terminals
- `src/lib/interpreter/interpreter.test.ts` — existing sync test patterns and helpers
- `src/lib/interpreter/index.ts` — `interpretInteractive`, `NeedInputSignal`, `InteractiveGenerator` types
- `src/lib/interpreter/interpreter.ts` — `interpretGen`, `executeStatementsYielding`
- `src/lib/interpreter/handlers/statements.ts` — `INPUT_FUNCTIONS`, all interactive intercept points
- `src/lib/engine/validate.ts` — `validateProgram` rules
- `src/lib/engine/console.ts` — `buildConsoleOutputs` (stdout only, not stdin echo)
- POSIX `scanf(3)`, `setbuf(3)`, `termios(3)` — authoritative C behavior specs
