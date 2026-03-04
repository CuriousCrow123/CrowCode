# ADR 002: Per-widget tunable parameters

## Status

Accepted

## Context

Widgets need tunable parameters (font sizes, spacing, behavior settings) for real-time adjustment during development, similar to how global spatial tokens work via the DebugPanel. The question is where to define these parameters and how to wire the debug UI.

## Decision

Each widget defines its own `paramDefs` array inline using the `Param` interface from `src/lib/params.ts`. A reusable `WidgetDebugPanel.svelte` component reads the definitions and renders sliders. The panel is embedded inside each widget and gated behind `import.meta.env.DEV`.

Style parameters flow via scoped CSS custom properties (e.g. `--counter-font-size`) set as inline styles on the widget root element. Behavioral parameters (e.g. `stepSize`) are used directly in JS logic. Both are reactive `$state` that the debug panel mutates via `bind:values`.

localStorage persistence is keyed per widget (`widget-params-{widgetId}`).

## Consequences

- Adding a param to a widget requires editing only that widget file
- No central registry to maintain — each widget is fully self-contained
- The `WidgetDebugPanel` is reusable across all widgets with zero customization
- `Param` interface mirrors `Token` (same shape), keeping the mental model consistent
- Widget debug panels are tree-shaken from production builds via `import.meta.env.DEV`

## Alternatives considered

- **Central params registry**: Couples all widgets to a shared file, defeats widget independence
- **External config file per widget**: Two files to keep in sync, breaks single source of truth
- **Props-only approach (no debug UI)**: Loses the real-time slider adjustment that makes development fast
- **Extending the global DebugPanel**: Would mix global tokens with widget-specific params, making the panel unwieldy
