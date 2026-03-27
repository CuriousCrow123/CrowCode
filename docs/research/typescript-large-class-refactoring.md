# Large-Scale TypeScript Class Refactoring: Best Practices

Research date: 2026-03-26
Context: CrowCode interpreter.ts (1,812 lines, single Interpreter class) with 630 passing tests

---

## 1. God Class Decomposition Patterns

### The Core Decision: Functions vs. Strategy Pattern vs. Handler Map

For an interpreter with a `switch`-like dispatch over AST node types, there are three decomposition approaches. The right choice depends on whether behavior varies at runtime.

**Plain function extraction** is the right default for interpreter statement handlers. The Interpreter class has methods like `executeDeclaration`, `executeFor`, `executeWhile`, `executeAssignment` that each handle one AST node type. These are not interchangeable algorithms -- they are fixed dispatch targets. Extracting them to standalone functions (or small modules) is simpler than wrapping them in strategy classes.

**Strategy pattern** is overkill here. Strategy is for when you need to swap algorithms at runtime (e.g., different sorting strategies, different rendering backends). Statement execution in an interpreter is not polymorphic -- `executeFor` always does the same thing. Adding strategy classes would create indirection without benefit.

**Handler map pattern** (a record mapping node types to handler functions) is a middle ground worth considering for the dispatch layer:

```typescript
// Before: giant switch/if-else chain
private executeStatement(node: ASTNode): void {
    if (node.type === 'declaration') this.executeDeclaration(node);
    else if (node.type === 'for_statement') this.executeFor(node);
    // ... 15 more branches
}

// After: handler map with extracted modules
const statementHandlers: Record<string, StatementHandler> = {
    declaration: executeDeclaration,
    for_statement: executeFor,
    while_statement: executeWhile,
    // ...
};

private executeStatement(node: ASTNode): void {
    const handler = statementHandlers[node.type];
    if (handler) handler(this.ctx, node);
    else this.errors.push(`Unknown statement: ${node.type}`);
}
```

This is cleaner than a strategy pattern but gives you the modularity benefit of separate functions per node type.

### The TypeScript Compiler's Cautionary Tale

TypeScript's own `checker.ts` is a 44,932-line file with ~1,200 nested functions and ~450 closure variables. The team attempted a class refactoring (GitHub issue #17861) and discovered:

- Converting closure variables to class properties caused 16-24% slowdowns in check time
- Emit time increased 50-150%
- Ryan Cavanaugh (TS team) explained: bare-name variable lookups are "much faster than property accesses"

**Lesson for CrowCode**: At 1,812 lines with ~500 max steps, performance is not a concern. The checker.ts lesson applies to hot-path code processing millions of nodes. CrowCode's interpreter runs once per "Run" click on small programs. Prefer clarity over micro-optimization.

### Recommended Decomposition for interpreter.ts

Based on the method inventory, natural module boundaries exist:

| Module | Methods | Responsibility |
|--------|---------|---------------|
| `declarations.ts` | `executeDeclaration`, `evaluateCallForDecl`, `executeMallocDecl`, `executeStringLiteralDecl` | Variable declaration handling |
| `assignments.ts` | `executeAssignment`, `executeMallocAssign` | Assignment + heap assignment |
| `control-flow.ts` | `executeFor`, `executeWhile`, `executeDoWhile`, `executeSwitch`, `executeIf`, `executeBlock` | All control flow |
| `calls.ts` | `callFunction`, `executeCallStatement`, `executeFreeCall`, `executeReturn`, `executeUserFunctionCall` | Function call mechanics |
| `formatting.ts` | `formatValue`, `formatDeclDescription`, `formatAssignDesc`, `formatMallocArgs`, `formatPrintfDesc`, `describeExpr`, etc. | Description/display string generation |
| `interpreter.ts` | `interpretAST`, `executeStatement`, `executeStatements`, `detectLeaks` | Orchestration only |

The formatting functions (~140 lines) are the easiest extraction target -- they are pure functions with no side effects on interpreter state. Start there.

**Source**: Extract Class refactoring pattern (refactoring.guru), Crafting Interpreters architecture (craftinginterpreters.com)

---

## 2. State Unification Patterns

### The Problem: Parallel State Between Interpreter and Emitter

In CrowCode, two objects maintain related state that must stay in sync:
- **Environment** tracks runtime state (scopes, variables, addresses, heap blocks)
- **Emitter** tracks output state (scope stack for ops, variable-to-ID mapping, pointer-to-heap mapping)

When the interpreter calls `env.pushScope()`, it must also call `emitter.pushScope()`. When it calls `env.declareVariable()`, it must also call `emitter.emitAddVar()`. Forgetting either half creates bugs.

### Pattern 1: Facade / Unified API (Recommended)

Create a single API that coordinates both:

```typescript
// Before: caller must remember both
this.env.pushScope(name);
this.emitter.pushScope(scopeId, name, scopeInfo);

// After: single call handles coordination
this.runtime.pushScope(name, scopeId, scopeInfo);
// internally calls both env.pushScope() and emitter.pushScope()
```

This is the **Facade pattern** applied to parallel state. The runtime facade becomes the single entry point, and it is impossible to update one without the other.

**Tradeoff**: Adds a layer of indirection. But it eliminates an entire category of "forgot to sync" bugs.

### Pattern 2: Event-Driven Synchronization

The environment emits events, and the emitter subscribes:

```typescript
env.on('scopePushed', (name, depth) => {
    emitter.pushScope(scopeId, name, scopeInfo);
});
```

**Why this is worse for interpreters**: Event-driven sync introduces ordering ambiguity, makes debugging harder (stack traces cross event boundaries), and adds complexity for no runtime benefit. The interpreter already knows the exact sequence of operations. Use direct calls, not events.

### Pattern 3: Single Source of Truth (Ideal but Expensive)

Merge the two objects entirely. The environment owns all state -- runtime and output. The emitter becomes a pure function that reads environment state and produces ops.

```typescript
// Environment stores everything
env.pushScope(name, scopeId, scopeInfo);
// Emitter reads env state to produce ops
const ops = emitOpsFromState(env.currentScope, env.lastAction);
```

**Why this is expensive**: It requires redesigning both Environment and Emitter simultaneously. For CrowCode, Pattern 1 (Facade) achieves 80% of the benefit at 20% of the cost.

### What Crafting Interpreters Does

Bob Nystrom's Lox interpreter uses a mutable `environment` field on the Interpreter class rather than passing it as a parameter. He calls this "inelegant but simpler." The interpreter directly manipulates the environment, and the environment is the single source of truth for variable state. There is no separate "emitter" -- output is handled by visit methods directly.

**Lesson**: CrowCode's emitter exists because it produces `SnapshotOp`s (a concept Lox doesn't have). The emitter is a necessary additional concern, but the coordination pattern should be explicit, not implicit.

**Source**: Crafting Interpreters ch. 8 (craftinginterpreters.com), Observer pattern analysis

---

## 3. Incremental Refactoring Strategies

### With 630 Tests: You Have a Safety Net -- Use It

630 passing tests is a strong position. The key question is not "how do I avoid breaking things" but "how do I detect breakage fast."

### Strategy: Bottom-Up Extraction (Recommended)

Unlike the Strangler Fig pattern (designed for replacing entire subsystems at service boundaries), interpreter refactoring is better served by **bottom-up extraction**:

1. **Extract pure functions first** (formatting, description generation) -- zero risk, no state dependencies
2. **Extract stateless handlers next** (control flow handlers that only call other methods) -- low risk
3. **Extract stateful handlers last** (declaration, assignment handlers that touch env + emitter) -- requires careful context passing

At each step:
- Run the full 630-test suite
- If green, commit
- If red, the extraction changed behavior -- fix or revert

### Strategy: Parallel Implementation (For Risky Changes)

When unifying state (topic 2), run old and new code side by side:

```typescript
// Temporary: run both, assert same result
const oldResult = this.env.pushScope(name);
const newResult = this.runtime.pushScope(name, scopeId, scopeInfo);
assert.deepEqual(oldResult, newResult); // remove after validation
```

This is the strangler fig applied at function level rather than service level.

### Strategy: Characterization Tests as a Backstop

Before touching any code, add **approval tests** that capture the full output of the interpreter for every test program:

```typescript
// approval-test.ts
for (const program of allTestPrograms) {
    const result = interpret(program.source);
    expect(result).toMatchSnapshot(); // Vitest inline snapshots
}
```

These are coarse-grained but catch any behavioral change. They complement the existing 630 fine-grained tests. If a refactoring passes all unit tests but changes a snapshot, you know something subtle shifted.

**Key insight from approval testing literature**: "Approval tests don't require understanding code logic. They work by comparing current outputs against previously recorded results." This is exactly what you want when moving code between files.

### What NOT to Do

- **Feature flags**: Overkill for internal refactoring. Feature flags are for user-facing changes.
- **Big-bang rewrite**: Never rewrite the interpreter from scratch. Extract incrementally.
- **Refactoring without committing**: Make atomic commits after each extraction. If step 7 breaks, you can revert to step 6.

**Source**: Shopify engineering (strangler fig pattern), understandlegacycode.com (approval tests), Extract Class methodology (refactoring.guru)

---

## 4. Context Object Anti-Patterns

### The Problem

When you extract `executeFor(ctx, node)` from the Interpreter class, `ctx` must provide access to shared state: `env`, `emitter`, `evaluator`, `typeReg`, `errors`, `memoryValues`, control flow flags, etc. How much goes into `ctx`?

### Anti-Pattern 1: The God Context

```typescript
// BAD: everything in one bag
type InterpreterContext = {
    env: Environment;
    emitter: DefaultEmitter;
    evaluator: Evaluator;
    typeReg: TypeRegistry;
    errors: string[];
    memoryValues: Map<number, number>;
    breakFlag: boolean;
    continueFlag: boolean;
    returnFlag: boolean;
    returnValue: CValue | null;
    stepCount: number;
    maxSteps: number;
    maxFrames: number;
    frameDepth: number;
    source: string;
    callDeclContext: { varName: string; colStart?: number; colEnd?: number } | null;
};
```

This is just the class fields in a different container. It provides no improvement in coupling -- every function still depends on everything.

### Anti-Pattern 2: Mutable Context with Hidden Mutations

```typescript
// BAD: who mutated breakFlag?
function executeFor(ctx: InterpreterContext, node: ASTNode): void {
    // ... deep in the call chain ...
    ctx.breakFlag = true; // hidden side effect
}
```

When multiple functions mutate the same context fields, you get action-at-a-distance bugs. The caller doesn't know which fields `executeFor` might change.

### Anti-Pattern 3: Circular References

```typescript
// BAD: context references interpreter, interpreter references context
type InterpreterContext = {
    interpreter: Interpreter; // for calling executeStatement
    env: Environment;
};
```

This defeats the purpose of extraction entirely.

### Best Practice: Layered Contexts with Explicit Mutation Surfaces

**Principle 1: Split read-only from read-write**

```typescript
// Read-only services (never mutated by handlers)
type InterpreterServices = {
    readonly env: Environment;
    readonly emitter: DefaultEmitter;
    readonly evaluator: Evaluator;
    readonly typeReg: TypeRegistry;
};

// Mutable execution state (explicitly mutated)
type ExecutionState = {
    errors: string[];
    stepCount: number;
    breakFlag: boolean;
    continueFlag: boolean;
    returnFlag: boolean;
    returnValue: CValue | null;
};
```

**Principle 2: Functions declare what they need (interface segregation)**

```typescript
// Control flow handlers only need execution state + services
function executeFor(
    services: InterpreterServices,
    state: ExecutionState,
    node: ASTNode & { type: 'for_statement' }
): void { ... }

// Formatting functions need nothing mutable
function formatDeclDescription(name: string, type: CType, value: string): string { ... }
```

**Principle 3: Pass `executeStatement` as a callback, not as `this`**

```typescript
type StatementExecutor = (node: ASTNode, sharesStep?: boolean) => void;

function executeFor(
    services: InterpreterServices,
    state: ExecutionState,
    execute: StatementExecutor, // for recursive dispatch
    node: ASTNode & { type: 'for_statement' }
): void {
    // can call execute() for body statements without needing Interpreter reference
}
```

This breaks the circular dependency. The orchestrator passes itself as a callback, but the handler doesn't know it's calling an Interpreter method.

### The TypeScript Compiler's Context Approach

The TypeScript team considered extracting checker.ts functions by "moving variables into a context object and passing that context to functions." Kevin Barabash suggested starting with least-used variables. The key insight: **don't try to create one context -- create multiple small ones grouped by usage patterns**.

**Source**: Medium article on Context Object Pattern (@trinitietp), TypeScript checker.ts issue #17861 (github.com/microsoft/TypeScript)

---

## 5. Testing During Refactoring

### Your Testing Strategy (with 630 Existing Tests)

CrowCode already has excellent test coverage across the interpreter. Here is how to use it effectively during refactoring.

### Layer 1: Existing Tests as the Primary Safety Net

The 630 tests are your main protection. Run them after every extraction:

```bash
npm test  # must pass after every atomic change
```

**Critical rule**: Never change tests and implementation in the same commit. If you must update a test import path because you moved a function, that is the only change in that commit.

### Layer 2: Approval Tests for Full-Pipeline Behavior

Add approval tests that capture the complete interpreter output for all test programs. Vitest supports inline snapshots natively:

```typescript
import { interpret } from './interpreter';

describe('approval: full pipeline', () => {
    const programs = [
        'int main() { int x = 5; return 0; }',
        'int main() { int* p = malloc(sizeof(int)); *p = 42; free(p); return 0; }',
        // ... all 38 manual test programs
    ];

    for (const source of programs) {
        it(`produces stable output for: ${source.slice(0, 40)}...`, () => {
            const result = interpret(source);
            expect(result).toMatchSnapshot();
        });
    }
});
```

Run `npx vitest --update` once to establish baselines. Any refactoring that changes output will fail these tests, even if unit tests pass.

### Layer 3: Mutation Testing for Critical Modules (Post-Refactor)

After extraction is complete, run Stryker on the newly created modules to verify test quality:

```json
{
    "testRunner": "vitest",
    "mutate": [
        "src/lib/interpreter/declarations.ts",
        "src/lib/interpreter/control-flow.ts"
    ],
    "incremental": true,
    "concurrency": 4
}
```

Mutation testing revealed in a 2026 study that modules with "over 95% line coverage" still lacked "boundary value tests for exactly which conditions trigger the error." This is relevant to interpreter error handling paths.

**When to use mutation testing**: Not during refactoring (too slow, too noisy). After refactoring, on the new modules, to verify that tests actually assert behavior and not just exercise code paths.

### Layer 4: Type Safety as a Refactoring Guard

TypeScript strict mode is already enabled. During extraction, lean on the type system:

```typescript
// When extracting a method, start by declaring its exact signature
export function executeDeclaration(
    services: InterpreterServices,
    state: ExecutionState,
    execute: StatementExecutor,
    node: ASTNode & { type: 'declaration' },
    sharesStep: boolean
): void { ... }
```

The compiler will catch every call site that doesn't match. This is free verification that you haven't changed the contract.

### Anti-Pattern: Snapshot Overuse

Don't convert all 630 tests to snapshots. Snapshots are brittle -- they break on any output change, even intentional ones. Use them as a coarse backstop alongside precise assertions, not as a replacement.

**Source**: Stryker mutation testing (dev.to/wintrover), Vitest snapshot testing (blog.seancoughlin.me), approval testing methodology (understandlegacycode.com)

---

## Summary: Recommended Refactoring Sequence for interpreter.ts

1. **Add approval tests** capturing full pipeline output for all test programs
2. **Extract formatting functions** (~140 lines, pure, zero risk) to `formatting.ts`
3. **Extract control flow handlers** to `control-flow.ts` using callback pattern for `executeStatement`
4. **Extract declaration/assignment handlers** to `declarations.ts` and `assignments.ts`
5. **Extract function call mechanics** to `calls.ts`
6. **Introduce layered context** (services + state) to replace `this.` access
7. **Consider state unification** (facade over env + emitter) as a follow-up refactoring
8. **Run mutation testing** on extracted modules to verify test quality

Each step: extract, run 630 tests, commit. Never combine two extractions in one commit.

---

## Sources

- [TypeScript checker.ts refactoring experiment (GitHub #17861)](https://github.com/microsoft/TypeScript/issues/17861)
- [Checker.ts Hacker News discussion](https://news.ycombinator.com/item?id=30899744)
- [Extract Class refactoring (refactoring.guru)](https://refactoring.guru/extract-class)
- [Crafting Interpreters: Statements and State](https://craftinginterpreters.com/statements-and-state.html)
- [Shopify Engineering: Strangler Fig Pattern](https://shopify.engineering/refactoring-legacy-code-strangler-fig-pattern)
- [Context Object Pattern in Real-World Applications (Medium)](https://medium.com/@trinitietp/design-patterns-in-real-world-applications-the-context-object-pattern-c99047c978c0)
- [Approval Tests for Legacy Code (understandlegacycode.com)](https://understandlegacycode.com/approval-tests/)
- [Mutation Testing with Stryker (dev.to)](https://dev.to/wintrover/the-pitfalls-of-test-coverage-introducing-mutation-testing-with-stryker-and-cosmic-ray-75)
- [Vitest Snapshot Testing (blog.seancoughlin.me)](https://blog.seancoughlin.me/mastering-snapshot-testing-with-vite-vitest-or-jest-in-typescript)
- [Strategy Pattern in TypeScript (refactoring.guru)](https://refactoring.guru/design-patterns/strategy/typescript/example)
- [Strangler Fig Pattern (Microsoft Azure Architecture)](https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig)
- [How to Refactor a God Class (in-com.com)](https://www.in-com.com/blog/how-to-refactor-a-god-class-architectural-decomposition-and-dependency-control/)
