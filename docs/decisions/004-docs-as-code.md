# ADR-004: Documentation lives in-repo as Markdown

**Status:** Accepted
**Date:** 2026-03-25
**Commit:** `8bcbf82d`

## Context

CrowCode's documentation needs to stay accurate as the codebase evolves. Research reports, architecture decisions, implementation plans, and the system overview all need a home.

The question: where should documentation live?

External wikis (Notion, Confluence, Google Docs) drift because changes to documentation are not part of the code review process. A developer can refactor the engine without updating the wiki, and no one notices until a new contributor reads outdated information.

## Decision

All documentation lives as Markdown files in the repository's `docs/` directory, committed alongside code and reviewed in pull requests.

The documentation structure:
- `docs/architecture.md` — system overview and design
- `docs/decisions/` — architecture decision records
- `docs/research/` — research reports informing decisions
- `docs/plans/` — implementation plans
- `docs/interpreter-status.md` — living feature matrix
- `CLAUDE.md` — AI assistant context (project root)
- `CONTRIBUTING.md` — contributor guide (project root)

## Considered Alternatives

**Notion or Confluence wiki.** Pros: richer formatting, easier for non-developers, WYSIWYG editing. Cons: changes are not tied to code changes, no PR review, no `git blame`, links between docs and code are external URLs that rot.

**GitHub Wiki.** Pros: lives on GitHub, Markdown-based. Cons: separate repository, not part of the PR workflow, not versioned with the code, can't reference relative file paths.

**Auto-generated docs only (TSDoc/TypeDoc).** Pros: always in sync with code. Cons: can't capture rationale, architectural decisions, research, or conceptual explanations — only API surface.

## Consequences

- Documentation changes appear in PRs alongside the code changes they describe
- `git blame` shows who wrote each section and when
- Docs can reference relative file paths (`../architecture.md`, `src/lib/engine/snapshot.ts`)
- Research reports can be committed *before* implementation, creating an auditable record of how decisions were informed
- Contributors can update docs in the same workflow as code — no context switching to a separate tool
- Non-developers cannot easily edit docs without a GitHub workflow (acceptable for a developer tool)
