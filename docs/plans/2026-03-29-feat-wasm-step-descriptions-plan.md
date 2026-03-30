---
title: Step Descriptions for WASM Backend
type: feat
status: completed
date: 2026-03-29
---

# Step Descriptions for WASM Backend

## Context

The interpreter produces human-readable step descriptions like "Declare int x" (eval: `= 5`), "Set x = 42", "return 0", etc. The WASM backend produces steps with only `location` and `ops` — no `description` or `evaluation`. The UI renders these as blank lines in the step description panel.

## Design

The **transformer** already walks the entire CST and knows every statement type. It generates a `Map<number, StepDescription>` keyed by source line. After WASM execution, `finish()` attaches descriptions to steps by line, then derives runtime evaluations from ops.

---

## Step 1: Add types and thread descriptionMap through transformer

### Part A: New types and extended TransformResult

**File:** `transformer.ts` line 11–18

**Current:**
```typescript
export type StructField = { name: string; type: string };
export type StructRegistry = Map<string, StructField[]>;

export type TransformResult = {
	instrumented: string;
	errors: string[];
	structRegistry: StructRegistry;
};
```

**Change to:**
```typescript
export type StructField = { name: string; type: string };
export type StructRegistry = Map<string, StructField[]>;
export type StepDescription = { description: string };

export type TransformResult = {
	instrumented: string;
	errors: string[];
	structRegistry: StructRegistry;
	descriptionMap: Map<number, StepDescription>;
};
```

### Part B: Thread descriptionMap through walkNode and all instrument* functions

**File:** `transformer.ts`

Every `instrument*` function currently takes `(node, insertions, replacements)`. Add a `descriptionMap: Map<number, StepDescription>` parameter to each:

- `walkNode(node, insertions, replacements)` → `walkNode(node, insertions, replacements, descriptionMap)`
- `instrumentFunction(node, insertions, replacements)` → `instrumentFunction(node, insertions, replacements, descriptionMap)`
- `instrumentDeclaration(node, insertions, replacements)` → `instrumentDeclaration(node, insertions, replacements, descriptionMap)`
- `instrumentExpressionStatement(node, insertions, replacements)` → `instrumentExpressionStatement(node, insertions, replacements, descriptionMap)`
- `instrumentReturn(node, insertions)` → `instrumentReturn(node, insertions, descriptionMap)`
- `instrumentFor(node, insertions, replacements)` → `instrumentFor(node, insertions, replacements, descriptionMap)`
- `instrumentLoop(node, insertions, replacements)` → `instrumentLoop(node, insertions, replacements, descriptionMap)`
- `instrumentIf(node, insertions, replacements)` → `instrumentIf(node, insertions, replacements, descriptionMap)`
- `instrumentSwitch(node, insertions, replacements)` → `instrumentSwitch(node, insertions, replacements, descriptionMap)`
- `instrumentBlock(node, insertions, replacements, line)` → `instrumentBlock(node, insertions, replacements, line, descriptionMap)`

### Part C: Create and populate descriptionMap in transformSource

**File:** `transformer.ts` — `transformSource` (line 38–67)

**Current:**
```typescript
const insertions: Insertion[] = [];
const replacements: Replacement[] = [];

// Extract struct definitions for the type registry
const structRegistry = extractStructDefinitions(tree.rootNode);

// Walk the CST and collect instrumentation points
walkNode(tree.rootNode, insertions, replacements);
```

**Change to:**
```typescript
const insertions: Insertion[] = [];
const replacements: Replacement[] = [];
const descriptionMap = new Map<number, StepDescription>();

// Extract struct definitions for the type registry
const structRegistry = extractStructDefinitions(tree.rootNode);

// Walk the CST and collect instrumentation points + descriptions
walkNode(tree.rootNode, insertions, replacements, descriptionMap);
```

**Also update the return statements** (3 places) to include `descriptionMap`:
```typescript
return { instrumented: result, errors: [], structRegistry, descriptionMap };
```

And the error returns:
```typescript
return { instrumented: source, errors: [...], structRegistry: new Map(), descriptionMap: new Map() };
```

---

## Step 2: Generate descriptions in each instrument* function

### instrumentFunction — `Enter funcName(params)`

**Add after `const line = node.startPosition.row + 1;` (line 180):**
```typescript
const paramStr = params.map(p => p.name).join(', ');
descriptionMap.set(line, { description: `Enter ${funcName}(${paramStr})` });
```

### instrumentDeclaration — `Declare type name`

**Add after `const line = node.startPosition.row + 1;` (line 231):**
```typescript
const names = declarators.map(d => d.name).join(', ');
descriptionMap.set(line, { description: `Declare ${typeStr} ${names}` });
```

### instrumentExpressionStatement — `Set ...` / call text / `Set i++`

**Add description generation for each branch:**

Assignment branch (after `findAndRewriteCalls`):
```typescript
const stmtText = expr.text.replace(/;$/, '');
descriptionMap.set(line, { description: `Set ${stmtText}` });
```

sprintf branch:
```typescript
descriptionMap.set(line, { description: expr.text.replace(/;$/, '') });
```

Call expression branch (after `rewriteCallIfNeeded`):
```typescript
descriptionMap.set(line, { description: expr.text.replace(/;$/, '') });
```

Update expression branch (`i++`/`++i`):
```typescript
descriptionMap.set(line, { description: `Set ${expr.text}` });
```

Comma expression branch:
```typescript
descriptionMap.set(line, { description: expr.text.replace(/;$/, '') });
```

Default branch:
```typescript
descriptionMap.set(line, { description: expr.text.replace(/;$/, '') });
```

### instrumentReturn — `return expr`

**Add after `const line = ...`:**
```typescript
// Get the return expression text (skip "return " and ";")
const retExpr = node.text.replace(/^return\s*/, '').replace(/;$/, '').trim();
descriptionMap.set(line, { description: retExpr ? `return ${retExpr}` : 'return' });
```

### instrumentFor — loop header

**Add after `const line = ...` (line 377):**
```typescript
const condNode = node.childForFieldName('condition');
const updateNode = node.childForFieldName('update');
const initText = initializer?.text ?? '';
const condText = condNode?.text ?? '';
const updateText = updateNode?.text ?? '';
descriptionMap.set(line, { description: `for (${initText} ${condText}; ${updateText})` });
```

### instrumentLoop — `while (cond)` / `do { } while (cond)`

**Add after `const line = ...` (line 421):**
```typescript
const condNode = node.childForFieldName('condition');
if (node.type === 'while_statement') {
	descriptionMap.set(line, { description: `while (${condNode?.text ?? ''})` });
} else {
	descriptionMap.set(line, { description: `do...while (${condNode?.text ?? ''})` });
}
```

### instrumentIf — `if (cond)` / `else`

**Add after `const line = ...` (line 451):**
```typescript
const condNode = node.childForFieldName('condition');
descriptionMap.set(line, { description: `if (${condNode?.text ?? ''})` });
```

For else clauses, add in the alternative handling:
```typescript
if (alternative) {
	const elseLine = alternative.startPosition.row + 1;
	descriptionMap.set(elseLine, { description: 'else' });
```

### instrumentSwitch — `case N:`

**Add in the case_statement loop:**
```typescript
descriptionMap.set(line, { description: child.text.split(':')[0].trim() });
// e.g., "case 3" or "default"
```

---

## Step 3: Pass descriptionMap through pipeline to OpCollector

### op-collector.ts — constructor and field

**Add field (after structRegistry):**
```typescript
private descriptionMap: Map<number, StepDescription>;
```

**Change constructor:**
```typescript
constructor(maxSteps: number, structRegistry?: StructRegistry, descriptionMap?: Map<number, StepDescription>) {
	this.maxSteps = maxSteps;
	this.structRegistry = structRegistry ?? new Map();
	this.descriptionMap = descriptionMap ?? new Map();
}
```

**Add import:**
```typescript
import type { StructRegistry, StepDescription } from './transformer';
```

### op-collector.ts — attach in finish()

**Add before `return { name, source, steps: this.steps };` in finish():**
```typescript
// Attach descriptions from transformer
this.attachDescriptions();
```

**New method:**
```typescript
private attachDescriptions(): void {
	for (const step of this.steps) {
		const desc = this.descriptionMap.get(step.location.line);
		if (desc) {
			step.description = desc.description;
		}

		// Derive runtime evaluation from ops
		if (step.description?.startsWith('Declare ')) {
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

		if (step.description?.startsWith('Set ')) {
			// Find the first setValue op (the primary target variable)
			const setOp = step.ops.find(op => op.op === 'setValue');
			if (setOp && setOp.op === 'setValue' && setOp.value) {
				step.evaluation = `→ ${setOp.value}`;
			}
		}

		if (step.ioEvents?.length) {
			const writes = step.ioEvents.filter(e => e.kind === 'write');
			if (writes.length > 0) {
				const output = writes.map(e => e.text).join('');
				const escaped = output.replace(/\n/g, '\\n');
				step.evaluation = `→ "${escaped}"`;
			}
		}
	}
}
```

### runtime.ts — pass descriptionMap

**Change constructor call (line ~33):**
```typescript
const collector = new OpCollector(maxSteps, structRegistry, descriptionMap);
```

**Add parameter to executeWasm:**
```typescript
export async function executeWasm(
	binary: Uint8Array,
	name: string,
	source: string,
	maxSteps: number,
	stdin?: string,
	structRegistry?: StructRegistry,
	descriptionMap?: Map<number, StepDescription>,
): Promise<ExecuteResult> {
```

**Add import:**
```typescript
import type { StructRegistry, StepDescription } from './transformer';
```

### service.ts — pass descriptionMap

**In both `interpretSource` and `interpretSourceInteractive`:**

Destructure `descriptionMap` from `transformSource`:
```typescript
const { instrumented, errors: transformErrors, structRegistry, descriptionMap } = transformSource(parser, source);
```

Pass through to `executeWasm`:
```typescript
const { program, errors: runtimeErrors } = await executeWasm(
	wasm, 'user_program', source, MAX_STEPS, stdin, structRegistry, descriptionMap,
);
```

### integration.test.ts and diagnostic.test.ts — update runPipeline

Destructure `descriptionMap` and pass to `OpCollector`:
```typescript
const { instrumented, errors: tErrors, structRegistry, descriptionMap } = transformSource(parser, source);
// ...
const collector = new OpCollector(500, structRegistry, descriptionMap);
```

---

## Step 4: Tests

Add description assertions to 3 existing integration tests:

**Minimal scalar test:**
```typescript
expect(r.program.steps[0].description).toBe('Enter main()');
expect(r.program.steps[1].description).toBe('Declare int x');
expect(r.program.steps[1].evaluation).toBe('= 5');
```

**Assignment test:**
```typescript
const setStep = r.program.steps.find(s => s.description?.startsWith('Set '));
expect(setStep).toBeDefined();
expect(setStep!.evaluation).toMatch(/→ /);
```

**Return test:**
```typescript
const retStep = r.program.steps.find(s => s.description?.startsWith('return'));
expect(retStep).toBeDefined();
```

---

## Edge Cases

| Case | Expected behavior | How handled |
|------|-------------------|-------------|
| Empty steps (condition only) | Description from if/while/for header | instrument* sets description for the control flow line |
| Multiple steps at same line | All share same description from map | Map lookup by line; duplicates are fine |
| `for` loop re-check on each iteration | Same description each time | Same line → same map entry |
| `else if` chains | Each `if` gets its own description | instrumentIf recurses, each gets own line |
| `switch/case` | "case 3" / "default" | child.text split on `:` |
| Steps with no original source line | No description | descriptionMap only covers instrumented lines |
| `expr.text` includes braces from compact if | Trim trailing `{` | `.replace(/\s*\{?\s*$/, '')` for control flow |

## Verification Checklist

- [ ] `npm test` passes
- [ ] `npm run build` succeeds
- [ ] Declarations show "Declare int x" with eval "= 5"
- [ ] Assignments show "Set x = 42" with eval "→ 42"
- [ ] Function entries show "Enter main()" / "Enter factorial(n)"
- [ ] Returns show "return 0" or "return x + 1"
- [ ] Control flow shows "if (x > 5)", "while (n > 0)", "for (...)"
- [ ] printf shows call text with eval "→ output"
- [ ] Uninitialized vars show eval "= ? (uninitialized)"
- [ ] Structs/arrays show eval "= {...}"
- [ ] Empty steps (conditions) have descriptions
- [ ] Browser: step descriptions visible in description panel

## References

- [Interpreter description format](../../src/lib/interpreter/handlers/statements.ts) — formatDeclDescription, formatAssignDesc
- [UI rendering](../../src/routes/+page.svelte) — stepDescriptions derived, lines 477-492, 774-784
- [ProgramStep type](../../src/lib/api/types.ts) — description, evaluation fields
