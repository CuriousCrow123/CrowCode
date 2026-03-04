/**
 * Spatial design tokens — the single source of truth.
 *
 * Two consumers import this file:
 * 1. BaseLayout.astro → generates :root CSS custom properties
 * 2. DebugPanel.svelte → renders sliders for real-time adjustment
 *
 * Adding a token here automatically makes it available in CSS and the debug panel.
 * Non-spatial tokens (colors, typography, transitions) live in global.css.
 */

export interface Token {
  /** CSS custom property name, e.g. '--space-lg' */
  name: string;
  /** Default numeric value, e.g. 1.5 */
  value: number;
  /** CSS unit, e.g. 'rem', 'px' */
  unit: string;
  /** Grouping key for the debug panel UI */
  category: string;
  /** Slider minimum */
  min: number;
  /** Slider maximum */
  max: number;
  /** Slider step increment */
  step: number;
}

export const tokens: Token[] = [
  // Spacing
  { name: '--space-xs',  value: 0.25, unit: 'rem', category: 'spacing', min: 0, max: 2,  step: 0.125 },
  { name: '--space-sm',  value: 0.5,  unit: 'rem', category: 'spacing', min: 0, max: 2,  step: 0.125 },
  { name: '--space-md',  value: 1,    unit: 'rem', category: 'spacing', min: 0, max: 4,  step: 0.125 },
  { name: '--space-lg',  value: 1.5,  unit: 'rem', category: 'spacing', min: 0, max: 4,  step: 0.125 },
  { name: '--space-xl',  value: 2,    unit: 'rem', category: 'spacing', min: 0, max: 6,  step: 0.125 },
  { name: '--space-2xl', value: 3,    unit: 'rem', category: 'spacing', min: 0, max: 8,  step: 0.125 },
  { name: '--space-3xl', value: 4,    unit: 'rem', category: 'spacing', min: 0, max: 10, step: 0.25  },

  // Layout widths
  { name: '--prose-width',   value: 42, unit: 'rem', category: 'layout', min: 20, max: 80,  step: 1   },
  { name: '--figure-width',  value: 64, unit: 'rem', category: 'layout', min: 40, max: 100, step: 1   },
  { name: '--sidebar-width', value: 16, unit: 'rem', category: 'layout', min: 10, max: 30,  step: 0.5 },

  // Radii
  { name: '--radius-sm', value: 4,  unit: 'px', category: 'radii', min: 0, max: 24, step: 1 },
  { name: '--radius-md', value: 8,  unit: 'px', category: 'radii', min: 0, max: 24, step: 1 },
  { name: '--radius-lg', value: 12, unit: 'px', category: 'radii', min: 0, max: 32, step: 1 },
];

/** Generate a CSS custom property declarations string from token definitions. */
export function tokensToCss(tokenList: Token[]): string {
  return tokenList.map((t) => `${t.name}: ${t.value}${t.unit}`).join('; ');
}
