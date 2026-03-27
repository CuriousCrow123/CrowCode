# Research: ADR Best Practices for Small Open Source Projects

> Researched 2026-03-26. Effort level: deep. 28 unique sources consulted.

## Key Findings

1. **Retroactive ADRs are explicitly endorsed and follow the same format as prospective ones** — the only differences are past tense framing in Context, a pre-set "Accepted" status, and an honest acknowledgment of reconstruction uncertainty. Microsoft Azure, Spotify, and Equal Experts all explicitly describe the practice.

2. **The MADR bare-minimal template is the strongest choice for small open source projects** — four mandatory sections (Title, Context and Problem Statement, Considered Options, Decision Outcome), no tooling required, stores as `NNNN-title.md` in `docs/decisions/`. MADR 4.0.0 (September 2024) is the most actively maintained template with explicit lightweight variants.

3. **The Consequences section is the most commonly underdeveloped** — most teams write obvious tradeoffs when they should be capturing: follow-up decisions triggered, downstream constraints imposed on future choices, conditions under which the decision should be revisited, and confidence level. The "Free Lunch Coupon" anti-pattern (hiding negatives) is the most common failure.

4. **The Alternatives section needs at least two real options with concrete pros/cons each** — one sentence per alternative is acceptable for low-stakes decisions; the "Dummy Alternative" anti-pattern (fake options to justify the chosen one) destroys trust in the ADR. List alternatives at the same abstraction level.

5. **ADR-0000 should be "use ADRs"** — every real open source project with ADRs begins with a self-referential ADR documenting the decision to use ADRs. This is a universal convention and an excellent retroactive first ADR for CrowCode.

---

## Retroactive ADRs

### Summary
Retroactive ADRs document decisions made before the ADR practice was adopted. They are explicitly valid — Microsoft Azure's Well-Architected Framework states plainly: "An ADR should be started for brownfield workloads, and if the data is available, it should be retroactively generated based on known past decisions." Spotify formalizes this as a "backfill" scenario. Equal Experts documented it as standard practice on large platform projects.

The primary challenge is context reconstruction. Bennett Institute's small research team found retroactive ADRs "significantly more difficult" because they had to "tease apart several decisions and try to remember the context of each one." The original context — business pressures, team constraints, technical constraints at the time — fades quickly.

### How to Frame a Retroactive ADR

**Status field**: Set to `Accepted` immediately, not `Proposed`. The decision is already made.

**Date**: Use the approximate date the decision was actually made, not today's date. If unknown, use the earliest code commit that reflects the decision (e.g., first commit using the chosen approach).

**Context section**: Write in past tense. "The team was building..." rather than "We are building..." Acknowledge reconstruction: "Based on available evidence, the primary drivers were..." This honesty is more useful than false confidence.

**Decision section**: Write in past tense. "We chose..." rather than "We will choose..."

**Consequences section**: Include what has actually happened since — you have hindsight. Distinguish predicted consequences (what you thought would happen) from observed consequences (what actually happened) if there's meaningful difference.

**Alternatives section**: Reconstruct from memory and artifacts (git history, issue trackers, code comments, README files, Slack/Discord history). Equal Experts uses a "kernel of truth" approach: start with a one-liner decision statement ("On [date] we decided to use X because Y") and reconstruct alternatives from existing artifacts. Acknowledge when alternatives are reconstructed from memory: "The primary alternatives considered at the time were..." If you genuinely cannot reconstruct alternatives, write a brief note: "Alternatives were not formally evaluated; the decision emerged from [constraint/prior experience]."

**What retroactive ADRs are not**: A retroactive ADR is not a post-mortem or a justification of past decisions. The goal is to capture context for future readers, not to defend choices.

### Open Questions
Whether retroactive ADRs provide the same value as prospective ones is genuinely contested. Bennett Institute found the effort high enough to recommend against it unless the decision significantly affects ongoing development. For CrowCode's 4 ADRs, the decisions are recent enough that context reconstruction should be reliable.

---

## Lightweight Templates for Small Projects

### Summary
Three templates work for small projects. Nygard's original (2011) is the baseline: five sections, one to two pages. MADR bare-minimal is the best-maintained lightweight variant as of 2024. Y-statements work for very short inline documentation but lack searchability.

### The MADR Bare-Minimal Template

This is the recommended starting point for CrowCode:

```markdown
# {title}

## Context and Problem Statement

{2-3 sentences describing the situation and the decision needed}

## Considered Options

- Option A
- Option B
- Option C

## Decision Outcome

Chosen option: "{option}", because {justification}.
```

For decisions that warrant more detail, expand with:

```markdown
## Pros and Cons of the Options

### Option A

- Good, because {reason}
- Bad, because {reason}
- Neutral, because {reason}

### Option B

- Good, because {reason}
- Bad, because {reason}

## Consequences

- Good, because {positive outcome}
- Bad, because {negative outcome or cost}
- Neutral: {follow-up task or constrained future decision}
```

### What to Omit for Small Projects

**Decision Drivers**: Often redundant with the Context section for small projects. Skip unless the decision genuinely has multiple competing forces worth calling out explicitly.

**YAML front matter / metadata**: Skip for 1-5 contributor projects. A simple `Status: Accepted` line in the header suffices. Add date as part of the filename or first line.

**Confirmation section**: MADR's optional section describing how compliance will be validated. Skip for small projects.

**More Information**: Only add if there is a linked RFC, design doc, or issue thread worth preserving.

### Y-Statement Format (Ultra-Lightweight)

For very simple decisions, or as a summary line in a README:

> "In the context of [situation], facing [constraint or concern], we decided [choice] and neglected [alternatives] to achieve [benefit], accepting that [drawback]."

Real example: "In the context of the Web shop service, facing the need to keep user session data consistent across instances, we decided for Database Session State and against Client Session State or Server Session State to achieve data consistency, accepting that a session database needs to be designed and implemented."

Y-statements are not a substitute for a full ADR — they lack the alternatives analysis and detailed consequences. They work as a lead-in sentence at the top of a full ADR.

### Open Questions
No template has achieved universal adoption. The choice between Nygard, MADR, and Y-statements is partly aesthetic. What matters is consistency: pick one template and apply it uniformly.

---

## Considered Alternatives Section

### Summary
The Alternatives section should list at least two genuine options with concrete pros/cons for each. One sentence per alternative is acceptable for low-stakes decisions; a short paragraph with "Good, because..." / "Bad, because..." bullets is better for significant decisions. The section fails when alternatives are fake, superficial, or missing entirely.

### What Good Looks Like

From MADR's own example (test assertion frameworks):

**JUnit5** — standard framework, no extra dependency
- Good, because common Java knowledge, no learning curve
- Bad, because complex assertions become hard to read

**Hamcrest** — provides advanced matchers
- Good, because advanced matcher library
- Bad, because increases entry barrier for new contributors

**AssertJ** — fluent assertions
- Good, because more readable tests, fluent API
- Bad, because newcomers must learn additional library

Three options, each with one good and one bad bullet. The chosen option (JUnit5) is clearly not the "best" in all dimensions — it wins on the specific constraint that matters (no extra dependencies).

### Depth Guidelines

**For foundational decisions** (language choice, framework, persistence approach): List 3+ options. Each option gets a short paragraph or 2-3 bullets per option. These decisions are hard to reverse and warrant the investment.

**For tactical decisions** (which library for X, file naming convention): List 2-3 options. One sentence per option explaining why it was not chosen. Total section: 3-5 lines.

**For nearly-forced decisions** (where only one option was viable): Be honest. "Alternatives were not formally evaluated because [constraint]." A non-evaluation documented is more useful than a fake evaluation.

### Anti-Patterns to Avoid

**Dummy Alternative**: Option B is "build our own X from scratch" when the team has no bandwidth. It makes the chosen option look good by comparison but tells future readers nothing useful.

**Abstraction level mismatch**: Comparing a technology (Redis) to a pattern (session storage) to a product (Firebase) as if they are equivalent options. List alternatives at the same level.

**Pros only**: Listing why each alternative is worse than the chosen option, without acknowledging any genuine strength. The point is honest evaluation, not advocacy.

**For retroactive ADRs**: If you genuinely cannot reconstruct alternatives, write: "The team evaluated X and Y at the time. Detailed comparison notes were not preserved, but the primary rejection reason for X was [Z]." Honest approximation beats fabricated detail.

### Open Questions
Whether alternatives should include options that were explicitly rejected vs. options that were never seriously considered is not well-settled. Best practice: include any option that a reasonable engineer would consider, even if you immediately dismissed it — and note why you dismissed it immediately.

---

## Consequences Section

### Summary
The consequences section is where most ADRs fail. Good consequences go beyond obvious tradeoffs to capture: what future decisions are now constrained or enabled, what ongoing costs the team has accepted, and what conditions would warrant revisiting this decision. The goal is giving future readers the tools to evaluate whether the decision still makes sense.

### The "Chesterton's Fence" Test

A consequence entry is useful if it helps a future reader answer: "Has enough changed that this decision should be revisited?" This is Chesterton's Fence applied to architecture: you should not change or remove a decision until you understand why it was made and what depends on it.

Obvious consequence: "Good, because faster builds" — tells a reader nothing about when to revisit.

Useful consequence: "Good, because snapshot pre-computation moves all latency to program load, making step() calls O(1). This trades memory for UX responsiveness. Revisit if programs grow to >100 steps and memory becomes a constraint." — tells a reader exactly when the calculus changes.

### Structure

**Positive consequences**: Concrete benefits. Not "faster" — "step() calls are now O(1) regardless of program length." Not "simpler" — "the engine has no mutable state at step time, making it trivially testable."

**Negative consequences**: Real costs accepted. Not "adds complexity" — "any new op type requires changes to both `builders.ts` and the snapshot application logic — two-file minimum for every extension." Not "harder to debug" — "debugging a wrong snapshot requires tracing through all prior ops, not inspecting live state."

**Neutral consequences** (often omitted, often valuable):
- Follow-up decisions this unlocks or constrains: "This requires defining a canonical op vocabulary before adding new program types."
- Conditions for revisiting: "Reconsider if we add real-time collaborative editing — at that point, lazy evaluation would avoid transmitting full snapshot arrays."
- Follow-up tasks created: "Requires updating all existing programs to use the op builder API."

**Confidence level**: For retroactive ADRs, note if the consequences were uncertain at decision time. "At the time, the memory impact was unknown; in practice, programs stay under 50 steps, making this a non-issue."

### What "Not Obvious" Means in Practice

Obvious: "Positive: fewer bugs because it's simpler." (Every decision is argued to be simpler.)
Not obvious: "Positive: snapshot isolation via structuredClone() means tests can share a base program and mutate independently — no test setup overhead."

Obvious: "Negative: more memory usage."
Not obvious: "Negative: adding a fifth op type requires careful audit of all existing snapshot consumers, since the type discriminant union in TypeScript will catch missing cases at compile time but not wrong behavior at runtime."

### Open Questions
Whether to include a "revisit after [date]" field in the consequences section is contested. ozimmer.ch recommends it; most templates omit it. For a small project, a note in "More Information" or the consequences section itself suffices.

---

## Numbering, Naming, and Organization

### Summary
Sequential four-digit prefix (`0001`, `0002`) with lowercase-hyphenated noun or verb phrase is the dominant convention. Files go in `docs/decisions/` (MADR convention) or `doc/adr/` (Nygard/adr-tools convention). For small teams, either works; pick one and be consistent.

### File Naming

**Recommended pattern**: `NNNN-title-with-dashes.md`

Examples from real projects:
- `0000-use-markdown-architectural-decision-records.md`
- `0001-use-cc0-or-mit-as-license.md`
- `0005-use-dashes-in-filenames.md`
- `0011-use-the-same-cloud-architecture.md`

**Title style**: Present tense imperative ("use X", "adopt Y") or noun phrase ("snapshot precomputation", "four-op model"). Imperative matches commit message conventions. Noun phrase matches doc heading conventions. Both are fine; pick one and be consistent.

**No title numbers**: The number is in the filename, not repeated in the `# Title` heading. MADR explicitly decided not to include numbers in headings (ADR-0002 in their own log).

### Numbering

**Sequential**: Start at 0000 or 0001. MADR starts at 0000 (the meta-ADR). Use four digits minimum (`0001` not `1`) so lexicographic sort matches chronological order.

**Date-based alternative** (Cloud Posse pattern): `2024-03-15-snapshot-precomputation.md`. Avoids merge conflicts for multi-contributor teams. Useful for retroactive ADRs where preserving original decision date matters.

**For CrowCode's retroactive ADRs**: Sequential is simpler. Use the approximate date of each decision in the filename metadata or first line, not as the filename prefix.

### Directory Location

| Convention | Directory | Used by |
|-----------|-----------|---------|
| MADR | `docs/decisions/` | MADR project, GADR |
| Nygard/adr-tools | `doc/adr/` | npryce/adr-tools, many open source projects |
| Common variant | `docs/adr/` | Many teams |
| CrowCode (existing) | `docs/decisions/` | Already has `docs/` dir — use MADR convention |

**For CrowCode**: `docs/decisions/` aligns with MADR and the existing `docs/` structure.

### Never Reuse Numbers

Superseded ADRs keep their numbers. Mark as `Status: Superseded by ADR-0005` and create the new ADR at the next number. The historical record is the value.

### Open Questions
Whether to maintain an `index.md` listing all ADRs is optional but helpful once the count exceeds 10. Below 10, the directory listing suffices.

---

## Real Open Source Examples

### Summary
Most open source projects with ADRs cover 2-20 decisions. The first ADR is almost always "use ADRs" or "use this ADR format." Frontend/TypeScript projects rarely publish formal ADRs; the pattern is more common in infrastructure, backend, and devops projects. Real ADRs are notably shorter than template guidance suggests.

### Documented Patterns in Real Projects

**MADR project (adr/madr)**: 19 ADRs (0000-0018) covering purely meta-decisions: file naming, status fields, heading styles, license choice. All are short (< 1 page). Topics: "Use Dashes in Filenames," "Add Status Field," "Use Asterisk as List Marker." Demonstrates that ADRs can cover conventions, not just architectural choices.

**npryce/adr-tools**: ADR-0001 documents the decision to use ADRs. Context: "We need to record the architectural decisions made on this project." Decision: "We will use Architecture Decision Records, as described by Michael Nygard." Consequences: "See Michael Nygard's article, linked above. For adr-tools, ADRs will be in the repo doc/adr/." — Three sentences total. This is the canonical minimal example.

**Crown Commercial Service**: Infrastructure ADRs at `doc/adr/`. Sequential numbering. Covers cloud architecture, service mesh, identity decisions.

**GADR project**: Only 2 ADRs after bootstrapping — "use markdown ADRs" and "use GADR as name." Demonstrates that a project can have very few ADRs and still benefit.

**Spotify** (described): Adopted React Hooks in 2019, documented as ADR, referenced cross-team. Demonstrates technology adoption ADR for frontend.

### The Meta-ADR Convention

Every project with ADRs starts with: "We will use Architecture Decision Records to document significant architectural decisions." This is ADR-0000 or ADR-0001 universally. It also serves as a great retroactive starting point — CrowCode's first ADR can document the decision to adopt ADR practice.

---

## Tensions and Debates

### 1. Retroactive ADRs: Valuable vs. Counterproductive

**One side**: Bennett Institute (small research team) argues retroactive ADRs are significantly harder, the context is lost, and the effort is better spent on prospective ADRs going forward.

**Other side**: Azure WAF, Spotify, Equal Experts all explicitly endorse retroactive ADRs for brownfield systems. Equal Experts found them standard on large projects.

**Assessment**: For CrowCode's specific case — 4 decisions, all recent (within months), with the original author still present — retroactive ADRs are clearly worth doing. The Bennett Institute concern applies most when the original decision-makers are gone and years have passed. The honest reconstruction approach (acknowledging uncertainty in the context section) resolves most of the concern.

### 2. Immutability vs. Living Documents

**One side**: AWS Prescriptive Guidance and Nygard tradition say accepted ADRs are immutable — any change requires a new superseding ADR. This preserves the historical record.

**Other side**: joelparkerhenderson documents that "mutability has worked better for our teams" — inserting timestamped updates into the existing ADR rather than superseding.

**Assessment**: For small open source projects with few ADRs, either approach works. The immutability principle is more important for large teams where multiple people reference ADRs and a changed ADR might contradict someone's understanding. For CrowCode, pragmatic updates with date stamps are fine for minor corrections; create new superseding ADRs for actual decision changes.

### 3. How Much Detail in Alternatives

**One side**: MADR and ozimmer.ch recommend detailed pros/cons per alternative with explicit "Good, because..." / "Bad, because..." structure.

**Other side**: LADR and small-project guidance suggests one sentence per alternative is sufficient for low-stakes decisions.

**Assessment**: The MADR structured format is better for foundational decisions (snapshot precomputation, four-op model — both of which have significant design implications). One sentence suffices for tactical decisions (docs-as-code, file naming conventions).

---

## Gaps and Limitations

- **No empirical data**: No studies measuring whether retroactive ADRs are actually read or improve team outcomes at small project scale. All evidence is qualitative.
- **No TypeScript/frontend ADR collections found**: Frontend projects rarely publish formal ADRs publicly. The principles transfer, but domain-specific examples are scarce.
- **Retroactive tone guidance is thin**: No source provides a template specifically designed for retroactive use. Best practices were synthesized across sources.
- **Blocked sources**: AWS Architecture Blog (master-architecture-decision-records) returned only CSS/metadata; lasssim.com ADR examples returned CSS only.
- **One contested point uninvestigated**: Whether including a "revisit after [date]" field in consequences is worth the overhead for a small project. No strong evidence found either way.

---

## Sources

### Most Valuable

| Source | Why Valuable |
|--------|-------------|
| [Documenting Architecture Decisions (Nygard, 2011)](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions) | The original; defines the 5-section template and the "all consequences" principle |
| [How to create ADRs — and how not to (ozimmer.ch, 2023)](https://ozimmer.ch/practices/2023/04/03/ADRCreation.html) | Most comprehensive anti-pattern catalog; "Fairy Tale," "Dummy Alternative," "Free Lunch Coupon" |
| [MADR Template and Examples (adr.github.io/madr)](https://adr.github.io/madr/) | Best maintained lightweight template; bare-minimal variant; NNNN-title.md convention |
| [The MADR Template Explained (ozimmer.ch, 2022)](https://ozimmer.ch/practices/2022/11/22/MADRTemplatePrimer.html) | Section-by-section explanation; 5 essential elements; worked example |
| [When Should I Write an ADR (Spotify Engineering, 2020)](https://engineering.atspotify.com/2020/04/when-should-i-write-an-architecture-decision-record) | Explicit backfill/retroactive scenario; decision flowchart; cross-team alignment |
| [Azure Well-Architected Framework ADR guidance (Microsoft, 2024)](https://learn.microsoft.com/en-us/azure/well-architected/architect-role/architecture-decision-record) | Explicit retroactive/brownfield endorsement; confidence level guidance |
| [Recording Technical Decisions Using ADRs (Bennett Institute, 2024)](https://www.bennett.ox.ac.uk/blog/2024/07/recording-technical-decisions-using-adrs/) | Small team perspective; retroactive difficulty acknowledged; timing matters |
| [Accelerating ADRs with GenAI (Equal Experts, 2023)](https://www.equalexperts.com/blog/our-thinking/accelerating-architectural-decision-records-adrs-with-generative-ai/) | Real retroactive ADR workflow; "kernel of truth" approach |

### Full Source List

| Source | Facet | Type | Date | Key contribution |
|--------|-------|------|------|-----------------|
| [Nygard: Documenting Architecture Decisions](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions) | Template | Blog/Practitioner | 2011 | Original 5-section template |
| [adr.github.io](https://adr.github.io/) | All | Community/Reference | ongoing | ADR community hub, template index |
| [MADR (adr.github.io/madr)](https://adr.github.io/madr/) | Template | Open Source | 2024 | Bare-minimal template, NNNN convention |
| [MADR Examples](https://adr.github.io/madr/examples.html) | Real Examples | Open Source | 2024 | JUnit5 vs Hamcrest vs AssertJ worked example |
| [ozimmer.ch: How to create ADRs](https://ozimmer.ch/practices/2023/04/03/ADRCreation.html) | Anti-Patterns | Academic/Practitioner | 2023 | Comprehensive anti-pattern taxonomy |
| [ozimmer.ch: MADR Template Primer](https://ozimmer.ch/practices/2022/11/22/MADRTemplatePrimer.html) | Template | Academic/Practitioner | 2022 | Section-by-section MADR explanation |
| [Spotify: When Should I Write an ADR](https://engineering.atspotify.com/2020/04/when-should-i-write-an-architecture-decision-record) | Retroactive | Industry/Engineering | 2020 | Backfill scenario, cross-team use |
| [Azure WAF: Maintain an ADR](https://learn.microsoft.com/en-us/azure/well-architected/architect-role/architecture-decision-record) | Retroactive | Industry/Docs | 2024 | Explicit brownfield/retroactive endorsement |
| [joelparkerhenderson/architecture-decision-record](https://github.com/joelparkerhenderson/architecture-decision-record) | Template | Open Source | ongoing | Multi-template comparison, naming, mutability |
| [Bennett Institute: Recording Technical Decisions](https://www.bennett.ox.ac.uk/blog/2024/07/recording-technical-decisions-using-adrs/) | Retroactive | Research/Practitioner | 2024 | Small team experience, timing caution |
| [Equal Experts: ADRs with GenAI](https://www.equalexperts.com/blog/our-thinking/accelerating-architectural-decision-records-adrs-with-generative-ai/) | Retroactive | Industry/Consulting | 2023 | Retroactive ADR workflow at scale |
| [martinfowler.com: Architecture Decision Record](https://martinfowler.com/bliki/ArchitectureDecisionRecord.html) | Template | Industry/Practitioner | ongoing | Inverted pyramid, monotonic numbering |
| [Cloud Posse: How to Write ADRs](https://docs.cloudposse.com/learn/maintenance/tutorials/how-to-write-adrs/) | Naming | Industry/Open Source | ongoing | Date-based naming rationale, merge conflicts |
| [npryce/adr-tools ADR-0001](https://github.com/npryce/adr-tools/blob/master/doc/adr/0001-record-architecture-decisions.md) | Real Examples | Open Source | 2016 | Canonical minimal ADR example |
| [MADR docs/decisions](https://github.com/adr/madr/tree/develop/docs/decisions) | Real Examples | Open Source | 2024 | 19 meta-ADRs; NNNN naming in practice |
| [Y-Statements (Zimmermann)](https://medium.com/olzzio/y-statements-10eb07b5a177) | Template | Academic/Practitioner | ongoing | Single-sentence ultra-lightweight format |
| [adr.github.io/adr-templates](https://adr.github.io/adr-templates/) | Template | Community | ongoing | Template comparison index |
| [endjin.com: Architecture Decision Records](https://endjin.com/blog/2023/07/architecture-decision-records) | Template | Industry | 2023 | Mitigation strategy section, async PR workflow |
| [brittonbroderick.com: Using ADRs](https://brittonbroderick.com/2022/05/07/using-architectural-decision-records/) | Consequences | Practitioner | 2022 | Chesterton's Fence framing; context as primary value |
| [pmerson/ADR-template](https://github.com/pmerson/ADR-template) | Template | Open Source | ongoing | Separate Rationale section; "why > how" |
| [ADR vs LADR (Cano, Medium)](https://canobertin.medium.com/what-is-the-difference-between-an-architectural-decision-record-adr-and-a-lightweight-8d75971ea46b) | Template | Blog | ongoing | LADR vs ADR trade-off; Thoughtworks origin |
| [codesoapbox.dev: Preserving Knowledge with ADRs](https://codesoapbox.dev/preserving-critical-software-knowledge-using-architectural-decision-records/) | Consequences | Practitioner | ongoing | Sequential numbering; honest positive/negative/neutral |
| [Vinayak Hegde: Top-Class ADRs (Medium)](https://vinayak-hegde.medium.com/how-to-write-top-class-architectural-decision-records-adrs-fdab28afce81) | Consequences | Blog | ongoing | Seven components; microservices ADR example |
| [ctaverna.github.io: Practical ADR Overview](https://ctaverna.github.io/adr/) | Consequences | Practitioner | ongoing | Consequences as "deepest reflection" moment |
| [GADR project ADRs](https://github.com/adr/gadr/tree/main/docs/adr) | Real Examples | Open Source | ongoing | Minimal 2-ADR bootstrapping pattern |
| [edwardthienhoang: Architecture Decision Anti-Patterns](https://edwardthienhoang.wordpress.com/2020/04/12/summary-fundamentals-of-software-architecture-an-engineering-approach-part-8-architecture-decision-anti-patterns/) | Anti-Patterns | Summary/Blog | 2020 | Groundhog Day, analysis paralysis |
| [openpracticelibrary.com: ADR](https://openpracticelibrary.com/practice/architectural-decision-records-adr/) | Template | Community | ongoing | MADR 2.1.2; lean format guidance |
| [TechTarget: 8 ADR Best Practices](https://www.techtarget.com/searchapparchitecture/tip/4-best-practices-for-creating-architecture-decision-records) | All | Industry/Journalism | ongoing | At-least-two-options rule; thorough alternatives |
