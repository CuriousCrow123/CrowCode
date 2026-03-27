---
name: ct-plan
description: Transform feature descriptions into structured plans for CrowCode (TypeScript/SvelteKit memory visualizer). Use when planning new features, interpreter work, or non-trivial changes.
argument-hint: "[feature description or improvement idea]"
---

# CrowCode Plan

Create implementation plans for CrowCode features following project conventions.

## Feature Description

<feature_description> #$ARGUMENTS </feature_description>

**If empty, ask:** "What would you like to plan? Describe the feature, bug fix, or improvement."

## Workflow

### Phase 0: Check for Prior Work

Look for existing context before starting fresh:

```bash
ls -la docs/brainstorms/*.md docs/plans/*.md docs/research/*.md 2>/dev/null | head -20
```

If a relevant brainstorm or research report exists, read it and carry forward decisions. Skip idea refinement if the brainstorm already answered WHAT to build.

### Phase 1: Local Research (Parallel)

Launch these agents in parallel:

1. **Architecture explorer** — Find existing patterns in `src/lib/` that relate to the feature. Check engine, components, programs, and interpreter modules.
2. **Test pattern explorer** — Find how similar features are tested. Check `programs.test.ts` (`testProgram()` pattern), engine test files, and interpreter tests if they exist.

Key files to always check:
- `docs/architecture.md` — system overview and principles
- `docs/research/op-generation-requirements.md` — op generation contracts
- `src/lib/api/types.ts` — core type definitions
- `src/lib/engine/index.ts` — public engine API
- `src/lib/interpreter/index.ts` — interpreter API (if exists)

### Phase 2: External Research (Conditional)

**Research when:** Feature involves new dependencies (WASM, Web Workers, new npm packages), browser APIs, or unfamiliar territory.

**Skip when:** Feature is internal to existing patterns (new program, new op type, new component, refactor).

If researching, use Context7 for framework docs (SvelteKit, Vite, tree-sitter) and web search for best practices.

### Phase 3: Write Plan

Write to `docs/plans/YYYY-MM-DD-<type>-<descriptive-name>-plan.md`.

**Structure:**

```markdown
---
title: [Title]
type: [feat|fix|refactor]
status: active
date: YYYY-MM-DD
---

# [Title]

## Context
[Why this matters, what problem it solves]

## Design
[Approach with reasoning, alternatives considered]

## Files

### Modify
| File | What changes | Why |

### Create
| File | Purpose |

## Steps
### Step 1: [name]
- **What:** [description]
- **Files:** [files touched]
- **Depends on:** [previous steps]
- **Verification:** [how to verify — test command, manual check]

## Edge Cases
| Case | Expected behavior | How handled |

## Verification
- [ ] `npm test` passes
- [ ] `npm run build` succeeds
- [ ] [feature-specific acceptance criteria]

## References
- [links to architecture docs, research, prior work]
```

**CrowCode-specific conventions:**
- Every file in `src/lib/` must follow: strict TypeScript, tabs, single quotes, semicolons
- New modules get barrel exports via `index.ts`
- Error handling uses tuple pattern: `{ result: T; errors: string[] }`
- Snapshot-producing code must satisfy `validateProgram()` rules
- Tests use Vitest, collocated as `*.test.ts`, with inline helper factories

### Phase 4: Present Options

After writing the plan:

1. **Start `/ct:work`** — Begin implementing this plan
2. **Extend plan** — Add more detail to specific sections
3. **Review and refine** — Improve the document
4. **Just save** — Plan is ready for later

## Anti-Patterns

- Don't plan in Godot/GDScript terms — this is TypeScript/SvelteKit
- Don't add linting steps for gdformat/gdlint — use `npm test` and `npm run check`
- Don't reference signals or autoloads — use Svelte stores, props, and events
- Don't create GitHub issues unless explicitly asked
