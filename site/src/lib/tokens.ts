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
  /** Human-readable explanation of what this token controls */
  description: string;
}

export const tokens: Token[] = [
  // Spacing
  { name: '--space-xs',  value: 0.25, unit: 'rem', category: 'spacing', min: 0, max: 2,  step: 0.125, description: 'Tight gaps: inline element spacing, token row gaps' },
  { name: '--space-sm',  value: 0.5,  unit: 'rem', category: 'spacing', min: 0, max: 2,  step: 0.125, description: 'Small padding: panel insets, group separators' },
  { name: '--space-md',  value: 1,    unit: 'rem', category: 'spacing', min: 0, max: 4,  step: 0.125, description: 'Medium padding: card insets, form field spacing' },
  { name: '--space-lg',  value: 1.5,  unit: 'rem', category: 'spacing', min: 0, max: 4,  step: 0.125, description: 'Large spacing: section gaps, panel offsets' },
  { name: '--space-xl',  value: 2,    unit: 'rem', category: 'spacing', min: 0, max: 6,  step: 0.125, description: 'Extra-large spacing: major section margins' },
  { name: '--space-2xl', value: 3,    unit: 'rem', category: 'spacing', min: 0, max: 8,  step: 0.125, description: 'Double-large spacing: page-level vertical rhythm' },
  { name: '--space-3xl', value: 4,    unit: 'rem', category: 'spacing', min: 0, max: 10, step: 0.25,  description: 'Triple-large spacing: hero and top-level gaps' },

  // Layout widths
  { name: '--prose-width',   value: 42, unit: 'rem', category: 'layout', min: 20, max: 80,  step: 1,   description: 'Maximum width of text columns' },
  { name: '--figure-width',  value: 64, unit: 'rem', category: 'layout', min: 40, max: 100, step: 1,   description: 'Maximum width of interactive figure containers' },
  { name: '--sidebar-width', value: 16, unit: 'rem', category: 'layout', min: 10, max: 30,  step: 0.5, description: 'Width of the table of contents sidebar' },

  // Radii
  { name: '--radius-sm', value: 4,  unit: 'px', category: 'radii', min: 0, max: 24, step: 1, description: 'Small border radius: buttons, badges' },
  { name: '--radius-md', value: 8,  unit: 'px', category: 'radii', min: 0, max: 24, step: 1, description: 'Medium border radius: cards, inputs' },
  { name: '--radius-lg', value: 12, unit: 'px', category: 'radii', min: 0, max: 32, step: 1, description: 'Large border radius: panels, modals' },
];

/** Generate a CSS custom property declarations string from token definitions. */
export function tokensToCss(tokenList: Token[]): string {
  return tokenList.map((t) => `${t.name}: ${t.value}${t.unit}`).join('; ');
}
