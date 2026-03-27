# Phase 1: Facet Decomposition
# Topic: ADR Best Practices for Small Open Source Projects

Date: 2026-03-26

## Facets

### FACET 1: Retroactive ADRs
**FACET_QUESTION:** How do teams write ADRs for decisions that were made before the ADR practice was established? What format, tone, and framing conventions exist for "documenting the past"?
**SEARCH_SEEDS:**
- "retroactive ADR" architecture decision record past decision
- "documenting past decisions" architecture decision record
- ADR "for historical reasons" OR "already decided" template

### FACET 2: Lightweight ADR Templates for Small Projects
**FACET_QUESTION:** What minimal ADR templates work well for small teams (1-5 contributors) without enterprise overhead? What fields are truly essential vs. optional?
**SEARCH_SEEDS:**
- lightweight ADR template small project open source
- "architecture decision record" minimal template 2024 2025
- Nygard ADR template alternatives simple

### FACET 3: Considered Alternatives Section Best Practices
**FACET_QUESTION:** How detailed should the "Considered Alternatives" section be? What makes a good alternatives section vs. a perfunctory one?
**SEARCH_SEEDS:**
- ADR "considered alternatives" section best practices how detailed
- architecture decision record alternatives section examples good bad
- "options considered" ADR depth format

### FACET 4: Consequences Section Best Practices
**FACET_QUESTION:** How do you write a "Consequences" section that is genuinely useful rather than obvious? What distinguishes good from bad consequences sections?
**SEARCH_SEEDS:**
- ADR consequences section best practices useful not obvious
- architecture decision record "consequences" section examples
- ADR positive negative consequences tradeoffs how to write

### FACET 5: Numbering, Naming, and Organization Conventions
**FACET_QUESTION:** What are the prevailing conventions for ADR numbering (sequential, date-based), file naming, and directory organization? What works at small-project scale?
**SEARCH_SEEDS:**
- ADR numbering convention sequential date-based filename
- architecture decision record file naming organization small project
- ADR tools adr-tools nygard naming conventions

### FACET 6: Real-World ADR Examples from Open Source Projects
**FACET_QUESTION:** What do real ADRs from actual open source projects look like? Which projects publish their ADRs and what patterns emerge?
**SEARCH_SEEDS:**
- open source project ADR examples github architecture decisions
- "docs/decisions" OR "docs/adr" github real examples
- architecture decision record examples moby kubernetes rust

### FACET 7: ADR Anti-Patterns and Common Mistakes
**FACET_QUESTION:** What are the most common ways ADRs fail to be useful? What mistakes do small teams make when adopting ADRs?
**SEARCH_SEEDS:**
- ADR anti-patterns mistakes common problems
- architecture decision record "not useful" OR "stopped using" OR "failed"
- ADR adoption failure small team pitfalls

## Known Tensions
- Nygard original format vs. newer lightweight variants (MADR, Y-statements, etc.)
- Retroactive ADRs: some argue they defeat the purpose of capturing context at decision time
- Depth vs. brevity: enterprise ADR practice vs. small-project pragmatism
- Immutability: strict (never edit) vs. pragmatic (update status)

## Likely Gaps
- Quantitative data on ADR adoption rates or effectiveness at small project scale
- Guidance specific to TypeScript/SvelteKit or frontend projects
- Empirical evidence on whether retroactive ADRs actually help teams

## Recency Sensitivity
Medium — core ADR practice has been stable since Nygard's 2011 post, but tooling and lightweight variants have evolved through 2023-2025. Bias searches toward recent templates while not discarding foundational sources.
