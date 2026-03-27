# Phase 2: Research Findings

Date: 2026-03-26
Total unique sources consulted: 28+

## Coverage Summary
| Facet | Confidence | Sources |
|-------|-----------|---------|
| Retroactive ADRs | Medium | 8 |
| Lightweight Templates | High | 10 |
| Alternatives Section | High | 7 |
| Consequences Section | High | 8 |
| Numbering/Naming | High | 6 |
| Real Open Source Examples | Medium | 6 |
| Anti-Patterns | High | 5 |

---

## FACET 1: Retroactive ADRs

### Summary
Retroactive ADRs are explicitly endorsed by Microsoft Azure Well-Architected Framework, Spotify, and other practitioners for brownfield/existing systems. The primary challenge is reconstructing context months or years later. Bennett Institute research found retroactive ADRs significantly harder to write because you must "tease apart several decisions and try to remember the context of each one."

### Key Findings
- Microsoft Azure WAF: "An ADR should be started for brownfield workloads, and if the data is available, it should be retroactively generated based on known past decisions." [Azure Learn, 2024]
- Spotify's explicit "backfill" scenario: when a decision exists but is undocumented, the mental model is: Problem exists? Yes → Solution exists? Yes → Is it documented? No → Write an ADR. [Spotify Engineering, 2020]
- Bennett Institute (small research team): explicitly warned retroactive ADRs are "significantly more difficult" because timing of documentation matters — immediate documentation is far easier than reconstruction. [Bennett Oxford, 2024]
- Equal Experts found teams often need to "retroactively document dozens of critical architectural choices that had never been formally recorded" — they used GenAI with a "kernel of truth" one-liner to reconstruct context. [Equal Experts, 2023]
- One approach for retroactive ADRs: insert new information into existing ADR with date stamp and note that info arrived after the decision (mutable/"living document" approach). [joelparkerhenderson, GitHub]
- joelparkerhenderson repo: "Sometimes a decision was made, or an implicit standard forms naturally on its own, but because it was never documented, it's not clear to everyone (especially new hires) that this decision exists."
- No source provides a specific "retroactive ADR" template distinct from regular ADRs — the format is identical; only the framing of context changes.

### Tensions
- Some sources (Bennett Institute) argue retroactive ADRs are counterproductive because you lose the original context; others (Azure, Spotify) treat them as valuable even if imperfect.

### Gaps
- No empirical data on whether retroactive ADRs are actually read or used by teams.
- No specific template variant designed for retroactive use.

---

## FACET 2: Lightweight Templates for Small Projects

### Summary
Three templates dominate for small projects: Nygard's original (5 sections, 1-2 pages), MADR bare-minimal (4 mandatory sections), and Y-statements (single sentence format). MADR 4.0.0 (September 2024) is the most actively maintained and explicitly provides a "bare minimal" variant.

### Key Findings
- **Nygard (2011)**: Title, Status, Context, Decision, Consequences. "One or two pages long." No alternatives section. The canonical minimal template. [Cognitect]
- **MADR bare-minimal (2024)**: Title, Context and Problem Statement, Considered Options, Decision Outcome. Stored as `NNNN-title.md` in `docs/decisions/`. [adr.github.io/madr]
- **MADR minimal "5 essential elements"**: Title, Context and Problem Statement, Decision Drivers, Considered Options, Chosen Option with justification. Described as "close to Nygard's 2011 proposal." [ozimmer.ch, 2022]
- **Y-statement format**: Single extended sentence: "In the context of [X], facing [Y], we decided [Z] and neglected [alternatives] to achieve [benefit], accepting that [drawback]." Excellent for inline code comments or README notes. [Zimmermann / olzzio, Medium]
- **LADR (Thoughtworks)**: Strips ADR to essentials, markdown format, kept in `docs/` directory. Brief alternatives list explaining why rejected. [Carlos Bertin Cano, Medium]
- No tooling required; MADR can be used by copying template into text editor. [MADR GitHub]
- MADR 4.0.0 released September 2024 — most recent maintained template with explicit "bare" and "minimal" variants.
- pmerson template adds explicit **Rationale** section separate from Consequences, citing "Second Law of Software Architecture: why is more important than how." [pmerson, GitHub]

### Tensions
- Nygard omits Alternatives section entirely; MADR makes it mandatory. For small projects, skipping alternatives documentation is tempting but loses value.

---

## FACET 3: Considered Alternatives Section Best Practices

### Summary
The alternatives section should list 2+ real options with brief pros/cons per option — not a perfunctory list. Anti-patterns include "Dummy Alternative" (fake options to make chosen look better) and "Fairy Tale" (only pros, no cons). For small projects, one sentence per alternative is acceptable if the decision is low-stakes; complex decisions warrant a paragraph.

### Key Findings
- **Minimum viable**: "Consider at least two options per issue, as hardly any software design does not have any alternatives." [AWS Architecture Blog / joelparkerhenderson]
- **Anti-pattern "Dummy Alternative"**: Creating non-viable options to inflate appearance of choice. "Unrealistic options presented merely to make preferred choices appear superior." [ozimmer.ch, 2023]
- **MADR format for alternatives**: List each option with "Good, because..." and "Bad, because..." bullets. Pros and Cons of the Options section supports "Neutral (w.r.t.), because..." for neutral tradeoffs. [MADR / ozimmer.ch]
- **Real MADR example**: JUnit5 vs Hamcrest vs AssertJ — each listed with 1-2 bullet pros/cons. JUnit5: "common Java knowledge" but "complex assertions become hard to read." Not paragraphs — just focused bullets. [adr.github.io/madr/examples]
- **Depth guidance**: "Use a separate design document mechanism to explore alternative options thoroughly, and reference these design documents within the ADR." ADR stays concise; details link out. [AWS Architecture Blog]
- **Ozimmer's criteria**: Alternatives should be listed "at the same abstraction level" — don't compare a technology to a pattern, or a product to a protocol.
- For retroactive ADRs: Equal Experts' "kernel of truth" approach — start with the one-liner decision and reconstruct alternatives from existing artifacts (code commits, docs). [Equal Experts]

### Tensions
- MADR recommends listing chosen option FIRST in the considered options section (as a convention); other approaches list it at the end. This affects narrative flow.

---

## FACET 4: Consequences Section Best Practices

### Summary
The consequences section is the most commonly underdeveloped section. Good consequences go beyond obvious tradeoffs to capture: follow-up decisions triggered, downstream constraints, learning curve costs, and conditions under which the decision should be revisited. The "Free Lunch Coupon" anti-pattern (hiding negative consequences) is the most common failure mode.

### Key Findings
- **Nygard's original guidance**: "All consequences should be listed here, not just the 'positive' ones." Positive, negative, and neutral. [Cognitect, 2011]
- **MADR format**: "Good, because [improvement to desired quality]" and "Bad, because [implementation effort or risk]." Structured bullets, not prose paragraphs. [MADR / ozimmer.ch]
- **Anti-pattern "Free Lunch Coupon"**: Ignoring consequences like "extra design, implementation, test effort." [ozimmer.ch, 2023]
- **Useful consequences go beyond the obvious**: Include "information about any subsequent ADRs" triggered, "decisions unlocked or constrained," and "validation or revisit criteria." [joelparkerhenderson]
- **Chesterton's Fence principle**: Consequences section should enable future readers to judge whether circumstances have changed enough to warrant revisiting. Context section is "primary future value." [brittonbroderick.com, 2022]
- **Follow-up review**: "Typical for teams to review each ADR one month later, comparing the ADR information with what's happened in actual practice." [joelparkerhenderson]
- **Ozimmer reflection moment**: "Take your time thinking about the consequences, because it's at that moment when the deepest reflections will come to light, and you could even completely reconsider a decision." [ctaverna.github.io]
- **Confidence level**: Record uncertainty honestly. "Documenting that low confidence status could prove useful for future reconsideration decisions." [Azure WAF, 2024]
- **What "neutral" means**: Learning curve for new team members, follow-up tasks that must happen, side decisions now required. Not positive or negative — just real.

### Tensions
- Nygard original template: single "Consequences" section, all types mixed. MADR: explicitly separates "Good, because" / "Bad, because." Both work; MADR is more scannable for small teams.

---

## FACET 5: Numbering and Naming Conventions

### Summary
Sequential numeric prefix (0001, 0002...) with imperative verb phrase or noun phrase title in lowercase-with-dashes is the dominant convention. Date-based naming (YYYY-MM-DD) is a less common but valid alternative that avoids merge conflicts. Files live in `docs/decisions/` (MADR) or `doc/adr/` (adr-tools/Nygard tradition).

### Key Findings
- **MADR convention**: `NNNN-title-with-dashes.md` — four-digit sequential number (supports up to 9,999). Files in `docs/decisions/`. [MADR GitHub]
- **adr-tools convention**: `doc/adr/NNNN-title.md` — same sequential pattern, different directory. [npryce/adr-tools]
- **joelparkerhenderson convention**: Present tense imperative verb phrases — `choose-database.md`, `format-timestamps.md`, `manage-passwords.md`. No number prefix! [joelparkerhenderson GitHub]
- **Date-based alternative**: `2021-09-24-decided-to-use-dates-in-adrs.md` — eliminates numbering conflicts when multiple contributors work simultaneously. ISO-8601 for sorting. [Cloud Posse]
- **Cloud Posse rationale for dates**: "The combination of date and title should never conflict and it also gives a better idea of when decisions were made." Helpful for retroactive ADRs to preserve original decision date.
- **Leading zeros matter**: `0005` not `5` — ensures lexicographic sort matches chronological order.
- **Martinfowler.com guidance**: "monotonic numbering with descriptive titles (e.g., '0001-HTMX-for-active-web-pages')" stored in `doc/adr` in lightweight markup.
- **Directory names in use**: `doc/adr/`, `docs/adr/`, `docs/decisions/`, `docs/architecture/decisions/` — all common. No universal standard.
- **Never reuse numbers**: Superseded ADRs keep their numbers; they're marked deprecated/superseded.

### Tensions
- Sequential numbers: simple but can cause merge conflicts if two contributors add ADRs simultaneously. Date-based solves this but loses the "ADR-001" reference shorthand.
- MADR uses `docs/decisions/` (plural, noun); adr-tools uses `doc/adr/` (singular, acronym). Both work.

---

## FACET 6: Real Open Source Examples

### Summary
Real open source ADR collections are sparse in TypeScript/frontend projects but abundant in infra/backend projects. MADR's own decision log (0000-0018), npryce/adr-tools, and Crown Commercial Service provide good real examples. The most common pattern is 4-8 ADRs covering foundational technology choices.

### Key Findings
- **MADR's own ADRs** (0000-0018): Topics include "Use Markdown ADRs," "Use CC0 or MIT as License," "Do Not Use Numbers in Headings," "Use Dashes in Filenames," "Add Status Field" — meta-decisions about the project's own conventions. [github.com/adr/madr/docs/decisions]
- **npryce/adr-tools ADR-0001**: "Record Architecture Decisions" — the first ADR documents the decision to use ADRs. Classic self-referential first entry pattern.
- **Crown Commercial Service**: Uses `doc/adr/0011-use-the-same-cloud-architecture.md` format — sequential numbering, concrete infrastructure decisions. [GitHub CCS]
- **GADR project**: Only 2 ADRs (0000-use-markdown-architectural-decision-records, 0001-use-gadr-as-name) — demonstrates minimal/bootstrapping pattern.
- **Spotify** (described): Creator Team documented React Hooks adoption in 2019 as ADR — demonstrates technology adoption pattern for frontend.
- **Pattern across projects**: ADR-0000/0001 is almost always "use ADRs" or "use this ADR format" — the meta-ADR. This is a strong convention.
- **Typical scope for small projects**: 4-12 ADRs covering: format choice, key framework/language choice, storage/persistence approach, testing strategy, deployment approach.

---

## FACET 7: Anti-Patterns

### Summary
Ozimmer (2023) provides the most comprehensive anti-pattern catalog. The most damaging for small projects are: Mega-ADR (everything in one), Blueprint/Policy in Disguise (commanding tone), and Free Lunch Coupon (hiding negatives). The structural Groundhog Day problem (same decision relitigated repeatedly because no ADR exists) is the primary motivator for adopting ADRs.

### Key Findings
- **Groundhog Day**: "People don't know why a decision was made, so it keeps getting discussed over and over." Primary motivator for ADR adoption. [Richards/Ford via edwardthienhoang.wordpress]
- **Mega-ADR**: Stuffing multiple decisions, extensive diagrams, and code into a single ADR. Prevents individual lifecycle management. [ozimmer.ch]
- **Blueprint/Policy in Disguise**: ADR reads like a cookbook or law with commanding voice rather than a journal reporting outcomes. Breaks the conversational "letter to future developer" intent. [ozimmer.ch]
- **Fairy Tale**: Only presenting pros, no cons. Makes the ADR useless for future evaluation. [ozimmer.ch]
- **Dummy Alternative**: Non-viable alternatives listed just to make chosen option look better. [ozimmer.ch]
- **Novel/Epic**: ADR becomes a full Software Architecture Document. Should link out to detailed docs, not contain them. [ozimmer.ch]
- **Sprint**: Considering only short-term effects and single options. Misses long-term consequences. [ozimmer.ch]
- **For small teams specifically**: Bennett Institute found "longer documents often indicated multiple decisions needing separation" — length is a smell for Mega-ADR.
- **Immutability misunderstanding**: Some teams think accepted ADRs can never be updated; pragmatic approach is to mark as superseded and create new ADR for changed decisions. [joelparkerhenderson, Cloud Posse]

---

## Iteration 1: Gap Fills

### Gap: Retroactive ADR specific tone/framing
No source provides a specific retroactive ADR template. However, from aggregate findings:
- Use past tense in Context ("The team was facing...") rather than present tense
- Status should be "Accepted" not "Proposed" for retroactive ADRs
- Add approximate date of original decision even if reconstructed
- Azure WAF explicitly says retroactive ADRs are valid when "data is available"
- Acknowledge uncertainty: "Based on available evidence, the primary drivers were..."

### Gap: Frontend/TypeScript specific examples
No ADR collections found in TypeScript/Svelte/frontend open source projects. Frontend projects tend to use READMEs or inline comments rather than formal ADRs. The pattern is the same — the domain is just different.

### Gap: Quantitative effectiveness data
No empirical studies found on whether ADRs actually improve team outcomes at small project scale. All evidence is qualitative/anecdotal.
