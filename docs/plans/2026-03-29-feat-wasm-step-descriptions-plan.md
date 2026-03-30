---
title: Step Descriptions for WASM Backend
type: feat
status: active
date: 2026-03-29
---

# Step Descriptions for WASM Backend

## Context

The interpreter produces human-readable step descriptions like "Declare int x" (eval: `= 5`), "Set x = 42", "return 0", etc. The WASM backend produces steps with only `location` and `ops` — no `description` or `evaluation`. The UI renders these as blank lines in the step description panel.

## Design

### Where to generate descriptions

The **transformer** already walks the entire CST and knows every statement type, variable name, type string, and expression text. It can generate a description for each instrumented line as a side output — a `Map<number, StepDescription>` keyed by source line number.

After WASM execution, descriptions are attached to steps by matching `step.location.line` → description map.

**Why not at runtime:** The op-collector sees raw memory addresses and string pointers — it would need to reconstruct statement semantics from low-level callbacks, which is fragile and duplicates the transformer's work.

**Why not post-processing with a second parse:** The transformer already parses. Adding another pass is wasteful.

### Description format

Match the interpreter's conventions exactly:

| Statement | description | evaluation |
|-----------|------------|------------|
| `int x = 5;` | `Declare int x` | `= 5` (from runtime value) |
| `int x;` | `Declare int x` | `= ?` (uninitialized) |
| `x = 42;` | `Set x = 42` | (none, or `→ 42` for compound ops) |
| `x += 5;` | `Set x += 5` | |
| `*p = 42;` | `Set *p = 42` | |
| `p->x = 10;` | `Set p->x = 10` | |
| `arr[i] = val;` | `Set arr[i] = val` | |
| `a = b = c = 42;` | `Set a = b = c = 42` | |
| `return 0;` | `return 0` | |
| `return x + 1;` | `return x + 1` | |
| `printf("...", x);` | `printf("...", x)` | (eval from IO events) |
| `scanf(...)` | `scanf(...)` | |
| `malloc(size)` | `malloc(size)` | |
| `free(p)` | `free(p)` | |
| `i++` / `++i` | `Set i++` / `Set ++i` | |
| `if (cond)` | `if (cond)` | |
| `while (cond)` | `while (cond)` | |
| `for (init; cond; update)` | `for (init; cond; update)` | |
| function entry | `Enter funcName(args)` | |
| scope cleanup | `Leave funcName` | |

### Runtime evaluation strings

Static descriptions come from the transformer. **Runtime evaluations** (the green `= 5` part) come from the step's ops at attachment time:

- For declarations: find the `addEntry` op → use its `value` field
- For assignments: find the `setValue` op → use its `value` field
- For function calls with IO: find `ioEvents` → use `text` for printf output
- For returns: read the return expression's evaluated value from the removal step

This is a post-processing pass over the finished Program.

---

## Files

### Modify

| File | What changes | Why |
|------|-------------|-----|
| `src/lib/wasm-backend/transformer.ts` | Generate `descriptionMap` as part of `TransformResult` | Source of descriptions |
| `src/lib/wasm-backend/op-collector.ts` | Accept `descriptionMap`, attach to steps in `finish()` | Connect descriptions to steps |
| `src/lib/wasm-backend/runtime.ts` | Pass `descriptionMap` through | Plumbing |
| `src/lib/wasm-backend/service.ts` | Pass `descriptionMap` through | Plumbing |
| `src/lib/wasm-backend/integration.test.ts` | Update pipeline, add description assertions | Verify descriptions |
| `src/lib/wasm-backend/diagnostic.test.ts` | Update pipeline | Plumbing |

---

## Steps

### Step 1: Description generation in transformer

**What:** As the transformer walks the CST, build a `Map<number, { description: string; evaluation?: string }>` with one entry per instrumented line. Add this to `TransformResult`.

**New type:**
```typescript
export type StepDescription = { description: string; evaluation?: string };
```

**Extended TransformResult:**
```typescript
export type TransformResult = {
    instrumented: string;
    errors: string[];
    structRegistry: StructRegistry;
    descriptionMap: Map<number, StepDescription>;
};
```

**Generate descriptions in each instrument* function:**

In `instrumentFunction`:
```typescript
const line = node.startPosition.row + 1;
descriptionMap.set(line, { description: `Enter ${funcName}(${params.map(p => p.name).join(', ')})` });
```

In `instrumentDeclaration`:
```typescript
const names = declarators.map(d => d.name).join(', ');
descriptionMap.set(line, { description: `Declare ${typeStr} ${names}` });
```

In `instrumentExpressionStatement` (assignment branch):
```typescript
// For x = expr:
descriptionMap.set(line, { description: `Set ${node.child(0)!.text}` });
```

Actually — the simplest robust approach: use the **trimmed source line** as the description base, then classify it:

```typescript
function generateDescription(node: SyntaxNode, source: string): StepDescription {
    const line = node.startPosition.row + 1;
    const lineText = source.split('\n')[line - 1]?.trim() ?? '';

    // Classify by statement type
    if (node.type === 'declaration') {
        const typeStr = getDeclarationType(node)?.trim() ?? '';
        const names = getDeclarators(node).map(d => d.name).join(', ');
        return { description: `Declare ${typeStr} ${names}` };
    }
    if (node.type === 'return_statement') {
        return { description: lineText };  // "return 0" or "return x + 1"
    }
    if (node.type === 'expression_statement') {
        const expr = node.child(0);
        if (expr?.type === 'assignment_expression') {
            return { description: `Set ${lineText.replace(/;$/, '')}` };
        }
        if (expr?.type === 'call_expression') {
            return { description: lineText.replace(/;$/, '') };
        }
        if (expr?.type === 'update_expression') {
            return { description: `Set ${lineText.replace(/;$/, '')}` };
        }
    }
    // Fallback: use the source line itself
    return { description: lineText.replace(/;$/, '') };
}
```

For control flow lines (if, while, for), the description is the condition/header:

```typescript
// instrumentIf / instrumentLoop / instrumentFor add the line to descriptionMap
descriptionMap.set(line, { description: lineText.replace(/\s*\{?\s*$/, '') });
// e.g., "if (x > 5)" or "while (n > 0)" or "for (int i = 0; i < 10; i++)"
```

**Files:** `transformer.ts`
**Depends on:** nothing
**Verification:** Unit test: transform a simple program, check descriptionMap has correct entries.

### Step 2: Pass descriptionMap through pipeline

**What:** Add `descriptionMap` to `TransformResult`, pass it through `executeWasm` → `OpCollector` → `finish()`.

In `OpCollector`:
```typescript
constructor(maxSteps: number, structRegistry?: StructRegistry, descriptionMap?: Map<number, StepDescription>) {
    this.descriptionMap = descriptionMap ?? new Map();
}
```

In `finish()`, after building all steps, attach descriptions:
```typescript
for (const step of this.steps) {
    const desc = this.descriptionMap.get(step.location.line);
    if (desc) {
        step.description = desc.description;
        // Don't set evaluation yet — that comes from runtime values
    }
}
```

**Files:** `op-collector.ts`, `runtime.ts`, `service.ts`, `integration.test.ts`, `diagnostic.test.ts`
**Depends on:** Step 1
**Verification:** Integration test: run a program, check steps have descriptions.

### Step 3: Runtime evaluation strings

**What:** After attaching static descriptions, derive evaluation strings from ops:

```typescript
for (const step of this.steps) {
    if (!step.description) continue;

    // Declarations: find addEntry op, use its value
    if (step.description.startsWith('Declare ')) {
        const addOp = step.ops.find(op => op.op === 'addEntry' && op.parentId !== null);
        if (addOp && addOp.op === 'addEntry') {
            const val = addOp.entry.value;
            if (val === '?') {
                step.evaluation = '= ? (uninitialized)';
            } else if (val === '' || addOp.entry.children) {
                step.evaluation = '= {...}';
            } else {
                step.evaluation = `= ${val}`;
            }
        }
    }

    // Assignments: find setValue op for the target variable
    if (step.description.startsWith('Set ')) {
        const setOp = step.ops.find(op => op.op === 'setValue');
        if (setOp && setOp.op === 'setValue' && setOp.value) {
            step.evaluation = `→ ${setOp.value}`;
        }
    }

    // IO: format output from ioEvents
    if (step.ioEvents?.length) {
        const writes = step.ioEvents.filter(e => e.kind === 'write');
        if (writes.length > 0) {
            const output = writes.map(e => e.text).join('');
            step.evaluation = `→ "${output.replace(/\n$/, '\\n')}"`;
        }
    }
}
```

**Files:** `op-collector.ts`
**Depends on:** Step 2
**Verification:** Integration test: check evaluation strings match expected values.

### Step 4: Scope entry/exit descriptions

**What:** Add descriptions for function scope push/pop:
- `onPushScope`: record `Enter funcName` for the step's line
- `onPopScope`: record `Leave funcName` for the step's line

Since scope push/pop are ops within a step (not their own steps), we handle this differently. The scope push happens in the same step as the function entry. The description from Step 1 (`Enter funcName(...)`) already covers this.

For `return` statements, the transformer generates `return expr` description. The scope pop is part of the same step and doesn't need its own description.

**Files:** `transformer.ts` (already handled in Step 1)
**Depends on:** Step 1

### Step 5: Tests and verification

**What:**
1. Add description assertions to key integration tests
2. Run diagnostic suite to verify descriptions appear in dumps
3. Manual browser verification

**Verification assertions:**
```typescript
// Basic declaration
expect(step.description).toBe('Declare int x');
expect(step.evaluation).toBe('= 5');

// Assignment
expect(step.description).toBe('Set x = 10');

// Function entry
expect(step.description).toBe('Enter main()');

// Return
expect(step.description).toBe('return 0');
```

**Files:** `integration.test.ts`
**Depends on:** Steps 1-4

---

## Edge Cases

| Case | Expected behavior | How handled |
|------|-------------------|-------------|
| Empty steps (condition check only) | Description from control flow header | `instrumentIf/Loop/For` adds description |
| Multiple steps at same line | All share same description | Map lookup by line; ok to share |
| Steps from instrumented code (not in original source) | No description | descriptionMap only has original source lines |
| Sub-steps (loop increment, condition re-check) | Description of the loop header | Same line → same description |
| Multi-line statements | Description from first line | `node.startPosition.row + 1` |
| Macro-expanded or generated code | Fallback to source text | Source line trim as fallback |

## Verification Checklist

- [ ] `npm test` passes
- [ ] `npm run build` succeeds
- [ ] Declarations show "Declare int x" with eval "= 5"
- [ ] Assignments show "Set x = 42" with eval "→ 42"
- [ ] Function entries show "Enter main()" / "Enter factorial(n)"
- [ ] Returns show "return 0" or "return x + 1"
- [ ] Control flow shows "if (x > 5)", "while (n > 0)", "for (...)"
- [ ] printf shows call text with eval "→ output"
- [ ] malloc/free show call text
- [ ] Uninitialized vars show eval "= ? (uninitialized)"
- [ ] Structs/arrays show eval "= {...}"
- [ ] Empty steps (conditions) have descriptions

## References

- [Interpreter description format](../../src/lib/interpreter/handlers/statements.ts) — formatDeclDescription, formatAssignDesc
- [UI rendering](../../src/routes/+page.svelte) — stepDescriptions derived, lines 477-492, 774-784
- [ProgramStep type](../../src/lib/api/types.ts) — description, evaluation fields
