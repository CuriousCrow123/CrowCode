# Interpreter Architecture Patterns for Instrumented Execution

> Research into how production tools and academic systems handle the dual concern of executing code and producing step-by-step visualization traces. Focused on patterns relevant to CrowCode's C interpreter, which must walk an AST, manage runtime state, and emit `SnapshotOp`s for memory visualization.

## 1. Instrumented Interpreters: Execution vs. Observation

### The Fundamental Split

Every tool that produces execution traces faces the same architectural question: where does execution end and observation begin? Three distinct approaches exist in production.

#### Pattern A: External Hook (Python Tutor)

Python Tutor, the most widely-used program visualization system (10M+ users), uses Python's built-in `bdb` debugger protocol. The architecture:

1. `PGLogger` subclasses `bdb.Bdb` and overrides four hook methods: `user_call` (function entry), `user_return` (function exit), `user_exception`, and `user_line` (each line executed).
2. All hooks dispatch to a single `interaction()` method.
3. `interaction()` captures a complete snapshot of stack frames, heap objects, and variable bindings at that execution point.
4. Each snapshot is appended to `self.trace`, an ordered list.
5. At completion, the full trace is serialized to JSON and sent to the frontend.
6. The frontend does all navigation locally -- stepping backward is just `trace[index - 1]`, no backend calls needed.

**Key insight:** Python Tutor does not execute code itself. It hooks into a real language runtime. The observation layer is completely external to execution. The interpreter has no knowledge it is being observed.

For C/C++, Python Tutor takes this even further: it uses Valgrind Memcheck as the execution engine, which instruments every byte of memory with allocation/initialization metadata, enabling safe traversal of memory-unsafe code.

**Source:** [Python Tutor developer overview (GitHub)](https://github.com/pathrise-eng/pathrise-python-tutor/blob/master/v3/docs/developer-overview.md), [Ten Million Users paper (ACM 2021)](https://dl.acm.org/doi/fullHtml/10.1145/3472749.3474819)

#### Pattern B: Instrumented Interpreter (JavaWiz, JSExplain)

JavaWiz (ICPC 2025) and JSExplain (WWW 2018) take a different approach: they instrument the interpreter itself rather than hooking an external runtime.

**JavaWiz** has a two-part architecture:
- The backend extracts ASTs, instruments and compiles user code, then runs the result as a debuggee, collecting all data needed for visualization at debug steps.
- The execution trace is the "most fundamental component," capturing program state at each step.
- The frontend selects from multiple visualizations (flowcharts, memory, array operations) based on the same underlying trace.
- Supports time-travel debugging: step backward by replaying the trace to an earlier point.

**JSExplain** is a "double debugger" for JavaScript: it displays both the state of the interpreted program AND the state of the interpreter program. Events are logged at every entry/exit point of interpreter functions and on every variable binding. Each event captures the stack, state, and all local variables in scope of the interpreter code.

**Key insight:** When you control the interpreter, the observation can be woven into the execution logic itself. The boundary between execution and observation becomes a design choice rather than a runtime constraint.

**Source:** [JavaWiz (ICPC 2025)](https://ieeexplore.ieee.org/document/11025901/), [JSExplain (WWW 2018)](https://dl.acm.org/doi/fullHtml/10.1145/3184558.3185969)

#### Pattern C: Callback/Emitter (CrowCode's Current Design)

CrowCode's current architecture is a hybrid: the interpreter executes C code via tree-walking, and calls into an `OpEmitter` interface to record visualization events. The interpreter controls execution; the emitter is injected as a collaborator.

```
Interpreter (owns execution) → calls → OpEmitter (records visualization ops)
     ↕                                       ↕
Environment (owns runtime state)       Steps/Ops (visualization output)
```

This is structurally similar to the Observer pattern, but with a concrete protocol: `beginStep`, `enterFunction`, `declareVariable`, `assignVariable`, `allocHeap`, etc.

### Comparison for CrowCode's Context

| Aspect | External Hook (Python Tutor) | Instrumented Interpreter (JavaWiz) | Callback/Emitter (CrowCode) |
|--------|-----|-----|-----|
| Observation is... | External to execution | Woven into execution | Injected into execution |
| Execution knows about observation? | No | Yes | Yes (via interface) |
| Can test execution independently? | Yes (different runtime) | Harder | Yes (mock emitter) |
| Can test observation independently? | Yes (replay trace) | Harder | Yes (call emitter directly) |
| State duplication risk | None (reads real runtime) | Moderate | High (env + emitter track scopes separately) |
| Correctness enforcement | Runtime guarantees | Must be maintained manually | Must be maintained manually |

### The Duplication Problem

CrowCode's current split between `Environment` and `DefaultEmitter` creates a concrete problem: both objects independently track scope chains, variable names, and hierarchical state. When the interpreter calls `env.pushScope('main')` and `emitter.enterFunction('main', ...)`, two parallel scope stacks evolve in lockstep. Any divergence between them is a bug. The emitter maintains `scopeStack`, `varMap`, `childMap`, `ptrTargetMap` -- essentially a shadow of the environment.

This is not inherent to the callback/emitter pattern. It is a consequence of the emitter needing to generate IDs (`main-x`, `heap-player-pos-x`) and resolve paths (`resolvePointerPath`) that depend on scope context. The emitter cannot be a dumb event log; it needs structural knowledge of the runtime.

---

## 2. Tree-Walking Interpreter Patterns

### Statement Dispatch: Three Approaches in TypeScript

CrowCode already uses the TypeScript-idiomatic approach. Here is how it compares to alternatives:

#### Approach 1: Switch on Discriminated Union (CrowCode's current pattern)

```typescript
private executeStatement(node: ASTNode, sharesStep = false): void {
    switch (node.type) {
        case 'declaration': this.executeDeclaration(node, sharesStep); break;
        case 'assignment': this.executeAssignment(node, sharesStep); break;
        case 'for_statement': this.executeFor(node); break;
        // ...
        default: this.errors.push(`Unhandled: ${node.type}`);
    }
}
```

**Advantages:**
- TypeScript narrows `node` inside each `case` branch via discriminated union support.
- Exhaustiveness can be checked at compile time (add `never` in default).
- All dispatch logic is visible in one place.
- No class hierarchy or boilerplate needed.
- The most common pattern in TypeScript interpreters (used by Babel, ts-morph, and TypeScript Lox implementations like [SawyerHood/lox-typescript](https://github.com/SawyerHood/lox-typescript) which explicitly chose "tagged unions and POJOs rather than code generation to make a visitor which makes walking the AST a bit cleaner").

**Disadvantages:**
- Adding a cross-cutting concern (like logging every statement) requires touching the switch or wrapping every handler.
- Hard to swap dispatch behavior at runtime.

#### Approach 2: Visitor Pattern (Crafting Interpreters / Java style)

```typescript
class Interpreter implements StmtVisitor<void>, ExprVisitor<Value> {
    visitDeclaration(node: Declaration): void { ... }
    visitAssignment(node: Assignment): void { ... }
}
```

**Bob Nystrom's motivation:** The visitor pattern "lets you emulate the functional style in an object-oriented language." It organizes code by operation (all interpretation logic in one class) rather than by node type (behavior scattered across node classes).

**Why it is less idiomatic in TypeScript:** TypeScript lacks true method overloading. Double dispatch requires `accept(visitor)` boilerplate in every node class. The [ZenStack analysis](https://dev.to/zenstack/reflection-on-visitor-pattern-in-typescript-4gjd) concludes that TypeScript's structural typing makes visitors brittle: "the function name has to be unique regardless of the parameters." Decorator-based workarounds add reflection dependencies.

**Verdict for CrowCode:** The visitor pattern adds complexity without benefit here. CrowCode controls both the AST and the interpreter; there is no need to add operations without modifying the AST (the classic visitor motivation). Stick with switch dispatch.

#### Approach 3: Handler Map / Registry

```typescript
const handlers: Record<string, (node: ASTNode) => void> = {
    declaration: (node) => this.executeDeclaration(node as Declaration),
    assignment: (node) => this.executeAssignment(node as Assignment),
};
handlers[node.type]?.(node);
```

**Advantages:** Extensible at runtime, composable.
**Disadvantages:** Loses TypeScript narrowing (requires casts), easy to forget entries with no compile-time check.

**Verdict for CrowCode:** Worse than switch in every dimension that matters (type safety, readability, exhaustiveness). Not recommended.

### The Interpreter-Expression-Environment Triangle

Crafting Interpreters establishes a pattern that most tree-walking interpreters follow:

- **Interpreter** class: owns the execution loop, dispatches statements, manages control flow (break/continue/return).
- **Expression evaluator**: pure(ish) function from expression AST to value. Called by the interpreter.
- **Environment** class: owns variable bindings and scope chain. The interpreter mutates it; the evaluator reads from it.

CrowCode already follows this pattern cleanly: `Interpreter` dispatches statements, `Evaluator` handles expressions, `Environment` owns the scope chain. The addition of `Emitter` as a fourth collaborator is where CrowCode diverges from the standard pattern.

**Source:** [Crafting Interpreters: Statements and State](https://craftinginterpreters.com/statements-and-state.html), [Representing Code](https://craftinginterpreters.com/representing-code.html)

---

## 3. Event Sourcing in Interpreters

### CrowCode Already Does Event Sourcing

CrowCode's `SnapshotOp` system is textbook event sourcing:

- State is reconstructed by replaying an ordered sequence of events (ops).
- Each event is immutable and append-only.
- Current state at any point = `applyOps([], ops[0..n])`.
- The ops are the source of truth; snapshots are derived projections.
- Navigation (stepping backward) is just indexing into pre-computed projections.

This maps directly to Redux's architecture, which enables time-travel debugging using the same principles: every action dispatched is logged, and state at any point is reconstructed by replaying actions from the initial state. Redux DevTools "simply start with the initial state and replay each change up to the one you clicked on."

### Where the Analogy Helps: Side Effect Isolation

The event sourcing literature has a well-studied problem relevant to CrowCode: **side effects during event processing**. The "smart handler" pattern distinguishes between events created during live execution vs. events being replayed, to avoid re-triggering side effects.

For CrowCode, the distinction is clean: the interpreter is the "live" producer of ops. `buildSnapshots()` is the replayer. There are no side effects during replay. This is the ideal event sourcing setup.

### Where It Reveals a Design Tension

In classical event sourcing, events are emitted as a side effect of processing commands. The command handler (interpreter) decides what happened and emits events. Events should capture what happened, not how to reconstruct state.

CrowCode's ops are lower-level than events in this sense -- they are reconstruction instructions (`addEntry`, `setValue`), not semantic events (`variableDeclared`, `functionCalled`). This is fine for the visualization engine, but it means the emitter must know HOW to construct visualization state, not just WHAT happened. That is why the emitter has path resolution, ID generation, child building, and scope tracking -- it is both event emitter and state reconstructor.

A more event-sourcing-pure design would have the interpreter emit high-level semantic events (`declareVariable('x', 'int', 42)`) and a separate projection layer convert those into `SnapshotOp`s. This is essentially what the `OpEmitter` interface already describes. The question is whether the implementation of that interface (the projection logic) should live close to execution state or separate from it.

**Source:** [Martin Fowler on Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html), [Redux DevTools](https://blog.openreplay.com/time-travel-debugging-with-redux-and-profiler/)

---

## 4. Memory Model Patterns for Educational Visualization

### Python Tutor's Model

Python Tutor captures a full memory snapshot at every step:
- **Stack:** Ordered list of frames, each containing a name and a map of variable bindings.
- **Heap:** Object graph with unique IDs. Variables hold references (pointers) to heap objects.
- **Pointers are implicit:** In Python, all non-primitive values are heap-allocated. The trace format stores object IDs, and the frontend renders arrows between stack variables and heap objects.

For C/C++, Python Tutor uses Valgrind to instrument every byte of memory, enabling visualization of:
- Uninitialized memory
- Out-of-bounds access
- Dangling pointers
- Struct layout with alignment
- Type punning

### CrowCode's Model

CrowCode takes a different approach that is better suited to educational visualization:

- **MemoryEntry tree:** A single recursive type represents everything (scopes, variables, struct fields, array elements, heap blocks).
- **Explicit addresses:** Every non-scope entry has a formatted address string, making memory layout concrete rather than abstract.
- **Hierarchy = containment:** A variable's children are its struct fields or array elements. Scopes contain variables. The heap container parents heap blocks.
- **4 ops cover all mutations:** addEntry, removeEntry, setValue, setHeapStatus.

This is a significant design strength. The uniform `MemoryEntry` type means the UI never needs special cases. A struct field, an array element, and a heap block are all rendered by the same `MemoryRow` component.

### Comparison with JavaWiz

JavaWiz (2025) separates visualizations into independent views (flowcharts, memory, array operations) that all consume the same underlying trace. This is the same principle as CrowCode's architecture where `CodeEditor` and `MemoryView` independently read from the current step.

JavaWiz's time-travel debugging is state reconstruction from traces -- the same as CrowCode's `snapshots[index - 1]`.

### Key Insight for the Unification Proposal

The memory model and the runtime state serve different masters:
- **Runtime state** (Environment) serves correctness: "what is the value of x in the current scope?"
- **Visualization state** (MemoryEntry tree) serves the user: "what should the student see?"

These are not the same. Runtime state includes things the visualization should not show (internal type metadata, uninitialized tracking, function pointer indices). Visualization state includes things the runtime does not need (display names like `.x` and `[0]`, formatted address strings, heap status labels).

The question is whether the mapping between them should happen at emission time (current design) or at rendering time.

---

## 5. Implications for the Unification Proposal

### What Unification Would Mean

Merging `Environment` and `Emitter` into a single object would mean one scope stack instead of two, one variable registry instead of two, and one source of truth for "what exists and where."

### Arguments For Unification

1. **Eliminates duplication:** No more parallel scope stacks, no more risk of divergence between env and emitter state.
2. **Simpler call sites:** `interpreter.declareVariable('x', type, value)` does both runtime bookkeeping AND op emission in one call, rather than separate `env.declareVariable()` + `emitter.declareVariable()` calls.
3. **ID generation becomes natural:** The unified object knows both the runtime scope chain AND the ID scheme, so IDs like `main-x` are derived from a single source.
4. **Reduces the interpreter's coordination burden:** The interpreter currently orchestrates two objects that must stay in sync. One object eliminates the orchestration.

### Arguments Against Unification

1. **Testability:** The current split allows testing the environment (scope chain, address allocation, heap management) independently of visualization concerns. A unified object would require the test harness to deal with ops even when testing pure runtime behavior.
2. **Single Responsibility:** The environment answers "what is the value of x?" The emitter answers "how do I represent the creation of x in the visualization?" These are genuinely different concerns.
3. **Future flexibility:** If CrowCode ever needs a different visualization format (e.g., a text-only trace, a compact binary format), the emitter interface provides a clean extension point. A unified object makes this harder.
4. **Complexity migration, not reduction:** The emitter's `resolvePointerPath()`, `buildChildrenWithAddress()`, and `generateHeapId()` logic does not disappear. It moves into the unified object, making that object larger.

### A Middle Path: Shared Scope Context

The core duplication is the scope stack. Both objects need to know "we are inside `main`, then inside `for1`." One option:

```
ScopeContext (shared)
├── scope stack with IDs
├── variable → ID mapping
└── scope lifecycle methods

Environment (owns runtime values)
├── uses ScopeContext for scope chain
├── owns stack/heap memory
└── variable lookup, address allocation

Emitter (owns op generation)
├── uses ScopeContext for ID resolution
├── owns step lifecycle
└── op construction, path resolution
```

This eliminates the duplication (one scope stack) while preserving separation of concerns (runtime values vs. visualization ops).

### Recommendation

The duplication between Environment and Emitter is real and worth addressing, but full unification trades one problem (duplication) for another (a god object mixing runtime and visualization concerns). The shared scope context approach addresses the specific source of duplication without sacrificing testability or separation of concerns.

If the goal is simplicity above all (and the test suite is strong enough to catch regressions), unification is viable -- the interpreter is ~900 lines and the emitter is ~580 lines; a unified object of ~1200 lines is manageable. But the shared context approach is strictly better on the dimensions of testability, extensibility, and single responsibility.

---

## Summary of Findings

| Topic | Key Finding | Relevance to CrowCode |
|-------|-------------|----------------------|
| Python Tutor | External hooks into real runtime; full snapshot per step; JSON trace consumed by frontend | Validates CrowCode's pre-computed snapshot approach |
| JavaWiz | Instrumented execution with trace as fundamental component; time-travel via trace replay | Confirms CrowCode's architecture is industry-standard |
| JSExplain | Double debugger logging interpreter AND program state | Shows the observation-execution coupling is a deliberate design choice |
| Crafting Interpreters | Switch dispatch + Environment class; visitor pattern for Java, discriminated unions for TS | CrowCode already uses the idiomatic TypeScript pattern |
| Event Sourcing / Redux | Append-only event log; state reconstruction via replay; side effect isolation | CrowCode's SnapshotOp system is textbook event sourcing |
| Discriminated Unions in TS | Switch on `type` field with exhaustiveness checking is the recommended TS pattern | Confirms CrowCode's current `executeStatement` switch dispatch |
| Memory model separation | Runtime state and visualization state serve different masters | Argues for keeping some separation even in a unified design |

## Sources

- [Python Tutor developer overview (GitHub)](https://github.com/pathrise-eng/pathrise-python-tutor/blob/master/v3/docs/developer-overview.md)
- [Ten Million Users and Ten Years Later (ACM UIST 2021)](https://dl.acm.org/doi/fullHtml/10.1145/3472749.3474819)
- [Python Tutor C/C++ visualizer](https://pythontutor.com/articles/c-cpp-visualizer.html)
- [JavaWiz: Trace-Based Graphical Debugger (ICPC 2025)](https://ieeexplore.ieee.org/document/11025901/)
- [JSExplain: A Double Debugger for JavaScript (WWW 2018)](https://dl.acm.org/doi/fullHtml/10.1145/3184558.3185969)
- [Crafting Interpreters: Representing Code](https://craftinginterpreters.com/representing-code.html)
- [Crafting Interpreters: Statements and State](https://craftinginterpreters.com/statements-and-state.html)
- [SawyerHood/lox-typescript (tagged unions over visitors)](https://github.com/SawyerHood/lox-typescript)
- [ZenStack: Reflection on Visitor Pattern in TypeScript](https://dev.to/zenstack/reflection-on-visitor-pattern-in-typescript-4gjd)
- [Martin Fowler: Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html)
- [Redux time-travel debugging](https://blog.openreplay.com/time-travel-debugging-with-redux-and-profiler/)
- [Discriminated Unions in TypeScript](https://basarat.gitbook.io/typescript/type-system/discriminated-unions)
- [EasyTracker: Python Library for Controlling and Inspecting Program Execution (INRIA 2024)](https://inria.hal.science/hal-04368835v3/document)
