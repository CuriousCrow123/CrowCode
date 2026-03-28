---
title: Improve Step Descriptions for Clarity and Pedagogy
type: refactor
status: completed
date: 2026-03-27
---

# Improve Step Descriptions for Clarity and Pedagogy

## Context

Step descriptions are the primary text users see as they step through a C program. They appear in a monospace font below the step controls, styled as gray text (description) + green text (evaluation). Currently descriptions are inconsistent: some show computed values (`malloc(sizeof(int)) — allocate 4 bytes`), others show raw expressions (`x = x + 1`), and some are terse to the point of being unhelpful (`break`, `return 0`). The `evaluation` field is only used on for-loop conditions.

The goal is to make every description **accurate** (describes exactly what happened) and **pedagogical** (helps a learner understand the step). The key principle: **show the computation, then the result**.

## Design

### Description Philosophy

Each description answers: "What did this step do, and what was the outcome?"

Use `description` for the action and `evaluation` for the computed result. The description is the "what", the evaluation is the "answer". This maps naturally to the UI: gray text explains, green text shows the result.

### Format Changes

#### Declarations

| Before | After (description) | After (evaluation) |
|---|---|---|
| `int y = 10` | `Declare int y` | `= 10` |
| `int[3] arr = {...}` | `Declare int[3] arr` | `= {1, 2, 3}` |
| `char *name = "hello"` | `Declare char *name` | `= "hello"` |
| `int sum = add(x, y)` | *(handled by function return step)* | |
| `struct Point p = {...}` | `Declare struct Point p` | `= {.x = 0, .y = 0}` |

**Why split:** Separating "Declare" from the value lets the user see the type info (gray) and the result (green) distinctly. The verb "Declare" is pedagogically clear — it maps to the C concept of declaration.

#### Assignments

| Before | After (description) | After (evaluation) |
|---|---|---|
| `x = x + 1` | `Set x = x + 1` | `→ 6` |
| `arr[0] = 99` | `Set arr[0] = 99` | |
| `*p = 42` | `Set *p = 42` | |
| `x = 100` | `Set x = 100` | |
| `c *= 2` | `Set c *= 2` | `→ 70` |

**Rules:**
- Use verb "Set" to distinguish from declarations
- When the RHS is an expression (not a literal), show the computed result in `evaluation` with `→`
- When the RHS is a literal, the description is self-explanatory — no evaluation needed
- Compound operators (`+=`, `*=`, etc.) always get evaluation since the result isn't obvious

#### Increment/Decrement

| Before | After (description) | After (evaluation) |
|---|---|---|
| `i++` | `i++` | `→ i = 1` |
| `++a` | `++a` | `→ a = 6` |
| `--count` | `--count` | `→ count = 4` |

**Why:** The expression form is already clear. Adding evaluation shows the result.

#### Function Calls

| Before | After (description) | After (evaluation) |
|---|---|---|
| `Call add(a, b) — push stack frame` | `Call add(a, b)` | |
| `add() returns 15, assign to sum` | `Return from add()` | `→ sum = 15` |
| `add() returns 15` (no assign) | `Return from add()` | `→ 15` |
| `return 15` | `return 15` | |
| `return 0` | `return 0` | |

**Changes:**
- Drop "— push stack frame" (implementation detail, not pedagogical)
- Restructure return: "Return from X()" is the action, the value/assignment is the result
- Keep `return N` as-is for in-function returns — it matches the C keyword

#### Heap Operations

| Before | After (description) | After (evaluation) |
|---|---|---|
| `malloc(sizeof(int)) — allocate 4 bytes` | `Allocate 4 bytes with malloc` | `→ p = 0x55A00000` |
| `calloc(5, sizeof(int)) — allocate 20 bytes` | `Allocate 20 bytes with calloc` | `→ arr = 0x55A00000` |
| `free(p) — deallocate memory` | `Free memory at p` | |

**Changes:**
- Lead with the action verb ("Allocate", "Free")
- Show the resulting pointer value in evaluation
- Drop the redundant "— allocate/deallocate" suffix

#### Control Flow — Loops

| Before | After (description) | After (evaluation) |
|---|---|---|
| `for: int i = 0` | `for: init int i = 0` | |
| `for: check i < 3 → true` | `for: check i < 3` | `→ true, continue` |
| `for: check i < 3 → false, exit loop` | `for: check i < 3` | `→ false, exit loop` |
| `for: i++ → i = 1` | `for: update i++` | `→ i = 1` |
| `while: check y > 7 → true` | `while: check y > 7` | `→ true, continue` |
| `while: y > 7 → false, exit` | `while: check y > 7` | `→ false, exit loop` |
| `do-while: check x < 30 → true` | `do-while: check x < 30` | `→ true, continue` |
| `do-while: x < 30 → false, exit` | `do-while: check x < 30` | `→ false, exit loop` |
| `Enter while loop` | `Enter while loop` | |
| `Enter do-while loop` | `Enter do-while loop` | |
| `for: init` (no init expr) | `for: init (empty)` | |

**Key change:** Move the condition result (`→ true/false`) into `evaluation`. This uses the green color to highlight the boolean outcome, which is the most important information for understanding control flow. Add "continue" for clarity on true conditions.

#### Control Flow — Branching

| Before | After (description) | After (evaluation) |
|---|---|---|
| `if: sum > 10 → true` | `if: check sum > 10` | `→ true, take if-branch` |
| `if: sum > 10 → false` | `if: check sum > 10` | `→ false, take else-branch` |
| `if: x > 5 → false` (no else) | `if: check x > 5` | `→ false, skip` |
| `switch: x = 3` | `switch on x` | `→ 3` |
| `Enter block scope` | `Enter block scope` | |
| `Exit block scope` | `Exit block scope` | |
| `break` | `break` | |
| `continue` | `continue` | |

**Changes:** Add "check" keyword for consistency with loops. Move the result to evaluation. The branch outcome ("take if-branch", "skip") is pedagogically valuable.

#### Stdlib Calls

| Before | After (description) | After (evaluation) |
|---|---|---|
| `printf("sum=%d", sum)` | `printf("sum=%d", sum)` | |
| `sprintf(buf, ...) — write "dist=500"` | `sprintf(buf, ...)` | `→ "dist=500"` |
| `strlen(s)` | `strlen(s)` | `→ 5` |
| `strcpy(dest, src)` | `strcpy(dest, src)` | |

**Changes:** Move sprintf result to evaluation. Stdlib calls that return used values should show result in evaluation.

#### Entry/Exit

| Before | After |
|---|---|
| `Enter main()` | `Enter main()` (unchanged) |

### What Stays the Same

- `Enter main()` — already clear
- `break`, `continue` — C keywords, self-explanatory
- `return N` — maps directly to C code
- The `subStep` flag on steps
- Column ranges for sub-line highlighting
- All op generation (this is description-only, no op changes)

## Files

### Modify
| File | What changes | Why |
|---|---|---|
| `src/lib/interpreter/handlers/statements.ts` | Update `formatDeclDescription`, `formatAssignDesc`, `executeCallStatement`, `executeMallocDecl`, `executeMallocAssign`, `executeFreeCall`, `executeReturn`, `executeExpressionStatement`, `callFunction` | All description generation for statements |
| `src/lib/interpreter/handlers/control-flow.ts` | Update `executeIf`, `executeFor`, `executeWhile`, `executeDoWhile`, `executeSwitch`, `executeBlock` | All description generation for control flow |
| `src/lib/interpreter/interpreter.ts` | Update `break`/`continue` descriptions (already fine), ensure `Enter main()` unchanged | Entry point descriptions |
| `src/lib/interpreter/value-correctness.test.ts` | Update all description assertions | Tests that match on specific description strings |
| `src/lib/interpreter/manual-programs.test.ts` | Update description assertions | Tests that match on description content |
| `src/lib/interpreter/interpreter.test.ts` | Update description assertions | Tests that match on description content |

### Create
None.

## Steps

### Step 1: Update declaration descriptions
- **What:** Change `formatDeclDescription` and string literal/struct/array declaration sites to use `Declare {type} {name}` in description and `= {value}` in evaluation
- **Files:** `statements.ts`
- **Depends on:** nothing
- **Verification:** `npm test` — fix failing description assertions in test files

### Step 2: Update assignment descriptions
- **What:** Change `formatAssignDesc` and assignment sites to use `Set {target} = {expr}` and add `→ {result}` evaluation when RHS is computed
- **Files:** `statements.ts`
- **Depends on:** nothing
- **Verification:** `npm test`

### Step 3: Update increment/decrement descriptions
- **What:** Add evaluation field `→ {name} = {newVal}` to unary inc/dec in `executeExpressionStatement`
- **Files:** `statements.ts`
- **Depends on:** nothing
- **Verification:** `npm test`

### Step 4: Update function call/return descriptions
- **What:** Simplify call to `Call {name}({params})`, restructure return to `Return from {name}()` with evaluation `→ {var} = {val}` or `→ {val}`
- **Files:** `statements.ts` (callFunction, executeReturn)
- **Depends on:** nothing
- **Verification:** `npm test`

### Step 5: Update heap operation descriptions
- **What:** Change malloc/calloc to `Allocate N bytes with {allocator}` + evaluation `→ {var} = {addr}`. Change free to `Free memory at {var}`
- **Files:** `statements.ts` (executeMallocDecl, executeMallocAssign, executeFreeCall)
- **Depends on:** nothing
- **Verification:** `npm test`

### Step 6: Update loop descriptions
- **What:** Move condition results to evaluation field with `→ true, continue` / `→ false, exit loop`. Add "check" to while/do-while true conditions. Add "update" label to for updates
- **Files:** `control-flow.ts`
- **Depends on:** nothing
- **Verification:** `npm test`

### Step 7: Update if/switch descriptions
- **What:** Change if to `if: check {expr}` + evaluation `→ true/false, take if-branch/else-branch/skip`. Change switch to `switch on {expr}` + evaluation `→ {val}`
- **Files:** `control-flow.ts`
- **Depends on:** nothing
- **Verification:** `npm test`

### Step 8: Update stdlib descriptions
- **What:** Move sprintf result to evaluation. Keep printf/puts as-is
- **Files:** `statements.ts`
- **Depends on:** nothing
- **Verification:** `npm test`

### Step 9: Fix all test assertions
- **What:** Update description string assertions in value-correctness.test.ts, manual-programs.test.ts, interpreter.test.ts to match new formats
- **Files:** all test files
- **Depends on:** Steps 1-8
- **Verification:** `npm test` passes fully

### Step 10: Run full verification
- **What:** Run `npm test`, `npm run check`, `npm run build`. Manually verify with dump-program.test.ts that output reads well
- **Files:** none
- **Depends on:** Step 9
- **Verification:** All green

## Edge Cases

| Case | Expected behavior | How handled |
|---|---|---|
| Very long expressions in description | May wrap in UI — acceptable | No truncation; UI handles wrapping naturally |
| Assignment with literal RHS (e.g. `x = 5`) | No evaluation field needed | Only add evaluation when RHS is computed/non-obvious |
| Chained assignment `a = b = c = 0` | Each sub-assignment gets its own description | Existing chaining logic preserved |
| Function call with no assignment target | `Return from fn()` + `→ {val}` | Different format from assigned case |
| Void function call (printf) | No return step, just call description | Unchanged |
| for-loop with no init | `for: init (empty)` | Minor wording improvement |
| if with no else, condition false | `→ false, skip` | New wording |
| Compound assignment `x += 5` | `Set x += 5` + `→ 10` | Always shows evaluation since result is implicit |

## Verification

- [ ] `npm test` passes (all ~599 tests)
- [ ] `npm run check` passes
- [ ] `npm run build` succeeds
- [ ] dump-program.test.ts output is readable and accurate
- [ ] Line mode accumulation still reads naturally (multiple descriptions stacked)
- [ ] Sub-step mode descriptions are clear on their own

## Expected Output After Changes

Running the same test program should produce:
```
[ 0] L 7         | Enter main()
[ 1] L 8         | Declare int y                          eval: "= 10"
[ 2] L 9 col14-23| Call add(a, b)
[ 3] L 3         | return 15
[ 4] L 9         | Return from add()                      eval: "→ sum = 15"
[ 5] L11         | Declare int[3] arr                     eval: "= {1, 2, 3}"
[ 6] L12         | Set arr[0] = 99
[ 7] L14         | Allocate 4 bytes with malloc            eval: "→ p = 0x55A00000"
[ 8] L15         | Set *p = 42
[ 9] L16         | Free memory at p
[10] L18         | for: init int i = 0
[11] L18 [SUB]   | for: check i < 3                       eval: "→ true, continue"
[12] L19         | Set x = x + 1                          eval: "→ 6"
[13] L18 [SUB]   | for: update i++                        eval: "→ i = 1"
[20] L18         | for: check i < 3                       eval: "→ false, exit loop"
[21] L22 [SUB]   | while: check y > 7                     eval: "→ true, continue"
[27] L22         | while: check y > 7                     eval: "→ false, exit loop"
[28] L26         | if: check sum > 10                     eval: "→ true, take if-branch"
[29] L27         | Set x = 100
[30] L32         | return 0
```

## References

- [Architecture: Data Model](../architecture.md#data-model)
- [Op generation requirements](../research/op-generation-requirements.md) — description/evaluation contract
- `src/routes/+page.svelte` lines 181-199, 336-349 — UI rendering of descriptions
