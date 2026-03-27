# Phase 2 Findings

Coverage summary: 13 unique pages fetched. All 5 facets covered. Sources: Claude Code official docs (2), GitHub repos (3), industry blogs (5), research sites (2), community guides (1).

---

## FACET 1: SKILL_STRUCTURE
CONFIDENCE: high
SOURCE_COUNT: 5

KEY FINDINGS:
- Skills = SKILL.md files with YAML frontmatter + markdown instructions. The `name` field becomes the slash command. `description` drives automatic Claude invocation. [source: code.claude.com/docs/en/slash-commands]
- Two invocation types: "reference content" (knowledge/conventions, inline) vs. "task content" (step-by-step workflows, side effects — use disable-model-invocation: true). [source: code.claude.com/docs/en/slash-commands]
- Multi-phase skills use explicit numbered steps. The built-in /batch skill follows: research → decompose → present plan → spawn workers per git worktree → each worker implements + runs tests + opens PR. [source: code.claude.com/docs/en/slash-commands]
- context: fork runs skill in isolated subagent context. agent: field picks Explore/Plan/general-purpose. Supporting files (examples/, scripts/, reference.md) keep SKILL.md under 500 lines. [source: code.claude.com/docs/en/slash-commands]
- Official 4-phase workflow pattern: Explore (Plan Mode, read-only) → Plan → Implement → Commit. "Separate research and planning from implementation to avoid solving the wrong problem." [source: code.claude.com/docs/en/best-practices]
- Multi-agent swarm uses: Pipeline pattern (chained dependencies), Parallel Specialists (simultaneous review agents), Self-Organizing Swarm (workers race to claim tasks from shared queue). [source: gist.github.com/kieranklaassen/4f2aba89594a4aea4ad64d753984b2ea]
- Task state machine: pending → in_progress → completed. Persistent JSON files survive restarts. Dependencies prevent premature execution. [source: gist.github.com kieranklaassen swarm skill]

GAPS: No published specification for exactly how phase transitions should be communicated back to the orchestrator in custom skills (beyond TodoWrite or task files).

---

## FACET 2: HUMAN_CHECKPOINTS
CONFIDENCE: high
SOURCE_COUNT: 4

KEY FINDINGS:
- Core trigger test: "Would you accept the agent performing this without asking first?" Irreversible actions = mandatory checkpoint. Reversible low-risk actions = automate. [source: permit.io HITL guide]
- Five categories mandating human checkpoints: access control changes, infrastructure modifications, financial operations, data access (sensitive), destructive actions (delete/overwrite). [source: permit.io HITL guide]
- Four implementation patterns: Interrupt & Resume (LangGraph interrupt()), Human-as-a-Tool (agent calls human feedback as a tool), Approval Flows (permission engine routes to designated role), Fallback Escalation (agent failure routes to human). [source: permit.io HITL guide]
- State must be persisted through checkpoint pause, then resumed from exact pause point. LangGraph: keyed by thread_id. [source: zylos.ai checkpointing]
- Official Claude Code checkpoint mechanism: every action creates a checkpoint. /rewind or Esc+Esc restores conversation + code to any prior state. claude --from-pr links sessions to PRs for resumption. [source: code.claude.com/docs/en/common-workflows]
- Plan Mode as pre-execution checkpoint: read-only phase, Claude uses AskUserQuestion to gather requirements, then presents plan for approval before any writes. Ctrl+G opens plan in editor for human editing. [source: code.claude.com/docs/en/common-workflows]
- Agentic coding best practice: "Require implementation plans before code generation; review and approve plans to catch misunderstandings early." [source: agentic-coding.github.io]
- "Monitor execution actively; interrupt unexpected behavior immediately with clear feedback." [source: agentic-coding.github.io]

GAPS: No clear community consensus on exactly how often to prompt in a skill (once at start, between phases, or never). Claude Code's --permission-mode plan is the closest official answer.

---

## FACET 3: GIT_INTEGRATION
CONFIDENCE: high
SOURCE_COUNT: 4

KEY FINDINGS:
- Git worktrees as isolation primitive: each parallel agent session gets its own worktree + branch. claude --worktree creates at .claude/worktrees/<name>/. Subagents can use isolation: worktree frontmatter. [source: code.claude.com/docs/en/common-workflows]
- /batch skill uses one worktree per work unit, each worker implements, runs tests, opens PR. Main branch never touched. [source: code.claude.com/docs/en/slash-commands]
- Checkpointed commits as safety: "Make frequent meaningful Git commits...if the process has gone awry, don't hesitate to roll back to the nearest checkpoint." [source: agentic-coding.github.io + codegen.com]
- GitHub Agentic Workflows: read-only by default; write operations require explicit approval through "safe-outputs" — pre-approved operation sets. [source: github.blog agentic workflows]
- netresearch/git-workflow-skill: multi-step workflow: pull → branch → stage (git add -p) → commit → push → PR → merge → cleanup. Conventional Commits format enforced. Pre-commit hooks for validation. [source: github.com/netresearch/git-workflow-skill]
- "The golden rule: AI agents can propose code, never own it. AI-generated PRs should be tagged and require extra approvals." [source: github.blog community discussions]
- Atomic commits per logical change. Never commit broken tests. Session can be resumed via --from-pr. [source: code.claude.com best practices]

GAPS: No published guidance specifically about handling git conflicts when multiple parallel worktree agents touch shared files.

---

## FACET 4: FAILURE_MODES
CONFIDENCE: high
SOURCE_COUNT: 5

KEY FINDINGS:
- Goal drift (context pollution): long sessions with irrelevant context cause Claude to "forget" earlier instructions. Fix: /clear between tasks, start fresh sessions. [source: code.claude.com/docs/en/best-practices]
- Over-correction loop: correcting Claude twice on same issue pollutes context with failed approaches. Fix: after two failures, /clear and write better initial prompt. [source: code.claude.com/docs/en/best-practices]
- Infinite exploration: Claude reads hundreds of files without scoping, fills context. Fix: scope narrowly or use subagents. [source: code.claude.com/docs/en/best-practices]
- Bloated SKILL.md: >500 lines causes Claude to ignore rules. Fix: prune ruthlessly, move detail to supporting files. [source: code.claude.com/docs/en/best-practices + slash-commands docs]
- Trust-then-verify gap: plausible-looking output that doesn't handle edge cases. Fix: always provide verification (tests, scripts, screenshots). [source: code.claude.com/docs/en/best-practices]
- Cascading errors in multi-step: a single misclassification propagates silently through downstream systems. [source: concentrix.com 12 failure patterns (blocked) / sendbird.com agentic challenges]
- Over-automation without oversight: Klarna example — 80% AI automation caused customer complaints, company reverted to AI-augmented humans. [source: sendbird.com agentic challenges]
- Coordination failures in multi-agent: conflicting actions, duplicated efforts, missed handoffs. [source: sendbird.com / concentrix.com]
- Data quality / hallucination acting on invented facts: agents execute transactions based on false data. [source: sendbird.com agentic challenges]
- Four structural failure causes: unrealistic expectations, poor use-case prioritization, data quality, governance/auditability gaps. [source: builtin.com agentic implementation failures]
- Heartbeat timeout failure detection: in swarm pattern, 5-minute timeout auto-reclaims tasks from unresponsive workers. [source: kieranklaassen swarm SKILL.md]

GAPS: Concentrix "12 failure patterns" article was blocked (403). Could only get summary from search snippets.

---

## FACET 5: ABORT_RESUME
CONFIDENCE: high
SOURCE_COUNT: 4

KEY FINDINGS:
- Claude Code native resume: claude --continue (most recent), claude --resume (picker), claude --from-pr 123. Sessions persisted locally with full message + tool history. [source: code.claude.com/docs/en/common-workflows]
- /rewind menu: restore conversation only, code only, or both. Checkpoints created before every Claude action. Persist across sessions. [source: code.claude.com/docs/en/common-workflows + best-practices]
- Session naming (/rename, -n flag) enables finding sessions later. B filter in picker = sessions from current branch. [source: code.claude.com/docs/en/common-workflows]
- LangGraph checkpointing model: keyed by thread_id, PostgresSaver for production, MemorySaver for dev only. Resume by passing same thread_id back. [source: zylos.ai checkpointing]
- Temporal model: event-history replay — completed activities skipped on recovery; idempotency keys mandatory for external writes (format: {workflow_id}:{step_name}). [source: zylos.ai checkpointing]
- "Interrupt execution when behavior becomes unexpected; provide clear feedback; restart with refined context." Adjust strategy (different LLMs, more context, external search) rather than abandoning. [source: agentic-coding.github.io]
- Rollback + retry is cheap with AI: "regenerating code with AI is often low-cost; if the process has gone awry, roll back to nearest checkpoint." [source: codegen.com agentic workflows]
- For multi-step task state persistence across sessions: use dedicated tracking files (plan.md, tickets, todo lists). [source: agentic-coding.github.io]
- Swarm pattern: task files at ~/.claude/tasks/{team}/N.json survive process restarts. Owner field prevents duplicate work. No explicit rollback — forward-only with manual intervention for failure. [source: kieranklaassen swarm skill]

GAPS: No published pattern for "partial resume" — resuming from the middle of a multi-step skill that was interrupted mid-phase (as opposed to between phases).
