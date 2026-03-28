#!/usr/bin/env node
/**
 * Generates src/lib/data/features.ts from docs/feature-inventory.md.
 *
 * Run: node scripts/gen-features.mjs
 * Wired as prebuild/predev in package.json.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const INPUT = resolve(ROOT, 'docs/feature-inventory.md');
const OUTPUT = resolve(ROOT, 'src/lib/data/features.ts');

const md = readFileSync(INPUT, 'utf-8');
const lines = md.split('\n');

/** @typedef {{ name: string; category: string; status: string; description: string }} Feature */

/** @type {Feature[]} */
const features = [];

// ── Helpers ──

/** Strip backticks and leading/trailing pipes from a markdown table cell. */
function clean(cell) {
	return cell.replace(/`/g, '').replace(/\\\|/g, '|').trim();
}

/** Parse a markdown table row into cells. Handles escaped pipes \| */
function parseRow(line) {
	// Split on | but not \|
	const raw = line.split(/(?<!\\)\|/).slice(1, -1);
	return raw.map(clean);
}

/** Is this a table separator line (|---|---|) */
function isSeparator(line) {
	return /^\|[\s:?-]+\|/.test(line);
}

/** Is this a table header row? (immediately followed by a separator) */
function isHeader(line, nextLine) {
	return line.startsWith('|') && nextLine && isSeparator(nextLine);
}

/** Is this a data row? (starts with | but not a separator or header) */
function isRow(line) {
	return line.startsWith('|') && !isSeparator(line);
}

/** Track which lines are headers so we can skip them */
const headerLines = new Set();
for (let i = 0; i < lines.length - 1; i++) {
	if (isHeader(lines[i], lines[i + 1])) {
		headerLines.add(i);
	}
}

function add(name, category, status, description) {
	if (!name) return;
	features.push({ name, category, status, description: description || '' });
}

// ── Section tracking ──

let h2 = '';
let h3 = '';

// Sections we skip for feature extraction (they're metadata, not features)
const SKIP_SECTIONS = new Set([
	'Architecture Constraints', 'Test Programs', 'Test Coverage', 'Summary',
	'Prioritized Remaining Work',
]);

for (let i = 0; i < lines.length; i++) {
	const line = lines[i];

	// Track headings
	if (line.startsWith('## ') && !line.startsWith('### ')) {
		h2 = line.slice(3).trim();
		h3 = '';
		continue;
	}
	if (line.startsWith('### ')) {
		h3 = line.slice(4).trim();
		continue;
	}

	// Skip non-feature sections
	if (SKIP_SECTIONS.has(h2)) continue;
	// Skip priority sub-sections (they duplicate "Not Implemented")
	if (h2 === 'Prioritized Remaining Work') continue;

	// Only process data rows (skip headers and separators)
	if (!isRow(line) || headerLines.has(i)) continue;

	const cells = parseRow(line);
	if (cells.length < 2) continue;

	// ── Standard Library: Not Implemented ──
	// Format: | Category | `fn1`, `fn2`, ... |
	if (h2 === 'Standard Library' && h3 === 'Not Implemented') {
		const category = cells[0];
		const funcs = cells[1].split(',').map((f) => f.trim()).filter(Boolean);
		for (const fn of funcs) {
			add(fn, 'Standard Library', 'not-implemented', `${category} function. Not implemented.`);
		}
		continue;
	}

	// ── Standard Library: Implemented ──
	// Format: | Function | Notes |
	if (h2 === 'Standard Library' && (h3 === 'Implemented (26 functions)' || h3.startsWith('Implemented'))) {
		add(cells[0], 'Standard Library', 'implemented', cells[1] || '');
		continue;
	}

	// ── Partially Working ──
	// Format: | Feature | What works | What doesn't | Notes |
	if (h2 === 'Partially Working') {
		const desc = [cells[1], cells[2], cells[3]].filter(Boolean).join('. ');
		add(cells[0], 'Partial', 'partial', desc);
		continue;
	}

	// ── Not Implemented: Language Features ──
	// Format: | Feature | Parser | Interpreter | Difficulty | Notes |
	if (h2 === 'Not Implemented' && h3 === 'Language Features') {
		add(cells[0], 'Language', 'not-implemented', cells[4] || '');
		continue;
	}

	// ── Not Implemented: Format String Gaps ──
	// Format: | Gap | Difficulty | Notes |
	if (h2 === 'Not Implemented' && h3 === 'Format String Gaps') {
		add(cells[0], 'Format Strings', 'not-implemented', cells[2] || '');
		continue;
	}

	// ── Not Implemented: Runtime Limitations ──
	// Format: | Limitation | Notes |
	if (h2 === 'Not Implemented' && h3 === 'Runtime Limitations') {
		add(cells[0], 'Runtime', 'not-implemented', cells[1] || '');
		continue;
	}

	// ── Sections with "Tested" column (Data Types, Operators, Control Flow, Functions, Memory) ──
	if (['Data Types', 'Operators', 'Control Flow', 'Functions', 'Memory Management'].includes(h2)) {
		const testedIdx = cells.findIndex((c) => /^(Yes|Partial|Implicit|No)$/i.test(c));
		const name = cells[0];
		const tested = testedIdx >= 0 ? cells[testedIdx] : '';

		let status = 'implemented';
		if (/^partial$/i.test(tested)) status = 'partial';
		else if (/^no$/i.test(tested)) status = 'not-implemented';

		const category = h2 === 'Memory Management' ? 'Memory' : h2;

		// Use last column as description (Notes), skipping size/tested/behavior columns
		// For tables with Notes as last column, this is always the right choice
		const lastCol = cells[cells.length - 1];
		// If last column is the tested column itself, look for a "Behavior" or other middle column
		let desc = '';
		if (testedIdx === cells.length - 1) {
			// No notes column — use behavior/description columns (skip name and tested)
			desc = cells.slice(1, testedIdx).filter(Boolean).join('. ');
		} else {
			desc = lastCol || '';
		}
		add(name, category, status, desc);
		continue;
	}

	// ── Visualization ──
	// Format: | Feature | Status | Notes |
	if (h2 === 'Visualization') {
		const status = /working/i.test(cells[1]) ? 'implemented' : 'not-implemented';
		add(cells[0], 'Visualization', status, cells[2] || '');
		continue;
	}

	// ── UI Features, Engine, Infrastructure ──
	// Format: | Feature | Notes | — all implemented
	if (['UI Features', 'Engine', 'Infrastructure'].includes(h2)) {
		add(cells[0], h2, 'implemented', cells[1] || '');
		continue;
	}
}

// ── Generate TypeScript ──

function escapeStr(s) {
	return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

const tsLines = [
	'// AUTO-GENERATED from docs/feature-inventory.md',
	'// Do not edit manually — run: node scripts/gen-features.mjs',
	'',
	"export type FeatureStatus = 'implemented' | 'partial' | 'not-implemented';",
	'',
	'export interface Feature {',
	'\tname: string;',
	'\tcategory: string;',
	'\tstatus: FeatureStatus;',
	'\tdescription: string;',
	'}',
	'',
	'export const features: Feature[] = [',
];

for (const f of features) {
	tsLines.push(`\t{ name: '${escapeStr(f.name)}', category: '${escapeStr(f.category)}', status: '${f.status}', description: '${escapeStr(f.description)}' },`);
}

tsLines.push('];', '');

writeFileSync(OUTPUT, tsLines.join('\n'), 'utf-8');
console.log(`gen-features: wrote ${features.length} features to src/lib/data/features.ts`);
