# Architecture Decision Records

Decisions that shaped CrowCode's design. Each record captures the context, alternatives considered, and consequences — so future contributors understand *why* things work this way.

| # | Title | Status | Date |
|---|-------|--------|------|
| 001 | [Pre-compute all snapshots upfront](001-snapshot-precomputation.md) | Accepted | 2026-03-25 |
| 002 | [Four primitive op types for all memory changes](002-four-op-model.md) | Accepted | 2026-03-25 |
| 003 | [Unified Memory class replaces Environment + Emitter](003-unified-memory-class.md) | Accepted | 2026-03-26 |
| 004 | [Documentation lives in-repo as Markdown](004-docs-as-code.md) | Accepted | 2026-03-25 |

## Adding a new ADR

Copy the template below. Use the next sequential number. Write the Context section as if the decision hasn't been made yet — neutral, factual. Keep it to 1-2 pages.

```markdown
# ADR-NNN: [Title as imperative phrase]

**Status:** Proposed | Accepted | Deprecated | Superseded by ADR-NNN
**Date:** YYYY-MM-DD

## Context
[What forces led to this decision?]

## Decision
[What we decided. Active voice.]

## Considered Alternatives
[2-3 alternatives with brief pros/cons]

## Consequences
[All results — positive, negative, and neutral.]
```
