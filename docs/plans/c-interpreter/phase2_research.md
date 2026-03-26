# Phase 2: External Research

## tree-sitter-c WASM in Browser

- Use `web-tree-sitter` npm package (v0.25.10 recommended for stability — ABI mismatch with v0.26+)
- Pre-built `tree-sitter-c.wasm` from `tree-sitter-wasms` package (~793KB)
- `web-tree-sitter.wasm` runtime is ~192KB
- Total: ~1MB uncompressed, ~500KB gzipped
- Vite requires `optimizeDeps: { exclude: ['web-tree-sitter'] }`
- Copy WASM files to `static/` via postinstall script
- Use `locateFile` in `Parser.init()` to resolve WASM paths
- Use `childForFieldName()` not positional indexing for AST traversal
- Use `namedChildren` to skip punctuation tokens
- Positions are zero-indexed `{ row, column }`
- Parser.init() is async, must complete before any parsing

## Web Worker Patterns

- Use `import Worker from './worker.ts?worker'` pattern in Vite/SvelteKit
- Create worker in `onMount`, terminate in `onDestroy`
- Timeout: `setTimeout` + `worker.terminate()` + recreate pattern
- Use structured clone for MemoryEntry[][] (faster than transferables for object arrays)
- For progress reporting: yield between steps with `setTimeout(0)` or async generator
- Initialize tree-sitter inside the worker, not main thread
- Avoid `?worker&inline` when worker needs to fetch WASM files
