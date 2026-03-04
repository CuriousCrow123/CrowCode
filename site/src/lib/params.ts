/**
 * Widget parameter definitions — per-widget tunable values.
 *
 * Each widget defines its own `paramDefs` array using this interface.
 * The reusable WidgetDebugPanel reads the definitions and renders sliders.
 * Style params flow via scoped CSS custom properties; behavioral params
 * are used directly in JS.
 */

export interface Param {
  /** Identifier, e.g. 'stepSize' */
  name: string;
  /** Default numeric value */
  value: number;
  /** Display unit ('' for unitless, 'rem', 'px', etc.) */
  unit: string;
  /** Grouping key for the debug panel UI */
  category: string;
  /** Slider minimum */
  min: number;
  /** Slider maximum */
  max: number;
  /** Slider step increment */
  step: number;
  /** Human-readable explanation of what this param controls */
  description: string;
}

/** Build a defaults map from param definitions. */
export function paramDefaults(defs: Param[]): Record<string, number> {
  return Object.fromEntries(defs.map((p) => [p.name, p.value]));
}

/** Load saved param overrides from localStorage, falling back to defaults. */
export function loadParams(widgetId: string, defs: Param[]): Record<string, number> {
  const defaults = paramDefaults(defs);
  try {
    const saved = JSON.parse(localStorage.getItem(`widget-params-${widgetId}`) ?? '{}');
    return { ...defaults, ...saved };
  } catch {
    return defaults;
  }
}

/** Persist only the overridden params to localStorage. */
export function saveParams(widgetId: string, values: Record<string, number>, defs: Param[]) {
  const defaults = paramDefaults(defs);
  const overrides: Record<string, number> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v !== defaults[k]) overrides[k] = v;
  }
  if (Object.keys(overrides).length > 0) {
    localStorage.setItem(`widget-params-${widgetId}`, JSON.stringify(overrides));
  } else {
    localStorage.removeItem(`widget-params-${widgetId}`);
  }
}
