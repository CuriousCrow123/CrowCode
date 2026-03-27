# Phase 2: Research Findings

## Coverage Summary
- **Total unique sources:** ~30 (after deduplication)
- **Per-facet confidence:** All 5 facets rated HIGH
- **Blocked sources:** None reported

---

## Facet 1: Inline Documentation

SUMMARY: Comments should explain *why* code exists — rationale, intent, tradeoffs — not *what* it does. Self-documenting code reduces but doesn't eliminate comment need. Outdated or redundant comments are worse than no comments.

KEY_FINDINGS:
- "Code tells you how; comments tell you why" — dominant principle (Stack Overflow Blog, Spertus 2021)
- Uncle Bob: every comment is "a failure to make code self-explanatory" — yet acknowledges rare legitimate cases for complex algorithms
- Nine concrete rules from Stack Overflow Blog: don't duplicate code; explain unidiomatic code; link to original sources; add comments when fixing bugs with issue tracker refs; mark TODOs
- Self-documenting code has five failure modes: stale naming, loss of "why", context loss through over-decomposition, names too long to read, naming overconfidence (SubMain)
- Five situations where comments are essential regardless of clarity: intent/rationale, magic numbers, solution tradeoffs, convention exceptions, system architecture relationships
- Python PEP 257 + Real Python: docstrings mandatory for all public modules/functions/classes/methods; four competing formats (Google, reST/Sphinx, NumPy, Epytext)
- Type annotations reduce need for @param-type comments but don't replace purpose/constraint descriptions
- TSDoc standardizes JSDoc for tooling interop; outdated docstrings "more harmful than no docstrings"
- Documentation needs vary by audience experience level — juniors benefit from more inline explanation (Jonathan Hall 2024)

TENSIONS: Uncle Bob treats comments as failure vs. SubMain/Hall treating them as legitimate first-class tools. Secondary: comprehensive public API docstrings vs. "excessive documentation breaks focus" on internal code.

CONFIDENCE: high
SOURCES: 6

---

## Facet 2: Project-Level Documentation

SUMMARY: READMEs orient newcomers; architecture docs capture structural decisions and quality goals; ADRs record individual decisions with context, rationale, and consequences. Each is most useful stored in version control alongside code.

KEY_FINDINGS:
- README core sections: title, description, prerequisites, installation, usage examples, license. Internal projects add: team standards, CI/CD status, build/test commands
- Nygard ADR format (2011): Title, Status, Context, Decision ("We will..."), Consequences. "One or two pages, written as if conversation with future developer"
- MADR extends Nygard with explicit "Considered Options" section — prevents re-litigating settled decisions
- ADRs should be immutable once accepted; new ADR supersedes old one (Microsoft Azure WAF, AWS)
- Microsoft ADR requirements: problem statement, options considered, decision outcome with tradeoffs, confidence level. "Avoid making decision records design guides"
- arc42 template: 12 sections covering goals, constraints, context, solution strategy, building blocks, runtime, deployment, crosscutting concepts, decisions, quality requirements, risks, glossary. All optional — populate incrementally
- C4 model: four levels (System Context, Container, Component, Code) mapping to arc42 sections
- Architecture docs should target multiple audiences simultaneously
- ADRs stored in docs/decisions/ with sequential numbering and README index
- Common pitfalls: documenting everything upfront, documenting implementation not decisions, not updating, overly complex diagrams

TENSIONS: Completeness vs. maintainability (arc42's 12 sections vs. Nygard's brevity). No consensus on which ADR template is authoritative.

CONFIDENCE: high
SOURCES: 9

---

## Facet 3: API Documentation

SUMMARY: Hybrid model consensus: auto-generated reference docs from OpenAPI spec + hand-written conceptual content (guides, tutorials, quickstarts). Sync via CI/CD with contract-testing tools.

KEY_FINDINGS:
- 84% of developers use technical documentation for learning; 90% rely on docs in API/SDK packages
- 80% say clear documentation influences API adoption; only 10% of organizations fully document their APIs
- 75% of APIs fail to conform to their specifications — drift is the norm
- Spec-first development (write OpenAPI spec before implementation) is primary defense against drift
- Contract testing tools (Dredd, Schemathesis) validate live API matches spec on every build
- Docs-as-code (Markdown + Git + CI/CD) is dominant workflow pattern
- Tool landscape: Swagger UI (budget), Redocly (Git/CI teams), ReadMe (DevRel/analytics), Bump.sh (static + changelog), Fern (SDK + doc generation)
- AI integration emerging (ReadMe Owlbot, Theneo GPT-4) but human review essential
- Machine-readable docs now competitive requirement for AI code generation tools
- Ownership ambiguity is structural root cause of drift

TENSIONS: Code-first vs. spec-first. Auto-generation scope (reference only vs. AI-generated guides). Hosted SaaS vs. self-hosted CLI tools.

CONFIDENCE: high
SOURCES: 7

---

## Facet 4: Developer Onboarding Documentation

SUMMARY: Layered document types — setup guides, architecture overviews, ADRs, contribution workflows — organized for progressive navigation. Proximity to code, visual diagrams, executable examples, and modular indexes are most effective.

KEY_FINDINGS:
- Environment setup is highest priority — poor setup docs cause 20–30% of first three months spent fighting environment
- Architecture docs must explain "why" behind decisions, not just structure
- Microsoft Engineering Playbook template: Overview/Goals, Contacts, Team Agreement, Dev Environment Setup, Project Building Blocks, Resources
- Structured onboarding = 62% faster time-to-productivity (Stack Overflow 2024)
- Poor documentation costs 15–25% of engineering capacity, $500K–$2M annually
- Each one-point DXI documentation improvement saves 13 min/developer/week
- Contribution guides should assume no prior familiarity, maintain "light and friendly tone"
- "The closer documentation is to what it documents, the more likely it gets updated"
- C4 model recommended for introducing architecture at multiple levels
- Three-day onboarding cadence outperforms documentation dumps and meeting-heavy approaches
- 44% of organizations report onboarding takes 2+ months

TENSIONS: Documentation depth vs. discoverability (lean indexes vs. thorough guides). Async documentation vs. human mentorship sessions. Platform choice matters less than maintenance discipline.

CONFIDENCE: high
SOURCES: 6

---

## Facet 5: Documentation Maintenance

SUMMARY: Three complementary approaches: docs-as-code (version control, PRs, CI checks), explicit ownership (DRIs), and auto-generation from code. Without deliberate process, docs decay within 6 months.

KEY_FINDINGS:
- 56% of teams cite keeping docs up-to-date as biggest challenge (State of Docs 2025)
- Docs decay within 6 months, become "actively misleading" within a year
- Docs-as-code adopted at scale by Google, Microsoft, GitHub, Squarespace, UK Home Office
- Squarespace identified four root causes of stale docs: disjointed workflows, unclear ownership during transitions, infrequent bulk updates, lack of traceability
- CI checks: spell/grammar linting (Vale, TextLint), broken link detection, Markdown formatting (markdownlint), OpenAPI linting (vacuum), code example validation (doctest)
- Ownership anti-pattern: "everyone's responsibility = no one's." Solution: DRI per major system
- 78% of developers report outdated docs as significant productivity blocker
- Developers spend 3–10 hours/week searching for undocumented information
- Living documentation (auto-generating from code/specs/BDD via CI) is strongest accuracy insurance
- 77% of teams don't use structural frameworks like Diátaxis
- Quarterly documentation audits recommended for conceptual/architectural content
- Vale + markdownlint in CI enforce spelling, grammar, formatting, style guides

TENSIONS: Docs-as-code vs. dedicated documentation platforms (scaling pain at larger orgs). Auto-generation vs. human authoring (generated can't capture decisions/rationale). Engineer-owned vs. technical-writer-owned.

CONFIDENCE: high
SOURCES: 7
