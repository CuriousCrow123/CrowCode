---
title: Documentation Overhaul
type: refactor
status: completed
date: 2026-03-27
deepened: 2026-03-27
---

# Documentation Overhaul

## Enhancement Summary

**Deepened on:** 2026-03-27
**Research agents used:** 7 (README best practices, ADR templates, C4 architecture restructuring, git history analysis, spec flow analysis, CONTRIBUTING.md best practices, repo structure gap analysis)

### Critical Issues Discovered
1. **Sequencing conflict with whole-codebase refactor** — The active refactor plan deletes files (programs layer, builders, ProgramStepper) that this plan documents. Must decide: document pre- or post-refactor state?
2. **architecture.md has stale references** — `emitter.ts` and `environment.ts` are referenced as "legacy, retained for tests" but have actually been deleted. The `handlers/` subdirectory is missing from the directory listing.
3. **Five "Known Edge Cases" have no ADR coverage** — Plan says to replace the section with ADR links, but only 4 ADRs cover different topics. Five edge cases would be silently deleted.

### Key Improvements Added
1. Concrete README structure with pedagogical hook, demo GIF, and outcome-framed features
2. Git commit history for each ADR — specific dates, commits, and rationale quotes
3. matklad's "codemap not atlas" pattern for architecture restructuring + Mermaid recommendation
4. 15 documentation gaps discovered by repo analysis (WASM postinstall, worker.ts vs service.ts, EditorTabStore, handlers/ subdirectory, etc.)
5. Detailed CONTRIBUTING.md section ordering based on SvelteKit, Vitest, and TypeScript exemplars
6. 8 reader journeys mapped (vs. original 4 edge cases)

---

## Prerequisite Decision: Sequencing with Codebase Refactor

> **This must be resolved before implementing the plan.**

The whole-codebase refactor plan (`docs/plans/2026-03-26-refactor-whole-codebase-plan.md`) is active on the same branch and schedules deletion of:
- `src/lib/programs/basics.ts`, `loops.ts`, `index.ts`, `programs.test.ts`
- `src/lib/components/ProgramStepper.svelte`
- `src/lib/engine/builders.ts`, `builders.test.ts`

**Impact on this plan:**
- Step 2 (CONTRIBUTING.md) includes "Adding a new program" — that workflow gets deleted
- Step 4 (architecture.md) references builders, ProgramStepper, programs layer extensively
- Step 5 (CLAUDE.md) Key Files table includes `builders.ts` and `programs/basics.ts`

**Decision:** Document the **post-refactor state**. The codebase refactor should complete first, then this documentation overhaul runs against the resulting codebase. This avoids writing docs that are immediately wrong. Steps that reference the programs layer, builders, or ProgramStepper should describe whatever exists after the refactor.

---

## Context

CrowCode's README is the SvelteKit scaffold default — it says "sv" and describes `npx sv create`. The architecture doc is comprehensive (490 lines) but tries to serve every audience at once. There are no ADRs, no contribution guide, and no onboarding path for new developers. The `CLAUDE.md` file doubles as both AI context and project convention reference.

Research findings (see `docs/research/codebase-documentation-best-practices.md`) identified five priorities:
1. README should orient newcomers to purpose, setup, and usage in 30 seconds
2. Architecture docs should be layered for multiple audiences (arc42/C4 principles)
3. ADRs should capture the "why" behind non-obvious decisions
4. Docs should live near code and be maintained through reviews
5. Inline comments should explain "why," not "what"

## Design

### Documentation Architecture

```
README.md                      ← Project identity, setup, usage (rewrite)
CONTRIBUTING.md                ← New: how to contribute
CLAUDE.md                      ← AI context (keep, accuracy updates)
docs/
├── architecture.md            ← Keep, restructure with C4 layering
├── interpreter-status.md      ← Keep as-is (living reference)
├── decisions/                 ← New: ADR directory
│   ├── README.md              ← ADR index
│   ├── 001-snapshot-precomputation.md
│   ├── 002-four-op-model.md
│   ├── 003-unified-memory-class.md
│   └── 004-docs-as-code.md
├── pipeline-audit-findings.md ← Keep (operational record)
├── test-programs.md           ← Keep (manual QA reference)
├── research/                  ← Keep (research artifacts)
└── plans/                     ← Keep (planning artifacts)
```

### Reader Journeys

| Reader | Entry Point | Primary Goal | Served by |
|--------|-------------|-------------|-----------|
| Curious evaluator (found live demo) | README | Understand purpose in 30 seconds | README: pedagogical hook + live link |
| Setup-only developer | README | Run locally | README: quick start |
| Feature developer | README → CONTRIBUTING → architecture | Know where their change belongs | All three docs |
| Bug investigator | README → architecture | Isolate which layer owns the bug | Architecture: Level 2 module map |
| Program author | CONTRIBUTING | Add a pre-authored program | CONTRIBUTING: "Adding a Program" section |
| Interpreter contributor | architecture → interpreter-status | Extend C language support | Architecture: Level 3 interpreter details |
| Decision investigator | ADRs | Understand why something works this way | ADRs cross-linked from architecture |
| AI agent (Claude/Copilot) | CLAUDE.md | Get accurate project context | CLAUDE.md: terse, machine-optimized |

### Approach: Lean and Incremental

Following the research consensus: start with the highest-ROI documents (README, ADRs, contributing guide), restructure the architecture doc for readability, and skip anything that would create a maintenance burden without clear value.

**What we're NOT doing:**
- Auto-generated API docs (TypeScript types are self-documenting; project is too small for TSDoc overhead)
- Separate onboarding guide (README + CONTRIBUTING.md + architecture.md cover this)
- Inline comment audit (code is already clean; would be churn)

## Files

### Modify
| File | What changes | Why |
|------|-------------|-----|
| `README.md` | Complete rewrite: pedagogical hook, demo GIF, live link, quick start, pipeline overview, links | Current README is scaffold boilerplate |
| `docs/architecture.md` | Restructure into C4-style levels with Mermaid diagrams; fix stale references; add "How to read this document" navigation; add missing modules (handlers/, stores/, service.ts) | 490 lines serving all audiences; stale references to deleted files; missing modules |
| `CLAUDE.md` | Update Key Files table; add `service.ts`, `summary.ts`, `types.ts` re-export; add CONTRIBUTING.md and docs/decisions/ references; verify Workflow Skills section | Keep it accurate; several files missing from Key Files |

### Create
| File | Purpose |
|------|---------|
| `CONTRIBUTING.md` | How to set up, run tests, code conventions, PR process |
| `docs/decisions/README.md` | ADR index with one-line descriptions |
| `docs/decisions/001-snapshot-precomputation.md` | Why all snapshots are pre-computed vs. lazy/on-demand |
| `docs/decisions/002-four-op-model.md` | Why only 4 op types (addEntry, removeEntry, setValue, setHeapStatus) |
| `docs/decisions/003-unified-memory-class.md` | Why Memory class replaced Environment + Emitter |
| `docs/decisions/004-docs-as-code.md` | Why docs live in-repo as Markdown, not a wiki |

## Steps

### Step 1: Rewrite README.md
- **What:** Replace scaffold boilerplate with proper project README
- **Files:** `README.md`
- **Depends on:** None

**Content structure (research-informed):**

```markdown
# CrowCode

> C is hard to learn partly because you can't see memory. CrowCode shows you.

[Demo GIF: 8-10 second recording of stepping through a program]

[Try it live →](https://CuriousCrow123.github.io/CrowCode/)

Interactive C memory visualizer. Step through C programs and watch stack frames,
local variables, heap allocations, and scope lifecycle change at each instruction.

## Features
- Watch stack frames grow as functions are called and shrink when they return
- See local variables appear, hold values, and disappear when they go out of scope
- Follow heap allocations from malloc() to free() — with leak detection
- Step forward and backward at your own pace
- Write your own C code in the Custom tab — interpreted in the browser

## Quick Start
[Prerequisites, npm install, note about postinstall WASM copy, npm run dev]
[Note: dev server runs at localhost:5173/CrowCode (base path)]

## How It Works
[3-5 sentences: Program → buildSnapshots() → MemoryEntry[][] → ProgramStepper → UI]
[Link to docs/architecture.md for depth]

## Commands
[npm run dev, build, preview, test, test:watch, check]

## Contributing
[Link to CONTRIBUTING.md]

## License
[TBD — decide whether to add MIT or leave unlicensed]
```

### Research Insights

**Best Practices:**
- Lead with a pedagogical hook, not a feature list: "Name the barrier before introducing the tool" (Python Tutor pattern — pathrise-eng/pathrise-python-tutor)
- Demo GIF is highest-ROI visual for interactive tools — 8-15 seconds, single focused interaction. Cannot be replaced by screenshot because the core value is watching memory change across steps (rekort.app)
- Feature bullets must describe outcomes, not capabilities: "Watch your variable disappear when it goes out of scope" beats "scope lifecycle tracking"
- Developers evaluate a README in 10-30 seconds using F-pattern scanning (Art of README, hackergrrl)
- GitHub topic tags feed search indexing — add: `c-programming`, `memory-visualization`, `education`, `sveltekit`, `typescript`

**Demo GIF plan:**
- Use the live site to record 8-10 seconds of stepping through a simple program
- Tools: macOS screen recording → convert to GIF (e.g., `ffmpeg -i recording.mov -vf "fps=15,scale=800:-1" demo.gif`)
- Store in `static/demo.gif` or `docs/assets/demo.gif`
- If GIF is not ready, use a text link to the live demo instead of a broken image tag

**Missing from original plan:**
- `postinstall` WASM copy step must be mentioned in Quick Start — `npm install` copies `web-tree-sitter.wasm` and `tree-sitter-c.wasm` to `static/`. If these files are missing, the interpreter silently fails.
- Base path note: dev server runs at `localhost:5173/CrowCode`, not `/`
- License section — the repo has no LICENSE file. Either add MIT or explicitly note it's unlicensed.

- **Verification:** Read the README cold — does a new developer know what this is and how to run it within 60 seconds? Does the live demo link work?

---

### Step 2: Create CONTRIBUTING.md
- **What:** Developer contribution guide
- **Files:** `CONTRIBUTING.md`
- **Depends on:** None (can run parallel with Step 1)

**Content structure (research-informed, 11 sections):**

```markdown
# Contributing to CrowCode

Welcome! CrowCode is an interactive C memory visualizer. Contributions are
welcome — whether you're fixing a bug, adding a C feature to the interpreter,
or creating a new example program.

## Development Setup
[Fork, clone, npm install (note: postinstall copies WASM files), npm run dev]
[Note: dev server at localhost:5173/CrowCode]

## Running Tests
[npm test (all 600+ tests), npm run test:watch, targeted: npm test -- src/lib/engine/]

## Before You Submit
[Checklist: npm test, npm run check (svelte-check), npm run build]

## Code Conventions
[Single paragraph: TypeScript strict, tabs, single quotes, semicolons, $lib/ imports,
import type for type-only, barrel exports via index.ts, error tuples { result, errors }]
[Then: "Run npm run check to verify."]

## Adding a Pre-authored Program
[See basics.ts as reference. Register in programs/index.ts. Add testProgram() call.]

## Adding an Interpreter Feature
[Check interpreter-status.md for current feature matrix.
Write tests in value-correctness.test.ts using interpretAndBuild().
Add full-program integration test in manual-programs.test.ts.
Run snapshot-regression.test.ts to verify no regressions.]

## Adding an Engine Feature
[Collocate *.test.ts in same directory. Export from engine/index.ts.
Use describe/it/expect with inline helper factories (not beforeEach globals).]

## Commit Format
[type(scope): description — types: feat, fix, docs, refactor, test.
One logical change per commit. Never commit broken tests.]

## Pull Requests
[Branch from main. PR description explains why, not just what. Small PRs preferred.]

## Architecture
[Link to docs/architecture.md — "Read Levels 1-2 before writing code (~5 minutes)"]

## Questions
[Open a GitHub issue]
```

### Research Insights

**Best Practices:**
- Optimal CONTRIBUTING.md for small projects: 500–1,500 words (contributing.md, rivereditor.com)
- "Never use CLAUDE.md for code style guidelines — that's a linter's job" — same principle applies to CONTRIBUTING.md. State the format/lint commands, don't transcribe rules (humanlayer.dev)
- Pre-submission validation checklist catches CI failures before they happen (SvelteKit CONTRIBUTING.md pattern)
- "Adding a new X" sections dramatically lower contribution friction — point to an exemplar file rather than explaining from scratch (TypeScript CONTRIBUTING.md pattern)
- Feature additions must include a test — state as non-negotiable (rivereditor.com)
- CLAUDE.md vs CONTRIBUTING.md overlap: CLAUDE.md is machine-optimized context (terse, token-efficient). CONTRIBUTING.md is human onboarding (can be longer, discoverability-focused). They can both describe the same conventions from different angles — that's acceptable since the audiences differ (Anthropic blog, humanlayer.dev)

**Missing from original plan:**
- Svelte 5 runes convention — `svelte.config.js` forces runes mode for all project files. Contributors must use `$props()` / `$state()` / `$derived()`, not legacy Svelte syntax. Add one sentence.
- Tailwind v4 note — no `tailwind.config.js` exists; Tailwind uses the Vite plugin (`@tailwindcss/vite`). Mention so contributors don't search for a missing config file.
- `npm run check` runs `svelte-check` — non-obvious to non-SvelteKit developers. Explain briefly.
- Node.js version — check `package.json` for an `engines` field. If absent, add one or document a known-working version.

**Exemplar references:**
- SvelteKit CONTRIBUTING.md — strong pre-submission validation, naming conventions as single memorable rules
- TypeScript CONTRIBUTING.md — best "Adding a Test" section: location, filename convention, format template, baseline command
- Vitest CONTRIBUTING.md — tiered test execution, AI contribution disclosure policy

- **Verification:** Can a new contributor go from clone to passing tests to submitting a PR using only this guide?

---

### Step 3: Create ADR directory and initial ADRs
- **What:** Retroactive ADRs capturing the 4 most important non-obvious decisions
- **Files:** `docs/decisions/README.md`, `docs/decisions/001-*.md` through `004-*.md`
- **Depends on:** None (can run parallel)

**ADR template (lightweight Nygard + MADR hybrid):**

```markdown
# ADR-NNN: [Title as imperative phrase]

**Status:** Accepted
**Date:** [Date of original decision, from git history]
**Commit:** [Relevant commit hash]

## Context
[What forces led to this decision? Written in present tense as if the
decision hasn't been made yet. Neutral, factual.]

## Decision
[What we decided. Active voice: "We will..." or "The system uses..."]

## Considered Alternatives
[2-3 alternatives with brief pros/cons for each]

## Consequences
[All results — positive, negative, and neutral. Link back to
architecture.md section where this decision surfaces.]
```

**ADR content from git history analysis:**

#### ADR-001: Snapshot Precomputation
- **Commit:** `45b6f249` (2026-03-25)
- **Context:** CrowCode needs to support backward stepping (user clicks "previous") with O(1) latency. The alternative — lazy computation from ops on demand — would require either caching or replaying from the start on every backward step.
- **Decision:** Pre-compute all snapshots upfront via `buildSnapshots()`, producing `MemoryEntry[][]` with `structuredClone()` per step for isolation.
- **Alternatives:** (1) Lazy computation with LRU cache — adds complexity, still O(N) worst case. (2) Checkpoint-based replay (full snapshot every N steps, replay from nearest) — noted in architecture.md as future option if memory becomes a concern. (3) Diff-based storage (store only deltas) — more complex, loses O(1) random access.
- **Consequences:** O(1) access to any step. Memory grows linearly with step count (~25-50 steps typical, negligible). Snapshot immutability is guaranteed by structural cloning. Backward stepping "just works" without any additional logic.
- **Quote from day-one architecture doc:** "If this becomes a problem, the fix is checkpoint-based computation — a ~20 line change to buildSnapshots with zero component changes."

#### ADR-002: Four-Op Model
- **Commit:** `fc56113f` (2026-03-25)
- **Context:** The engine needs a minimal set of operations that can express every possible memory state change (scope creation, variable declaration, value mutation, heap lifecycle).
- **Decision:** Four primitive op types: `addEntry` (insert), `removeEntry` (delete + children), `setValue` (mutate value), `setHeapStatus` (lifecycle state).
- **Alternatives:** (1) Domain-specific ops (addScope, addVariable, addHeapBlock, etc.) — more readable but harder to validate exhaustively. (2) Single "patch" op with JSON patch semantics — too generic, loses semantic meaning.
- **Consequences:** `applyOps` switch statement is 4 cases. `validateProgram` can reason about a small, closed set. Builder functions (`addScope`, `addVar`, `set`, `free`) provide the ergonomic layer without expanding the op set. New visualization features (e.g., highlighting freed blocks) only need new builders, not new op types.

#### ADR-003: Unified Memory Class
- **Commit:** `cb4c3964` → `60cb707e` (2026-03-26)
- **Context:** The interpreter originally had three separately maintained data structures: `Environment` (runtime scope chain, heap), `DefaultEmitter` (op recording), and `memoryValues` (address→value bridge). Every mutation required calling all three in sync. The three-way coordination caused bugs — e.g., emitting ops for state that hadn't been updated yet, or updating state without recording the op.
- **Decision:** Merge all three into a single `Memory` class where every mutation method (pushScope, declareVariable, malloc, free, etc.) atomically updates runtime state AND records the corresponding `SnapshotOp`.
- **Alternatives:** (1) Keep separation with stricter interfaces — would still require three-way coordination discipline. (2) Event-driven: Environment emits events, Emitter subscribes — adds complexity without solving the atomicity problem.
- **Consequences:** Eliminated an entire class of synchronization bugs. Reduced interpreter.ts complexity (single object to interact with instead of three). Migration was safe: snapshot regression tests captured output from 7 programs before the change, 696 tests passed after. Legacy files deleted: 1,566 lines removed.
- **Migration safety note:** Regression test file `snapshot-regression.test.ts` was created *before* the migration commit as a safety net.

#### ADR-004: Docs-as-Code
- **Commit:** `8bcbf82d` (2026-03-25)
- **Context:** Documentation needs to stay accurate as the codebase evolves. External wikis (Notion, Confluence) drift because they're not part of the PR review process.
- **Decision:** All documentation lives as Markdown files in the `docs/` directory, committed alongside code, reviewed in pull requests.
- **Alternatives:** (1) Notion/Confluence wiki — easier for non-developers, but changes aren't tied to code changes. (2) GitHub Wiki — in the repo but not in the PR workflow. (3) Auto-generated docs only — can't capture rationale or architectural decisions.
- **Consequences:** Documentation changes appear in PRs alongside code changes. `git blame` shows who wrote each section and when. Docs can reference relative file paths. Research preceded implementation: the C-WASM research report was committed *before* the interpreter code it informed.

### Research Insights

**Best Practices:**
- Retroactive ADRs are well-suited when the original decision-maker is present and decisions are recent (Azure WAF, Spotify, Equal Experts). CrowCode's situation is ideal: single author, decisions made days ago.
- No TypeScript/frontend open-source projects with public ADR logs were found — CrowCode would be among the first. This is a distinguishing attribute worth noting.
- ADR numbering: use zero-padded sequential numbers (001, 002...) for sort ordering.
- ADRs should be immutable once accepted. When circumstances change, write a new ADR that supersedes the old one (Microsoft Azure WAF, AWS Architecture Blog).
- The "Considered Alternatives" section is the critical addition beyond Nygard — it prevents teams from re-litigating settled decisions (MADR template, Microsoft Azure WAF).
- Keep each ADR to 1-2 pages. "Written as if it is a conversation with a future developer" (Nygard).

- **Verification:** Each ADR answers "why is it this way?" without requiring the reader to understand the code first. Each references the specific commit where the decision was implemented.

---

### Step 4: Restructure architecture.md
- **What:** Reorganize for progressive disclosure using C4-style layering; fix stale references; add missing modules
- **Files:** `docs/architecture.md`
- **Depends on:** Steps 1-3 (so we can link to ADRs and CONTRIBUTING.md)

**Target structure (research-informed, matklad + C4 + arc42):**

```markdown
# CrowCode Architecture

## How to Read This Document
- New contributor: read System Overview and Pipeline (~5 min), stop there
- Adding a feature to the engine: also read the Engine section
- Extending the interpreter: also read C Interpreter Pipeline
- Investigating a design decision: see docs/decisions/

## Level 1 — System Context
[What CrowCode is, who uses it, inputs/outputs]
[Mermaid diagram: user → CrowCode → browser]
[Principles (5 bullets, currently at top — keep here)]

## Level 2 — Module Map
[The four modules and how they connect]
[Mermaid pipeline diagram (replacing current ASCII art)]
[One paragraph per module: Engine, Interpreter, Components, Programs]
[Directory structure (module-level only, not every file)]

## Level 3 — Component Details

### Data Model
[MemoryEntry, Program, ProgramStep, SnapshotOp — keep existing content]
> See [ADR-002](decisions/002-four-op-model.md) for why 4 ops cover all changes.

### Engine
[Snapshot Pipeline, Diffing, Navigation, Builders, Validation]
> See [ADR-001](decisions/001-snapshot-precomputation.md) for the precomputation tradeoff.

### C Interpreter Pipeline
[Pipeline diagram + component descriptions]
[Add: service.ts vs worker.ts explanation]
[Add: handlers/ subdirectory description]
[Add: WASM initialization note (optimizeDeps.exclude)]
[Link to interpreter-status.md for feature matrix — don't duplicate]
> See [ADR-003](decisions/003-unified-memory-class.md) for the Memory unification.

### UI Components
[ProgramStepper, CodeEditor, CustomEditor, MemoryView, etc.]
[Add: EditorTabStore, localStorage persistence, runCache]

### State Management (NEW)
[EditorTabStore, AppMode state machine in +page.svelte]
[localStorage persistence with STORAGE_KEY = 'crowtools-tabs']
[runCache keyed by tab index, runGeneration abort guard]

### Authoring Programs
[Pre-authored vs custom, sub-steps guidance]

## Implementation Notes
[Renamed from "Known Edge Cases and Design Decisions"]
[Keep items NOT covered by ADRs:]
  - indexById rebuilt per op (performance note)
  - Drilldown modal closes on step (v1 behavior)
  - EditorView lifecycle (Svelte $effect cleanup)
  - Column range stripping (orchestrator responsibility)
  - Sub-step ops always apply (even when not visible)
[Items covered by ADRs: replace with "> See ADR-NNN" callout]

## Testing
[Keep existing content]

## Deployment
[Keep existing content]
[Add: base path /CrowCode constraint explanation]
[Add: why worker.ts hardcodes paths while service.ts uses BASE_URL]
```

### Research Insights

**Best Practices:**
- matklad (rust-analyzer author): Architecture docs should be a "codemap, not an atlas." Never link to specific files (links rot); name modules/types so readers use symbol search. Highlight architectural invariants expressed as absences (what the system deliberately does NOT do). (matklad.github.io/2021/02/06/ARCHITECTURE.md.html)
- Convert ASCII diagrams to Mermaid — 82% fewer tokens, renders natively on GitHub, diffs show semantic changes not visual noise. GitHub has supported Mermaid since 2022. (dev.to/darkmavis1980)
- "How to read this document" is intent-first navigation, NOT a table of contents: "I want to understand X, so I read Y" (arc42, workingsoftware.dev)
- Cross-reference ADRs with inline callouts: `> See [ADR-NNN: Title](path) for the tradeoff analysis.` (joelparkerhenderson ADR repository)
- Each C4 level should be a self-contained section a reader can stop at. You do not force every reader through all four levels. (c4model.com)

**Stale references to fix (from repo analysis):**
- `emitter.ts` and `environment.ts` listed as "legacy, retained for tests" — but both files have been deleted. Remove references or clarify they no longer exist.
- `handlers/` subdirectory (statements.ts, control-flow.ts, types.ts, index.ts) missing from directory listing — add it under interpreter/
- `service.ts` (main-thread interpreter entry) not documented at all — it's the file that `+page.svelte` actually imports
- `stores/` directory (editor-tabs.svelte.ts) missing entirely — add as a new section

**New modules to document:**
- `src/lib/interpreter/service.ts` — Main-thread interpreter entry, uses `import.meta.env.BASE_URL` for WASM paths
- `src/lib/interpreter/handlers/` — Statement and control-flow handlers factored out of interpreter.ts
- `src/lib/stores/editor-tabs.svelte.ts` — Multi-tab state, localStorage persistence, run cache
- `MAX_STEPS = 500` limit in service.ts — produces user-visible warning

- **Verification:** A developer can understand the system at their chosen depth by reading only as far as they need. All file references in the document exist in the codebase. Mermaid diagrams render correctly on GitHub.

---

### Step 5: Update CLAUDE.md
- **What:** Ensure accuracy, fix stale references, add missing files
- **Files:** `CLAUDE.md`
- **Depends on:** Steps 1-4

**Specific accuracy checklist:**
- [ ] Every file in Key Files table exists at that path (verify with `ls`)
- [ ] Add missing files to Key Files: `src/lib/interpreter/service.ts`, `src/lib/summary.ts`, `src/lib/types.ts`
- [ ] Remove files that no longer exist (e.g., `emitter.ts`, `environment.ts` if referenced)
- [ ] Script names in Commands section match `package.json` scripts exactly
- [ ] Workflow Skills section lists only actually installed skills
- [ ] Remove `/ct:refactor` reference if that skill no longer exists
- [ ] Add `CONTRIBUTING.md` to project documentation references
- [ ] Add `docs/decisions/` to project documentation references
- [ ] Svelte 5 runes convention mentioned (all project files use runes mode)
- [ ] Tailwind v4 Vite plugin noted (no tailwind.config.js)

- **Verification:** Run each file path in Key Files through `ls` to confirm existence. Compare Commands with `package.json` scripts. NOT just `npm test` — those can't catch stale prose.

---

### Step 6: Verify and cross-link
- **What:** Final pass ensuring all docs link to each other correctly
- **Files:** All documentation files
- **Depends on:** Steps 1-5

**Cross-link checklist:**
- [ ] README links to: architecture.md, CONTRIBUTING.md, live demo, docs/decisions/ (optional)
- [ ] CONTRIBUTING.md links to: architecture.md ("Read Levels 1-2 before writing code"), interpreter-status.md (for interpreter contributors)
- [ ] architecture.md links to: ADRs (inline callouts at decision points), interpreter-status.md (feature matrix), CONTRIBUTING.md (for conventions)
- [ ] ADR index lists all ADRs with: number, title (linked), status, date
- [ ] Each ADR's Consequences section references the architecture.md section where the decision surfaces
- [ ] No broken relative links

**Link verification method:**
```bash
# Check all markdown links resolve to existing files
grep -roh '\[.*\](\.\.?/[^)]*\.md)' docs/ README.md CONTRIBUTING.md CLAUDE.md | \
  sed 's/.*(\(.*\))/\1/' | sort -u | while read link; do
    test -f "$link" || echo "BROKEN: $link"
  done
```

- **Verification:** The above script produces no output (all links resolve).

---

## Edge Cases

| Case | Expected behavior | How handled |
|------|-------------------|-------------|
| Reader only cares about setup | README covers it in first 3 sections | Quick start near the top, includes WASM note |
| Reader wants to understand architecture | README links to architecture.md | Progressive disclosure — read only as far as needed |
| Reader asks "why was X decided?" | ADRs answer this | Cross-linked from architecture.md inline callouts |
| Reader wants to contribute | CONTRIBUTING.md is comprehensive | Linked from README, covers setup through PR |
| Reader hits a bug in the live demo | Need to report it | README includes link to GitHub issues |
| Docs get stale | Docs live in-repo, reviewed in PRs | ADR 004 captures this decision |
| CLAUDE.md vs CONTRIBUTING.md overlap | CLAUDE.md is AI context (terse); CONTRIBUTING.md is human onboarding (detailed) | Different audiences, acceptable duplication of core conventions |
| Architecture.md references deleted files | Incorrect docs worse than no docs | Step 4 explicitly audits file references against codebase |
| "Known Edge Cases" section replaced by ADRs | 5 items not covered by any ADR | Rename to "Implementation Notes," keep non-ADR items, replace ADR-covered items with callouts |

## Verification

- [ ] `npm test` passes (no code changes, but sanity check)
- [ ] `npm run build` succeeds
- [ ] README explains what CrowCode is within first paragraph
- [ ] README live demo link works
- [ ] README mentions postinstall WASM step in quick start
- [ ] New developer can go from clone → running tests in under 5 minutes using only docs
- [ ] All relative links between docs resolve correctly (run link-check script)
- [ ] All file paths in CLAUDE.md Key Files table exist (run `ls` on each)
- [ ] ADRs answer "why" for the 4 most commonly asked architectural questions
- [ ] ADRs reference specific commits from git history
- [ ] architecture.md has "How to read this document" navigation
- [ ] architecture.md has no references to deleted files (emitter.ts, environment.ts)
- [ ] architecture.md includes handlers/ subdirectory and service.ts

## References

- [Documentation best practices research](../research/codebase-documentation-best-practices.md)
- [Current architecture doc](../architecture.md)
- [Nygard ADR format](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
- [MADR template](https://adr.github.io/)
- [matklad ARCHITECTURE.md essay](https://matklad.github.io/2021/02/06/ARCHITECTURE.md.html) — "codemap, not atlas"
- [Art of README](https://github.com/hackergrrl/art-of-readme) — cognitive funneling for niche tools
- [Python Tutor README](https://github.com/pathrise-eng/pathrise-python-tutor) — gold standard for educational visualizer READMEs
- [joelparkerhenderson ADR repository](https://github.com/joelparkerhenderson/architecture-decision-record) — cross-referencing patterns
- [C4 model](https://c4model.com/) — progressive abstraction levels for architecture docs
