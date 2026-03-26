---
title: Control Flow Sub-Steps for while/do-while/if-else
type: feat
status: completed
date: 2026-03-26
---

# Control Flow Sub-Steps for while/do-while/if-else

## Context

For-loops have rich sub-step visualization: `"for: check i < 5 → true"`, `"for: i++ → i = 1"`. But while, do-while, and if/else evaluate their conditions silently — no step is emitted for the condition check. This makes stepping through these constructs less informative than for-loops.

## Design

Add condition-check sub-steps to while, do-while, and if/else, matching the for-loop pattern. Also store column positions for condition highlighting in the parser.

**Sub-step pattern (from for-loop):**
- Condition true: sub-step with description `"while: check <expr> → true"`
- Condition false/exit: regular step with description `"while: <expr> → false, exit"`
- if/else: sub-step with description `"if: check <expr> → true/false"`

**Key design decisions:**
- if/else condition check is a **sub-step** (hidden in line mode) since the branch body is the main step
- while/do-while condition true is a **sub-step** (same as for-loop check)
- while/do-while condition false is a **regular step** (same as for-loop exit)
- Column highlighting on the condition expression for all three

## Files

### Modify
| File | What changes | Why |
|------|-------------|-----|
| `src/lib/interpreter/parser.ts` | Store `condColStart`/`condColEnd` on while, do-while, if AST nodes | Column highlighting |
| `src/lib/interpreter/interpreter.ts` | Add sub-steps to `executeWhile`, `executeDoWhile`, `executeIf` | Core feature |
| `src/lib/interpreter/value-correctness.test.ts` | Add tests for new sub-steps | Verification |

## Steps

### Step 1: Parser — store condition columns
- **What:** Add `condColStart`/`condColEnd` to while_statement, do_while_statement, if_statement AST nodes
- **Files:** `parser.ts`
- **Verification:** Parser tests still pass

### Step 2: While-loop sub-steps
- **What:** In `executeWhile`, emit sub-step `"while: check <expr> → true"` when condition is true. Change existing false exit to include expression text.
- **Files:** `interpreter.ts`
- **Pattern:**
  ```
  while (n > 0):
    Step: "while: check n > 0 → true" (sub-step)
    Step: "sum += n"
    Step: "n--"
    Step: "while: check n > 0 → true" (sub-step)
    ...
    Step: "while: n > 0 → false, exit"
  ```
- **Verification:** `npm test`

### Step 3: Do-while sub-steps
- **What:** In `executeDoWhile`, emit sub-step `"do-while: check <expr> → true"` after body when condition is true. Change false exit to include expression text.
- **Files:** `interpreter.ts`
- **Pattern:**
  ```
  do { x *= 2; } while (x < 100):
    Step: "x = x * 2"
    Step: "do-while: check x < 100 → true" (sub-step)
    ...
    Step: "x = x * 2"
    Step: "do-while: x < 100 → false, exit"
  ```
- **Verification:** `npm test`

### Step 4: If/else condition sub-step
- **What:** In `executeIf`, emit sub-step `"if: check <expr> → true/false"` before executing the branch.
- **Files:** `interpreter.ts`
- **Pattern:**
  ```
  if (x > 5):
    Step: "if: check x > 5 → true" (sub-step, shares with branch body)
    Step: "y = 1"
  ```
- **Verification:** `npm test`

### Step 5: Tests
- **What:** Add tests verifying sub-step descriptions and subStep flags for while, do-while, if/else
- **Files:** `value-correctness.test.ts`
- **Tests:**
  - while-loop has "while: check" sub-steps per iteration
  - while-loop exit step has condition text
  - do-while has "do-while: check" sub-steps
  - if/else has "if: check" sub-step before branch
  - Sub-steps have `subStep: true` flag
  - Column ranges present on condition sub-steps
- **Verification:** `npm test`, step-dump inspection

## Edge Cases
| Case | Expected behavior | How handled |
|------|-------------------|-------------|
| while (1) infinite loop | Sub-steps still emit, step limit breaks | Existing maxSteps guard |
| if without else, condition false | Sub-step shows "→ false", no branch executes | Skip branch, emit sub-step |
| Empty while body | Condition sub-steps still emit | Body execution is separate |
| Nested if inside while | Each gets own sub-steps | Independent execution |

## Verification
- [ ] `npm test` passes
- [ ] `npm run build` succeeds
- [ ] while-loop shows "check → true" sub-steps
- [ ] do-while shows condition check after body
- [ ] if/else shows condition evaluation sub-step
- [ ] All sub-steps have `subStep: true` flag
- [ ] Existing for-loop sub-steps unchanged
