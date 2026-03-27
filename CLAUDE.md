# CrowCode

Interactive C memory visualizer. Users step through C programs and see memory layout change — stack frames, local variables, heap allocations, and scope lifecycle.

## Architecture

See `docs/architecture.md` for full system overview.

**Pipeline:** `Program → buildSnapshots() → MemoryEntry[][] → ProgramStepper → UI`

**Core types:** `src/lib/api/types.ts` — MemoryEntry, SnapshotOp, Program, ProgramStep

## Conventions

- **TypeScript:** strict mode, tabs, single quotes, semicolons
- **Imports:** `$lib/` alias, `import type` for type-only imports
- **Exports:** barrel via `index.ts` in each module directory
- **Errors:** return `{ result: T; errors: string[] }` — no thrown exceptions in engine code
- **Immutability:** `structuredClone()` for snapshot isolation
- **Tests:** Vitest, collocated `*.test.ts`, `describe`/`it`/`expect`, inline helper factories

## Commands

```bash
npm run dev        # local dev at localhost:5173/CrowCode
npm run build      # static build to build/
npm run preview    # preview static build
npm test           # run all tests (vitest)
npm run test:watch # watch mode
npm run check      # svelte-check type verification
```

## Deployment

Static site on GitHub Pages via `@sveltejs/adapter-static`. Push to `main` deploys automatically.

Live at: `https://CuriousCrow123.github.io/CrowCode/`

## Workflow Skills

- `/ct:plan [description]` — Create implementation plan following project patterns
- `/ct:work [plan-path]` — Execute a plan: read → branch → todos → implement → test → ship
- `/ct:review [files]` — Multi-agent review: TypeScript quality, snapshot correctness, architecture

**Recommended flow:** `/ct:plan` → review plan → `/ct:work` → `/ct:review` (for complex changes) → ship

**Refactoring flow:** `/ct:plan` with type `refactor` → approve task list → implement with test gates → verify → ship

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/api/types.ts` | Core type definitions (MemoryEntry, SnapshotOp, Program) |
| `src/lib/engine/snapshot.ts` | buildSnapshots(), applyOps() |
| `src/lib/engine/builders.ts` | Op builder helpers (addScope, addVar, set, free, etc.) |
| `src/lib/engine/validate.ts` | validateProgram() — rules all Programs must satisfy |
| `src/lib/interpreter/memory.ts` | Unified Memory class (runtime state + op recording) |
| `src/lib/interpreter/interpreter.ts` | Statement execution, control flow, uses Memory |
| `src/lib/interpreter/service.ts` | Main-thread interpreter entry (WASM init, MAX_STEPS limit) |
| `src/lib/summary.ts` | Display summaries for nested MemoryEntry values |
| `src/lib/programs/basics.ts` | Reference program: structs, pointers, malloc/free, function calls |
| `src/lib/programs/loops.ts` | Reference program: for-loops with sub-step granularity |
| `docs/architecture.md` | System architecture and principles |
| `docs/decisions/` | Architecture Decision Records (why things are the way they are) |
| `docs/research/op-generation-requirements.md` | Full op generation contract for interpreter |
| `CONTRIBUTING.md` | Setup, conventions, testing, and PR process for contributors |
