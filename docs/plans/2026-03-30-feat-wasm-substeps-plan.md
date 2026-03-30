---
title: Substeps for WASM Backend
type: feat
status: active
date: 2026-03-30
---

# Substeps for WASM Backend

## Context

The interpreter marks loop condition checks and increments as `subStep: true`. In line mode (default), these are hidden — users only see body/anchor steps. In sub-step mode, users can step through every condition check and increment. The WASM backend doesn't mark any steps as substeps, so all loop control steps are always visible.

## Design

Add `__crow_substep(line)` — identical to `__crow_step(line)` but sets `subStep: true` on the resulting step. Use it in `instrumentFor` and `instrumentLoop` for condition/increment steps inside loop bodies.

**What gets marked as substep:**
- For-loop: the step inside the body that declares/re-declares the loop var and evaluates the condition
- While/do-while: the step inside the body that evaluates the condition
- NOT if-statements — the condition step is a meaningful anchor

**What stays as anchor (normal step):**
- Loop body statements
- Function entries/returns
- Declarations and assignments
- If/else condition checks
- Switch/case

**Validation:** The anchor rule requires at least one non-substep per source line. For a for-loop with body on a different line, this is satisfied — the body step on its line is an anchor. For compact loops like `for (...) x++;` (single line), the body step serves as anchor.

---

## Step 1: Add `__crow_substep` callback

### __crow.h

```c
void __crow_substep(int line);
```

### op-collector.ts — `onSubStep`

```typescript
onSubStep(line: number): void {
    if (++this.stepCount > this.maxSteps) {
        throw new StepLimitExceeded();
    }
    this.currentLine = line;

    // Same dedup as onStep
    const prev = this.steps[this.steps.length - 1];
    if (
        prev &&
        prev.location.line === line &&
        prev.ops.length === 0 &&
        !prev.ioEvents &&
        this.currentOps.length === 0 &&
        this.currentIoEvents.length === 0
    ) {
        return;
    }

    this.steps.push({
        location: { line: this.currentLine },
        ops: this.currentOps,
        ioEvents: this.currentIoEvents.length > 0 ? [...this.currentIoEvents] : undefined,
        subStep: true,
    });
    if (this.pendingEval !== null) {
        this.steps[this.steps.length - 1].evaluation = `→ ${this.pendingEval}`;
        this.pendingEval = null;
    }
    this.currentOps = [];
    this.currentIoEvents = [];
}
```

### runtime.ts — add binding

```typescript
__crow_substep: (line: number) => collector.onSubStep(line),
```

Same in test files.

---

## Step 2: Use `__crow_substep` in transformer

### instrumentFor — condition/decl step becomes substep

**Current (line ~454):**
```typescript
text += `\n\t__crow_step(${line});`;
```

**Change to:**
```typescript
text += `\n\t__crow_substep(${line});`;
```

This marks the for-loop's initialization/condition step as a substep. The body steps (from recursing into body statements) remain as `__crow_step`.

### instrumentLoop — condition step becomes substep

**Current (line ~495):**
```typescript
text += `\n\t__crow_step(${line});`;
```

**Change to:**
```typescript
text += `\n\t__crow_substep(${line});`;
```

### instrumentBlock — condition step for if stays as `__crow_step`

No change — if-condition steps are anchors, not substeps.

---

## Step 3: Description adjustments

Substeps should have descriptive labels matching the interpreter's format:

For-loop substeps get descriptions like:
- First iteration: `for: init i = 0` (or keep the existing `for (...)` description)
- Subsequent iterations: same `for (...)` description with `→ true` eval

While substeps:
- `while (cond)` with `→ true` eval (already implemented)

No changes needed — the existing descriptions and condition evals work for substeps.

---

## Step 4: Verification

1. `npm test` — all tests pass
2. In browser: line mode hides loop condition/increment steps
3. In browser: sub-step mode shows all steps including loop control
4. `validateProgram()` passes — anchor rule satisfied for all lines
5. Snapshots compound correctly — substep ops apply before next visible anchor

**Key test cases:**
- For-loop: body steps visible in line mode, condition steps hidden
- While-loop: body steps visible, condition checks hidden
- Nested loops: both levels have correct substep marking
- Compact single-line loop: anchor rule still satisfied

---

## Edge Cases

| Case | Expected behavior | How handled |
|------|-------------------|-------------|
| Compact `for (...) x++;` on one line | Body step is anchor on same line | Body step uses `__crow_step`, satisfying anchor rule |
| Empty loop body `while (x--) {}` | Only substeps on that line | The `__crow_substep` inside body is only step — may violate anchor rule. Add `__crow_step` after loop as fallback. |
| Nested for-loops | Inner and outer conditions are substeps | Each uses `__crow_substep` independently |
| `for (;;)` infinite loop (with break) | No condition to eval | `__crow_substep` still fires for the step, just no eval |

## Verification Checklist

- [ ] `npm test` passes
- [ ] `npm run build` succeeds
- [ ] For-loop condition steps hidden in line mode
- [ ] While-loop condition steps hidden in line mode
- [ ] Sub-step mode shows all steps
- [ ] Snapshots compound correctly across hidden substeps
- [ ] `validateProgram()` anchor rule passes for all 47 diagnostic programs

## References

- [ProgramStep type](../../src/lib/api/types.ts) — `subStep?: boolean`
- [Interpreter substep creation](../../src/lib/interpreter/handlers/control-flow.ts)
- [getVisibleIndices](../../src/lib/engine/navigation.ts) — filters substeps in line mode
- [Anchor rule validation](../../src/lib/engine/validate.ts)
