# CrowCode

> C is hard to learn partly because you can't see memory. CrowCode shows you.

**[Try it live](https://CuriousCrow123.github.io/CrowCode/)**

Interactive C memory visualizer. Step through C programs and watch stack frames, local variables, heap allocations, and scope lifecycle change at each instruction. Like [Python Tutor](https://pythontutor.com/), but for C memory layout.

## Features

- Watch stack frames grow as functions are called and shrink when they return
- See local variables appear, hold values, and disappear when they go out of scope
- Follow heap allocations from `malloc()` to `free()` — with leak and use-after-free detection
- Step forward and backward at your own pace, with sub-step mode for loop internals
- Write your own C code in the Custom tab — parsed and interpreted entirely in the browser

## Quick Start

**Prerequisites:** [Node.js](https://nodejs.org/) 20+ and npm.

```bash
git clone https://github.com/CuriousCrow123/CrowCode.git
cd CrowCode
npm install
npm run dev
```

Open [localhost:5173/CrowCode](http://localhost:5173/CrowCode) in your browser.

> `npm install` runs a `postinstall` script that copies tree-sitter WASM files to `static/`. These are required for the C interpreter — if they're missing, the Custom tab won't work.

## Commands

```bash
npm run dev        # Dev server at localhost:5173/CrowCode
npm run build      # Static build to build/
npm run preview    # Preview the static build
npm test           # Run all tests (600+ via Vitest)
npm run test:watch # Watch mode
npm run check      # TypeScript + Svelte type verification
```

## How It Works

```
C source code ──→ tree-sitter parser ──→ AST ──→ interpreter ──→ Program
                                                                    │
Pre-authored programs (TypeScript) ─────────────────────────────────┘
                                                                    │
                                                                    ▼
                                                            buildSnapshots()
                                                                    │
                                                                    ▼
                                                            MemoryEntry[][]
                                                              (one per step)
                                                                    │
                                                          ┌─────────┴──────────┐
                                                          ▼                    ▼
                                                    CodeEditor           MemoryView
                                                          ▲                    ▲
                                                          └─────────┬──────────┘
                                                           StepControls
```

Programs produce steps. Each step has ops that transform the previous memory snapshot. All snapshots are pre-computed on load — stepping is just indexing into an array. See [docs/architecture.md](docs/architecture.md) for the full system design.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, conventions, testing, and PR process.

## Deployment

Static site on GitHub Pages via `@sveltejs/adapter-static`. Push to `main` deploys automatically via GitHub Actions.

Live at: https://CuriousCrow123.github.io/CrowCode/

## License

MIT
