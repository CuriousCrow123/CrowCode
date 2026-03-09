# CrowCode Research Documentation Index

**Generated**: March 4, 2026
**For**: Building complex interactive widgets for bits-to-numbers chapter

---

## Start Here

**New to this project?** Read in this order:

1. **[QUICK_REFERENCE.md](QUICK_REFERENCE.md)** ← Start here (5 min read)
   - 90-second widget creation
   - Essential patterns
   - Common mistakes to avoid
   - File structure overview

2. **[CLAUDE.md](CLAUDE.md)** ← Architecture rules (must-read)
   - Non-negotiable constraints
   - Widget separation rules
   - Token system rules

3. **[RESEARCH_SUMMARY.md](RESEARCH_SUMMARY.md)** ← Executive summary (10 min read)
   - Three pillars: tokens, params, sections
   - Animation patterns overview
   - Key files and absolute paths
   - For your new chapter (recommendations)

---

## Deep Dives

**Need detailed understanding?** Use these reference docs:

### [RESEARCH_PATTERNS.md](RESEARCH_PATTERNS.md)
Complete analysis of the codebase. Covers:
- Architecture & structure
- Widget param system (full spec)
- Animation patterns (BitMatrix, BitRepresenter, continuous)
- Section composition patterns
- Design token system (spatial vs. non-spatial)
- Debug panel system
- Hydration & performance
- No Canvas/WebGL (current approach)
- For your new chapter (patterns you'll need)

### [ANIMATION_PATTERNS.md](ANIMATION_PATTERNS.md)
Detailed code examples for each animation style:
- **Grid animation** (BitMatrix style) — Full worked example
- **SVG signals** (BitRepresenter style) — Full worked example
- **Continuous canvas** (sin wave) — Full worked example
- **RGB visualizer** — Full worked example
- Performance checklist
- Canvas patterns & helpers
- Testing patterns
- Gotchas & common mistakes

### [WIDGET_IMPLEMENTATION_GUIDE.md](WIDGET_IMPLEMENTATION_GUIDE.md)
Practical, task-focused guide:
- Widget creation template
- Step-by-step checklist
- Animation patterns (which to use when)
- Parameter categories reference
- State management pattern
- Common mistakes to avoid
- Section integration pattern
- Sandbox page pattern
- Testing checklist
- File checklist
- Useful code snippets

---

## Reference Files (Absolute Paths)

### Core System Files
All in `/Users/alan/Desktop/CrowCode/site/src/`

| File | Purpose |
|------|---------|
| `lib/tokens.ts` | Spatial design tokens (source of truth) |
| `lib/params.ts` | Widget param interface + helpers |
| `styles/global.css` | Non-spatial tokens, reset, prose |
| `layouts/BaseLayout.astro` | HTML shell + token CSS injection |
| `layouts/EssayLayout.astro` | TOC + essay container |

### Debug Components
| File | Purpose |
|------|---------|
| `components/debug/DebugPanel.svelte` | Global token sliders (bottom-right) |
| `components/debug/WidgetDebugPanel.svelte` | Per-widget param sliders (gear icon) |

### Example Widgets
| File | Use Case |
|------|----------|
| `components/widgets/Counter.svelte` | Simple interactive widget (start here) |
| `components/widgets/SingleBit.svelte` | 3D flip animation |
| `components/widgets/BitMatrix.svelte` | Grid animation + interval loop |
| `components/widgets/BitRepresenter.svelte` | SVG wiring + signal animation |

### Example Sections
| File | Use Case |
|------|----------|
| `components/sections/example/InteractiveDemo.svelte` | Section composition template |
| `components/sections/bits/WhatIsABit.svelte` | Full example (prose + widgets) |

### Sandbox Pages
| File | Use Case |
|------|----------|
| `pages/sandbox/index.astro` | Widget catalog |
| `pages/sandbox/counter.astro` | Widget sandbox template |
| `pages/sandbox/bit-matrix.astro` | Complex widget sandbox |

### Decision Records
| File | Topic |
|------|-------|
| `docs/decisions/001-tokens-in-typescript.md` | Why spatial tokens in TS not CSS |
| `docs/decisions/002-per-widget-params.md` | Why per-widget params not central registry |

### Project Rules
| File | Purpose |
|------|---------|
| `CLAUDE.md` | **READ FIRST** — Architecture constraints |
| `README.md` | Project overview, tech stack, how-to |

---

## For Your New Chapter

### Anticipated Widgets

Based on your scope (bits→numbers, representations, RAM, memory viewer), you'll build:

1. **Sin Wave Visualizer** (continuous animation)
   - Reference: [ANIMATION_PATTERNS.md](ANIMATION_PATTERNS.md#3-continuous-sin-wave-animation)
   - Example code: Canvas-based sin wave

2. **RGB/HSL Viewer** (representation mapping)
   - Reference: [ANIMATION_PATTERNS.md](ANIMATION_PATTERNS.md#4-canvas-based-rgb-visualizer)
   - Example code: Multi-canvas channel visualization

3. **RAM Grid** (memory visualization)
   - Reference: [ANIMATION_PATTERNS.md](ANIMATION_PATTERNS.md#1-interval-based-grid-animation)
   - Example code: Memory viewer with byte addressing

4. **CPU Wires** (signal propagation)
   - Reference: [ANIMATION_PATTERNS.md](ANIMATION_PATTERNS.md#2-svg-signal-animation)
   - Example code: SVG bus connections

5. **Memory Viewer** (code + dual views)
   - Composite: Combines grid + SVG patterns
   - Reference: Sections 1 & 2 of [ANIMATION_PATTERNS.md](ANIMATION_PATTERNS.md)

### Recommended Reading Path for Development

1. [QUICK_REFERENCE.md](QUICK_REFERENCE.md) — Get oriented
2. [CLAUDE.md](CLAUDE.md) — Understand constraints
3. [WIDGET_IMPLEMENTATION_GUIDE.md](WIDGET_IMPLEMENTATION_GUIDE.md) — Create your first widget
4. [ANIMATION_PATTERNS.md](ANIMATION_PATTERNS.md) — Reference for animation code
5. Example source files — Copy, modify, iterate

---

## Common Questions

**Q: Where do I define design tokens?**
A: `/Users/alan/Desktop/CrowCode/site/src/lib/tokens.ts` for spatial (spacing, layout, radii). `/site/src/styles/global.css` for non-spatial (colors, fonts, transitions).

**Q: Can widgets use global spacing tokens?**
A: No. See [CLAUDE.md](CLAUDE.md) constraint #1. Widgets define their own params.

**Q: How do I add a tunable parameter?**
A: Add to `paramDefs` array in widget. [WIDGET_IMPLEMENTATION_GUIDE.md](WIDGET_IMPLEMENTATION_GUIDE.md#quick-start-creating-a-new-widget) has template.

**Q: Which animation pattern for my widget?**
A: See [ANIMATION_PATTERNS.md](ANIMATION_PATTERNS.md#performance-checklist) quick pick table.

**Q: How do I prevent memory leaks?**
A: Always return cleanup function from `$effect()`. See [QUICK_REFERENCE.md](QUICK_REFERENCE.md#cleanup-pattern).

**Q: Can I use Canvas/WebGL?**
A: Yes, but not currently used. See [RESEARCH_PATTERNS.md](RESEARCH_PATTERNS.md#no-canvaswebgl-usage).

**Q: What if I want to add a new global token?**
A: Edit `/Users/alan/Desktop/CrowCode/site/src/lib/tokens.ts`, add to array. Appears in debug panel automatically.

**Q: How do I integrate a widget into a section?**
A: See [WIDGET_IMPLEMENTATION_GUIDE.md](WIDGET_IMPLEMENTATION_GUIDE.md#section-integration-pattern) + example: `/Users/alan/Desktop/CrowCode/site/src/components/sections/bits/WhatIsABit.svelte`

---

## Documentation Map

```
QUICK_REFERENCE.md          ← Start here (bookmark this)
    ↓
CLAUDE.md                   ← Must-read rules
    ↓
RESEARCH_SUMMARY.md         ← Executive overview
    ↓
    ├─ RESEARCH_PATTERNS.md      ← Full technical analysis
    ├─ ANIMATION_PATTERNS.md     ← Code examples for animations
    └─ WIDGET_IMPLEMENTATION_GUIDE.md ← Step-by-step task guide
       
Source files (/site/src/)
    ├─ lib/tokens.ts, lib/params.ts
    ├─ components/widgets/ ← Copy & modify
    ├─ components/sections/ ← Copy & modify
    └─ pages/sandbox/ ← Copy & modify
```

---

## Quick Links

**Project root**: `/Users/alan/Desktop/CrowCode/`
**Source root**: `/Users/alan/Desktop/CrowCode/site/src/`
**Widgets**: `/Users/alan/Desktop/CrowCode/site/src/components/widgets/`
**Sections**: `/Users/alan/Desktop/CrowCode/site/src/components/sections/`
**Sandbox**: `/Users/alan/Desktop/CrowCode/site/src/pages/sandbox/`
**Tokens**: `/Users/alan/Desktop/CrowCode/site/src/lib/tokens.ts`
**Params**: `/Users/alan/Desktop/CrowCode/site/src/lib/params.ts`

All paths are absolute and file-safe.

---

## Key Takeaways

1. **Simplicity**: 3 dependencies, no magic, pure web APIs
2. **Separation**: Tokens → widgets → sections → pages
3. **Independence**: Widgets never reference global tokens
4. **Debug**: Two-layer system (global + per-widget)
5. **Performance**: Visibility observers, document.hidden checks
6. **Type safety**: All tokens and params use TypeScript interfaces
7. **No Canvas/WebGL**: DOM + CSS + SVG for all current animations
8. **localStorage persistence**: Params persist per widget

---

## Development Checklist

- [ ] Read CLAUDE.md (project rules)
- [ ] Read QUICK_REFERENCE.md (essential patterns)
- [ ] Explore example widgets (Counter, BitMatrix, BitRepresenter)
- [ ] Create first widget using template
- [ ] Test in sandbox with debug panel
- [ ] Integrate into section
- [ ] Add to essay page
- [ ] Test production build

---

## Feedback Loop

While developing:

1. **Design**: Draft widget structure, decide on params
2. **Implement**: Use template + examples as reference
3. **Debug**: Adjust params via debug panel (real-time)
4. **Test**: Verify performance, accessibility, responsiveness
5. **Integrate**: Move from sandbox to section
6. **Polish**: Fine-tune based on prose context

---

## Absolute Paths Reference

### Documentation Files
- `/Users/alan/Desktop/CrowCode/CLAUDE.md`
- `/Users/alan/Desktop/CrowCode/QUICK_REFERENCE.md`
- `/Users/alan/Desktop/CrowCode/RESEARCH_SUMMARY.md`
- `/Users/alan/Desktop/CrowCode/RESEARCH_PATTERNS.md`
- `/Users/alan/Desktop/CrowCode/ANIMATION_PATTERNS.md`
- `/Users/alan/Desktop/CrowCode/WIDGET_IMPLEMENTATION_GUIDE.md`
- `/Users/alan/Desktop/CrowCode/README.md`

### Source Files
- `/Users/alan/Desktop/CrowCode/site/src/lib/tokens.ts`
- `/Users/alan/Desktop/CrowCode/site/src/lib/params.ts`
- `/Users/alan/Desktop/CrowCode/site/src/styles/global.css`
- `/Users/alan/Desktop/CrowCode/site/src/layouts/BaseLayout.astro`
- `/Users/alan/Desktop/CrowCode/site/src/layouts/EssayLayout.astro`
- `/Users/alan/Desktop/CrowCode/site/src/components/debug/DebugPanel.svelte`
- `/Users/alan/Desktop/CrowCode/site/src/components/debug/WidgetDebugPanel.svelte`
- `/Users/alan/Desktop/CrowCode/site/src/components/widgets/Counter.svelte`
- `/Users/alan/Desktop/CrowCode/site/src/components/widgets/BitMatrix.svelte`
- `/Users/alan/Desktop/CrowCode/site/src/components/widgets/BitRepresenter.svelte`
- `/Users/alan/Desktop/CrowCode/site/src/components/sections/bits/WhatIsABit.svelte`
- `/Users/alan/Desktop/CrowCode/site/src/pages/sandbox/index.astro`

---

## Next Steps

1. **Bookmark** `QUICK_REFERENCE.md`
2. **Read** `CLAUDE.md` (10 min)
3. **Explore** example widgets (15 min)
4. **Create** first widget using template (30 min)
5. **Develop** with debug panel (iterative)
6. **Integrate** into chapter sections

Good luck! 🚀
