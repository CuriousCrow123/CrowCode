# Plan: Save-to-source for debug panel parameters

## Context

Currently, tuning widget params or global tokens via the debug panel sliders only persists to localStorage. To "bake in" tuned values as new defaults, you must click Copy, manually paste into source, and align formatting. The user wants a **Save** button that writes current slider values directly back to the source file as new defaults.

## Approach

A **Vite plugin** registers dev-only HTTP endpoints. The debug panels POST current values to these endpoints. The plugin updates the source files in-place (replacing only the `value:` field in each param/token object), triggering Vite HMR to reload with new defaults.

## Changes

### 1. New: `site/save-params-plugin.ts` — Vite plugin

Exports a `saveParamsPlugin()` function returning a Vite `Plugin` with a `configureServer` hook that registers two POST endpoints:

**`POST /__api/save-widget-params`**
- Body: `{ widgetId: string, values: Record<string, number> }`
- Scans `src/components/widgets/**/*.svelte` for the file containing `WIDGET_ID = '{widgetId}'`
- For each param name in `values`, finds the line with `name: '{paramName}'` and replaces `value: <old>` with `value: <new>`
- Writes the file back; Vite HMR picks up the change

**`POST /__api/save-tokens`**
- Body: `{ values: Record<string, number> }`
- Opens `src/lib/tokens.ts`
- For each token name in `values`, finds the line with `name: '{tokenName}'` and replaces `value: <old>` with `value: <new>`
- Writes the file back

**Line-level regex replacement strategy:**
```
For each (name, newValue) pair:
  1. Find line containing:  name: '{name}'
  2. On that line, replace:  value: <number>  →  value: <newValue>
```
This preserves all surrounding formatting, comments, and structure.

### 2. Modify: `site/astro.config.mjs` — Register the plugin

```js
import { saveParamsPlugin } from './save-params-plugin';

export default defineConfig({
  integrations: [svelte()],
  vite: {
    plugins: [saveParamsPlugin()],
  },
});
```

### 3. Modify: `site/src/components/debug/WidgetDebugPanel.svelte` — Add Save button

- Add `saveParams()` async function that POSTs `{ widgetId, values }` to `/__api/save-widget-params`
- On success: clear localStorage (`widget-params-${widgetId}`), show "Saved!" feedback (same pattern as existing "Copied!" feedback)
- Add "Save" button in `.debug-actions` (next to Copy and Reset)
- Only visible when `hasOverrides` is true (same condition as Reset)

### 4. Modify: `site/src/components/debug/DebugPanel.svelte` — Add Save button

- Add `saveTokens()` async function that POSTs `{ values }` to `/__api/save-tokens`
- On success: clear localStorage (`debug-token-overrides`), remove inline styles from `document.documentElement`, show "Saved!" feedback
- Add "Save" button in `.debug-actions` (next to Copy and Reset)
- Only visible when `hasOverrides` is true

## Files

| File | Action |
|------|--------|
| `site/save-params-plugin.ts` | **New** — Vite plugin with two POST endpoints |
| `site/astro.config.mjs` | Register plugin via `vite.plugins` |
| `site/src/components/debug/WidgetDebugPanel.svelte` | Add Save button + POST logic |
| `site/src/components/debug/DebugPanel.svelte` | Add Save button + POST logic |

## Post-save flow

1. User clicks "Save"
2. Client POSTs current values to dev server endpoint
3. Plugin updates source file (value fields only)
4. Plugin responds with success
5. Client clears localStorage overrides and shows "Saved!" feedback
6. Vite HMR detects file change and reloads component with new defaults
7. `loadParams()`/`loadSaved()` returns new defaults (no localStorage overrides remain)

## Verification

1. `npm run build` — succeeds (plugin is dev-only, no build impact)
2. Dev server → adjust a Counter slider → click Save → verify Counter.svelte source file has updated `value:` field
3. Dev server → adjust a global token slider → click Save → verify tokens.ts has updated `value:` field
4. After save, confirm localStorage is cleared and HMR reloads correctly
5. Save button only appears when values differ from defaults
