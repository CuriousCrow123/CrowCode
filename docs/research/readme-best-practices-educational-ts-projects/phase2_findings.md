# Phase 2: Findings

**Date:** 2026-03-26
**Total unique sources fetched and read:** 28

---

## Coverage Summary

| Facet | Confidence | Unique Sources | Notes |
|-------|-----------|----------------|-------|
| 1: Exemplary Educational README Examples | High | 8 | Good range — Python Tutor, algorithm visualizers, C memory tools |
| 2: Educational Tool README Sections | High | 7 | Strong consensus across sources |
| 3: Dual Web App + Library Structure | Medium | 5 | Thin — mostly general advice, not specific to dual-component |
| 4: Communicating Niche Nools | High | 6 | Good mix of academic and practitioner sources |
| 5: GitHub Best Practices 2025-2026 | High | 9 | Strong, well-corroborated |
| 6: SvelteKit-Specific Conventions | Medium-Low | 4 | Thin — SvelteKit ecosystem has no firm README conventions |
| 7: README Psychology | High | 6 | Strong, includes academic paper |

---

## FACET 1: Exemplary Educational README Examples

**SUMMARY:** The best READMEs for educational/visualization tools lead with the live experience (demo GIF or "try it live" link), clearly state the pedagogical problem being solved, and keep setup friction minimal. Python Tutor is the gold standard for communicating a step-through code visualizer.

**KEY FINDINGS:**
- Python Tutor README: leads with "helps people overcome a fundamental barrier to learning programming: understanding what happens as the computer executes each line" — directly names the pedagogical problem [pathrise-eng/pathrise-python-tutor, GitHub]
- OnlinePythonTutor (hcientist fork): communicates visualization by describing "single-step FORWARDS AND BACKWARDS through execution" and "view the run-time state of all data structures" — very concrete [hcientist/OnlinePythonTutor, GitHub]
- Algorithm Visualizer (algorithm-visualizer): has demo link but lacks quick-start for users (focuses too much on contributors) — evaluated as prioritizing recruiting over learning [algorithm-visualizer/algorithm-visualizer, GitHub]
- visualize-c-memory: strong demo screenshot, 5-step setup, clear code snippets — but doesn't explain *why* memory visualization matters educationally; assumes familiarity with GDB/VSCode [chatziko/visualize-c-memory, GitHub]
- debug-visualizer (Kobzol): communicates via bachelor thesis framing — academic context sets expectations but is off-putting for casual learners [Kobzol/debug-visualizer, GitHub]
- Memory Graph (Python): praised for "extensive documentation and examples" in community feedback; demonstrates that thorough examples are valued for educational tools [discuss.python.org, 2024]
- PVC.js academic paper: frames the tool's value with empirical data — students solved tasks "1.7 times faster and with 19% more correct answers" — quantifying educational impact is a compelling strategy [PMC/NCBI, 2020]
- awesome-sveltekit: learn.svelte.dev described as a "soup-to-nuts interactive tutorial" — demonstrates importance of leading with the interactive experience [janosh/awesome-sveltekit, GitHub]

**TENSIONS:** None significant — all sources agree educational tools need stronger "why does this exist" framing than standard developer tools

**GAPS:** No TypeScript/SvelteKit educational tools with exemplary READMEs found — ecosystem is newer

**CONFIDENCE:** High

**SOURCE_COUNT:** 8

**SOURCES:**
- https://github.com/pathrise-eng/pathrise-python-tutor | Python Tutor README | Pathrise | N/A | GitHub project | Step-through code visualizer for students
- https://github.com/hcientist/OnlinePythonTutor | OnlinePythonTutor README | hcientist | N/A | GitHub project | Fork with architecture details
- https://github.com/algorithm-visualizer/algorithm-visualizer | Algorithm Visualizer README | algorithm-visualizer team | N/A | GitHub project | Large OSS algorithm viz platform
- https://github.com/chatziko/visualize-c-memory | visualize-c-memory README | chatziko | N/A | GitHub project | GDB+VSCode C memory visualizer
- https://github.com/Kobzol/debug-visualizer | debug-visualizer README | Kobzol | N/A | GitHub project | Academic bachelor thesis memory visualizer
- https://discuss.python.org/t/request-for-feedback-memory-graph-a-python-visualization-tool-for-education/78347 | Memory Graph Discussion | Python community | 2024 | Forum | Educational memory viz community feedback
- https://pmc.ncbi.nlm.nih.gov/articles/PMC7182681/ | PVC.js paper | PMC/NCBI | 2020 | Academic | C program visualization empirical study
- https://github.com/janosh/awesome-sveltekit | Awesome SvelteKit | janosh | 2024 | GitHub curated list | SvelteKit project collection with README patterns

---

## FACET 2: Educational Tool README Sections — What Works

**SUMMARY:** The most effective educational tool READMEs follow a "cognitive funnel" from broad to specific: hook → live demo → why it exists → how to use it → how to set it up. Demo GIFs (8-15s, under 20MB) placed immediately after the title are the single most impactful visual element.

**KEY FINDINGS:**
- "Demonstrate the product within the first screenful — through a GIF, screenshot, or interactive example" [dev.to/belal_zahran — GitHub README Template that Gets Stars]
- GIF best practice: 15fps standard, under 20 seconds, 8-second clips preferred for single interaction demos [rekort.app/blog, 2026]
- Demo + live link placement: "Give a Live Demo link just below the title image" — appears as near-universal recommendation [GitHub community discussions]
- Section order consensus: Title → Badges → Demo/GIF → Live Link → What it does → Features → Quick Start → Usage → Contributing → License [multiple sources]
- Dedicated Demo section: "Create a 'Demo' heading in the README under the description and place the animated GIF under it along with a link to an online demo" [dev.to/kelli]
- Educational context matters: successful educational tools explain the *pedagogical problem* before the solution — "why does this barrier exist for learners?" [Art of README, hackergrrl]
- Cognitive funneling principle: organize from "broadest and most pertinent details" down to specifics — respects how developers scan documentation [Art of README, hackergrrl]
- For 8-second interactive demos: "show one interaction" more useful than comprehensive walkthrough [rekort.app]
- Avoid words like "easy," "obviously," "simple" — these have "high potential to make people feel stupid" [welcometothejungle.com, README docs]
- "How it works" section: 3-5 sentence technical overview appreciated after usage examples [dev.to/haegis]

**TENSIONS:** GIF vs. screenshot: GIFs show interactivity but are large/distracting; some argue static screenshots with a live link are cleaner. Most sources favor GIF for interactive/animated tools.

**GAPS:** No empirical data on section order effect on engagement (all guidance is practitioner opinion)

**CONFIDENCE:** High

**SOURCE_COUNT:** 7

**SOURCES:**
- https://dev.to/belal_zahran/the-github-readme-template-that-gets-stars-used-by-top-repos-4hi7 | GitHub README Template for Stars | belal_zahran | DEV Community | Blog | Top-starred repo patterns
- https://dev.to/kelli/demo-your-app-in-your-github-readme-with-an-animated-gif-2o3c | Demo with Animated GIF | kelli | DEV Community | Blog | GIF demo best practices
- https://rekort.app/blog/gif-for-github-readme | GIF for GitHub README | Rekort | 2026 | Blog | Technical GIF specs and timing
- https://github.com/hackergrrl/art-of-readme | Art of README | hackergrrl | GitHub | Reference | Definitive README philosophy guide
- https://dev.to/haegis/readme-first-how-to-make-your-project-instantly-understandable-3p89 | README First | haegis | DEV Community | Blog | 6-question framework for clarity
- https://www.welcometothejungle.com/en/articles/btc-readme-documentation-best-practices | README Sections Best Practices | Welcome to the Jungle | Industry | Multi-audience README approach
- https://github.com/orgs/community/discussions/166708 | Live link in README | GitHub community | Forum | Live demo placement discussion

---

## FACET 3: README Structure for Dual-Component Projects (Web App + Library/Engine)

**SUMMARY:** No single established pattern exists for dual web app + library READMEs. Best practice synthesized from multiple sources: use a clear "For users" vs. "For developers/contributors" split, with the web app hook (live demo link) prominent at top, and the engine/library API documented in a separate section or linked docs file.

**KEY FINDINGS:**
- Three distinct audiences identified: "End users, technical users/contributors, designers" — dual-component projects serve both end-users (students) and contributors (engine users) [welcometothejungle.com]
- ReLaXeD PDF generator cited as good example: separate sections for contributors (internals) vs. end users (usage) [welcometothejungle.com]
- For complex software: "the Usage section [can be] shortened to just a sentence or two pointing people to your documentation site" [makeareadme.com]
- Library README priorities: Usage examples first, then API reference, then install — "the most-read section after the Quick Start is Examples" [dev.to/documatic]
- Web app README priorities: Live demo link first, then features, then install — opposite order from library
- Flutter Engine README cited as good example of "high-level diagrams to show the stack and its parts" — useful for engine/library component [dev.to/merlos]
- "Progressive disclosure": general information first, detailed content follows — use collapsible `<details>` tags for advanced sections [welcometothejungle.com]
- SvelteKit docs site: links out to external docs rather than cramming everything in README — effective for large projects [sveltejs/kit GitHub]
- Packaging docs in SvelteKit: if publishing engine as library, `$lib` folder and SvelteKit packaging docs guide structure [svelte.dev/docs/kit/packaging]

**TENSIONS:** Single README vs. separate READMEs per component — monorepo style vs. single-repo with sections

**GAPS:** No direct examples of SvelteKit projects with both web app and engine library components found with exemplary README structure

**CONFIDENCE:** Medium

**SOURCE_COUNT:** 5

**SOURCES:**
- https://www.welcometothejungle.com/en/articles/btc-readme-documentation-best-practices | README Best Practices | Welcome to the Jungle | Industry | Multi-audience structure
- https://www.makeareadme.com/ | Make a README | makeareadme.com | Reference | Foundational README principles
- https://dev.to/merlos/how-to-write-a-good-readme-bog | How to Write a Good README | merlos | DEV Community | Blog | Audience segmentation approach
- https://github.com/sveltejs/kit | SvelteKit README | Svelte team | GitHub | Official | Reference for SvelteKit project README style
- https://dev.to/documatic/how-to-write-an-awesome-readme-cfl | How to Write an Awesome README | documatic | DEV Community | Blog | Library section ordering

---

## FACET 4: Communicating Niche Developer Tools

**SUMMARY:** For niche tools, the README must first establish that the problem exists before explaining the solution. "Cognitive funneling" + "pedagogical problem first" is the winning pattern: name the barrier students hit, then position the tool as the solution, with concrete language about what users see/do.

**KEY FINDINGS:**
- PVC.js paper strategy: frames tool against "three critical problems" (capability, installability, usability) — competing tools named explicitly; value is comparative [PMC/NCBI, 2020]
- Emotional hook strategy: "Every project begins with a problem. You had a pain point, a frustration, a late-night 'there has to be a better way' moment. That's your hook." [nmd.imporinfo.com, 2025]
- One-liner specificity: "Determines whether a moving axis-aligned bounding box (AABB) collides with other AABBs" is better than vague description — be as specific as the tool is [Art of README]
- Sell the solution not the code: "This library automates the process, saving you hours of tedious work" — focus on outcome for the user [nmd.imporinfo.com]
- For C/memory niche: visualize-c-memory assumes too much GDB familiarity; better to establish the *learning gap* (C memory is hard to reason about) first [chatziko/visualize-c-memory assessment]
- Python Tutor one-liner exemplary: "helps people overcome a fundamental barrier to learning programming: understanding what happens as the computer executes each line of a program's source code" — names the barrier + names the solution mechanism [Python Tutor README]
- Academic framing (PVC.js data): "students solved tasks 1.7x faster and with 19% more correct answers" — empirical claims are compelling for educator audience [PMC/NCBI]
- For CS students as audience: explain memory layout concepts in the README opening (stack vs. heap) — don't assume C knowledge [archbee.com advice]
- Curse of knowledge: "highly technical people [fail] to reconstruct their thinking before becoming so knowledgeable" — write README for student discovering tool, not expert [writing-skills.com]

**TENSIONS:** Technical depth vs. accessibility — CS educators may want depth, students need plain language. Solution: use progressive disclosure or dual-audience sections.

**GAPS:** No specific research on README effectiveness for C programming education tools specifically

**CONFIDENCE:** High

**SOURCE_COUNT:** 6

**SOURCES:**
- https://pmc.ncbi.nlm.nih.gov/articles/PMC7182681/ | PVC.js: Visualizing C Programs | PMC/NCBI | 2020 | Academic | C program visualization for novices
- https://nmd.imporinfo.com/2025/10/how-to-write-readme-files-that-actually.html | README Files That Get Contributors | nmd.imporinfo | 2025 | Blog | Emotional hook strategy
- https://github.com/hackergrrl/art-of-readme | Art of README | hackergrrl | GitHub | Reference | One-liner specificity principles
- https://github.com/chatziko/visualize-c-memory | visualize-c-memory | chatziko | GitHub | Project | Real-world C memory visualizer README
- https://www.archbee.com/blog/readme-creating-tips | README Creating Tips | archbee.com | Industry | Multi-audience writing
- https://www.writing-skills.com/knowledge-hub/how-to-write-for-a-non-technical-audience/ | Writing for Non-Technical Audience | writing-skills.com | Industry | Curse of knowledge in docs

---

## FACET 5: GitHub README Best Practices 2025-2026

**SUMMARY:** In 2025-2026, the benchmark for a high-performing GitHub README is: center-aligned logo → 2-4 badges → compelling one-liner → demo GIF → live demo button → 4-6 feature bullets → quick start (copy-paste, under 2 min) → link to docs → contributing → license. Academic research confirms most projects fall far short of this benchmark.

**KEY FINDINGS:**
- Academic study (arxiv 2502.18440): 4,226 READMEs studied — "projects create minimal READMEs proactively, but often publish CONTRIBUTING files following an influx of contributions" — most READMEs are reactive afterthoughts [arxiv, 2025]
- Top template (othneildrew/Best-README-Template): most starred README template on GitHub — sections: About, Built With, Getting Started, Usage, Roadmap, Contributing, License, Contact, Acknowledgments [GitHub]
- Badges: 2-4 at top maximum; build status, license, version most valuable; Shields.io for consistency [daily.dev, 2025]
- Daytona case study (4,000 stars week 1): Logo → badges → elevator pitch → visual → features → quick start → "the Why" → backstory — "avoid unnecessarily long README files" [daytona.io]
- Repo with detailed READMEs get 50% more contributions (claimed by dev.to/belal_zahran — no primary source cited, but widely repeated)
- Quick-start testing rule: "Your installation instructions must work on a completely fresh machine without modification" [dev.to/belal_zahran]
- GitHub "About" section: complete with description, website link, and topic tags for discoverability — README alone is not enough [daytona.io]
- Modern GitHub features: video embeds now supported in README (2024+); GitHub renders Mermaid diagrams natively [healeycodes.com]
- `<details>` tags for collapsible sections: effective for keeping README scannable while preserving detail [welcometothejungle.com]
- "One purpose": "The README bridges 'What is this?' to active usage. Architecture decisions and advanced topics belong elsewhere." [dev.to/belal_zahran]

**TENSIONS:** Long comprehensive README vs. short focused README — some advocate "too long is better than too short" (makeareadme.com) while others warn long READMEs "deter users and contributors" (daytona.io). Resolution: short README + links to dedicated docs for advanced content

**GAPS:** No rigorous empirical research on optimal README length for adoption rates

**CONFIDENCE:** High

**SOURCE_COUNT:** 9

**SOURCES:**
- https://arxiv.org/abs/2502.18440 | README and CONTRIBUTING Files in FLOSS | arxiv | 2025 | Academic | Empirical study of 4,226 READMEs
- https://github.com/othneildrew/Best-README-Template | Best README Template | othneildrew | GitHub | Reference | Most-starred README template
- https://daily.dev/blog/readme-badges-github-best-practices | Badge Best Practices | daily.dev | 2025 | Industry | Badge selection and placement
- https://www.daytona.io/dotfiles/how-to-write-4000-stars-github-readme-for-your-project | 4000 Stars README | daytona.io | Industry | High-starred README case study
- https://www.makeareadme.com/ | Make a README | makeareadme.com | Reference | Canonical README principles
- https://healeycodes.com/writing-an-awesome-github-readme | Awesome GitHub README | healeycodes.com | Blog | GIF usage and GitHub feature advice
- https://dev.to/belal_zahran/the-github-readme-template-that-gets-stars-used-by-top-repos-4hi7 | README Template That Gets Stars | DEV Community | Blog | Top-repo pattern analysis
- https://www.freecodecamp.org/news/how-to-write-a-good-readme-file/ | How to Write a Good README | freeCodeCamp | Industry | Comprehensive section guide
- https://dbader.org/blog/write-a-great-readme-for-your-github-project | Write a Great README | dbader.org | Blog | Seven essential sections

---

## FACET 6: SvelteKit-Specific README Conventions

**SUMMARY:** No strong SvelteKit-specific README conventions exist — the ecosystem is too young for established norms. The official sveltejs/kit README is minimal (packages table + contribution links). SvelteKit examples follow a code-first, numbered-step structure for setup. The key SvelteKit-specific element to document is the GitHub Pages deployment (adapter-static + .nojekyll).

**KEY FINDINGS:**
- Official SvelteKit examples standard: "each example should contain a README.md that describes what the example is about and some of the technical decisions that were made/packages that were used" [sveltejs/examples]
- SvelteKit GitHub Pages setup: document adapter-static installation, paths.base config, .nojekyll file — these are SvelteKit-specific deployment gotchas [metonym/sveltekit-gh-pages README]
- sveltejs/kit README itself: very minimal — packages table, community links, MIT license — not a useful template for educational app projects [sveltejs/kit GitHub]
- Numbered step structure works well for SvelteKit setup: "1) Use the static adapter, 2) Modify paths.base, 3) Add .nojekyll" [metonym/sveltekit-gh-pages]
- Commands to document for SvelteKit projects: `npm run dev`, `npm run build`, `npm run preview`, `npm test`, `npm run check` — these are the standard SvelteKit developer commands
- TypeScript + SvelteKit: document that `npm run check` uses svelte-check for type verification — non-obvious to developers unfamiliar with the stack
- No SvelteKit community README spec or strong convention found — general TypeScript/web app conventions apply

**TENSIONS:** None — sources agree SvelteKit has no specific README conventions yet

**GAPS:** No exemplary SvelteKit educational project README found for direct comparison

**CONFIDENCE:** Medium-Low (thin coverage — few sources)

**SOURCE_COUNT:** 4

**SOURCES:**
- https://github.com/sveltejs/kit | SvelteKit official README | Svelte team | GitHub | Official | Minimal reference for SvelteKit conventions
- https://github.com/metonym/sveltekit-gh-pages | SvelteKit GitHub Pages README | metonym | GitHub | Project | Numbered-step SvelteKit setup example
- https://github.com/sveltejs/examples | SvelteKit examples conventions | Svelte team | GitHub | Official | What SvelteKit examples should include
- https://github.com/janosh/awesome-sveltekit | Awesome SvelteKit | janosh | GitHub | Curated list | SvelteKit project patterns

---

## FACET 7: README Psychology — First Impressions and Discoverability

**SUMMARY:** Developers evaluate a README in 10-30 seconds using F-pattern scanning. The critical content is the first screenful: project name + one-liner + visual/demo. Projects that fail to convey purpose in this window are abandoned. For educational tools targeting students, the hook must address a felt pain before proposing a solution.

**KEY FINDINGS:**
- 10-30 second evaluation window: "Your README file is the gateway to your project - it needs to grab attention in 30 seconds" [readmecodegen.com, 2025]
- Cognitive funneling: "like a funnel held upright, where the widest end contains the broadest, most pertinent details" — information flows from general to specific [Art of README, hackergrrl]
- F-pattern scanning: readers use headers (##) and bullet points as entry points — dense paragraphs are skipped [multiple sources]
- "Show, don't tell": "A visual can instantly clarify what your app looks like or how it behaves" [dev.to/haegis]
- Abandoned project signal: poor README correlates with project abandonment — "a README is a reflection of how a repository is maintained" [healeycodes.com]
- Discoverability beyond README: GitHub topic tags + "About" section + description are indexed by search — critical for educational tools wanting student discovery [daytona.io]
- Academic research on README quality: "the actual content and quality of READMEs vary wildly in practice. Critical sections are often missing or disordered, language can be overly technical" [arxiv 2502.18440]
- Target audience matters: "end users are the actual users of your application... may not have strong technical knowledge and are more worried about the functional aspects" [dev.to/merlos]
- For educators/students: the hook is "this helps students understand X concept" — appeal to the teaching or learning goal [PVC.js paper, Python Tutor README approach]
- Human tone: "Skip the corporate tone... Be friendly, clear, and even a little funny if it suits your project" [dev.to/haegis]

**TENSIONS:** Developer-focused vs. student-focused opening — do you write for someone who wants to contribute, or someone who wants to learn? Resolution: write opening for users/students, reserve technical details for lower sections

**GAPS:** No eye-tracking or click-through data on README elements specifically; psychological claims are practitioner-based, not from rigorous studies

**CONFIDENCE:** High (well corroborated across many sources, supported by 1 academic paper)

**SOURCE_COUNT:** 6

**SOURCES:**
- https://github.com/hackergrrl/art-of-readme | Art of README | hackergrrl | GitHub | Reference | Cognitive funneling and evaluation psychology
- https://arxiv.org/abs/2502.18440 | README Files in FLOSS | arxiv | 2025 | Academic | Empirical quality assessment
- https://www.readmecodegen.com/blog/beginner-friendly-readme-guide-open-source-projects | Beginner-Friendly README Guide | readmecodegen | 2025 | Industry | 30-second evaluation window
- https://healeycodes.com/writing-an-awesome-github-readme | Awesome GitHub README | healeycodes.com | Blog | Repository maintenance signal
- https://dev.to/haegis/readme-first-how-to-make-your-project-instantly-understandable-3p89 | README First | haegis | DEV Community | Blog | Show don't tell, human tone
- https://dev.to/merlos/how-to-write-a-good-readme-bog | Write a Good README | merlos | DEV Community | Blog | Audience targeting

---

## Iteration 1: Gap Fill — Dual-Component Structure and SvelteKit Examples

Additional searches conducted to deepen Facets 3 and 6.

**Finding:** SvelteKit packaging docs recommend documenting library exports in package.json "exports" field — for CrowCode's engine, if ever published as a library, this is where to start [svelte.dev/docs/kit/packaging]. Current recommendation: since CrowCode is not yet a published library, treat the engine as an internal module and document it in architecture docs rather than README.

**Finding:** For projects with both a live demo and a library: httpie/httpie listed in awesome-readme as exemplar — uses "description, demo screenshots, build badges, usage examples" [matiassingers/awesome-readme]. The pattern: web app experience first, then API/library docs.

**Finding:** SvelteKit's own READMEs (language-tools, svelte-vscode) use a packages table structure for multi-package repos. For single-package SvelteKit apps, no special structure needed beyond standard web app README.

**ADDITIONAL SOURCES (Iteration 1):**
- https://github.com/matiassingers/awesome-readme | Awesome README | matiassingers | GitHub | Reference | 80+ exemplary README projects curated
- https://svelte.dev/docs/kit/adapter-static | SvelteKit Static Adapter | Svelte team | Official docs | Deployment documentation reference
