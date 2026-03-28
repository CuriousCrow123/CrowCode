# Contributing to CrowCode

Welcome! CrowCode is an interactive C memory visualizer. Contributions are welcome — whether you're fixing a bug, adding a C feature to the interpreter, or creating a new example program.

## Development Setup

```bash
git clone https://github.com/CuriousCrow123/CrowCode.git
cd CrowCode
npm install    # also copies tree-sitter WASM files to static/
npm run dev    # opens at localhost:5173/CrowCode
```

The dev server runs at `localhost:5173/CrowCode` (not `/`) because of the GitHub Pages base path.

**Stack:** SvelteKit, TypeScript (strict mode), Vitest, Tailwind v4 (via `@tailwindcss/vite` — there is no `tailwind.config.js`), CodeMirror 6. All `.svelte` files use Svelte 5 runes (`$props()`, `$state()`, `$derived()`).

## Running Tests

```bash
npm test                            # all ~600 tests
npm run test:watch                  # watch mode
npx vitest run src/lib/engine/      # target a directory
npx vitest run src/lib/interpreter/evaluator.test.ts  # single file
```

## Before You Submit

Run all three before opening a PR:

```bash
npm test        # all tests pass
npm run check   # svelte-check TypeScript verification
npm run build   # static build succeeds
```

## Code Conventions

TypeScript strict mode. Tabs for indentation, single quotes, semicolons. Use `$lib/` import alias and `import type` for type-only imports. Each module directory has a barrel `index.ts`. Engine code returns `{ result: T; errors: string[] }` — no thrown exceptions. Use `structuredClone()` for snapshot isolation.

Run `npm run check` to verify.

## Adding an Interpreter Feature

1. Check [docs/feature-inventory.md](docs/feature-inventory.md) for the complete feature inventory
2. Write value assertions in `value-correctness.test.ts` using the `interpretAndBuild()` helper
3. Add a full-program integration test in `manual-programs.test.ts`
4. Run `snapshot-regression.test.ts` to verify no regressions to existing programs

`interpretAndBuild()` runs the full pipeline (parse → interpret → validate → buildSnapshots) and asserts no errors.

## Adding an Engine Feature

Collocate tests as `*.test.ts` in the same directory. Export from `engine/index.ts`. Tests use `describe`/`it`/`expect` with inline helper factories (not `beforeEach` globals).

## Commit Format

```
type(scope): description
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`. One logical change per commit. Never commit broken tests or half-finished work.

## Pull Requests

Branch from `main`. PR description should explain *why*, not just what changed. Small PRs preferred over large ones.

## Architecture

Read [docs/architecture.md](docs/architecture.md) before writing code — Levels 1-2 take about 5 minutes and give you the full mental model.

For design decisions, see [docs/decisions/](docs/decisions/) — these explain *why* things are the way they are.

## Questions

Open a [GitHub issue](https://github.com/CuriousCrow123/CrowCode/issues).
